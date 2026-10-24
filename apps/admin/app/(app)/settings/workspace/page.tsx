import type { Metadata } from 'next';

import { roleOf } from '../../../../src/me';
import { getMe } from '../../../../src/me.server';
import { SystemPage } from '../../../../src/system-page';
import { WorkspaceTable } from '../../../../src/workspaces/workspace-table';

export const metadata: Metadata = { title: 'Workspace — Gani Platform' };

/**
 * #21 Workspace (N157), Owner and Admin only as the API allows (whether a Manager may look is still open): the workspaces, their
 * name, time zone and default load limit. Business hours, SLA and allocation wait for their API.
 */
export default async function WorkspacePage() {
  const result = await getMe();
  const role = result.kind === 'ok' ? roleOf(result.me) : null;
  if (role !== 'owner' && role !== 'admin') return <SystemPage kind="forbidden" />;
  return (
    <section aria-labelledby="workspace-page-title" className="flex max-w-[880px] flex-col gap-6">
      <h1 id="workspace-page-title" className="text-20 font-semibold">
        Workspace
      </h1>
      <WorkspaceTable />
      <p className="text-12 text-text-muted">
        Giờ làm việc, ngày nghỉ, SLA và cách phân bổ: chờ API (spec M8 §3.3–3.5).
      </p>
      <p className="text-12 text-text-muted">Không áp dụng AI ở màn này.</p>
    </section>
  );
}
