import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { roleOf } from '../../../../src/me';
import { getMe } from '../../../../src/me.server';
import { builtFor, menuItemAt } from '../../../../src/nav';
import { SecurityScreen } from '../../../../src/security/security-screen';

export const metadata: Metadata = { title: 'Bảo mật — Gani Platform' };

/**
 * #29 Bảo mật, Đợt 1 read only (CEO 30/10): Owner and Admin as the menu (Phụ lục B "Mở sự cố bảo mật"; the platform operator's
 * view waits for /platform). Outside the menu of the role it is the 404 inside the frame, as any such path.
 */
export default async function SecurityPage() {
  const result = await getMe();
  const role = result.kind === 'ok' ? roleOf(result.me) : null;
  const item = role ? menuItemAt(role, '/settings/security') : undefined;
  if (!role || !item) notFound();
  return <SecurityScreen item={item} go={builtFor(role)} />;
}
