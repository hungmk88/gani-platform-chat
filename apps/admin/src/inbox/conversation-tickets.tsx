'use client';

import Link from 'next/link';

import { useApiPages } from '../query/provider';
import { RetryAction } from '../retry-button';
import { Assignee } from '../tickets/assignee';
import {
  changedAt,
  conversationTicketsPath,
  PRIORITY,
  STATUS,
  type TicketPage,
} from '../tickets/tickets';

const TONE = { ok: 'bg-ok-bg text-ok-text', warn: 'bg-warn-bg text-warn-text' };

/**
 * "Ticket của hội thoại" in the open conversation (#6; U53, N170; CEO brief 171 B8): `GET /v1/tickets?conversationId=`, newest first
 * as the API gives them, by cursor, for the roles that work with tickets (the caller checks `mayReadTickets`; Sales reads the ones
 * they made, the API filters). Read only: each title opens #15. Made from here with "Tạo ticket".
 */
export function ConversationTickets({ id }: { id: string }) {
  const tickets = useApiPages<TicketPage>(['tickets', 'conversation', id], (cursor) =>
    conversationTicketsPath(id, cursor),
  );
  const rows = tickets.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <section aria-labelledby="conversation-tickets" className="flex flex-col gap-2">
      <h3 id="conversation-tickets" className="font-semibold">
        Ticket của hội thoại
      </h3>
      {tickets.isPending ? (
        <p role="status" aria-busy="true" className="text-text-muted">
          Đang tải ticket…
        </p>
      ) : tickets.isError ? (
        <div role="alert" className="flex flex-col gap-2">
          <p>{tickets.error.error.message}</p>
          {tickets.error.error.traceId ? (
            <p className="text-12 text-text-muted">Mã: {tickets.error.error.traceId}</p>
          ) : null}
          <RetryAction onRetry={() => void tickets.refetch()} busy={tickets.isFetching} />
        </div>
      ) : rows.length ? (
        <ul aria-label="Ticket" className="flex flex-col gap-2">
          {rows.map((t) => {
            const [label, tone] = STATUS[t.status];
            return (
              <li key={t.id} className="flex flex-col gap-1 rounded-input border border-border p-2">
                <Link href={`/tickets/${encodeURIComponent(t.id)}`} className="underline">
                  {t.title}
                </Link>
                <span className="flex flex-wrap items-center gap-2 text-12">
                  <span className={`rounded-input px-2 py-1 ${tone ? TONE[tone] : 'bg-bg-subtle'}`}>
                    {label}
                  </span>
                  <span>Ưu tiên: {PRIORITY[t.priority]}</span>
                  <span>
                    Phụ trách: <Assignee t={t} />
                  </span>
                  <span className="text-text-muted">Cập nhật {changedAt(t)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p>Chưa có ticket nào cho hội thoại này.</p>
      )}
      {tickets.hasNextPage ? (
        <button
          type="button"
          className="self-start rounded-input border border-border-strong px-3 py-1"
          disabled={tickets.isFetchingNextPage}
          aria-busy={tickets.isFetchingNextPage}
          onClick={() => void tickets.fetchNextPage()}
        >
          {tickets.isFetchingNextPage ? 'Đang tải…' : 'Tải thêm ticket'}
        </button>
      ) : null}
    </section>
  );
}
