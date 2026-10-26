'use client';

import type { NavItem } from '../nav';
import { PendingPage } from '../pending-page';
import { useApiQuery, useScope } from '../query/provider';
import { RetryAction } from '../retry-button';
import { cardsOf, overviewPath, updatedAt, type Overview } from './overview';

const TONE = { warn: 'bg-warn-bg text-warn-text', error: 'bg-error-bg text-error-text' };
const button = 'rounded-input border border-border-strong px-3 py-1 disabled:opacity-70';

/**
 * #16 Tổng quan of the workspace being worked in (T1): the figures as `GET /v1/overview` gives them (planned S5, N167), read
 * again with "Làm mới". A 404 means the API does not serve the route yet: the screen then says it is not there, as before.
 */
export function OverviewScreen({ item, go }: { item: NavItem; go: NavItem }) {
  const { workspaceId } = useScope();
  const overview = useApiQuery<Overview>(
    ['overview', workspaceId],
    overviewPath(workspaceId ?? ''),
    Boolean(workspaceId),
  );
  if (!workspaceId)
    return <p>Bạn chưa thuộc workspace nào. Nhờ Owner thêm bạn ở Cài đặt › Workspace.</p>;
  if (overview.isPending)
    return (
      <p role="status" aria-busy="true" className="text-text-muted">
        Đang tải số liệu…
      </p>
    );
  if (overview.isError) {
    const { error } = overview.error;
    if (error.code === 'not_found') return <PendingPage item={item} go={go} />;
    return (
      <div role="alert" className="flex flex-col gap-2">
        <p>{error.message}</p>
        {error.traceId ? <p className="text-12 text-text-muted">Mã: {error.traceId}</p> : null}
        <RetryAction onRetry={() => void overview.refetch()} busy={overview.isFetching} />
      </div>
    );
  }
  const o = overview.data;
  return (
    <section aria-labelledby="overview-title" className="flex max-w-[960px] flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 id="overview-title" className="text-20 font-semibold">
          {o.scope === 'me' ? 'Tổng quan của tôi' : 'Tổng quan'}
        </h1>
        <span className="flex items-center gap-2 text-12 text-text-muted">
          Cập nhật lúc {updatedAt(o)}
          <button
            type="button"
            className={button}
            disabled={overview.isFetching}
            aria-busy={overview.isFetching}
            onClick={() => void overview.refetch()}
          >
            Làm mới
          </button>
        </span>
      </div>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
        {cardsOf(o).map((c) => (
          <li key={c.label} className="flex flex-col gap-1 rounded-card border border-border p-4">
            <span className="text-text-muted">{c.label}</span>
            <strong
              className={`self-start text-20 ${c.tone ? `rounded-input px-2 ${TONE[c.tone]}` : ''}`}
            >
              {c.value}
            </strong>
            <span className="text-12 text-text-muted">{c.note}</span>
          </li>
        ))}
      </ul>
      <p className="text-12 text-text-muted">
        CSAT và số liệu AI có ở Đợt 2. Không áp dụng AI ở màn này.
      </p>
    </section>
  );
}
