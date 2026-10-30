import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AutonomyScreen } from '../../../../src/autonomy/autonomy-screen';
import { roleOf } from '../../../../src/me';
import { getMe } from '../../../../src/me.server';
import { builtFor, menuItemAt } from '../../../../src/nav';

export const metadata: Metadata = { title: 'Tự chủ & feature flag — Gani Platform' };

/**
 * #27 Tự chủ & feature flag, Đợt 1 read only (CEO 30/10): Owner and Admin as the menu and the API (Phụ lục B "hạ mức tự chủ,
 * tắt feature flag"). Outside the menu of the role it is the 404 inside the frame, as any such path.
 */
export default async function AutonomyPage() {
  const result = await getMe();
  const role = result.kind === 'ok' ? roleOf(result.me) : null;
  const item = role ? menuItemAt(role, '/settings/autonomy') : undefined;
  if (result.kind !== 'ok' || !role || !item) notFound();
  return <AutonomyScreen item={item} go={builtFor(role)} meId={result.me.id} />;
}
