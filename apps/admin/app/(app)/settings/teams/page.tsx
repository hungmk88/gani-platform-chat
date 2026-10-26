import type { Metadata } from 'next';

import { roleOf } from '../../../../src/me';
import { getMe } from '../../../../src/me.server';
import { SystemPage } from '../../../../src/system-page';
import { TeamsScreen } from '../../../../src/teams/teams-screen';

export const metadata: Metadata = { title: 'Team — Gani Platform' };

/**
 * #20 Team (A4, N160): Owner and Admin manage the teams (Phụ lục B "Cài đặt workspace, kênh, team"): making, changing and ending
 * a team, picking its people and its channels. A Manager only reads the teams it belongs to, as the API serves them (CEO, 26/10).
 */
export default async function TeamsPage() {
  const result = await getMe();
  const role = result.kind === 'ok' ? roleOf(result.me) : null;
  if (role !== 'owner' && role !== 'admin' && role !== 'manager')
    return <SystemPage kind="forbidden" />;
  const readOnly = role === 'manager';
  return (
    <section aria-labelledby="teams-page-title" className="flex max-w-[880px] flex-col gap-6">
      <h1 id="teams-page-title" className="text-20 font-semibold">
        Team
      </h1>
      <TeamsScreen readOnly={readOnly} />
      {readOnly ? (
        <p className="text-12 text-text-muted">
          Bạn xem các team mình thuộc về. Tạo, sửa team, chọn người và kênh của team do Owner hoặc
          Admin làm.
        </p>
      ) : null}
      <p className="text-12 text-text-muted">Không áp dụng AI ở màn này.</p>
    </section>
  );
}
