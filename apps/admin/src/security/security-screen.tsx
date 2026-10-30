'use client';

import { useState, type ReactNode } from 'react';

import type { NavItem } from '../nav';
import { PendingPage } from '../pending-page';
import { useApiPages } from '../query/provider';
import { RetryAction } from '../retry-button';
import { ALERT_KIND, SEVERITY, type Severity } from './labels';
import {
  alertsPath,
  incidentsPath,
  timeText,
  uniqueRows,
  type IncidentStatus,
  type SecurityAlertPage,
  type SecurityIncidentPage,
} from './security';

const field = 'rounded-input border border-border-strong px-3 py-2';
const button = 'self-start rounded-input border border-border-strong px-3 py-1 disabled:opacity-70';
const TONE = { warn: 'bg-warn-bg text-warn-text', error: 'bg-error-bg text-error-text' };
const STATUS: Readonly<Record<IncidentStatus, string>> = { open: 'Đang mở', closed: 'Đã đóng' };

/** The severity in its word, coloured as a state (never by colour alone). */
function SeverityBadge({ severity }: { severity: Severity }) {
  const [word, tone] = SEVERITY[severity];
  return (
    <span
      className={`rounded-input px-2 py-1 text-12 ${tone ? TONE[tone] : 'bg-bg-subtle'} ${severity === 'critical' ? 'font-semibold' : ''}`}
    >
      {word}
    </span>
  );
}

type Pages<P> = ReturnType<typeof useApiPages<P & { readonly nextCursor: string | null }>>;

/** One list read by cursor: loading, error (the list, or only the next page), empty, the table, "Tải thêm" and its end. */
function Paged<R extends { readonly id: string }>({
  query,
  loading,
  empty,
  head,
  row,
}: {
  query: Pages<{ readonly data: readonly R[] }>;
  loading: string;
  empty: ReactNode;
  head: readonly string[];
  row: (r: R) => ReactNode;
}) {
  if (query.isPending)
    return (
      <p role="status" aria-busy="true" className="text-text-muted">
        {loading}
      </p>
    );
  const failure = query.isError ? query.error.error : null;
  const failed = failure ? (
    <div role="alert" className="flex flex-col gap-2">
      <p>{failure.message}</p>
      {failure.traceId ? <p className="text-12 text-text-muted">Mã: {failure.traceId}</p> : null}
      <RetryAction
        onRetry={() => void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())}
        busy={query.isFetching}
      />
    </div>
  ) : null;
  if (!query.data) return failed;
  const rows = uniqueRows(query.data.pages);
  if (rows.length === 0) return empty;
  return (
    <>
      <div className="overflow-x-auto rounded-card border border-border">
        <table className="w-full text-left">
          <thead className="bg-bg-subtle">
            <tr>
              {head.map((t) => (
                <th key={t} scope="col" className="p-2 font-semibold">
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">{rows.map(row)}</tbody>
        </table>
      </div>
      {failed}
      {query.hasNextPage && !query.isFetchNextPageError ? (
        <button
          type="button"
          className={button}
          disabled={query.isFetchingNextPage}
          aria-busy={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}
        </button>
      ) : !query.hasNextPage && query.data.pages.length > 1 ? (
        <p className="text-12 text-text-muted">Đã hiện hết.</p>
      ) : null}
    </>
  );
}

/**
 * #29 Bảo mật of the company, read only in Đợt 1 (PR A, CEO 30/10): the incidents of one status (open first) and every alert,
 * newest first. The alerts have no person or channel column until the API gives their names (U69). A 404 of either route means the
 * API does not serve them yet (planned S5): the screen then says it is not there, never a list made up here.
 */
export function SecurityScreen({ item, go }: { item: NavItem; go: NavItem }) {
  const [status, setStatus] = useState<IncidentStatus>('open');
  const incidents = useApiPages<SecurityIncidentPage>(['security', 'incidents', status], (c) =>
    incidentsPath(status, c),
  );
  const alerts = useApiPages<SecurityAlertPage>(['security', 'alerts'], alertsPath);
  if ([incidents, alerts].some((q) => q.isError && q.error.error.code === 'not_found'))
    return <PendingPage item={item} go={go} />;
  const other: IncidentStatus = status === 'open' ? 'closed' : 'open';
  return (
    <section aria-labelledby="security-title" className="flex max-w-[1080px] flex-col gap-6">
      <h1 id="security-title" className="text-20 font-semibold">
        Bảo mật
      </h1>
      <section aria-labelledby="incidents-title" className="flex flex-col gap-3">
        <h2 id="incidents-title" className="text-16 font-semibold">
          Sự cố
        </h2>
        <label className="flex flex-col gap-1 self-start">
          Trạng thái
          <select
            value={status}
            className={field}
            onChange={(e) => setStatus(e.target.value as IncidentStatus)}
          >
            {Object.entries(STATUS).map(([s, word]) => (
              <option key={s} value={s}>
                {word}
              </option>
            ))}
          </select>
        </label>
        <Paged
          query={incidents}
          loading="Đang tải sự cố…"
          empty={
            <div className="flex flex-col items-start gap-2">
              <p>{status === 'open' ? 'Không có sự cố đang mở.' : 'Chưa có sự cố nào đã đóng.'}</p>
              <button type="button" className={button} onClick={() => setStatus(other)}>
                {other === 'open' ? 'Xem sự cố đang mở' : 'Xem sự cố đã đóng'}
              </button>
            </div>
          }
          head={[
            'Sự cố',
            'Mức độ',
            'Người xử lý',
            'Người mở',
            'Mở lúc',
            ...(status === 'closed' ? ['Đóng lúc'] : []),
          ]}
          row={(i) => (
            <tr key={i.id}>
              <td className="p-2">{i.title}</td>
              <td className="p-2">
                <SeverityBadge severity={i.severity} />
              </td>
              <td className="p-2">{i.handler.name}</td>
              <td className="p-2">{i.openedBy.name}</td>
              <td className="p-2 whitespace-nowrap">{timeText(i.openedAt)}</td>
              {status === 'closed' ? (
                <td className="p-2 whitespace-nowrap">{timeText(i.closedAt)}</td>
              ) : null}
            </tr>
          )}
        />
      </section>
      <section aria-labelledby="alerts-title" className="flex flex-col gap-3">
        <h2 id="alerts-title" className="text-16 font-semibold">
          Cảnh báo
        </h2>
        <Paged
          query={alerts}
          loading="Đang tải cảnh báo…"
          empty={
            <div className="flex flex-col items-start gap-2">
              <p>Chưa có cảnh báo bảo mật nào.</p>
              <button
                type="button"
                className={button}
                disabled={alerts.isFetching}
                aria-busy={alerts.isFetching}
                onClick={() => void alerts.refetch()}
              >
                Làm mới
              </button>
            </div>
          }
          head={['Loại', 'Mức độ', 'Thời điểm', 'Số lần', 'Sự cố']}
          row={(a) => (
            <tr key={a.id}>
              <td className="p-2">{ALERT_KIND[a.kind]}</td>
              <td className="p-2">
                <SeverityBadge severity={a.severity} />
              </td>
              <td className="p-2 whitespace-nowrap">{timeText(a.occurredAt)}</td>
              <td className="p-2">{a.count}</td>
              <td className="p-2">{a.incidentId ? 'Đã gắn sự cố' : 'Chưa gắn sự cố'}</td>
            </tr>
          )}
        />
      </section>
      <p className="text-12 text-text-muted">
        Chỉ xem: không mở, đóng hay giao sự cố ở màn này. Không áp dụng AI ở màn này.
      </p>
    </section>
  );
}
