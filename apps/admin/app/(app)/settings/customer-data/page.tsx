import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { roleOf } from '../../../../src/me';
import { getMe } from '../../../../src/me.server';
import { builtFor, menuItemAt } from '../../../../src/nav';
import { PrivacyScreen } from '../../../../src/privacy/privacy-screen';

export const metadata: Metadata = { title: 'Dữ liệu khách — Gani Platform' };

/**
 * #23 Dữ liệu khách, Đợt 1 read only (CEO 30/10): Owner and Admin as the menu and the API (Phụ lục B "Xử lý yêu cầu dữ liệu cá nhân",
 * U36). Outside the menu of the role it is the 404 inside the frame, as any such path.
 */
export default async function CustomerDataPage() {
  const result = await getMe();
  const role = result.kind === 'ok' ? roleOf(result.me) : null;
  const item = role ? menuItemAt(role, '/settings/customer-data') : undefined;
  if (!role || !item) notFound();
  return <PrivacyScreen item={item} go={builtFor(role)} />;
}
