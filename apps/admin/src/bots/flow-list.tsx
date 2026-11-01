'use client';

import Link from 'next/link';

import type { NavItem } from '../nav';
import { PendingPage } from '../pending-page';
import { useApiQuery, useScope } from '../query/provider';
import { RetryAction } from '../retry-button';
import {
  flowsPath,
  MAX_FLOWS,
  publishedText,
  STATUS,
  timeText,
  type BotFlowList,
} from './bot-flows';

const button = 'self-start rounded-input border border-border-strong px-3 py-1 disabled:opacity-70';
const TONE = { ok: 'bg-ok-bg text-ok-text', warn: 'bg-warn-bg text-warn-text' };

/**
 * #17 Danh sách bot flow of the workspace being worked in (T1), last changed first, read only (CEO 01/11: no create, edit, publish,
 * delete). Each name opens its detail. A 404 keeps the screen of a menu item not built yet (`PendingPage`).
 */
export function FlowList({ item, go }: { item: NavItem; go: NavItem }) {
  const { workspaceId } = useScope();
  const list = useApiQuery<BotFlowList>(
    ['bot-flows', workspaceId],
    flowsPath(workspaceId ?? ''),
    Boolean(workspaceId),
  );
  if (!workspaceId)
    return <p>Bạn chưa thuộc workspace nào. Nhờ Owner thêm bạn ở Cài đặt › Workspace.</p>;
  if (list.isError && list.error.error.code === 'not_found')
    return <PendingPage item={item} go={go} />;
  const rows = list.data?.data ?? [];
  return (
    <section aria-labelledby="bots-title" className="flex max-w-[960px] flex-col gap-4">
      <h1 id="bots-title" className="text-20 font-semibold">
        Bot
      </h1>
      {list.isPending ? (
        <p role="status" aria-busy="true" className="text-text-muted">
          Đang tải danh sách flow…
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
        <div className="flex flex-col gap-2">
          <p>Workspace chưa có flow nào.</p>
          <button
            type="button"
            className={button}
            disabled={list.isFetching}
            aria-busy={list.isFetching}
            onClick={() => void list.refetch()}
          >
            Làm mới
          </button>
        </div>
      ) : (
        <>
          <table className="w-full text-left">
            <thead className="text-text-muted">
              <tr>
                {['Flow', 'Trạng thái', 'Đã xuất bản', 'Cập nhật'].map((t) => (
                  <th key={t} scope="col" className="py-2 pr-4 font-normal">
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => {
                const [label, tone] = STATUS[f.status];
                return (
                  <tr key={f.id} className="border-t border-border">
                    <td className="py-2 pr-4">
                      <Link href={`/bots/${encodeURIComponent(f.id)}`} className="underline">
                        {f.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">
                      <span className={`rounded-input px-2 ${tone ? TONE[tone] : 'bg-bg-subtle'}`}>
                        {label}
                      </span>
                    </td>
                    <td className="py-2 pr-4">{publishedText(f.publishedVersion)}</td>
                    <td className="py-2 whitespace-nowrap">{timeText(f.updatedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length >= MAX_FLOWS ? (
            <p className="text-12 text-text-muted">Đang hiện {MAX_FLOWS} flow đổi gần nhất.</p>
          ) : null}
        </>
      )}
      <p className="text-12 text-text-muted">
        Chỉ xem: không tạo, sửa hay xuất bản flow ở màn này. Không áp dụng AI.
      </p>
    </section>
  );
}
