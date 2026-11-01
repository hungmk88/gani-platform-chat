'use client';

import type { ReactNode } from 'react';

import { uniqueRows } from './paged';
import type { useApiPages } from './query/provider';
import { RetryAction } from './retry-button';

/** The secondary button of the screens that read a list by cursor (#23, #28, #29): one class, not three copies. */
export const button =
  'self-start rounded-input border border-border-strong px-3 py-1 disabled:opacity-70';

type Pages<P> = ReturnType<typeof useApiPages<P & { readonly nextCursor: string | null }>>;

/** One list read by cursor: loading, error (the list, or only the next page), empty, the table, "Tải thêm" and its end. */
export function Paged<R extends { readonly id: string }>({
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
  if (rows.length === 0)
    return (
      <>
        {empty}
        {failed}
      </>
    );
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
