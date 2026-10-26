'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import type { components } from '../api/schema';
import { ApiFailure, unwrap } from '../query/fetch';
import { scopeKey } from '../query/keys';
import { useApiQuery, useScope } from '../query/provider';
import { assigneeLines, assigneesPath } from './assign';
import type { Conversation } from './list';

type AssigneeList = components['schemas']['AssigneeList'];

const button = 'rounded-input border border-border-strong px-4 py-2 disabled:opacity-70';
const primary = 'rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70';

/** "Gán lại" and its dialog (#6, Phụ lục B row 16, issue #366): the dialog asks U31 only once opened. */
export function AssignAction({ c }: { c: Conversation }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`${button} self-start`} onClick={() => setOpen(true)}>
        Gán lại
      </button>
      {open ? <AssignDialog c={c} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/**
 * Pick one of those U31 lists (`purpose=assign`), then `POST …/assign` with the version last read, waiting for the server. One
 * Idempotency-Key per person picked, kept when the same is sent again after a failure. 409 version_conflict says so in the dialog
 * ("vừa được người khác thay đổi… Đã tải lại") and reads the conversation and its list again, so a second click sends the new
 * version; 422 invalid_assignee says its sentence of the P9 table.
 */
function AssignDialog({ c, onClose }: { c: Conversation; onClose: () => void }) {
  const scope = useScope();
  const queries = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const last = useRef<{ to: string; key: string } | null>(null);
  // Under the conversation's key, so reading the conversation again after a conflict reads the list again too.
  const people = useApiQuery<AssigneeList>(
    ['conversation', c.id, 'assignees', 'assign'],
    assigneesPath(c.id, 'assign'),
  );
  const options = assigneeLines(people.data?.data ?? []);
  const [to, setTo] = useState('');
  const assign = useMutation<Conversation, ApiFailure, { to: string; key: string }>({
    mutationFn: ({ to, key }) =>
      unwrap(
        api<Conversation>(`/v1/conversations/${encodeURIComponent(c.id)}/assign`, {
          method: 'POST',
          body: { version: c.version, toUserId: to },
          idempotencyKey: key,
        }),
      ),
    onSuccess: (next) => {
      last.current = null;
      queries.setQueryData(scopeKey(scope, 'conversation', c.id), next);
      void queries.invalidateQueries({ queryKey: scopeKey(scope, 'conversations') });
      dialog.current?.close();
    },
    onError: ({ error }) => {
      if (error.action === 'reload')
        void queries.invalidateQueries({ queryKey: scopeKey(scope, 'conversation', c.id) });
    },
  });
  useEffect(() => dialog.current?.showModal(), []);

  const chosen = to || options[0]?.userId || '';
  const submit = () => {
    if (assign.isPending || !chosen) return;
    const key = last.current?.to === chosen ? last.current.key : crypto.randomUUID();
    last.current = { to: chosen, key };
    assign.mutate({ to: chosen, key });
  };
  const error = assign.error?.error ?? people.error?.error ?? null;
  return (
    <dialog
      ref={dialog}
      aria-labelledby="assign-title"
      onClose={onClose}
      className="m-auto w-[400px] max-w-full rounded-dialog bg-surface p-6 shadow-dialog backdrop:bg-overlay"
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h3 id="assign-title" className="text-16 font-semibold">
          Gán lại hội thoại
        </h3>
        {people.isPending ? (
          <p role="status" aria-busy="true" className="text-text-muted">
            Đang tải người nhận…
          </p>
        ) : people.isError ? null : options.length === 0 ? (
          <p>
            Chưa có ai khác nhận được hội thoại này. Thêm người vào workspace ở Cài đặt › Workspace.
          </p>
        ) : (
          <label className="flex flex-col gap-1">
            Người nhận
            <select
              value={chosen}
              className="rounded-input border border-border-strong px-3 py-2"
              onChange={(e) => setTo(e.target.value)}
            >
              {options.map(({ userId, label }) => (
                <option key={userId} value={userId}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
        {options.some((o) => o.full) ? (
          <p className="text-12 text-text-muted">
            &quot;Đã đầy&quot;: người đó đang giữ đủ số hội thoại tối đa, vẫn gán được.
          </p>
        ) : null}
        {error ? (
          <div role="alert">
            <p>{error.message}</p>
            {error.traceId ? <p className="text-12 text-text-muted">Mã: {error.traceId}</p> : null}
          </div>
        ) : null}
        <div className="flex gap-2">
          <button
            type="submit"
            className={primary}
            disabled={assign.isPending || !chosen}
            aria-busy={assign.isPending}
          >
            {assign.isPending ? 'Đang gán…' : 'Gán'}
          </button>
          <button type="button" className={button} onClick={() => dialog.current?.close()}>
            Hủy
          </button>
        </div>
      </form>
    </dialog>
  );
}
