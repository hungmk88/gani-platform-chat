import { roleOf } from '../../../src/me';
import { getMe, getSecurityStatus } from '../../../src/me.server';
import { Profile } from '../../../src/profile/profile';
import { tabOf } from '../../../src/profile/tabs';

/** #5 Hồ sơ cá nhân for every role. The layout has already handled sign-in, 2FA and errors; both answers are cached per request. */
export default async function MePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const [result, status, { tab }] = await Promise.all([getMe(), getSecurityStatus(), searchParams]);
  if (result.kind !== 'ok') return null;
  const role = roleOf(result.me);
  if (!role) return null;
  return (
    <Profile
      tab={tabOf(tab)}
      name={result.me.name}
      role={role}
      orgName={result.me.org?.name ?? null}
      workspaces={result.me.workspaces.map((w) => w.name)}
      twoFactorEnabled={status.kind === 'signed_in' && status.twoFactorEnabled}
    />
  );
}
