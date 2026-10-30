'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import type { Customer } from '../customers/customers';
import { ApiFailure, unwrap } from '../query/fetch';
import { redirectFor, scopeKey } from '../query/keys';
import { useScope } from '../query/provider';
import { CustomerField } from '../tickets/customer-field';
import { KIND } from './labels';
import {
  MAX_REASON,
  requestBodyOf,
  type PrivacyRequest,
  type PrivacyRequestCreate,
  type RequestDraft,
} from './privacy';

const field = 'rounded-input border border-border-strong px-3 py-2';
const button = 'rounded-input border border-border-strong px-4 py-2 disabled:opacity-70';
const primary = 'rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70';

/** Said when the customer picked is no longer visible (404): the pick is dropped, the rest of the form kept (as #359). */
const CUSTOMER_GONE = 'Khách này không còn thấy được. Đã bỏ chọn, chọn khách khác.';

/**
 * "Ghi nhận yêu cầu" (#23 PR B, `POST /v1/privacy-requests`, planned S5): the customer, what they ask (`export` or `erase`) and the
 * reason (1–500, kept as plain text). Nothing is carried out here: an `erase` is done later with its own dialog. Waits for the
 * server; one Idempotency-Key for one body (sent again unchanged it keeps its key). A failure never clears the form,
 * and nothing is sent again by itself: each request is a click.
 */
export function RequestDialog({ onClose }: { onClose: () => void }) {
  const scope = useScope();
  const queries = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const last = useRef<{ what: string; key: string } | null>(null);
  const [draft, setDraft] = useState<RequestDraft>({ customerId: '', kind: 'export', reason: '' });
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const create = useMutation<
    PrivacyRequest,
    ApiFailure,
    { body: PrivacyRequestCreate; key: string }
  >({
    mutationFn: ({ body, key }) =>
      unwrap(
        api<PrivacyRequest>('/v1/privacy-requests', {
          method: 'POST',
          body,
          idempotencyKey: key,
          retry: false, // the person sends again, never the client by itself (CEO 31/10, as the erase of B2)
        }),
      ),
    onSuccess: () => {
      last.current = null;
      void queries.invalidateQueries({ queryKey: scopeKey(scope, 'privacy-requests') });
      dialog.current?.close();
    },
    onError: ({ error }) => {
      const to = redirectFor(error);
      if (to) window.location.assign(to);
      if (error.code === 'not_found') {
        setCustomer(null);
        setDraft((d) => ({ ...d, customerId: '' }));
      }
    },
  });
  useEffect(() => dialog.current?.showModal(), []);

  const edit = (next: Partial<RequestDraft>) => {
    setDraft((d) => ({ ...d, ...next }));
    setProblem(null);
  };
  const submit = () => {
    if (create.isPending) return;
    const body = requestBodyOf(draft);
    if (typeof body === 'string') return setProblem(body);
    const what = JSON.stringify(body);
    const key = last.current?.what === what ? last.current.key : crypto.randomUUID();
    last.current = { what, key };
    create.mutate({ body, key });
  };
  const failed = create.error?.error;
  const sent = create.variables?.body;
  const error =
    problem ??
    (failed?.code === 'not_found'
      ? CUSTOMER_GONE
      : failed?.code === 'duplicate_resource' && sent
        ? `Khách này đã có một yêu cầu "${KIND[sent.kind]}" đang chờ thực hiện.`
        : (failed?.message ?? null));

  return (
    <dialog
      ref={dialog}
      aria-labelledby="request-title"
      onClose={onClose}
      className="m-auto w-[480px] max-w-full rounded-dialog bg-surface p-6 shadow-dialog backdrop:bg-overlay"
    >
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h3 id="request-title" className="text-16 font-semibold">
          Ghi nhận yêu cầu
        </h3>
        <CustomerField
          label="Khách hàng"
          value={customer}
          onChange={(c) => {
            setCustomer(c);
            edit({ customerId: c?.id ?? '' });
          }}
        />
        <label className="flex flex-col gap-1">
          Khách yêu cầu
          <select
            value={draft.kind}
            className={field}
            onChange={(e) => edit({ kind: e.target.value as RequestDraft['kind'] })}
          >
            {Object.entries(KIND).map(([k, word]) => (
              <option key={k} value={k}>
                {word}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Lý do
          <textarea
            value={draft.reason}
            maxLength={MAX_REASON}
            rows={3}
            required
            className={field}
            onChange={(e) => edit({ reason: e.target.value })}
          />
        </label>
        <p className="text-12 text-text-muted">
          Không chép SĐT, email hay nội dung tin của khách vào lý do. Ghi nhận chưa thực hiện gì.
        </p>
        {error ? (
          <div role="alert" className="flex flex-col gap-1">
            <p>{error}</p>
            {!problem && failed?.traceId ? (
              <p className="text-12 text-text-muted">Mã: {failed.traceId}</p>
            ) : null}
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" className={button} onClick={() => dialog.current?.close()}>
            Đóng
          </button>
          <button
            type="submit"
            className={primary}
            disabled={create.isPending}
            aria-busy={create.isPending}
          >
            {create.isPending ? 'Đang ghi nhận…' : 'Ghi nhận'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
