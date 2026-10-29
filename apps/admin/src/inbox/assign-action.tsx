'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import type { components } from '../api/schema';
import { ApiFailure, getter, unwrap } from '../query/fetch';
import { scopeKey } from '../query/keys';
import { useApiQuery, useScope } from '../query/provider';
import { readAgain } from '../realtime/events';
import { assigneeLines, assigneesPath, matching, SEARCH_FROM, type Assignee } from './assign';
import type { Conversation } from './list';

type AssigneeList = components['schemas']['AssigneeList'];

const button = 'rounded-input border border-border-strong px-4 py-2 disabled:opacity-70';
const primary = 'rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70';

type Purpose = 'assign' | 'transfer';

const WORDS: Readonly<
  Record<Purpose, { open: string; title: string; send: string; sending: string }>
> = {
  assign: { open: 'Gán lại', title: 'Gán lại hội thoại', send: 'Gán', sending: 'Đang gán…' },
  transfer: { open: 'Chuyển', title: 'Chuyển hội thoại', send: 'Chuyển', sending: 'Đang chuyển…' },
};

/**
 * "Gán lại" (Phụ lục B row 16, #366) or "Chuyển" (T15, #376) and their one dialog: the same list of U31 (`purpose`), body
 * `{version, toUserId}` and Idempotency-Key per person; only the words and the path differ. The dialog asks U31 only once
 * opened. `onLeave`: the person may no longer read the conversation once it is handed on (a Sales/Support transfer, API
 * `canSee`), so the screen leaves it instead of meeting a 404. "Chuyển" also opens with T, as the shortcut table says.
 */
export function HandOverAction({
  c,
  purpose,
  onLeave,
}: {
  c: Conversation;
  purpose: Purpose;
  onLeave?: ((to: string) => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (purpose !== 'transfer') return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        t?.closest('input, textarea, select, dialog, [contenteditable]')
      )
        return;
      if (e.key.toLowerCase() === 't') setOpen(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [purpose]);
  return (
    <>
      <button type="button" className={`${button} self-start`} onClick={() => setOpen(true)}>
        {WORDS[purpose].open}
      </button>
      {open ? (
        <HandOverDialog c={c} purpose={purpose} onLeave={onLeave} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

/**
 * Pick one of those U31 lists, then `POST …/{purpose}` with the version last read, waiting for the server. One Idempotency-Key
 * per person picked, kept when the same is sent again after a failure. 409 version_conflict or invalid_transition says so in the
 * dialog ("…Đang tải lại…") and reads the conversation and its list again, tried twice more (`readAgain`); until that read
 * succeeds the button is locked, so a second click never sends the old version. 422 invalid_assignee says its P9 sentence.
 */
function HandOverDialog({
  c,
  purpose,
  onLeave,
  onClose,
}: {
  c: Conversation;
  purpose: Purpose;
  onLeave: ((to: string) => void) | undefined;
  onClose: () => void;
}) {
  const scope = useScope();
  const queries = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLSelectElement>(null);
  const last = useRef<{ to: string; key: string } | null>(null);
  const [stale, setStale] = useState(false);
  // Under the conversation's key, so reading the conversation again after a conflict reads the list again too.
  const people = useApiQuery<AssigneeList>(
    ['conversation', c.id, 'assignees', purpose],
    assigneesPath(c.id, purpose),
  );
  const all = assigneeLines(people.data?.data ?? []);
  const [query, setQuery] = useState('');
  const options = matching(all, query);
  const [to, setTo] = useState('');
  const assign = useMutation<Conversation, ApiFailure, { to: string; key: string }>({
    mutationFn: ({ to, key }) =>
      unwrap(
        api<Conversation>(`/v1/conversations/${encodeURIComponent(c.id)}/${purpose}`, {
          method: 'POST',
          body: { version: c.version, toUserId: to },
          idempotencyKey: key,
        }),
      ),
    onSuccess: (next, { to }) => {
      last.current = null;
      void queries.invalidateQueries({ queryKey: scopeKey(scope, 'conversations') });
      dialog.current?.close();
      if (onLeave) return onLeave(nameOf(people.data?.data ?? [], to));
      queries.setQueryData(scopeKey(scope, 'conversation', c.id), next);
    },
    onError: ({ error }) => {
      if (error.action !== 'reload') return;
      setStale(true);
      const key = scopeKey(scope, 'conversation', c.id);
      void readAgain(() =>
        Promise.all([
          queries.fetchQuery({
            queryKey: key,
            queryFn: getter<Conversation>(`/v1/conversations/${encodeURIComponent(c.id)}`),
            staleTime: 0,
          }),
          people.refetch({ throwOnError: true }),
        ]),
      ).then((read) => {
        if (read) setStale(false);
      });
    },
  });
  useEffect(() => dialog.current?.showModal(), []);
  // Where the keyboard starts: the search box, else the list, once the people are read; until then (or with nobody to offer)
  // the dialog itself. Never "Hủy", the only button while loading: one Tab from it left the dialog, Enter closed it.
  const read = people.isSuccess;
  useEffect(() => (searchBox.current ?? pick.current ?? dialog.current)?.focus(), [read]);

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
      aria-labelledby="hand-over-title"
      tabIndex={-1}
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
        <h3 id="hand-over-title" className="text-16 font-semibold">
          {WORDS[purpose].title}
        </h3>
        {people.isPending ? (
          <p role="status" aria-busy="true" className="text-text-muted">
            Đang tải người nhận…
          </p>
        ) : people.isError ? null : all.length === 0 ? (
          <p>
            {purpose === 'transfer' && onLeave
              ? 'Không có đồng nghiệp chung team nhận được hội thoại này.'
              : 'Chưa có ai khác nhận được hội thoại này. Thêm người vào workspace ở Cài đặt › Workspace.'}
          </p>
        ) : (
          <>
            {all.length >= SEARCH_FROM ? (
              <label className="flex flex-col gap-1">
                Tìm người
                <input
                  ref={searchBox}
                  type="search"
                  value={query}
                  placeholder="Tên, vai trò hoặc team"
                  className="rounded-input border border-border-strong px-3 py-2"
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setTo('');
                  }}
                />
              </label>
            ) : null}
            {options.length === 0 ? (
              <p>Không ai khớp &quot;{query.trim()}&quot;.</p>
            ) : (
              <label className="flex flex-col gap-1">
                Người nhận
                <select
                  ref={pick}
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
          </>
        )}
        {/* "vẫn … được": the API never caps a manual assign or transfer (U55, letter #387). If it ever does, change this. */}
        {options.some((o) => o.full) ? (
          <p className="text-12 text-text-muted">
            &quot;Đã đầy&quot;: người đó đang xử lý đủ số hội thoại tối đa, vẫn{' '}
            {WORDS[purpose].send.toLowerCase()} được.
          </p>
        ) : null}
        {options.some((o) => o.waiting) ? (
          <p className="text-12 text-text-muted">
            &quot;Chờ khách&quot;: hội thoại đã trả lời, đang chờ khách phản hồi; không tính vào số
            đang xử lý.
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
            disabled={assign.isPending || stale || !chosen}
            aria-busy={assign.isPending || stale}
          >
            {assign.isPending ? WORDS[purpose].sending : WORDS[purpose].send}
          </button>
          <button type="button" className={button} onClick={() => dialog.current?.close()}>
            Hủy
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** Who it went to, in the words of the list ("…abcd" for one with no name). */
const nameOf = (list: readonly Assignee[], to: string) => {
  const a = list.find((x) => x.userId === to);
  return a?.name?.trim() || `…${to.slice(-4)}`;
};
