'use client';

import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import type { NavItem } from '../nav';
import { PendingPage } from '../pending-page';
import { useApiQuery, useScope } from '../query/provider';
import type { ApiFailure } from '../query/fetch';
import { RetryAction } from '../retry-button';
import {
  autonomyPath,
  changeOf,
  flagState,
  flagsPath,
  LEVELS,
  meaningOf,
  UNDEFINED_LEVEL,
  type Autonomy,
  type FeatureFlagList,
} from './autonomy';

const button = 'rounded-input border border-border-strong px-3 py-1 disabled:opacity-70';
const th = 'py-2 pr-4 font-normal';

/** One block's loading or error, or its content once read. */
function Loaded<T>({
  query,
  loading,
  children,
}: {
  query: UseQueryResult<T, ApiFailure>;
  loading: string;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending)
    return (
      <p role="status" aria-busy="true" className="text-text-muted">
        {loading}
      </p>
    );
  if (query.isError) {
    const { error } = query.error;
    return (
      <div role="alert" className="flex flex-col gap-2">
        <p>{error.message}</p>
        {error.traceId ? <p className="text-12 text-text-muted">Mã: {error.traceId}</p> : null}
        <RetryAction onRetry={() => void query.refetch()} busy={query.isFetching} />
      </div>
    );
  }
  return children(query.data);
}

/**
 * #27 Tự chủ & feature flag of the workspace being worked in, read only in Đợt 1 (PR A, CEO 30/10): no button lowers the level
 * or turns a flag off (PR B). A 404 of either route means the API does not serve them yet (planned S5): the screen then says it
 * is not there, never figures made up here.
 */
export function AutonomyScreen({ item, go, meId }: { item: NavItem; go: NavItem; meId: string }) {
  const { workspaceId } = useScope();
  const ws = workspaceId ?? '';
  const level = useApiQuery<Autonomy>(['autonomy', ws], autonomyPath(ws), Boolean(workspaceId));
  const flags = useApiQuery<FeatureFlagList>(
    ['feature-flags', ws],
    flagsPath(ws),
    Boolean(workspaceId),
  );
  if (!workspaceId)
    return <p>Bạn chưa thuộc workspace nào. Nhờ Owner thêm bạn ở Cài đặt › Workspace.</p>;
  if ([level, flags].some((q) => q.isError && q.error.error.code === 'not_found'))
    return <PendingPage item={item} go={go} />;
  return (
    <section aria-labelledby="autonomy-title" className="flex max-w-[880px] flex-col gap-6">
      <h1 id="autonomy-title" className="text-20 font-semibold">
        Tự chủ & feature flag
      </h1>
      <section aria-labelledby="level-title" className="flex flex-col gap-3">
        <h2 id="level-title" className="text-16 font-semibold">
          Mức tự chủ
        </h2>
        <Loaded query={level} loading="Đang tải mức tự chủ…">
          {(a) => (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
              <dt className="text-text-muted">Hiện tại</dt>
              <dd>
                <strong>{a.level}</strong> — {meaningOf(a.level)}
              </dd>
              <dt className="text-text-muted">Lý do</dt>
              <dd>{a.reason ?? '—'}</dd>
              <dt className="text-text-muted">Lần đổi gần nhất</dt>
              <dd>{changeOf(a, meId)}</dd>
            </dl>
          )}
        </Loaded>
        <table className="w-full text-left">
          <caption className="sr-only">Ý nghĩa các mức tự chủ</caption>
          <thead className="text-text-muted">
            <tr>
              <th className={th}>Mức</th>
              <th className="py-2 font-normal">Ý nghĩa</th>
            </tr>
          </thead>
          <tbody>
            {LEVELS.map(([l, meaning]) => (
              <tr key={l} className="border-t border-border">
                <td className="py-2 pr-4">{l}</td>
                <td className="py-2">{meaning}</td>
              </tr>
            ))}
            <tr className="border-t border-border">
              <td className="py-2 pr-4">L3–L5</td>
              <td className="py-2">{UNDEFINED_LEVEL}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <section aria-labelledby="flags-title" className="flex flex-col gap-3">
        <h2 id="flags-title" className="text-16 font-semibold">
          Feature flag
        </h2>
        <Loaded query={flags} loading="Đang tải feature flag…">
          {({ data }) =>
            data.length === 0 ? (
              <div className="flex flex-col items-start gap-2">
                <p>Workspace này chưa có cờ nào.</p>
                <button
                  type="button"
                  className={button}
                  disabled={flags.isFetching}
                  aria-busy={flags.isFetching}
                  onClick={() => void flags.refetch()}
                >
                  Làm mới
                </button>
              </div>
            ) : (
              <table className="w-full text-left">
                <caption className="sr-only">Feature flag của workspace</caption>
                <thead className="text-text-muted">
                  <tr>
                    <th className={th}>Cờ</th>
                    <th className={th}>Tác dụng</th>
                    <th className="py-2 font-normal">Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((f) => (
                    <tr key={f.key} className="border-t border-border">
                      <td className="py-2 pr-4">
                        <code>{f.key}</code>
                      </td>
                      <td className="py-2 pr-4">{f.description}</td>
                      <td className="py-2">
                        {!f.locked && f.enabled ? (
                          <span className="rounded-input bg-ok-bg px-2 text-ok-text">
                            {flagState(f)}
                          </span>
                        ) : (
                          flagState(f)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </Loaded>
      </section>
      <p className="text-12 text-text-muted">Chỉ xem: không đổi mức tự chủ hay cờ ở màn này.</p>
    </section>
  );
}
