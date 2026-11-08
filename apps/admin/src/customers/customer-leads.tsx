'use client';

import Link from 'next/link';

import { customerLeadsPath, STATUS, timeText, type LeadPage } from '../leads/leads';
import { useApiPages } from '../query/provider';
import { RetryAction } from '../retry-button';

const TONE = { ok: 'bg-ok-bg text-ok-text', error: 'bg-error-bg text-error-text' };

/**
 * "Lead của khách" of #8 (CEO brief 169 P3): the customer's leads as the API lets the role read them (T-2, N188: Sales the leads they
 * made or hold; Support none, never asked), newest change first as the API gives them: title (to #13a), step, status, the person in
 * charge, last change. Read only: making and moving leads is #12b/#12c.
 */
export function CustomerLeads({ customerId }: { customerId: string }) {
  const leads = useApiPages<LeadPage>(['customer', customerId, 'leads'], (cursor) =>
    customerLeadsPath(customerId, cursor),
  );
  const rows = leads.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <section aria-labelledby="customer-leads" className="flex flex-col gap-2">
      <h2 id="customer-leads" className="text-16 font-semibold">
        Lead của khách
      </h2>
      {leads.isPending ? (
        <p role="status" aria-busy="true" className="text-text-muted">
          Đang tải lead…
        </p>
      ) : leads.isError ? (
        <div role="alert" className="flex flex-col gap-2">
          <p>{leads.error.error.message}</p>
          {leads.error.error.traceId ? (
            <p className="text-12 text-text-muted">Mã: {leads.error.error.traceId}</p>
          ) : null}
          <RetryAction onRetry={() => void leads.refetch()} busy={leads.isFetching} />
        </div>
      ) : rows.length ? (
        <ul className="flex flex-col gap-2">
          {rows.map((l) => {
            const [label, tone] = STATUS[l.status];
            return (
              <li key={l.id} className="flex flex-col gap-1 rounded-input border border-border p-2">
                <Link href={`/leads/${l.id}`} className="underline">
                  {l.title}
                </Link>
                <span className="flex flex-wrap items-center gap-2 text-12">
                  <span>{l.stage.name}</span>
                  <span className={`rounded-input px-2 py-1 ${tone ? TONE[tone] : 'bg-bg-subtle'}`}>
                    {label}
                  </span>
                  <span>Phụ trách: {l.owner ? (l.owner.name ?? 'Chưa có tên') : 'Chưa giao'}</span>
                  <span className="text-text-muted">Cập nhật {timeText(l.updatedAt)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p>Khách chưa có lead nào.</p>
      )}
      {leads.hasNextPage ? (
        <button
          type="button"
          className="self-start rounded-input border border-border-strong px-3 py-1"
          disabled={leads.isFetchingNextPage}
          aria-busy={leads.isFetchingNextPage}
          onClick={() => void leads.fetchNextPage()}
        >
          {leads.isFetchingNextPage ? 'Đang tải…' : 'Tải thêm lead'}
        </button>
      ) : null}
    </section>
  );
}
