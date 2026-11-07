'use client';

import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import type { ApiError } from '../api/errors';
import type { Role } from '../nav';
import { ApiFailure, unwrap } from '../query/fetch';
import { scopeKey } from '../query/keys';
import { useApiPages, useScope } from '../query/provider';
import { RetryAction } from '../retry-button';
import {
  isLocalNote,
  MAX_NOTE,
  mayWriteNote,
  noteLineOf,
  notesPath,
  noteTextOf,
  sendingNote,
  withNote,
  withoutLocalNote,
  type Note,
  type NotePage,
} from './notes';

type Pages = InfiniteData<NotePage>;

/**
 * "Ghi chú nội bộ" of an open conversation (#6, C6, N194; CEO brief 169 P1a, P1b): `GET …/notes` newest first by pages, and the box of
 * `POST …/notes` for the roles that may write (`mayWriteNote`). Adding is optimistic (CLAUDE.md): the note shows at once as
 * "Đang lưu…", the API's answer replaces it, a refusal takes it back and returns the text. One Idempotency-Key per text, kept when
 * the same text is sent again after a failure. N goes to the box. The customer never sees these.
 */
export function ConversationNotes({
  c,
  role,
  meId,
}: {
  c: { readonly id: string; readonly assignedUserId: string | null };
  role: Role;
  meId: string;
}) {
  const scope = useScope();
  const queries = useQueryClient();
  const box = useRef<HTMLTextAreaElement>(null);
  const last = useRef<{ text: string; key: string } | null>(null);
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const notes = useApiPages<NotePage>(['notes', c.id], (cursor) => notesPath(c.id, cursor));
  const notesKey = scopeKey(scope, 'notes', c.id);
  const writes = mayWriteNote(c, role, meId);

  const add = useMutation<Note, ApiFailure, { text: string; key: string }>({
    mutationFn: ({ text, key }) =>
      unwrap(
        api<Note>(notesPath(c.id), { method: 'POST', body: { body: text }, idempotencyKey: key }),
      ),
    onMutate: ({ text, key }) => {
      setError(null);
      setText('');
      queries.setQueryData<Pages>(notesKey, (p) =>
        withNote(p, sendingNote(key, text, c.id, meId, new Date())),
      );
    },
    onSuccess: (n, { key }) => {
      last.current = null;
      queries.setQueryData<Pages>(notesKey, (p) => withNote(withoutLocalNote(p, key), n));
    },
    onError: (failure, { text, key }) => {
      queries.setQueryData<Pages>(notesKey, (p) => withoutLocalNote(p, key));
      setText((now) => now || text);
      setError(failure.error);
      // No longer holding it (403) or gone (404): read the conversation again, the box follows the answer.
      if (
        failure.error.action === 'reload' ||
        failure.error.status === 403 ||
        failure.error.status === 404
      )
        void queries.invalidateQueries({ queryKey: scopeKey(scope, 'conversation', c.id) });
    },
  });

  const submit = () => {
    if (add.isPending) return;
    const checked = noteTextOf(text);
    if (!checked.ok) return setProblem(checked.problem);
    setProblem(null);
    const key = last.current?.text === checked.text ? last.current.key : crypto.randomUUID();
    last.current = { text: checked.text, key };
    add.mutate({ text: checked.text, key });
  };

  useEffect(() => {
    if (!writes) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        t?.closest('input, textarea, select, dialog, [contenteditable]')
      )
        return;
      if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        box.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [writes]);

  const rows = notes.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <section
      aria-labelledby="notes-title"
      className="flex flex-col gap-2 rounded-card bg-note p-3 text-note-text"
    >
      <h3 id="notes-title" className="font-semibold">
        Ghi chú nội bộ
      </h3>
      <p className="text-12">Chỉ nhân viên thấy, khách không thấy.</p>
      {notes.isPending ? (
        <p role="status" aria-busy="true">
          Đang tải ghi chú…
        </p>
      ) : notes.isError ? (
        <div role="alert" className="flex flex-col gap-2">
          <p>{notes.error.error.message}</p>
          {notes.error.error.traceId ? (
            <p className="text-12">Mã: {notes.error.error.traceId}</p>
          ) : null}
          <RetryAction onRetry={() => void notes.refetch()} busy={notes.isFetching} />
        </div>
      ) : rows.length ? (
        <ol aria-label="Ghi chú" className="flex flex-col gap-2">
          {rows.map((n) => {
            const line = noteLineOf(n, meId);
            return (
              <li
                key={n.id}
                className="flex flex-col gap-1 border-b border-border pb-2 last:border-b-0"
              >
                <span className="text-12">
                  {line.by.title ? <abbr title={line.by.title}>{line.by.text}</abbr> : line.by.text}{' '}
                  · <time dateTime={n.createdAt}>{line.at}</time>
                  {line.kind ? ` · ${line.kind}` : null}
                  {isLocalNote(n) ? ' · Đang lưu…' : null}
                </span>
                {/* Plain text: React escapes it (Brief UI §2.6). */}
                <p className="whitespace-pre-wrap break-words">{n.body}</p>
              </li>
            );
          })}
        </ol>
      ) : (
        <p>Chưa có ghi chú nào.</p>
      )}
      {notes.hasNextPage ? (
        <button
          type="button"
          className="self-start rounded-input border border-border-strong px-3 py-1"
          disabled={notes.isFetchingNextPage}
          aria-busy={notes.isFetchingNextPage}
          onClick={() => void notes.fetchNextPage()}
        >
          {notes.isFetchingNextPage ? 'Đang tải…' : 'Tải ghi chú cũ hơn'}
        </button>
      ) : null}
      {writes ? (
        <form
          aria-label="Thêm ghi chú nội bộ"
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label htmlFor="note-box" className="text-12">
            Ghi chú mới (phím N để vào ô này, Ctrl+Enter để lưu)
          </label>
          <textarea
            id="note-box"
            ref={box}
            rows={2}
            value={text}
            aria-keyshortcuts="N"
            aria-invalid={problem ? true : undefined}
            aria-describedby="note-count"
            className="rounded-input border border-border-strong bg-bg p-2"
            onChange={(e) => {
              setText(e.target.value);
              setProblem(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <span id="note-count" className="text-12">
              {text.trim().length}/{MAX_NOTE}
            </span>
            <button
              type="submit"
              className="rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70"
              disabled={add.isPending}
              aria-busy={add.isPending}
            >
              {add.isPending ? 'Đang lưu…' : 'Thêm ghi chú'}
            </button>
          </div>
          {problem ? (
            <p role="alert" className="text-12">
              {problem}
            </p>
          ) : null}
          {error ? (
            <div role="alert">
              <p>{error.message}</p>
              {error.traceId ? <p className="text-12">Mã: {error.traceId}</p> : null}
            </div>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
