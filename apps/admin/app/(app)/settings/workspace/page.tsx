import type { Metadata } from 'next';

import { roleOf } from '../../../../src/me';
import { getMe } from '../../../../src/me.server';
import { builtFor, menuItemAt } from '../../../../src/nav';
import { SystemPage } from '../../../../src/system-page';
import { HolidaysTab } from '../../../../src/workspaces/holidays-tab';
import { HoursTab } from '../../../../src/workspaces/hours-tab';
import { tabOf } from '../../../../src/workspaces/tabs';
import { WorkspaceNav } from '../../../../src/workspaces/workspace-nav';
import { WorkspaceTable } from '../../../../src/workspaces/workspace-table';

export const metadata: Metadata = { title: 'Workspace — Gani Platform' };

/**
 * #21 Workspace (N157): Owner and Admin only, as the API (`GET /v1/workspaces` refuses the others), so the page says so instead of
 * an error. Tabs by `?tab=` (CEO 03/11, brief 52): the workspaces of the company, then the working hours of the one chosen in the
 * top bar (#566), its days off (#570, #571).
 */
export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const [result, { tab: raw }] = await Promise.all([getMe(), searchParams]);
  const role = result.kind === 'ok' ? roleOf(result.me) : null;
  if (role !== 'owner' && role !== 'admin') return <SystemPage kind="forbidden" />;
  const tab = tabOf(raw);
  const item = menuItemAt(role, '/settings/workspace') ?? {
    href: '/settings/workspace',
    label: 'Workspace',
  };
  return (
    <section aria-labelledby="workspace-page-title" className="flex max-w-[880px] flex-col gap-6">
      <h1 id="workspace-page-title" className="text-20 font-semibold">
        Workspace
      </h1>
      <WorkspaceNav tab={tab} />
      {tab === 'hours' ? (
        <HoursTab item={item} go={builtFor(role)} />
      ) : tab === 'holidays' ? (
        <HolidaysTab item={item} go={builtFor(role)} />
      ) : (
        <WorkspaceTable />
      )}
      <p className="text-12 text-text-muted">SLA và cách phân bổ: chưa có ở màn này.</p>
      <p className="text-12 text-text-muted">Không áp dụng AI ở màn này.</p>
    </section>
  );
}
