'use client';

import { useWindowVirtualizer } from '@tanstack/react-virtual';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import type { components } from '../api/schema';
import type { Role } from '../nav';
import { useApiPages, useApiQuery, useScope } from '../query/provider';
import { RetryAction } from '../retry-button';
import { Holder } from './holder';
import { setNotice, useNotice } from './notice';
import {
  ASSIGNEE_LABEL,
  channelChoice,
  channelFilterOf,
  emptyOf,
  filterOf,
  HOLD_LABEL,
  inboxChannelsPath,
  customerNameOf,
  channelOf,
  listPath,
  MAX_SEARCH,
  NO_FILTER,
  paramsOf,
  searchOf,
  STATE_LABEL,
  tooFewDigits,
  whenOf,
  type Assignee,
  type InboxChannelList,
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
  const notice = useNotice();
  const pathname = usePathname();
  const filter = filterOf(useSearchParams());
  const scope = useScope();
  const list = useApiPages<Page>(['conversations', filter], (cursor) =>
    listPath(filter, cursor, scope.workspaceId),
  );
  const go = (f: ListFilter) => {
    const q = paramsOf(f).toString();
    router.replace(q ? `${pathname}?${q}` : pathname);
  };
  // "Tìm khách" (#390): what is typed, put on the URL once React has a moment (like the Khách hàng list), never an empty `q`.
  const [text, setText] = useState(filter.q);
  const searched = searchOf(useDeferredValue(text));
  const search = useEffectEvent((q: string) => {
    if (q !== filter.q) go({ ...filter, q });
  });
  useEffect(() => search(searched), [searched]);
  // "Kênh" (#392, U56): the channels of the conversations this person reads; under 'conversations', read again with the list.
  const channels = useApiQuery<InboxChannelList>(
    ['conversations', 'channels'],
    inboxChannelsPath(scope.workspaceId),
  );
  const channelFilter = channelFilterOf(
    channels.isPending ? 'pending' : channels.isError ? 'error' : channels.data.data,
    filter.channel,
  );
  const known = channels.data?.data.some((c) => c.id === filter.channel) ?? false;

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
      {notice ? (
        <div
          role="status"
          className="flex items-center justify-between gap-2 rounded-card border border-border p-3"
        >
          <p>{notice}</p>
          <button type="button" className={button} onClick={() => setNotice(null)}>
            Đóng
          </button>
        </div>
      ) : null}
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
        {channelFilter === 'select' ? (
          <label className="flex flex-col gap-1">
            Kênh
            <select
              value={filter.channel}
              onChange={(e) => go({ ...filter, channel: e.target.value })}
              className="rounded-input border border-border-strong bg-surface px-3 py-1"
            >
              <option value="">Tất cả kênh</option>
              {filter.channel && !known ? (
                // A channel of the URL that is not offered (gone, or none of its conversations is read): still filtered, said so.
                <option value={filter.channel}>Kênh không còn trong danh sách</option>
              ) : null}
              {channels.data?.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {channelChoice(c)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="flex flex-col gap-1">
          Tìm khách
          <input
            type="search"
            value={text}
            maxLength={MAX_SEARCH}
            placeholder="Tên, email hoặc từ 3 số đầu SĐT"
            className="rounded-input border border-border-strong bg-surface px-3 py-1"
            onChange={(e) => setText(e.target.value)}
          />
        </label>
      </div>
      {channelFilter === 'line' ? (
        <p className="flex items-center gap-2">
          Đang lọc theo một kênh ·
          <button type="button" className={button} onClick={() => go({ ...filter, channel: '' })}>
            Bỏ lọc
          </button>
        </p>
      ) : null}
      {tooFewDigits(searched) ? (
        <p className="text-12 text-text-muted">
          Gõ từ 3 số để tìm theo SĐT; 1–2 số đang tìm theo tên.
        </p>
      ) : null}

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
              onClick={() => {
                if (empty.action !== 'unassigned') setText('');
                go(
                  empty.action === 'search'
                    ? { ...filter, q: '' }
                    : empty.action === 'clear'
                      ? NO_FILTER
                      : { ...NO_FILTER, assignee: 'none' },
                );
              }}
            >
              {empty.action === 'search'
                ? 'Bỏ tìm'
                : empty.action === 'clear'
                  ? 'Xóa bộ lọc'
                  : 'Xem hội thoại chưa ai nhận'}
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
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="font-semibold">{customerNameOf(c)}</span>
                      {c.lastMessagePreview ? (
                        <span className="truncate text-text-muted">{c.lastMessagePreview}</span>
                      ) : null}
                      <span>{c.afterHoursHold ? HOLD_LABEL : STATE_LABEL[c.state]}</span>
                      <span className="text-12 text-text-muted">
                        {channelOf(c) ? `${channelOf(c)} · ` : null}
                        <Holder c={c} meId={meId} />
                      </span>
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
