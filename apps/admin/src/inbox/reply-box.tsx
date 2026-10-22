'use client';

import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import type { ApiError } from '../api/errors';
import type { components } from '../api/schema';
import { ApiFailure, unwrap } from '../query/fetch';
import { scopeKey } from '../query/keys';
import { useScope } from '../query/provider';
import { withMessage } from '../realtime/events';
import { MAX_TEXT, sendingMessage, textOf, WINDOW_REASON, withoutLocal } from './composer';
import type { Message } from './messages';

type MessagePage = components['schemas']['MessagePage'];
type Pages = InfiniteData<MessagePage>;

/**
 * The reply box (#6, I2): `POST …/messages` (N146). Sending is optimistic (CLAUDE.md): the message shows at once as "Đang
 * gửi…", the API's answer replaces it, a refusal takes it back and returns the text to the box. One Idempotency-Key per text:
 * sending the same text again after a failure reuses it, any other text gets a new one. Ctrl/⌘+Enter sends, R goes to the box.
 */
export function ReplyBox({ conversationId, meId }: { conversationId: string; meId: string }) {
  const scope = useScope();
  const queries = useQueryClient();
  const box = useRef<HTMLTextAreaElement>(null);
  const last = useRef<{ text: string; key: string } | null>(null);
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const messagesKey = scopeKey(scope, 'messages', conversationId);

  const send = useMutation<Message, ApiFailure, { text: string; key: string }>({
    mutationFn: ({ text, key }) =>
      unwrap(
        api<Message>(`/v1/conversations/${encodeURIComponent(conversationId)}/messages`, {
          method: 'POST',
          body: { text },
          idempotencyKey: key,
        }),
      ),
    onMutate: ({ text, key }) => {
      setError(null);
      setText('');
      queries.setQueryData<Pages>(messagesKey, (p) =>
        withMessage(p, sendingMessage(key, text, meId, new Date())),
      );
    },
    onSuccess: (m, { key }) => {
      last.current = null;
      queries.setQueryData<Pages>(messagesKey, (p) => withMessage(withoutLocal(p, key), m));
    },
    onError: (failure, { text, key }) => {
      queries.setQueryData<Pages>(messagesKey, (p) => withoutLocal(p, key));
      setText((now) => now || text);
      setError(failure.error);
      if (failure.error.action === 'reload')
        void queries.invalidateQueries({
          queryKey: scopeKey(scope, 'conversation', conversationId),
        });
    },
  });

  const submit = () => {
    if (send.isPending) return;
    const checked = textOf(text);
    if (!checked.ok) return setProblem(checked.problem);
    setProblem(null);
    const key = last.current?.text === checked.text ? last.current.key : crypto.randomUUID();
    last.current = { text: checked.text, key };
    send.mutate({ text: checked.text, key });
  };

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
      if (e.key.toLowerCase() === 'r') {
        e.preventDefault();
        box.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const reason = error?.extensions['reason'];
  return (
    <form
      aria-label="Trả lời khách"
      className="flex flex-col gap-2 border-t border-border pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor="composer" className="text-12 text-text-muted">
        Soạn tin trả lời (Ctrl+Enter để gửi, phím R để vào ô này)
      </label>
      <textarea
        id="composer"
        ref={box}
        rows={3}
        value={text}
        aria-keyshortcuts="R"
        aria-invalid={problem ? true : undefined}
        aria-describedby="composer-count"
        className="rounded-input border border-border-strong p-2"
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
        <span id="composer-count" className="text-12 text-text-muted">
          {text.trim().length}/{MAX_TEXT}
        </span>
        <button
          type="submit"
          className="rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70"
          disabled={send.isPending}
          aria-busy={send.isPending}
        >
          {send.isPending ? 'Đang gửi…' : 'Gửi'}
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
          {typeof reason === 'string' && WINDOW_REASON[reason] ? (
            <p>{WINDOW_REASON[reason]}</p>
          ) : null}
          {error.traceId ? <p className="text-12 text-text-muted">Mã: {error.traceId}</p> : null}
        </div>
      ) : null}
    </form>
  );
}
