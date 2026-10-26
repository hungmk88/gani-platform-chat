'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import { ApiFailure, unwrap } from '../query/fetch';
import { scopeKey } from '../query/keys';
import { useScope } from '../query/provider';
import {
  insertVariable,
  MAX_BODY,
  MAX_SHORTCUT,
  quickReplyChangeOf,
  quickReplyError,
  type QuickReply,
} from './quick-replies';
import { VariableButtons } from './variable-buttons';

const field = 'rounded-input border border-border-strong px-3 py-2';
const button = 'rounded-input border border-border-strong px-4 py-2 disabled:opacity-70';
const primary = 'rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70';
const dialogClass =
  'm-auto w-[560px] max-w-full rounded-dialog bg-surface p-6 shadow-dialog backdrop:bg-overlay';
const pathOf = (r: QuickReply) => `/v1/quick-replies/${encodeURIComponent(r.id)}`;

function ErrorOf({ failure, shortcut }: { failure: ApiFailure | null; shortcut: string }) {
  if (!failure) return null;
  return (
    <div role="alert">
      <p>{quickReplyError(failure.error, shortcut)}</p>
      {failure.error.traceId ? (
        <p className="text-12 text-text-muted">Mã: {failure.error.traceId}</p>
      ) : null}
    </div>
  );
}

/**
 * "Sửa mẫu" (#22, `PATCH /v1/quick-replies/{id}`, N163): shortcut, text and tags, checked like the API; only what changed is sent,
 * nothing changed closes. Waits for the server, no Idempotency-Key (it sets values); then every list of the workspace is read again.
 */
export function EditQuickReplyDialog({
  reply,
  onClose,
  onDone,
}: {
  reply: QuickReply;
  onClose: () => void;
  onDone: (r: QuickReply) => void;
}) {
  const scope = useScope();
  const queries = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  const [shortcut, setShortcut] = useState(reply.shortcut);
  const [body, setBody] = useState(reply.body);
  const [tags, setTags] = useState(reply.tags.join(', '));
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation<QuickReply, ApiFailure, object>({
    mutationFn: (change) =>
      unwrap(api<QuickReply>(pathOf(reply), { method: 'PATCH', body: change })),
    onSuccess: (r) => {
      void queries.invalidateQueries({
        queryKey: scopeKey(scope, 'quick-replies', reply.workspaceId),
      });
      onDone(r);
      dialog.current?.close();
    },
  });
  useEffect(() => dialog.current?.showModal(), []);

  const edit = (set: (v: string) => void) => (v: string) => {
    set(v);
    setProblem(null);
  };
  const insert = (name: string) => {
    const next = insertVariable(body, text.current?.selectionStart ?? body.length, name);
    edit(setBody)(next.text);
    requestAnimationFrame(() => {
      text.current?.focus();
      text.current?.setSelectionRange(next.caret, next.caret);
    });
  };
  const submit = () => {
    if (save.isPending) return;
    const change = quickReplyChangeOf(reply, shortcut, body, tags);
    if (typeof change === 'string') return setProblem(change);
    if (!Object.keys(change).length) return dialog.current?.close();
    save.mutate(change);
  };

  return (
    <dialog ref={dialog} aria-labelledby="qr-edit-title" onClose={onClose} className={dialogClass}>
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h3 id="qr-edit-title" className="text-16 font-semibold">
          Sửa mẫu /{reply.shortcut}
        </h3>
        <label className="flex flex-col gap-1">
          Phím tắt
          <input
            value={shortcut}
            maxLength={MAX_SHORTCUT + 1}
            autoCapitalize="none"
            className={field}
            onChange={(e) => edit(setShortcut)(e.target.value.toLowerCase())}
          />
        </label>
        <label className="flex flex-col gap-1">
          Nội dung
          <textarea
            ref={text}
            rows={4}
            value={body}
            maxLength={MAX_BODY}
            className="rounded-input border border-border-strong p-2"
            onChange={(e) => edit(setBody)(e.target.value)}
          />
        </label>
        <VariableButtons onInsert={insert} />
        <label className="flex flex-col gap-1">
          Tag (cách nhau bằng dấu phẩy, tối đa 10)
          <input value={tags} className={field} onChange={(e) => edit(setTags)(e.target.value)} />
        </label>
        {problem ? <p role="alert">{problem}</p> : null}
        <ErrorOf failure={save.error} shortcut={shortcut.trim().replace(/^\//, '')} />
        <div className="flex gap-2">
          <button
            type="submit"
            className={primary}
            disabled={save.isPending}
            aria-busy={save.isPending}
          >
            {save.isPending ? 'Đang lưu…' : 'Lưu'}
          </button>
          <button type="button" className={button} onClick={() => dialog.current?.close()}>
            Hủy
          </button>
        </div>
      </form>
    </dialog>
  );
}

/**
 * "Xóa mẫu" (#22, `DELETE /v1/quick-replies/{id}`, N163): asked once more, waits for the server; the shortcut is free again and every
 * list of the workspace is read again.
 */
export function EndQuickReplyDialog({
  reply,
  onClose,
  onDone,
}: {
  reply: QuickReply;
  onClose: () => void;
  onDone: (r: QuickReply) => void;
}) {
  const scope = useScope();
  const queries = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const end = useMutation<null, ApiFailure, void>({
    mutationFn: () => unwrap(api<null>(pathOf(reply), { method: 'DELETE' })),
    onSuccess: () => {
      void queries.invalidateQueries({
        queryKey: scopeKey(scope, 'quick-replies', reply.workspaceId),
      });
      onDone(reply);
      dialog.current?.close();
    },
  });
  useEffect(() => dialog.current?.showModal(), []);

  return (
    <dialog ref={dialog} aria-labelledby="qr-end-title" onClose={onClose} className={dialogClass}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!end.isPending) end.mutate();
        }}
      >
        <h3 id="qr-end-title" className="text-16 font-semibold">
          Xóa mẫu /{reply.shortcut}?
        </h3>
        <p>Mẫu bị xóa khỏi workspace; phím tắt /{reply.shortcut} dùng lại được cho mẫu khác.</p>
        <ErrorOf failure={end.error} shortcut={reply.shortcut} />
        <div className="flex gap-2">
          <button
            type="submit"
            className={primary}
            disabled={end.isPending}
            aria-busy={end.isPending}
          >
            {end.isPending ? 'Đang xóa…' : 'Xóa mẫu'}
          </button>
          <button type="button" className={button} onClick={() => dialog.current?.close()}>
            Hủy
          </button>
        </div>
      </form>
    </dialog>
  );
}
