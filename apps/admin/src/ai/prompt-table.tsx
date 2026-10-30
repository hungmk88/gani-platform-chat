'use client';

import type { NavItem } from '../nav';
import { PendingPage } from '../pending-page';
import { useApiQuery } from '../query/provider';
import { RetryAction } from '../retry-button';
import { approvalOf, PROMPTS_PATH, type PromptVersionList } from './prompts';

const button = 'rounded-input border border-border-strong px-3 py-1 disabled:opacity-70';

/**
 * #26 AI nội bộ, Đợt 1: the versions of the prompts (E20), read only: no button edits a prompt (U35). A 404 means the API does not
 * serve the route yet (planned S5): the screen then says it is not there, never a list made up here.
 */
export function PromptTable({ item, go }: { item: NavItem; go: NavItem }) {
  const list = useApiQuery<PromptVersionList>(['ai', 'prompts'], PROMPTS_PATH);
  if (list.isPending)
    return (
      <p role="status" aria-busy="true" className="text-text-muted">
        Đang tải phiên bản prompt…
      </p>
    );
  if (list.isError) {
    const { error } = list.error;
    if (error.code === 'not_found') return <PendingPage item={item} go={go} />;
    return (
      <div role="alert" className="flex flex-col gap-2">
        <p>{error.message}</p>
        {error.traceId ? <p className="text-12 text-text-muted">Mã: {error.traceId}</p> : null}
        <RetryAction onRetry={() => void list.refetch()} busy={list.isFetching} />
      </div>
    );
  }
  const rows = list.data.data;
  return (
    <section aria-labelledby="ai-title" className="flex max-w-[880px] flex-col gap-4">
      <h1 id="ai-title" className="text-20 font-semibold">
        AI nội bộ
      </h1>
      <h2 className="text-16 font-semibold">Phiên bản prompt</h2>
      {rows.length === 0 ? (
        <div className="flex flex-col items-start gap-2">
          <p>Chưa có phiên bản prompt nào được ghi nhận.</p>
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
        <table className="w-full text-left">
          <thead className="text-text-muted">
            <tr>
              <th className="py-2 pr-4 font-normal">Prompt</th>
              <th className="py-2 pr-4 font-normal">Phiên bản</th>
              <th className="py-2 pr-4 font-normal">Trạng thái</th>
              <th className="py-2 pr-4 font-normal">Ngày duyệt</th>
              <th className="py-2 font-normal">Người duyệt</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const { when, who } = approvalOf(p);
              return (
                <tr key={`${p.key}@${p.version}`} className="border-t border-border">
                  <td className="py-2 pr-4">
                    <code>{p.key}</code>
                  </td>
                  <td className="py-2 pr-4">{p.version}</td>
                  <td className="py-2 pr-4">
                    {p.active ? (
                      <span className="rounded-input bg-ok-bg px-2 text-ok-text">Đang dùng</span>
                    ) : (
                      'Không dùng'
                    )}
                  </td>
                  <td className="py-2 pr-4">{when}</td>
                  <td className="py-2">{who}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="text-12 text-text-muted">Chỉ xem: không sửa prompt ở màn này.</p>
      <p className="text-12 text-text-muted">
        Môi trường, tính năng và ngân sách AI chưa có trong bản hiện tại.
      </p>
    </section>
  );
}
