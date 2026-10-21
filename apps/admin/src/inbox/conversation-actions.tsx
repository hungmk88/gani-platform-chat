'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useRef, useState } from 'react';

import { api } from '../api/client';
import type { ApiError } from '../api/errors';
import type { Role } from '../nav';
import { ApiFailure, unwrap } from '../query/fetch';
import { scopeKey } from '../query/keys';
import { useScope } from '../query/provider';
import {
  ACTION_LABEL,
  ACTION_PATH,
  actionsFor,
  bodyOf,
  OUTCOMES,
  type Action,
  type Outcome,
} from './actions';
import type { Conversation } from './list';

const button = 'rounded-input border border-border-strong px-4 py-2 disabled:opacity-70';
const primary = 'rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70';
/** Prototype shortcuts (inbox.js "Bảng phím tắt"): A claims, E closes; not while typing. */
const KEYS: Readonly<Record<string, Action>> = { a: 'claim', e: 'close' };

/**
 * Nhận, Chờ khách, Đóng (I1c). Each waits for the server with the buttons locked (no optimistic update, P9), carries a new
 * Idempotency-Key, and puts the conversation the API answers in the cache; a refusal says its P9 sentence and reloads when told to.
 */
export function ConversationActions({
  c,
  role,
  meId,
}: {
  c: Conversation;
  role: Role;
  meId: string;
}) {
  const scope = useScope();
  const queries = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const actions = actionsFor(c, role, meId);

  const run = useMutation<Conversation, ApiFailure, { action: Action; outcome?: Outcome }>({
    mutationFn: ({ action, outcome }) =>
      unwrap(
        api<Conversation>(`/v1/conversations/${encodeURIComponent(c.id)}/${ACTION_PATH[action]}`, {
          method: 'POST',
          body: bodyOf(action, c.version, outcome),
          idempotencyKey: crypto.randomUUID(),
        }),
      ),
    onSuccess: (next) => {
      setError(null);
      queries.setQueryData(scopeKey(scope, 'conversation', c.id), next);
      void queries.invalidateQueries({ queryKey: scopeKey(scope, 'conversations') });
    },
    onError: (failure) => {
      const { error } = failure;
      setError(error);
      const winner = error.extensions['assignedUserId'];
      if (error.code === 'conversation_already_claimed' && typeof winner === 'string') {
        // The 409 says who claimed it (T05: now theirs, being handled). Show that here and drop it from the queue, without
        // reading the conversation again: sales and support may no longer see it, and a 404 would hide why (P9).
        queries.setQueryData<Conversation>(
          scopeKey(scope, 'conversation', c.id),
          (prev) =>
            prev && {
              ...prev,
              state: 'HUMAN_ACTIVE',
              afterHoursHold: false,
              assignedUserId: winner,
            },
        );
        void queries.invalidateQueries({ queryKey: scopeKey(scope, 'conversations') });
      } else if (error.action === 'reload')
        void queries.invalidateQueries({ queryKey: scopeKey(scope) });
    },
    onSettled: () => dialog.current?.close(),
  });

  const start = (action: Action) => {
    if (run.isPending || !actions.includes(action)) return;
    if (action === 'close') dialog.current?.showModal();
    else run.mutate({ action });
  };
  const shortcut = useEffectEvent((action: Action) => start(action));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        t?.closest('input, textarea, select, dialog, [contenteditable]')
      )
        return;
      const action = KEYS[e.key.toLowerCase()];
      if (action) shortcut(action);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (actions.length === 0 && !error) return null;
  return (
    <div className="flex flex-col gap-2">
      {actions.length > 0 ? (
        <div role="group" aria-label="Thao tác" className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <button
              key={a}
              type="button"
              className={a === 'claim' ? primary : button}
              disabled={run.isPending}
              aria-busy={run.isPending && run.variables.action === a}
              aria-keyshortcuts={Object.entries(KEYS)
                .find(([, x]) => x === a)?.[0]
                .toUpperCase()}
              onClick={() => start(a)}
            >
              {ACTION_LABEL[a]}
            </button>
          ))}
        </div>
      ) : null}
      {error ? (
        <div role="alert">
          <p>{error.message}</p>
          {error.traceId ? <p className="text-12 text-text-muted">Mã: {error.traceId}</p> : null}
        </div>
      ) : null}
      <dialog
        ref={dialog}
        aria-labelledby="close-title"
        className="m-auto rounded-dialog bg-surface p-6 shadow-dialog backdrop:bg-overlay"
      >
        <h3 id="close-title" className="text-16 font-semibold">
          Đóng hội thoại — chọn kết quả
        </h3>
        <p className="mt-2 text-text-muted">Bấm kết quả là đóng luôn.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {OUTCOMES.map(([outcome, label]) => (
            <button
              key={outcome}
              type="button"
              className={button}
              disabled={run.isPending}
              onClick={() => run.mutate({ action: 'close', outcome })}
            >
              {label}
            </button>
          ))}
          <button type="button" className={button} onClick={() => dialog.current?.close()}>
            Hủy
          </button>
        </div>
      </dialog>
    </div>
  );
}
