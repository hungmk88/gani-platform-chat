'use client';

import type { ReactNode } from 'react';

import type { NavItem } from '../nav';
import { PendingPage } from '../pending-page';
import { useApiQuery, useScope } from '../query/provider';
import { RetryAction } from '../retry-button';
import { holidaysPath, type HolidayList } from './holidays';
import { HolidaysEditor } from './holidays-editor';

/** "Ngày nghỉ" of the workspace chosen in the top bar (#21, PR 2b): loading, error with trace and "Thử lại", 404 the pending screen. */
export function HolidaysTab({ item, go }: { item: NavItem; go: NavItem }) {
  const { workspaceId } = useScope();
  const list = useApiQuery<HolidayList>(
    ['workspace-holidays', workspaceId],
    holidaysPath(workspaceId ?? ''),
    !!workspaceId,
  );
  if (!workspaceId)
    return <p>Bạn chưa thuộc workspace nào. Thêm mình vào một workspace ở tab Workspace.</p>;
  if (list.isError && list.error.error.code === 'not_found')
    return <PendingPage item={{ ...item, label: 'Ngày nghỉ' }} go={go} />;
  let body: ReactNode;
  if (list.isPending)
    body = (
      <p role="status" aria-busy="true" className="text-text-muted">
        Đang tải ngày nghỉ…
      </p>
    );
  else if (list.isError)
    body = (
      <div role="alert" className="flex flex-col gap-2">
        <p>{list.error.error.message}</p>
        {list.error.error.traceId ? (
          <p className="text-12 text-text-muted">Mã: {list.error.error.traceId}</p>
        ) : null}
        <RetryAction onRetry={() => void list.refetch()} busy={list.isFetching} />
      </div>
    );
  else
    body = (
      <HolidaysEditor
        workspaceId={workspaceId}
        days={list.data.data}
        busy={list.isFetching}
        refresh={() => void list.refetch()}
      />
    );
  return (
    <section aria-labelledby="holidays-title" className="flex flex-col gap-3">
      <h2 id="holidays-title" className="text-16 font-semibold">
        Ngày nghỉ
      </h2>
      <p className="text-text-muted">
        Ngày nghỉ sắp tới của workspace đang chọn ở thanh trên, theo giờ của workspace. Ngày đã qua
        không còn trong danh sách.
      </p>
      {body}
    </section>
  );
}
