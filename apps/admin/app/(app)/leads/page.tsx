import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { LeadBoard } from '../../../src/leads/lead-board';
import { roleOf } from '../../../src/me';
import { getMe } from '../../../src/me.server';
import { builtFor, menuItemAt } from '../../../src/nav';

export const metadata: Metadata = { title: 'Pipeline lead — Gani Platform' };

/** #12 Pipeline lead (CEO 02/11, brief 29: 12a, read only): every role of the company, as the menu; anyone else, the 404. */
export default async function LeadsPage() {
  const result = await getMe();
  const role = result.kind === 'ok' ? roleOf(result.me) : null;
  const item = role ? menuItemAt(role, '/leads') : undefined;
  if (!role || !item) notFound();
  return <LeadBoard item={item} go={builtFor(role)} />;
}
