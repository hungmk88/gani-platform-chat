import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { roleOf } from '../../../src/me';
import { getMe } from '../../../src/me.server';
import { builtFor, menuItemAt } from '../../../src/nav';
import { SystemPage } from '../../../src/system-page';
import { TicketList } from '../../../src/tickets/ticket-list';
import { mayReadTickets } from '../../../src/tickets/tickets';

export const metadata: Metadata = { title: 'Ticket — Gani Platform' };

/** #14 Ticket (U27, N167): Owner, Admin, Manager, Sales (makes them) and Support, as the menu (Phụ lục B). */
export default async function TicketsPage() {
  const result = await getMe();
  const role = result.kind === 'ok' ? roleOf(result.me) : null;
  if (!mayReadTickets(role)) return <SystemPage kind="forbidden" />;
  const item = role ? menuItemAt(role, '/tickets') : undefined;
  if (!role || !item) notFound();
  return <TicketList item={item} go={builtFor(role)} />;
}
