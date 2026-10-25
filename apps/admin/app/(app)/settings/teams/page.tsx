import type { Metadata } from 'next';

import { roleOf } from '../../../../src/me';
import { getMe } from '../../../../src/me.server';
import { SystemPage } from '../../../../src/system-page';
import { TeamsScreen } from '../../../../src/teams/teams-screen';

export const metadata: Metadata = { title: 'Team — Gani Platform' };

/**
 * #20 Team (A4, N160), Owner and Admin as the menu (Phụ lục B "Cài đặt workspace, kênh, team"); the API also lets a Manager read
 * their own teams, which waits for the same call as /settings/workspace. Making, changing and ending a team and picking its people
 * are here; its channels come next.
 */
export default async function TeamsPage() {
  const result = await getMe();
  const role = result.kind === 'ok' ? roleOf(result.me) : null;
  if (role !== 'owner' && role !== 'admin') return <SystemPage kind="forbidden" />;
  return (
    <section aria-labelledby="teams-page-title" className="flex max-w-[880px] flex-col gap-6">
      <h1 id="teams-page-title" className="text-20 font-semibold">
        Team
      </h1>
      <TeamsScreen />
      <p className="text-12 text-text-muted">Kênh team phụ trách: chưa có trong bản hiện tại.</p>
      <p className="text-12 text-text-muted">Không áp dụng AI ở màn này.</p>
    </section>
  );
}
