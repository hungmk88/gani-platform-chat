'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { useApiQuery } from '../query/provider';
import { RetryAction } from '../retry-button';
import { eventText, leadPath, type LeadDetail } from './lead-detail';
import { STATUS, timeText } from './leads';

const back = (
  <Link href="/leads" className="self-start underline">
    Về pipeline lead
  </Link>
);

/**
 * #13a Chi tiết lead, read only (brief 36, 44–45): the lead, its customer, who handles it, its step and state, and its history,
 * oldest first. Another workspace's or another company's lead is a 404 like one that does not exist (P9). The conversation it came
 * from is linked only for the roles that read the inbox.
 */
export function LeadDetailView({
  id,
  meId,
  readsInbox,
}: {
  id: string;
  meId: string;
  readsInbox: boolean;
}) {
  const lead = useApiQuery<LeadDetail>(['lead', id], leadPath(id));
  if (lead.isPending)
    return (
      <p role="status" aria-busy="true" className="text-text-muted">
        Đang tải lead…
      </p>
    );
  if (lead.isError) {
    const { error } = lead.error;
    if (error.code === 'not_found' || error.code === 'validation_failed')
      return (
        <div className="flex flex-col items-start gap-2">
          <h1 className="text-20 font-semibold">Không tìm thấy lead</h1>
          <p>Có thể lead thuộc workspace khác hoặc bạn không được xem.</p>
          {back}
        </div>
      );
    return (
      <div role="alert" className="flex flex-col gap-2">
        <p>{error.message}</p>
        {error.traceId ? <p className="text-12 text-text-muted">Mã: {error.traceId}</p> : null}
        <RetryAction onRetry={() => void lead.refetch()} busy={lead.isFetching} />
      </div>
    );
  }

  const l = lead.data;
  const facts: [string, ReactNode][] = [
    [
      'Khách',
      <Link href={`/customers/${encodeURIComponent(l.customer.id)}`} className="underline">
        {l.customer.displayName ?? 'Khách chưa có tên'}
      </Link>,
    ],
    ['Phụ trách', l.owner ? (l.owner.name ?? 'Chưa có tên') : 'Chưa giao'],
    ['Bước', l.stage.name],
    ['Trạng thái', STATUS[l.status][0]],
    ...(l.status === 'lost' && l.lostReason
      ? [['Lý do Thua', l.lostReason] as [string, string]]
      : []),
    ...(l.closedAt ? [['Đóng lúc', timeText(l.closedAt)] as [string, string]] : []),
    ['Tạo lúc', timeText(l.createdAt)],
    ['Cập nhật', timeText(l.updatedAt)],
  ];
  return (
    <div className="flex flex-col gap-6">
      {back}
      <h1 className="text-20 font-semibold">{l.title}</h1>
      <section aria-labelledby="lead-info" className="flex flex-col gap-2">
        <h2 id="lead-info" className="text-16 font-semibold">
          Thông tin
        </h2>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2">
          {facts.map(([term, value]) => (
            <div key={term} className="contents">
              <dt className="text-text-muted">{term}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {l.conversationId && readsInbox ? (
          <Link
            href={`/inbox/${encodeURIComponent(l.conversationId)}`}
            className="self-start underline"
          >
            Mở hội thoại gốc
          </Link>
        ) : null}
      </section>
      <section aria-labelledby="lead-history" className="flex flex-col gap-2">
        <h2 id="lead-history" className="text-16 font-semibold">
          Lịch sử
        </h2>
        {l.events.length ? (
          <ol className="flex flex-col gap-1">
            {l.events.map((e, n) => (
              <li key={n} className="flex flex-wrap gap-x-3">
                <span className="whitespace-nowrap text-text-muted">{timeText(e.occurredAt)}</span>
                {eventText(e, meId)}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-text-muted">Chưa có sự kiện nào.</p>
        )}
      </section>
    </div>
  );
}
