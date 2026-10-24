'use client';

import { useApiQuery } from '../query/provider';
import { RetryAction } from '../retry-button';
import { TEMPLATE, type WorkspaceList } from './workspace';

/**
 * The workspaces of the company (#21, `GET /v1/workspaces`, N157), by name. Only Owner and Admin come here (the page checks), as
 * the API allows.
 */
export function WorkspaceTable() {
  const list = useApiQuery<WorkspaceList>(['workspaces'], '/v1/workspaces');

  if (list.isPending)
    return (
      <p role="status" aria-busy="true" className="text-text-muted">
        Đang tải workspace…
      </p>
    );
  if (list.isError)
    return (
      <div role="alert" className="flex flex-col gap-2">
        <p>{list.error.error.message}</p>
        {list.error.error.traceId ? (
          <p className="text-12 text-text-muted">Mã: {list.error.error.traceId}</p>
        ) : null}
        <RetryAction onRetry={() => void list.refetch()} busy={list.isFetching} />
      </div>
    );
  if (!list.data.data.length)
    return (
      <div className="flex flex-col gap-2">
        <p>Công ty chưa có workspace nào: quản trị nền tảng tạo workspace theo mẫu.</p>
        <RetryAction onRetry={() => void list.refetch()} busy={list.isFetching} />
      </div>
    );
  return (
    <div className="overflow-x-auto rounded-card border border-border">
      <table className="w-full text-left">
        <thead className="bg-bg-subtle">
          <tr>
            {['Workspace', 'Mẫu', 'Múi giờ', 'Giới hạn tải mặc định'].map((t) => (
              <th key={t} scope="col" className="p-2 font-semibold">
                {t}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {list.data.data.map((w) => (
            <tr key={w.id}>
              <td className="p-2">
                <div>{w.name}</div>
                <div className="text-12 text-text-muted">{w.slug}</div>
              </td>
              <td className="p-2">{TEMPLATE[w.template]}</td>
              <td className="p-2">{w.timezone}</td>
              <td className="p-2">{w.defaultMaxConcurrent} hội thoại</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
