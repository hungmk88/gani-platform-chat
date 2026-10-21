'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import type { components } from '../api/schema';
import type { Role } from '../nav';
import { useApiPages } from '../query/provider';
import { RetryAction } from '../retry-button';
import {
  ASSIGNEE_LABEL,
  emptyOf,
  filterOf,
  HOLD_LABEL,
  holderOf,
  listPath,
  NO_FILTER,
  paramsOf,
  STATE_LABEL,
  whenOf,
  type Assignee,
  type ListFilter,
} from './list';

type Page = components['schemas']['ConversationPage'];

const button = 'rounded-input border border-border-strong px-3 py-1';
const primary = 'rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70';

/** The list column of the Inbox (#6): filters in the URL, pages by cursor, the four states of the screen. */
export function ConversationList({ role, meId }: { role: Role; meId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const filter = filterOf(useSearchParams());
  const list = useApiPages<Page>(['conversations', filter], (cursor) => listPath(filter, cursor));
  const go = (f: ListFilter) => {
    const q = paramsOf(f).toString();
    router.replace(q ? `${pathname}?${q}` : pathname);
  };

  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const empty = emptyOf(filter, role);

  return (
    <section aria-label="Danh sách hội thoại" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <div role="group" aria-label="Người phụ trách" className="flex gap-2">
          {(Object.keys(ASSIGNEE_LABEL) as Assignee[]).map((a) => (
            <button
              key={a}
              type="button"
              aria-pressed={filter.assignee === a}
              onClick={() => go({ ...filter, assignee: a })}
              className={`${button} ${filter.assignee === a ? 'bg-accent text-accent-on' : ''}`}
            >
              {ASSIGNEE_LABEL[a]}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1">
          Trạng thái
          <select
            value={filter.state}
            onChange={(e) => go({ ...filter, state: e.target.value as ListFilter['state'] })}
            className="rounded-input border border-border-strong bg-surface px-3 py-1"
          >
            <option value="all">Tất cả</option>
            {Object.entries(STATE_LABEL).map(([s, label]) => (
              <option key={s} value={s}>
                {label}
              </option>
            ))}
            <option value="hold">{HOLD_LABEL}</option>
          </select>
        </label>
      </div>

      {list.isPending ? (
        <p role="status" aria-busy="true" className="text-text-muted">
          Đang tải hội thoại…
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
        <div className="flex flex-col items-start gap-2">
          <p>{empty.text}</p>
          {empty.action === 'channels' ? (
            <Link href="/settings/channels" className={primary}>
              Kết nối Zalo OA
            </Link>
          ) : (
            <button
              type="button"
              className={primary}
              onClick={() =>
                go(empty.action === 'clear' ? NO_FILTER : { assignee: 'none', state: 'all' })
              }
            >
              {empty.action === 'clear' ? 'Xóa bộ lọc' : 'Xem hội thoại chưa ai nhận'}
            </button>
          )}
        </div>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-border rounded-card border border-border">
            {rows.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <span className="flex flex-col gap-1">
                  <span className="font-semibold">
                    {c.afterHoursHold ? HOLD_LABEL : STATE_LABEL[c.state]}
                  </span>
                  <span className="text-12 text-text-muted">{holderOf(c, meId)}</span>
                </span>
                <time dateTime={c.lastMessageAt ?? c.createdAt} className="text-12 text-text-muted">
                  {whenOf(c)}
                </time>
              </li>
            ))}
          </ul>
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
      <p className="text-12 text-text-muted">Không áp dụng AI ở danh sách này.</p>
    </section>
  );
}
