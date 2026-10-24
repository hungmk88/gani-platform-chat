'use client';

import { useWindowVirtualizer } from '@tanstack/react-virtual';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLayoutEffect, useRef, useState } from 'react';

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
/** A row's height before it is measured (two lines and padding), and the rows drawn beyond the screen each way. */
const ROW_ESTIMATE = 64;
const OVERSCAN = 10;
const primary = 'rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70';

/**
 * The list column of the Inbox (#6): filters in the URL, pages by cursor, the four states of the screen. The rows are virtualised
 * against the page's scroll (CLAUDE.md "500+ hội thoại ảo hóa"): only those near the screen are in the DOM, each measured once drawn.
 */
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
  const listRef = useRef<HTMLUListElement>(null);
  // Where the list starts on the page: the virtualiser counts rows from there, not from the top of the window.
  const [margin, setMargin] = useState(0);
  const shown = rows.length > 0;
  useLayoutEffect(() => {
    if (shown && listRef.current)
      setMargin(listRef.current.getBoundingClientRect().top + window.scrollY);
  }, [shown]);
  const virtual = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => ROW_ESTIMATE,
    overscan: OVERSCAN,
    scrollMargin: margin,
  });
  const query = paramsOf(filter).toString();
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
          <ul
            ref={listRef}
            className="relative rounded-card border border-border"
            style={{ height: virtual.getTotalSize() }}
          >
            {virtual.getVirtualItems().map((item) => {
              const c = rows[item.index]!;
              return (
                <li
                  key={c.id}
                  ref={virtual.measureElement}
                  data-index={item.index}
                  aria-setsize={rows.length}
                  aria-posinset={item.index + 1}
                  className={`absolute left-0 top-0 w-full ${item.index < rows.length - 1 ? 'border-b border-border' : ''}`}
                  style={{
                    transform: `translateY(${item.start - margin}px)`,
                  }}
                >
                  <Link
                    href={`/inbox/${c.id}${query ? `?${query}` : ''}`}
                    aria-current={pathname === `/inbox/${c.id}` ? 'page' : undefined}
                    className="flex flex-wrap items-center justify-between gap-2 p-3 hover:bg-bg-subtle aria-[current=page]:bg-bg-subtle"
                  >
                    <span className="flex flex-col gap-1">
                      <span className="font-semibold">
                        {c.afterHoursHold ? HOLD_LABEL : STATE_LABEL[c.state]}
                      </span>
                      <span className="text-12 text-text-muted">{holderOf(c, meId)}</span>
                    </span>
                    <time
                      dateTime={c.lastMessageAt ?? c.createdAt}
                      className="text-12 text-text-muted"
                    >
                      {whenOf(c)}
                    </time>
                  </Link>
                </li>
              );
            })}
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
