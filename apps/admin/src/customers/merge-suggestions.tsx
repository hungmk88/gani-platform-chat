'use client';

import Link from 'next/link';
import { useState } from 'react';

import type { Role } from '../nav';
import { useApiQuery } from '../query/provider';
import { RetryAction } from '../retry-button';
import { nameOf, phoneText, type Customer } from './customers';
import { MergeDialog } from './merge-dialog';
import { mayMerge, REASON, suggestionsPath, type MergeSuggestionList } from './merges';

const chip = 'rounded-input bg-bg-subtle px-2 py-1 text-12';
const button = 'rounded-input border border-border-strong px-3 py-1';

/**
 * "Khách có thể trùng" of #8 (J3d, `GET /v1/customers/{id}/merge-suggestions`, CEO brief 153 PR A): live customers of the company
 * with exactly the same phone or email, at most 20, newest first, as the API answers. Owner, Admin, Manager (N204); "Gộp…" opens
 * `MergeDialog` (PR B1, tầng 3) for an Owner or an Admin only (`mayMerge`).
 */
export function MergeSuggestions({ customer, role }: { customer: Customer; role: Role }) {
  const id = customer.id;
  const [merging, setMerging] = useState<Customer | null>(null);
  const list = useApiQuery<MergeSuggestionList>(
    ['customer', id, 'merge-suggestions'],
    suggestionsPath(id),
  );
  return (
    <section aria-labelledby="customer-duplicates" className="flex flex-col gap-2">
      <h2 id="customer-duplicates" tabIndex={-1} className="text-16 font-semibold">
        Khách có thể trùng
      </h2>
      {list.isPending ? (
        <p role="status" aria-busy="true" className="text-text-muted">
          Đang tìm khách có thể trùng…
        </p>
      ) : list.isError ? (
        <div role="alert" className="flex flex-col gap-2">
          <p>{list.error.error.message}</p>
          {list.error.error.traceId ? (
            <p className="text-12 text-text-muted">Mã: {list.error.error.traceId}</p>
          ) : null}
          <RetryAction onRetry={() => void list.refetch()} busy={list.isFetching} />
        </div>
      ) : list.data.data.length ? (
        <ul className="flex flex-col gap-2">
          {list.data.data.map(({ customer: c, reasons }) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center gap-2 rounded-input border border-border p-2"
            >
              <span className="font-semibold">{nameOf(c)}</span>
              {c.phone ? <span>{phoneText(c.phone)}</span> : null}
              {c.email ? <span className="break-all">{c.email}</span> : null}
              {reasons.map((r) => (
                <span key={r} className={chip}>
                  {REASON[r]}
                </span>
              ))}
              <Link href={`/customers/${c.id}`} className="ml-auto underline">
                Xem hồ sơ
                <span className="sr-only"> {nameOf(c)}</span>
              </Link>
              {mayMerge(role) ? (
                <button type="button" className={button} onClick={() => setMerging(c)}>
                  Gộp…<span className="sr-only"> {nameOf(c)}</span>
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p>Không thấy khách nào trùng SĐT hoặc email.</p>
      )}
      {merging ? (
        <MergeDialog viewed={customer} other={merging} onClose={() => setMerging(null)} />
      ) : null}
    </section>
  );
}
