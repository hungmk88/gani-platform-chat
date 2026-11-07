'use client';

import { useApiQuery } from '../query/provider';
import { RetryAction } from '../retry-button';
import { mergeLineOf, mergesPath, type MergeList } from './merges';

/**
 * "Lịch sử gộp" of #8 (J3c, `GET /v1/customers/{id}/merges`, CEO brief 153 PR A): the merges into this customer, newest first,
 * undone ones too, as the API answers; read only (unmerging is PR B, tầng 3). Owner and Admin only (N206).
 */
export function MergeHistory({ id }: { id: string }) {
  const list = useApiQuery<MergeList>(['customer', id, 'merges'], mergesPath(id));
  return (
    <section aria-labelledby="customer-merges" className="flex flex-col gap-2">
      <h2 id="customer-merges" className="text-16 font-semibold">
        Lịch sử gộp
      </h2>
      {list.isPending ? (
        <p role="status" aria-busy="true" className="text-text-muted">
          Đang tải lịch sử gộp…
        </p>
      ) : list.isError ? (
        <div role="alert" className="flex flex-col gap-2">
          <p>{list.error.error.message}</p>
          {list.error.error.traceId ? (
            <p className="text-12 text-text-muted">Mã: {list.error.error.traceId}</p>
          ) : null}
          <RetryAction onRetry={() => void list.refetch()} busy={list.isFetching} />
        </div>
      ) : list.data.data.length ? (
        <ul className="flex flex-col gap-2">
          {list.data.data.map((m) => {
            const line = mergeLineOf(m);
            return (
              <li key={m.id} className="flex flex-col gap-1 rounded-input border border-border p-2">
                <span>
                  “{line.source}” gộp vào khách này · {line.at}
                </span>
                <span className="text-12 text-text-muted">
                  Người gộp:{' '}
                  {line.by.title ? <abbr title={line.by.title}>{line.by.text}</abbr> : line.by.text}
                  {line.undone ? ` · Đã tách ${line.undone}` : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p>Chưa có lần gộp nào vào khách này.</p>
      )}
    </section>
  );
}
