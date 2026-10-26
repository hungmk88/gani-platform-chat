'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRef, useState, type ReactNode } from 'react';

import { api } from '../api/client';
import type { Role } from '../nav';
import { ApiFailure, unwrap } from '../query/fetch';
import { scopeKey } from '../query/keys';
import { useApiQuery, useScope } from '../query/provider';
import { RetryAction } from '../retry-button';
import { eventText, moveLabel, movesFor, ticketPath, type TicketDetail } from './ticket-detail';
import { PRIORITY, slaText, STATUS, timeText, type TicketStatus } from './tickets';

const TONE = { ok: 'bg-ok-bg text-ok-text', warn: 'bg-warn-bg text-warn-text' };
const button = 'rounded-input border border-border-strong px-4 py-2 disabled:opacity-70';
const primary = 'rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70';
const back = (
  <Link href="/tickets" className="self-start underline">
    Về danh sách ticket
  </Link>
);

/**
 * #15 Chi tiết ticket (U27, N167): the ticket, who handles it, its SLA and its history, oldest first. The moves its status may make
 * are buttons (`movesFor`); each waits for the server with the version last read, cancelling asks again. 409 invalid_transition or
 * version_conflict read the ticket again. Planned S4: until the API serves it the list already says the screen is not there.
 */
export function TicketView({ id, role, meId }: { id: string; role: Role; meId: string }) {
  const scope = useScope();
  const queries = useQueryClient();
  const ticket = useApiQuery<TicketDetail>(['ticket', id], ticketPath(id));
  const confirm = useRef<HTMLDialogElement>(null);
  const [done, setDone] = useState<string | null>(null);
  const move = useMutation<TicketDetail, ApiFailure, { status: TicketStatus; version: number }>({
    mutationFn: (body) => unwrap(api<TicketDetail>(ticketPath(id), { method: 'PATCH', body })),
    onSuccess: (t) => {
      queries.setQueryData(scopeKey(scope, 'ticket', id), t);
      void queries.invalidateQueries({ queryKey: scopeKey(scope, 'tickets') });
      setDone(`Đã chuyển sang ${STATUS[t.status][0]}.`);
      confirm.current?.close();
    },
    onError: ({ error }) => {
      confirm.current?.close();
      if (error.action === 'reload')
        void queries.invalidateQueries({ queryKey: scopeKey(scope, 'ticket', id) });
    },
  });

  if (ticket.isPending)
    return (
      <p role="status" aria-busy="true" className="text-text-muted">
        Đang tải ticket…
      </p>
    );
  if (ticket.isError) {
    const { error } = ticket.error;
    // Another company's ticket is a 404 like one that does not exist (P9); a malformed id is no better.
    if (error.code === 'not_found' || error.code === 'validation_failed')
      return (
        <div className="flex flex-col items-start gap-2">
          <h1 className="text-20 font-semibold">Không tìm thấy ticket</h1>
          <p>Có thể ticket thuộc workspace khác hoặc bạn không được xem.</p>
          {back}
        </div>
      );
    return (
      <div role="alert" className="flex flex-col gap-2">
        <p>{error.message}</p>
        {error.traceId ? <p className="text-12 text-text-muted">Mã: {error.traceId}</p> : null}
        <RetryAction onRetry={() => void ticket.refetch()} busy={ticket.isFetching} />
      </div>
    );
  }

  const t = ticket.data;
  const [label, tone] = STATUS[t.status];
  const moves = movesFor(t.status, role);
  const go = (status: TicketStatus) => {
    if (move.isPending) return;
    setDone(null);
    move.mutate({ status, version: t.version });
  };
  const facts: [string, ReactNode][] = [
    ['Ưu tiên', PRIORITY[t.priority]],
    [
      'Khách',
      t.customer ? (
        <Link href={`/customers/${encodeURIComponent(t.customer.id)}`} className="underline">
          {t.customer.displayName ?? 'Khách chưa có tên'}
        </Link>
      ) : (
        'Không gắn khách'
      ),
    ],
    [
      'Hội thoại',
      t.conversationId ? (
        <Link href={`/inbox/${encodeURIComponent(t.conversationId)}`} className="underline">
          Mở trong Hộp thư
        </Link>
      ) : (
        'Không có'
      ),
    ],
    ['Phụ trách', t.assignee?.name ?? 'Chưa giao'],
    ['SLA', slaText(t)],
    ['Tạo lúc', timeText(t.createdAt)],
    ['Cập nhật', timeText(t.updatedAt)],
  ];
  return (
    <div className="flex flex-col gap-6">
      {back}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-20 font-semibold">{t.title}</h1>
        <span className={`rounded-input px-2 py-1 text-12 ${tone ? TONE[tone] : 'bg-bg-subtle'}`}>
          {label}
        </span>
      </div>
      {moves.length ? (
        <div className="flex flex-wrap gap-2">
          {moves.map((to, n) => (
            <button
              key={to}
              type="button"
              disabled={move.isPending}
              aria-busy={move.isPending && move.variables.status === to}
              className={n === 0 && to !== 'cancelled' ? primary : button}
              onClick={() => (to === 'cancelled' ? confirm.current?.showModal() : go(to))}
            >
              {moveLabel(t.status, to)}
            </button>
          ))}
        </div>
      ) : null}
      {move.isError ? (
        <div role="alert" className="flex flex-col gap-1">
          <p>{move.error.error.message}</p>
          {move.error.error.traceId ? (
            <p className="text-12 text-text-muted">Mã: {move.error.error.traceId}</p>
          ) : null}
        </div>
      ) : done ? (
        <p role="status">{done}</p>
      ) : null}
      <section aria-labelledby="ticket-info" className="flex flex-col gap-2">
        <h2 id="ticket-info" className="text-16 font-semibold">
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
        <p className="whitespace-pre-wrap break-words">{t.description ?? 'Chưa có mô tả.'}</p>
      </section>
      <section aria-labelledby="ticket-history" className="flex flex-col gap-2">
        <h2 id="ticket-history" className="text-16 font-semibold">
          Lịch sử
        </h2>
        <ol className="flex flex-col gap-1">
          {t.events.map((e, n) => (
            <li key={n} className="flex flex-wrap gap-x-3">
              <span className="whitespace-nowrap text-text-muted">{timeText(e.occurredAt)}</span>
              {eventText(e, meId)}
            </li>
          ))}
        </ol>
      </section>
      <dialog
        ref={confirm}
        aria-labelledby="ticket-cancel-title"
        className="m-auto w-[400px] max-w-full rounded-dialog bg-surface p-6 shadow-dialog backdrop:bg-overlay"
      >
        <div className="flex flex-col gap-3">
          <h3 id="ticket-cancel-title" className="text-16 font-semibold">
            Hủy ticket này?
          </h3>
          <p>Ticket đã hủy không mở lại được.</p>
          <div className="flex justify-end gap-2">
            <button type="button" className={button} onClick={() => confirm.current?.close()}>
              Không hủy
            </button>
            <button
              type="button"
              className={primary}
              disabled={move.isPending}
              aria-busy={move.isPending}
              onClick={() => go('cancelled')}
            >
              {move.isPending ? 'Đang hủy…' : 'Hủy ticket'}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
