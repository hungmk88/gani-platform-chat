'use client';

import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import type { components } from '../api/schema';
import { ApiFailure, unwrap } from '../query/fetch';
import { scopeKey } from '../query/keys';
import { useScope } from '../query/provider';
import { MAX_REASON, reasonProblem, resetError, withMember, type Member } from './list';

type Page = components['schemas']['MemberPage'];

const button = 'rounded-input border border-border-strong px-4 py-2 disabled:opacity-70';
const primary = 'rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70';

/**
 * "Đặt lại 2FA" of one member (#19, `POST /v1/members/{id}/2fa/reset`, Q-U20-1, N155): a reason (kept in the audit log, never in
 * the application's), waiting for the server; the row then takes the API's answer. One Idempotency-Key per reason, kept when the
 * same is sent again after a failure.
 */
export function ResetDialog({
  member,
  onClose,
  onDone,
}: {
  member: Member;
  onClose: () => void;
  onDone: (m: Member) => void;
}) {
  const scope = useScope();
  const queries = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const last = useRef<{ reason: string; key: string } | null>(null);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const reset = useMutation<Member, ApiFailure, { reason: string; key: string }>({
    mutationFn: ({ reason, key }) =>
      unwrap(
        api<Member>(`/v1/members/${encodeURIComponent(member.id)}/2fa/reset`, {
          method: 'POST',
          body: { reason },
          idempotencyKey: key,
        }),
      ),
    onSuccess: (m) => {
      queries.setQueryData<InfiniteData<Page>>(scopeKey(scope, 'members'), (p) => withMember(p, m));
      onDone(m);
      dialog.current?.close();
    },
  });
  useEffect(() => dialog.current?.showModal(), []);

  const submit = () => {
    if (reset.isPending) return;
    const p = reasonProblem(reason);
    setProblem(p);
    if (p) return;
    const text = reason.trim();
    const key = last.current?.reason === text ? last.current.key : crypto.randomUUID();
    last.current = { reason: text, key };
    reset.mutate({ reason: text, key });
  };

  const who = member.name ?? member.email;
  return (
    <dialog
      ref={dialog}
      aria-labelledby="reset-title"
      onClose={onClose}
      className="m-auto w-[440px] max-w-full rounded-dialog bg-surface p-6 shadow-dialog backdrop:bg-overlay"
    >
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h3 id="reset-title" className="text-16 font-semibold">
          Đặt lại 2FA — {who}
        </h3>
        <p>
          Xác thực 2 lớp của người này bị tắt và mọi phiên đăng nhập của họ bị thu hồi. Owner hoặc
          Admin phải cài lại ở lần đăng nhập kế tiếp.
        </p>
        <label className="flex flex-col gap-1">
          Lý do (bắt buộc, lưu vào nhật ký)
          <textarea
            rows={2}
            maxLength={MAX_REASON}
            value={reason}
            aria-invalid={problem ? true : undefined}
            className="rounded-input border border-border-strong p-2"
            onChange={(e) => {
              setReason(e.target.value);
              setProblem(null);
            }}
          />
        </label>
        {problem ? <p role="alert">{problem}</p> : null}
        {reset.error ? (
          <div role="alert">
            <p>{resetError(reset.error.error)}</p>
            {reset.error.error.traceId ? (
              <p className="text-12 text-text-muted">Mã: {reset.error.error.traceId}</p>
            ) : null}
          </div>
        ) : null}
        <div className="flex gap-2">
          <button
            type="submit"
            className={primary}
            disabled={reset.isPending}
            aria-busy={reset.isPending}
          >
            {reset.isPending ? 'Đang đặt lại…' : 'Đặt lại 2FA'}
          </button>
          <button type="button" className={button} onClick={() => dialog.current?.close()}>
            Hủy
          </button>
        </div>
      </form>
    </dialog>
  );
}
