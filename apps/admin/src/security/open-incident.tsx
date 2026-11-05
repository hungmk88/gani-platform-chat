'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import { ApiFailure, unwrap } from '../query/fetch';
import { scopeKey } from '../query/keys';
import { useScope } from '../query/provider';
import type { Member } from '../members/list';
import { readAllMembers } from '../workspaces/workspace-members';
import {
  handlersOf,
  incidentBodyOf,
  MAX_TITLE,
  SEVERITIES,
  titleProblem,
  type IncidentCreate,
} from './incident-open';
import { SEVERITY, type Severity } from './labels';

const button = 'rounded-input border border-border-strong px-4 py-2 disabled:opacity-70';
const primary = 'rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70';
const field = 'rounded-input border border-border-strong px-3 py-2';

// "Mở sự cố" of #29 (PR B1, CEO 05/11, brief 61, tầng 2), Owner or Admin as the screen: once opened, the list of open incidents is
// read again and a status sentence takes the focus.
export function OpenIncident({ meId, onOpened }: { meId: string; onOpened: () => void }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  return (
    <div className="flex flex-col items-start gap-2">
      <button
        ref={opener}
        type="button"
        className={primary}
        onClick={() => (setDone(false), setOpen(true))}
      >
        Mở sự cố
      </button>
      {done ? (
        <p ref={status} role="status" tabIndex={-1}>
          Đã mở sự cố. Đã ghi audit.
        </p>
      ) : null}
      {open ? (
        <OpenDialog
          meId={meId}
          onOpened={() => (setDone(true), onOpened())}
          onClose={(opened) => {
            setOpen(false);
            requestAnimationFrame(() => (opened ? status : opener).current?.focus());
          }}
        />
      ) : null}
    </div>
  );
}

// The dialog: title (1–200, no phone or e-mail), one of the four severities, an active Owner or Admin who handles it (oneself
// first). `POST` waiting for the server; one Idempotency-Key per content, kept when the same is sent again after a failure.
function OpenDialog(props: {
  meId: string;
  onOpened: () => void;
  onClose: (opened: boolean) => void;
}) {
  const scope = useScope();
  const queries = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const opened = useRef(false);
  const last = useRef<{ body: string; key: string } | null>(null);
  const members = useQuery<Member[], ApiFailure>({
    queryKey: scopeKey(scope, 'members', 'all'),
    queryFn: readAllMembers,
  });
  const handlers = members.data ? handlersOf(members.data) : [];
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState<Severity | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const handler = chosen ?? handlers.find((h) => h.userId === props.meId)?.userId ?? handlers[0]?.userId;
  const [problem, setProblem] = useState<string | null>(null);
  const send = useMutation<unknown, ApiFailure, { body: IncidentCreate; key: string }>({
    mutationFn: ({ body, key }) =>
      unwrap(api('/v1/security-incidents', { method: 'POST', body, idempotencyKey: key })),
    onSuccess: () => {
      void queries.invalidateQueries({ queryKey: scopeKey(scope, 'security', 'incidents') });
      opened.current = true;
      props.onOpened();
      dialog.current?.close();
    },
    onError: (e) => {
      if (e.error.code === 'invalid_handler') void members.refetch();
    },
  });
  useEffect(() => dialog.current?.showModal(), []);

  const submit = () => {
    if (send.isPending) return;
    const p = titleProblem(title) ?? (severity ? null : 'Chọn mức độ.');
    setProblem(p);
    if (p || !severity || !handler) return;
    const body = incidentBodyOf(title, severity, handler);
    const text = JSON.stringify(body);
    const key = last.current?.body === text ? last.current.key : crypto.randomUUID();
    last.current = { body: text, key };
    send.mutate({ body, key });
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="open-incident-title"
      onClose={() => props.onClose(opened.current)}
      onCancel={(e) => send.isPending && e.preventDefault()}
      className="m-auto w-[480px] max-w-full rounded-dialog bg-surface p-6 shadow-dialog backdrop:bg-overlay"
    >
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(e) => (e.preventDefault(), submit())}
      >
        <h3 id="open-incident-title" className="text-16 font-semibold">
          Mở sự cố bảo mật
        </h3>
        <label className="flex flex-col gap-1">
          Tên sự cố (bắt buộc)
          <input
            value={title}
            maxLength={MAX_TITLE}
            aria-describedby="incident-title-hint"
            className={field}
            onChange={(e) => (setTitle(e.target.value), setProblem(null))}
          />
        </label>
        <p id="incident-title-hint" className="text-12 text-text-muted">
          {title.length}/{MAX_TITLE} ký tự. Không ghi SĐT, email, nội dung tin vào tên.
        </p>
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
          <legend className="mb-1">Mức độ</legend>
          {SEVERITIES.map((s) => (
            <label key={s} className="flex gap-2">
              <input
                type="radio"
                name="severity"
                checked={severity === s}
                onChange={() => (setSeverity(s), setProblem(null))}
              />
              {SEVERITY[s][0]}
            </label>
          ))}
        </fieldset>
        {members.isError ? (
          <div role="alert" className="flex flex-col items-start gap-1">
            <p>Không tải được danh sách người xử lý. {members.error.error.message}</p>
            {members.error.error.traceId ? (
              <p className="text-12 text-text-muted">Mã: {members.error.error.traceId}</p>
            ) : null}
            <button type="button" className={button} onClick={() => void members.refetch()}>
              Thử lại
            </button>
          </div>
        ) : members.isSuccess && handlers.length === 0 ? (
          <p role="alert">Chưa có Owner hoặc Admin đang hoạt động để xử lý sự cố.</p>
        ) : (
          <label className="flex flex-col gap-1">
            Người xử lý (Owner hoặc Admin đang hoạt động)
            <select
              value={handler ?? ''}
              disabled={!members.isSuccess}
              aria-busy={members.isPending}
              className={field}
              onChange={(e) => setChosen(e.target.value)}
            >
              {members.isPending ? <option value="">Đang tải…</option> : null}
              {handlers.map((h) => (
                <option key={h.userId} value={h.userId}>
                  {h.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {problem ? <p role="alert">{problem}</p> : null}
        {send.error ? (
          <div role="alert">
            <p>{send.error.error.message}</p>
            {send.error.error.traceId ? (
              <p className="text-12 text-text-muted">Mã: {send.error.error.traceId}</p>
            ) : null}
          </div>
        ) : null}
        <div className="flex gap-2">
          <button
            type="submit"
            className={primary}
            disabled={send.isPending || !handler}
            aria-busy={send.isPending}
          >
            {send.isPending ? 'Đang mở…' : 'Mở sự cố'}
          </button>
          <button
            type="button"
            className={button}
            disabled={send.isPending}
            onClick={() => dialog.current?.close()}
          >
            Hủy
          </button>
        </div>
      </form>
    </dialog>
  );
}
