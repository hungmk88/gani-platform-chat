import type { Metadata } from 'next';

import { ChannelTable } from '../../../../src/channels/channel-table';
import { roleOf } from '../../../../src/me';
import { getMe } from '../../../../src/me.server';
import { SystemPage } from '../../../../src/system-page';

export const metadata: Metadata = { title: 'Kênh — Gani Platform' };

/**
 * #24 Kênh (B1–B3), Owner and Admin as the menu and the API (Phụ lục B "Cài đặt workspace, kênh, team"): the channels of the
 * workspace being worked in, read only (N161; a team is given its channels on /settings/teams). Connecting a Zalo OA, refreshing its
 * token and disconnecting wait for U26.
 */
export default async function ChannelsPage() {
  const result = await getMe();
  const role = result.kind === 'ok' ? roleOf(result.me) : null;
  if (role !== 'owner' && role !== 'admin') return <SystemPage kind="forbidden" />;
  return (
    <section aria-labelledby="channels-page-title" className="flex max-w-[880px] flex-col gap-6">
      <h1 id="channels-page-title" className="text-20 font-semibold">
        Kênh
      </h1>
      <ChannelTable />
      <p className="text-12 text-text-muted">
        Kết nối Zalo OA, làm mới kết nối và ngắt kết nối: chưa có trong bản hiện tại. Đổi team trả
        lời một kênh: Cài đặt › Team, nút "Kênh" của team.
      </p>
      <p className="text-12 text-text-muted">Không áp dụng AI ở màn này.</p>
    </section>
  );
}
