import type { Metadata } from 'next';

import { roleOf } from '../../../../src/me';
import { getMe } from '../../../../src/me.server';
import { invitableRoles } from '../../../../src/members/invite';
import { InviteForm } from '../../../../src/members/invite-form';
import { SystemPage } from '../../../../src/system-page';

export const metadata: Metadata = { title: 'Thành viên — Gani Platform' };

/** #19 Thành viên (N152), Owner and Admin only: inviting today; the list, roles, load limits and 2FA reset wait for their API. */
export default async function MembersPage() {
  const result = await getMe();
  const role = result.kind === 'ok' ? roleOf(result.me) : null;
  const roles = role ? invitableRoles(role) : [];
  if (!roles.length) return <SystemPage kind="forbidden" />;
  return (
    <section aria-labelledby="members-title" className="flex max-w-[720px] flex-col gap-6">
      <h1 id="members-title" className="text-20 font-semibold">
        Thành viên
      </h1>
      <InviteForm roles={roles} />
      <div className="flex flex-col gap-1">
        <h2 className="text-16 font-semibold">Danh sách thành viên</h2>
        <p className="text-text-muted">
          Chưa xem được ở đây: chờ API danh sách thành viên. Đổi vai trò, giới hạn tải, đặt lại 2FA
          và gửi lại lời mời cũng chờ API.
        </p>
      </div>
      <p className="text-12 text-text-muted">Không áp dụng AI ở màn này.</p>
    </section>
  );
}
