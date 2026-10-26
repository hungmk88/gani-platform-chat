'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { api } from '../api/client';
import { ApiFailure, unwrap } from '../query/fetch';
import { scopeKey } from '../query/keys';
import { useScope } from '../query/provider';
import {
  MAX_BODY,
  MAX_SHORTCUT,
  quickReplyDraftOf,
  quickReplyError,
  VARIABLES,
  type QuickReply,
} from './quick-replies';

const field = 'rounded-input border border-border-strong px-3 py-2';
const chip = 'rounded-input border border-border-strong px-2 py-1 text-12';

/**
 * "Tạo mẫu" (#22, `POST /v1/quick-replies`, N163) in the workspace being worked in: checked like the API first (shortcut, only the
 * variables of Đợt 1, tags), then waits for the server (it makes a record), one Idempotency-Key per template, kept when the same is
 * sent again after a failure. Done, every list of the workspace is read again (the API sorts by use).
 */
export function QuickReplyForm({ workspaceId }: { workspaceId: string }) {
  const scope = useScope();
  const queries = useQueryClient();
  const last = useRef<{ what: string; key: string } | null>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  const [shortcut, setShortcut] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const create = useMutation<QuickReply, ApiFailure, { body: object; key: string }>({
    mutationFn: ({ body, key }) =>
      unwrap(api<QuickReply>('/v1/quick-replies', { method: 'POST', body, idempotencyKey: key })),
    onSuccess: () => {
      last.current = null;
      void queries.invalidateQueries({ queryKey: scopeKey(scope, 'quick-replies', workspaceId) });
      setShortcut('');
      setBody('');
      setTags('');
    },
  });

  const edit = (set: (v: string) => void) => (v: string) => {
    set(v);
    setProblem(null);
  };
  /** Puts `{{name}}` where the caret is, or at the end. */
  const insert = (name: string) => {
    const at = text.current?.selectionStart ?? body.length;
    const token = `{{${name}}}`;
    edit(setBody)(body.slice(0, at) + token + body.slice(at));
    requestAnimationFrame(() => {
      text.current?.focus();
      text.current?.setSelectionRange(at + token.length, at + token.length);
    });
  };
  const submit = () => {
    if (create.isPending) return;
    const draft = quickReplyDraftOf(workspaceId, shortcut, body, tags);
    if (typeof draft === 'string') return setProblem(draft);
    const what = JSON.stringify(draft);
    const key = last.current?.what === what ? last.current.key : crypto.randomUUID();
    last.current = { what, key };
    create.mutate({ body: draft, key });
  };

  return (
    <form
      aria-labelledby="quick-reply-form-title"
      className="flex max-w-[560px] flex-col gap-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <h2 id="quick-reply-form-title" className="text-16 font-semibold">
        Tạo mẫu
      </h2>
      <label className="flex flex-col gap-1">
        Phím tắt (gõ sau “/” trong Hộp thư)
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
      <div role="group" aria-label="Chèn biến" className="flex flex-wrap items-center gap-2">
        <span className="text-12 text-text-muted">Chèn biến:</span>
        {VARIABLES.map(([name, label]) => (
          <button key={name} type="button" className={chip} onClick={() => insert(name)}>
            {label}
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-1">
        Tag (không bắt buộc, cách nhau bằng dấu phẩy, tối đa 10)
        <input value={tags} className={field} onChange={(e) => edit(setTags)(e.target.value)} />
      </label>
      {problem ? <p role="alert">{problem}</p> : null}
      {create.error ? (
        <div role="alert">
          <p>{quickReplyError(create.error.error, shortcut.trim().replace(/^\//, ''))}</p>
          {create.error.error.traceId ? (
            <p className="text-12 text-text-muted">Mã: {create.error.error.traceId}</p>
          ) : null}
        </div>
      ) : null}
      {create.isSuccess ? <p role="status">Đã tạo mẫu /{create.data.shortcut}.</p> : null}
      <div>
        <button
          type="submit"
          className="rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70"
          disabled={create.isPending}
          aria-busy={create.isPending}
        >
          {create.isPending ? 'Đang tạo…' : 'Tạo mẫu'}
        </button>
      </div>
    </form>
  );
}
