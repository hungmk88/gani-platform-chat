'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import { ApiFailure, unwrap } from '../query/fetch';
import { scopeKey } from '../query/keys';
import { useScope } from '../query/provider';
import { timeText } from '../security/security';
import {
  CREATE_PATH,
  createBodyOf,
  reasonProblem,
  type AccessSessionCreate,
  type OpenedSession,
} from './access';
import type { TenantHealth } from './platform';

const field = 'rounded-input border border-border-strong px-3 py-2';
const button = 'rounded-input border border-border-strong px-4 py-2 disabled:opacity-70';
export const primary = 'rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70';

/**
 * "Tạo phiên" (U79, PR U79b): one company and a reason (10–500 as the API counts), `POST /v1/platform/access-sessions` for 60
 * minutes with one Idempotency-Key per content (the same content sent again keeps its key). Focus on the dialog itself, never on
 * "Hủy" (#411). 404 (no such company any more) reads the companies again.
 */
export function CreateDialog(props: {
  companies: readonly TenantHealth[];
  onClose: () => void;
  onDone: (said: string) => void;
}) {
  const { companies } = props;
  const scope = useScope();
  const queries = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const last = useRef<{ text: string; key: string } | null>(null);
  const [chosen, setChosen] = useState('');
  // The chosen company while it is still in the list (a 404 reads the list again), else the first.
  const orgId = companies.some((c) => c.orgId === chosen) ? chosen : (companies[0]?.orgId ?? '');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const open = useMutation<OpenedSession, ApiFailure, { body: AccessSessionCreate; key: string }>({
    mutationFn: ({ body, key }) =>
      unwrap(api<OpenedSession>(CREATE_PATH, { method: 'POST', body, idempotencyKey: key })),
    onSuccess: (s, { body }) => {
      void queries.invalidateQueries({ queryKey: scopeKey(scope, 'platform', 'sessions') });
      const name = companies.find((c) => c.orgId === body.orgId)?.name ?? '';
      props.onDone(`Đã mở phiên 60 phút ở ${name}, tới ${timeText(s.expiresAt)}. Đã ghi audit.`);
      dialog.current?.close();
    },
    onError: (e) =>
      void (
        e.error.code === 'not_found' &&
        queries.invalidateQueries({ queryKey: scopeKey(scope, 'platform', 'companies') })
      ),
  });
  useEffect(() => (dialog.current?.showModal(), dialog.current?.focus()), []);

  const submit = () => {
    if (open.isPending) return;
    const p = orgId ? reasonProblem(reason) : 'Chọn công ty.';
    setProblem(p);
    if (p) return;
    const body = createBodyOf(orgId, reason);
    const text = JSON.stringify(body);
    const key = last.current?.text === text ? last.current.key : crypto.randomUUID();
    last.current = { text, key };
    open.mutate({ body, key });
  };
  const edit = (f: () => void) => (f(), setProblem(null), !open.isPending && open.reset());
  const failure = open.error?.error;
  return (
    <dialog
      ref={dialog}
      tabIndex={-1}
      aria-labelledby="create-title"
      onClose={props.onClose}
      onCancel={(e) => open.isPending && e.preventDefault()}
      className="m-auto w-[480px] max-w-full rounded-dialog bg-surface p-6 shadow-dialog backdrop:bg-overlay"
    >
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(e) => (e.preventDefault(), submit())}
      >
        <h3 id="create-title" className="text-16 font-semibold">
          Tạo phiên truy cập
        </h3>
        <label className="flex flex-col gap-1">
          Công ty
          <select
            value={orgId}
            className={field}
            disabled={!companies.length}
            onChange={(e) => edit(() => setChosen(e.target.value))}
          >
            {companies.map((c) => (
              <option key={c.orgId} value={c.orgId}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {companies.length ? null : <p>Chưa đọc được danh sách công ty. Đóng rồi thử lại.</p>}
        <label className="flex flex-col gap-1">
          Lý do (bắt buộc)
          <textarea
            rows={3}
            value={reason}
            className={field}
            onChange={(e) => edit(() => setReason(e.target.value))}
          />
        </label>
        <p className="text-12 text-text-muted">
          Phiên 60 phút. Công ty thấy lý do và mọi thao tác trong Audit log của họ. Không ghi SĐT,
          email, nội dung tin.
        </p>
        {problem || failure ? (
          <div role="alert">
            <p>{problem ?? failure?.message}</p>
            {!problem && failure?.traceId ? (
              <p className="text-12 text-text-muted">Mã: {failure.traceId}</p>
            ) : null}
          </div>
        ) : null}
        <div className="flex gap-2">
          <button
            type="submit"
            className={primary}
            disabled={open.isPending || !companies.length}
            aria-busy={open.isPending}
          >
            {open.isPending ? 'Đang gửi…' : 'Mở phiên 60 phút'}
          </button>
          <button
            type="button"
            className={button}
            disabled={open.isPending}
            onClick={() => dialog.current?.close()}
          >
            Hủy
          </button>
        </div>
      </form>
    </dialog>
  );
}
