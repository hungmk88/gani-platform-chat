'use client';

import Link from 'next/link';
import { useState } from 'react';

import type { NavItem } from '../nav';
import { PendingPage } from '../pending-page';
import { useApiPages, useScope } from '../query/provider';
import { RetryAction } from '../retry-button';
import {
  changedAt,
  PRIORITY,
  slaText,
  STATUS,
  ticketsPath,
  type AssigneeFilter,
  type TicketFilter,
  type TicketPage,
} from './tickets';

const field = 'rounded-input border border-border-strong px-3 py-2';
const button = 'rounded-input border border-border-strong px-3 py-1 disabled:opacity-70';
const TONE = { ok: 'bg-ok-bg text-ok-text', warn: 'bg-warn-bg text-warn-text' };
const ASSIGNEE: Readonly<Record<AssigneeFilter, string>> = {
  any: 'Mọi người',
  me: 'Của tôi',
  none: 'Chưa giao',
};

/**
 * #14 Ticket of the workspace being worked in (T1), newest first, by cursor ("Tải thêm"): title, customer, status in words, priority,
 * who handles it, SLA (none until Q7/Q8), last change; filtered by status and assignee. A 404 means the API does not serve the route
 * yet (planned S4, N167): the screen then says it is not there, as before.
 */
export function TicketList({ item, go }: { item: NavItem; go: NavItem }) {
  const { workspaceId } = useScope();
  const [filter, setFilter] = useState<TicketFilter>({ status: 'all', assignee: 'any' });
  const list = useApiPages<TicketPage>(['tickets', workspaceId, filter], (cursor) =>
    ticketsPath(workspaceId ?? '', filter, cursor),
  );
  if (!workspaceId)
    return <p>Bạn chưa thuộc workspace nào. Nhờ Owner thêm bạn ở Cài đặt › Workspace.</p>;
  if (list.isError && list.error.error.code === 'not_found')
    return <PendingPage item={item} go={go} />;
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const filtered = filter.status !== 'all' || filter.assignee !== 'any';
  return (
    <section aria-labelledby="tickets-title" className="flex max-w-[1080px] flex-col gap-4">
      <h1 id="tickets-title" className="text-20 font-semibold">
        Ticket
      </h1>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          Trạng thái
          <select
            value={filter.status}
            className={field}
            onChange={(e) =>
              setFilter((f) => ({ ...f, status: e.target.value as TicketFilter['status'] }))
            }
          >
            <option value="all">Mọi trạng thái</option>
            {Object.entries(STATUS).map(([s, [label]]) => (
              <option key={s} value={s}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Phụ trách
          <select
            value={filter.assignee}
            className={field}
            onChange={(e) =>
              setFilter((f) => ({ ...f, assignee: e.target.value as AssigneeFilter }))
            }
          >
            {Object.entries(ASSIGNEE).map(([a, label]) => (
              <option key={a} value={a}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {list.isPending ? (
        <p role="status" aria-busy="true" className="text-text-muted">
          Đang tải ticket…
        </p>
      ) : list.isError ? (
        <div role="alert" className="flex flex-col gap-2">
          <p>{list.error.error.message}</p>
          {list.error.error.traceId ? (
            <p className="text-12 text-text-muted">Mã: {list.error.error.traceId}</p>
          ) : null}
          <RetryAction onRetry={() => void list.refetch()} busy={list.isFetching} />
        </div>
      ) : rows.length === 0 ? (
        filtered ? (
          <div className="flex flex-col items-start gap-2">
            <p>Không có ticket khớp bộ lọc.</p>
            <button
              type="button"
              className={button}
              onClick={() => setFilter({ status: 'all', assignee: 'any' })}
            >
              Xóa bộ lọc
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-2">
            <p>Chưa có ticket nào. Ticket được tạo từ hội thoại trong Hộp thư.</p>
            <Link href="/inbox" className="underline">
              Mở Hộp thư
            </Link>
          </div>
        )
      ) : (
        <>
          <div className="overflow-x-auto rounded-card border border-border">
            <table className="w-full text-left">
              <thead className="bg-bg-subtle">
                <tr>
                  {['Ticket', 'Khách', 'Trạng thái', 'Ưu tiên', 'Phụ trách', 'SLA', 'Cập nhật'].map(
                    (t) => (
                      <th key={t} scope="col" className="p-2 font-semibold">
                        {t}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((t) => {
                  const [label, tone] = STATUS[t.status];
                  return (
                    <tr key={t.id}>
                      <td className="p-2">
                        <Link href={`/tickets/${encodeURIComponent(t.id)}`} className="underline">
                          {t.title}
                        </Link>
                      </td>
                      <td className="p-2">
                        {t.customer ? (
                          (t.customer.displayName ?? 'Khách chưa có tên')
                        ) : (
                          <span className="text-text-muted">Không gắn khách</span>
                        )}
                      </td>
                      <td className="p-2">
                        <span
                          className={`rounded-input px-2 py-1 text-12 ${tone ? TONE[tone] : 'bg-bg-subtle'}`}
                        >
                          {label}
                        </span>
                      </td>
                      <td className={`p-2 ${t.priority === 'urgent' ? 'font-semibold' : ''}`}>
                        {PRIORITY[t.priority]}
                      </td>
                      <td className="p-2">
                        {t.assignee?.name ?? <span className="text-text-muted">Chưa giao</span>}
                      </td>
                      <td className="p-2">{slaText(t)}</td>
                      <td className="p-2 whitespace-nowrap">{changedAt(t)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {list.hasNextPage ? (
            <button
              type="button"
              className={`${button} self-start`}
              disabled={list.isFetchingNextPage}
              aria-busy={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {list.isFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}
            </button>
          ) : null}
        </>
      )}
      <p className="text-12 text-text-muted">Không áp dụng AI ở màn này.</p>
    </section>
  );
}
