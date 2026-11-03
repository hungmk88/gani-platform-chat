'use client';

import type { ReactNode } from 'react';

import type { NavItem } from '../nav';
import { PendingPage } from '../pending-page';
import { useApiQuery, useScope } from '../query/provider';
import { RetryAction } from '../retry-button';
import { hoursPath, type BusinessHours } from './hours';
import { HoursPanel } from './hours-form';

/** "Giờ làm việc" of the workspace chosen in the top bar (#21): loading, error with trace and "Thử lại", 404 the pending screen. */
export function HoursTab({ item, go }: { item: NavItem; go: NavItem }) {
  const { workspaceId } = useScope();
  const hours = useApiQuery<BusinessHours>(
    ['workspace-hours', workspaceId],
    hoursPath(workspaceId ?? ''),
    !!workspaceId,
  );
  if (!workspaceId)
    return <p>Bạn chưa thuộc workspace nào. Thêm mình vào một workspace ở tab Workspace.</p>;
  if (hours.isError && hours.error.error.code === 'not_found')
    return <PendingPage item={{ ...item, label: 'Giờ làm việc' }} go={go} />;
  let body: ReactNode;
  if (hours.isPending)
    body = (
      <p role="status" aria-busy="true" className="text-text-muted">
        Đang tải giờ làm việc…
      </p>
    );
  else if (hours.isError)
    body = (
      <div role="alert" className="flex flex-col gap-2">
        <p>{hours.error.error.message}</p>
        {hours.error.error.traceId ? (
          <p className="text-12 text-text-muted">Mã: {hours.error.error.traceId}</p>
        ) : null}
        <RetryAction onRetry={() => void hours.refetch()} busy={hours.isFetching} />
      </div>
    );
  else body = <HoursPanel workspaceId={workspaceId} hours={hours.data} />;
  return (
    <section aria-labelledby="hours-title" className="flex flex-col gap-3">
      <h2 id="hours-title" className="text-16 font-semibold">
        Giờ làm việc
      </h2>
      <p className="text-text-muted">Giờ của workspace đang chọn ở thanh trên.</p>
      {body}
    </section>
  );
}
