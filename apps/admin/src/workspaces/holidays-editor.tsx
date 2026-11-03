'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import { ApiFailure, unwrap } from '../query/fetch';
import { scopeKey } from '../query/keys';
import { useScope } from '../query/provider';
import { draftOf, holidayChangeOf, holidayOf, MAX_NAME } from './holiday-edit';
import { holidayPath, holidaysPath, spanText, type Holiday } from './holidays';
import { HolidaysRead, HolidayTable } from './holidays-table';

const field = 'rounded-input border border-border-strong px-3 py-2';
const small = 'rounded-input border border-border-strong px-3 py-1';
const button = 'rounded-input border border-border-strong px-4 py-2 disabled:opacity-70';
const primary = 'self-start rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70';
const dialogClass =
  'm-auto w-[440px] max-w-full rounded-dialog bg-surface p-6 shadow-dialog backdrop:bg-overlay';

function Failure({ failure }: { failure: ApiFailure | null }) {
  if (!failure) return null;
  return (
    <div role="alert" className="flex flex-col gap-1">
      <p>{failure.error.message}</p>
      {failure.error.traceId ? (
        <p className="text-12 text-text-muted">Mã: {failure.error.traceId}</p>
      ) : null}
    </div>
  );
}

/**
 * The days off of 2b-i with "Thêm ngày nghỉ" (the one primary button) and "Sửa"/"Xóa" on each row (2b-ii). Each waits for the
 * server, then the list is read again (the API orders it) and a sentence says what was done.
 */
export function HolidaysEditor(p: {
  workspaceId: string;
  days: readonly Holiday[];
  busy: boolean;
  refresh: () => void;
}) {
  const [open, setOpen] = useState<{ kind: 'edit' | 'remove'; day: Holiday | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const done = (text: string) => {
    setNotice(text);
    setOpen(null);
  };
  const actions = (h: Holiday) => (
    <div className="flex gap-2">
      <button
        type="button"
        className={small}
        aria-label={`Sửa ngày nghỉ ${h.name}`}
        onClick={() => setOpen({ kind: 'edit', day: h })}
      >
        Sửa
      </button>
      <button
        type="button"
        className={small}
        aria-label={`Xóa ngày nghỉ ${h.name}`}
        onClick={() => setOpen({ kind: 'remove', day: h })}
      >
        Xóa
      </button>
    </div>
  );
  return (
    <>
      <button
        type="button"
        className={primary}
        onClick={() => {
          setNotice(null);
          setOpen({ kind: 'edit', day: null });
        }}
      >
        Thêm ngày nghỉ
      </button>
      {notice ? <p role="status">{notice}</p> : null}
      {p.days.length ? (
        <HolidayTable days={p.days} actions={actions} />
      ) : (
        <HolidaysRead days={p.days} busy={p.busy} refresh={p.refresh} />
      )}
      {open?.kind === 'edit' ? (
        <HolidayDialog
          workspaceId={p.workspaceId}
          day={open.day}
          onClose={() => setOpen(null)}
          onDone={done}
        />
      ) : null}
      {open?.kind === 'remove' && open.day ? (
        <RemoveDialog
          workspaceId={p.workspaceId}
          day={open.day}
          onClose={() => setOpen(null)}
          onDone={done}
        />
      ) : null}
    </>
  );
}

/**
 * Add (`POST`, one Idempotency-Key for one day off, kept when the same one is sent again) or change (`PATCH`, only what changed;
 * nothing changed closes, asking nothing). 422 holiday_overlap / holiday_in_past say what to do (errors.ts); the form stays.
 */
function HolidayDialog(p: {
  workspaceId: string;
  day: Holiday | null;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const scope = useScope();
  const queries = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const last = useRef<{ what: string; key: string } | null>(null);
  const [draft, setDraft] = useState(() => draftOf(p.day));
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation<Holiday, ApiFailure, { body: object; key?: string }>({
    mutationFn: ({ body, key }) =>
      unwrap(
        p.day
          ? api<Holiday>(holidayPath(p.workspaceId, p.day.id), { method: 'PATCH', body })
          : api<Holiday>(holidaysPath(p.workspaceId), {
              method: 'POST',
              body,
              ...(key ? { idempotencyKey: key } : {}),
            }),
      ),
    onSuccess: (h) => {
      void queries.invalidateQueries({ queryKey: scopeKey(scope, 'workspace-holidays') });
      p.onDone(p.day ? `Đã sửa ngày nghỉ ${h.name}.` : `Đã thêm ngày nghỉ ${h.name}.`);
      dialog.current?.close();
    },
  });
  useEffect(() => dialog.current?.showModal(), []);
  const edit = (next: Partial<typeof draft>) => {
    setDraft((d) => ({ ...d, ...next }));
    setProblem(null);
    save.reset();
  };
  const submit = () => {
    if (save.isPending) return;
    const body = p.day ? holidayChangeOf(p.day, draft) : holidayOf(draft);
    if (typeof body === 'string') return setProblem(body);
    if (p.day) return Object.keys(body).length ? save.mutate({ body }) : dialog.current?.close();
    const what = JSON.stringify(body);
    const key = last.current?.what === what ? last.current.key : crypto.randomUUID();
    last.current = { what, key };
    save.mutate({ body, key });
  };
  const input = (label: string, k: keyof typeof draft, type = 'text') => (
    <label className="flex flex-col gap-1">
      {label}
      <input
        type={type}
        value={draft[k]}
        maxLength={k === 'name' ? MAX_NAME : undefined}
        className={field}
        onChange={(e) => edit({ [k]: e.target.value })}
      />
    </label>
  );
  return (
    <dialog
      ref={dialog}
      aria-labelledby="holiday-title"
      onClose={p.onClose}
      className={dialogClass}
    >
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h3 id="holiday-title" className="text-16 font-semibold">
          {p.day ? `Sửa ngày nghỉ — ${p.day.name}` : 'Thêm ngày nghỉ'}
        </h3>
        {input('Tên ngày nghỉ', 'name')}
        {input('Từ ngày', 'startsOn', 'date')}
        {input('Đến ngày (nghỉ một ngày thì chọn cùng ngày)', 'endsOn', 'date')}
        {problem ? <p role="alert">{problem}</p> : null}
        <Failure failure={save.error} />
        <div className="flex gap-2">
          <button
            type="submit"
            className={primary}
            disabled={save.isPending}
            aria-busy={save.isPending}
          >
            {save.isPending ? 'Đang lưu…' : p.day ? 'Lưu ngày nghỉ' : 'Thêm ngày nghỉ'}
          </button>
          <button type="button" className={button} onClick={() => dialog.current?.close()}>
            Hủy
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** "Xóa ngày nghỉ" (`DELETE`): asked once more, waits for the server; its dates are working days again. */
function RemoveDialog(p: {
  workspaceId: string;
  day: Holiday;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const scope = useScope();
  const queries = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const remove = useMutation<null, ApiFailure, void>({
    mutationFn: () => unwrap(api<null>(holidayPath(p.workspaceId, p.day.id), { method: 'DELETE' })),
    onSuccess: () => {
      void queries.invalidateQueries({ queryKey: scopeKey(scope, 'workspace-holidays') });
      p.onDone(`Đã xóa ngày nghỉ ${p.day.name}.`);
      dialog.current?.close();
    },
  });
  useEffect(() => dialog.current?.showModal(), []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="holiday-remove-title"
      onClose={p.onClose}
      className={dialogClass}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!remove.isPending) remove.mutate();
        }}
      >
        <h3 id="holiday-remove-title" className="text-16 font-semibold">
          Xóa ngày nghỉ {p.day.name}?
        </h3>
        <p>{spanText(p.day)} thành ngày làm việc theo giờ làm việc của workspace.</p>
        <Failure failure={remove.error} />
        <div className="flex gap-2">
          <button
            type="submit"
            className={primary}
            disabled={remove.isPending}
            aria-busy={remove.isPending}
          >
            {remove.isPending ? 'Đang xóa…' : 'Xóa ngày nghỉ'}
          </button>
          <button type="button" className={button} onClick={() => dialog.current?.close()}>
            Hủy
          </button>
        </div>
      </form>
    </dialog>
  );
}
