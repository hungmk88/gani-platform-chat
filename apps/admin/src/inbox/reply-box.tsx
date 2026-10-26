'use client';

import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import {
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as KeyEvent,
} from 'react';

import { api } from '../api/client';
import type { ApiError } from '../api/errors';
import type { components } from '../api/schema';
import { ApiFailure, unwrap } from '../query/fetch';
import { scopeKey } from '../query/keys';
import { useApiQuery, useScope } from '../query/provider';
import {
  quickRepliesPath,
  type QuickReply,
  type QuickReplyList,
} from '../quick-replies/quick-replies';
import { withMessage } from '../realtime/events';
import { MAX_TEXT, sendingMessage, textOf, WINDOW_REASON, withoutLocal } from './composer';
import type { Message } from './messages';
import { optionId, PICKER_ID, TemplatePicker, VariableFields } from './template-picker';
import { fieldsOf, fill, MAX_SHOWN, slashQuery, unresolvedProblem, type Known } from './templates';

type MessagePage = components['schemas']['MessagePage'];
type Pages = InfiniteData<MessagePage>;

/**
 * The reply box (#6, I2): `POST …/messages` (N146). Sending is optimistic (CLAUDE.md): the message shows at once as "Đang
 * gửi…", the API's answer replaces it, a refusal takes it back and returns the text to the box. One Idempotency-Key per text:
 * sending the same text again after a failure reuses it, any other text gets a new one. Ctrl/⌘+Enter sends, R goes to the box.
 * "/" opens the templates of the conversation's workspace (C7c, N163): a picked one comes in with `known` filled, the variables
 * left get a field each and are filled when sending; a {{…}} left blocks sending. A message sent from a template counts one use.
 */
export function ReplyBox({
  conversationId,
  workspaceId,
  meId,
  known,
}: {
  conversationId: string;
  workspaceId: string;
  meId: string;
  known: Known;
}) {
  const scope = useScope();
  const queries = useQueryClient();
  const box = useRef<HTMLTextAreaElement>(null);
  const last = useRef<{ text: string; key: string } | null>(null);
  const template = useRef<string | null>(null);
  const [text, setText] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [closedAt, setClosedAt] = useState<string | null>(null);
  const [pointer, setPointer] = useState({ q: '', at: 0 });
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const messagesKey = scopeKey(scope, 'messages', conversationId);

  const q = slashQuery(text);
  const open = q !== null && closedAt !== text;
  const asked = useDeferredValue(q ?? '');
  const path = quickRepliesPath(workspaceId, { q: asked, tag: null });
  const templates = useApiQuery<QuickReplyList>(['quick-replies', workspaceId, path], path, open);
  const shown = open ? (templates.data?.data ?? []).slice(0, MAX_SHOWN) : [];
  const active = pointer.q === q ? Math.min(pointer.at, Math.max(shown.length - 1, 0)) : 0;
  const fields = fieldsOf(text);

  // Only counts: the message is already sent, so a refusal here is not shown.
  const used = useMutation<unknown, ApiFailure, string>({
    mutationFn: (id) =>
      unwrap(api(`/v1/quick-replies/${encodeURIComponent(id)}/used`, { method: 'POST' })),
    onSuccess: () =>
      void queries.invalidateQueries({ queryKey: scopeKey(scope, 'quick-replies', workspaceId) }),
  });

  const send = useMutation<
    Message,
    ApiFailure,
    { text: string; key: string; templateId: string | null }
  >({
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
      template.current = null;
      queries.setQueryData<Pages>(messagesKey, (p) =>
        withMessage(p, sendingMessage(key, text, meId, new Date())),
      );
    },
    onSuccess: (m, { key, templateId }) => {
      last.current = null;
      if (templateId) used.mutate(templateId);
      queries.setQueryData<Pages>(messagesKey, (p) => withMessage(withoutLocal(p, key), m));
    },
    onError: (failure, { text, key, templateId }) => {
      queries.setQueryData<Pages>(messagesKey, (p) => withoutLocal(p, key));
      setText((now) => {
        if (now) return now;
        template.current = templateId;
        return text;
      });
      setError(failure.error);
      if (failure.error.action === 'reload')
        void queries.invalidateQueries({
          queryKey: scopeKey(scope, 'conversation', conversationId),
        });
    },
  });

  const submit = () => {
    if (send.isPending) return;
    const filled = fill(text, values);
    const left = unresolvedProblem(filled);
    if (left) return setProblem(left);
    const checked = textOf(filled);
    if (!checked.ok) return setProblem(checked.problem);
    setProblem(null);
    const key = last.current?.text === checked.text ? last.current.key : crypto.randomUUID();
    last.current = { text: checked.text, key };
    send.mutate({ text: checked.text, key, templateId: template.current });
  };

  const edit = (next: string) => {
    setText(next);
    setProblem(null);
    if (!next.trim()) template.current = null;
  };
  const pick = (r: QuickReply) => {
    edit(fill(r.body, known));
    template.current = r.id;
    requestAnimationFrame(() => box.current?.focus());
  };
  const pickerKey = (e: KeyEvent): boolean => {
    if (!open) return false;
    if (e.key === 'Escape') setClosedAt(text);
    else if (!shown.length) return false;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const step = e.key === 'ArrowDown' ? 1 : shown.length - 1;
      setPointer({ q: q ?? '', at: (active + step) % shown.length });
    } else if ((e.key === 'Enter' && !e.ctrlKey && !e.metaKey) || e.key === 'Tab') {
      const r = shown[active];
      if (r) pick(r);
    } else return false;
    e.preventDefault();
    return true;
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
        Soạn tin trả lời (Ctrl+Enter để gửi, phím R để vào ô này, gõ “/” để chọn mẫu)
      </label>
      <textarea
        id="composer"
        ref={box}
        rows={3}
        value={text}
        aria-keyshortcuts="R"
        aria-invalid={problem ? true : undefined}
        aria-describedby="composer-count"
        aria-autocomplete="list"
        aria-controls={open && shown.length ? PICKER_ID : undefined}
        aria-activedescendant={open && shown[active] ? optionId(shown[active]) : undefined}
        className="rounded-input border border-border-strong p-2"
        onChange={(e) => edit(e.target.value)}
        onKeyDown={(e) => {
          if (pickerKey(e)) return;
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          }
        }}
      />
      {open && q !== null ? (
        <TemplatePicker q={q} list={templates} active={active} onPick={pick} />
      ) : null}
      <VariableFields
        fields={fields}
        values={values}
        onChange={(name, value) => {
          setValues((v) => ({ ...v, [name]: value }));
          setProblem(null);
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
