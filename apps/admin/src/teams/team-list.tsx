'use client';

import { useApiQuery } from '../query/provider';
import { RetryAction } from '../retry-button';
import { teamsPath, type TeamList } from './teams';

const badge = 'rounded-input bg-bg-subtle px-2 py-1 text-12';

/** The teams of the workspace being worked in (#20, `GET /v1/teams?workspaceId=`, N160), by name. */
export function TeamTable({ workspaceId }: { workspaceId: string }) {
  const list = useApiQuery<TeamList>(['teams', workspaceId], teamsPath(workspaceId));

  return (
    <section aria-labelledby="teams-title" className="flex flex-col gap-3">
      <h2 id="teams-title" className="text-16 font-semibold">
        Team của workspace
      </h2>
      {list.isPending ? (
        <p role="status" aria-busy="true" className="text-text-muted">
          Đang tải team…
        </p>
      ) : list.isError ? (
        <div role="alert" className="flex flex-col gap-2">
          <p>{list.error.error.message}</p>
          {list.error.error.traceId ? (
            <p className="text-12 text-text-muted">Mã: {list.error.error.traceId}</p>
          ) : null}
          <RetryAction onRetry={() => void list.refetch()} busy={list.isFetching} />
        </div>
      ) : list.data.data.length === 0 ? (
        <p>Workspace này chưa có team nào. Tạo team đầu tiên bằng form ở trên.</p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full text-left">
            <thead className="bg-bg-subtle">
              <tr>
                {['Team', 'Mô tả', 'Số người'].map((t) => (
                  <th key={t} scope="col" className="p-2 font-semibold">
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.data.data.map((t) => (
                <tr key={t.id}>
                  <td className="p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {t.name}
                      {t.isDefault ? <span className={badge}>Mặc định</span> : null}
                    </div>
                    <div className="text-12 text-text-muted">{t.slug}</div>
                  </td>
                  <td className="p-2">{t.description ?? '—'}</td>
                  <td className="p-2">{t.memberCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
