import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { FlowList } from '../../../src/bots/flow-list';
import { roleOf } from '../../../src/me';
import { getMe } from '../../../src/me.server';
import { builtFor, menuItemAt } from '../../../src/nav';

export const metadata: Metadata = { title: 'Bot — Gani Platform' };

/** #17 Danh sách bot flow (D1a3a, CEO 01/11: read only): Owner, Admin, Manager as the menu and the API; anyone else, the 404. */
export default async function BotsPage() {
  const result = await getMe();
  const role = result.kind === 'ok' ? roleOf(result.me) : null;
  const item = role ? menuItemAt(role, '/bots') : undefined;
  if (!role || !item) notFound();
  return <FlowList item={item} go={builtFor(role)} />;
}
