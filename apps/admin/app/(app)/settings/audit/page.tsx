import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AuditScreen } from '../../../../src/audit/audit-screen';
import { roleOf } from '../../../../src/me';
import { getMe } from '../../../../src/me.server';
import { menuItemAt } from '../../../../src/nav';

export const metadata: Metadata = { title: 'Audit log — Gani Platform' };

/**
 * #28 Audit log (CEO 31/10): Owner and Admin as the menu and the API (real API, N174). Outside the menu of the role it is the 404
 * inside the frame, as any such path.
 */
export default async function AuditPage() {
  const result = await getMe();
  const role = result.kind === 'ok' ? roleOf(result.me) : null;
  if (result.kind !== 'ok' || !role || !menuItemAt(role, '/settings/audit')) notFound();
  return <AuditScreen meId={result.me.id} />;
}
