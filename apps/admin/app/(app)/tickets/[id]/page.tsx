import type { Metadata } from 'next';

import { roleOf } from '../../../../src/me';
import { getMe } from '../../../../src/me.server';
import { SystemPage } from '../../../../src/system-page';
import { TicketView } from '../../../../src/tickets/ticket-view';
import { mayReadTickets } from '../../../../src/tickets/tickets';

export const metadata: Metadata = { title: 'Ticket — Gani Platform' };

/** #15 Chi tiết ticket (U27, N167): the same roles as the list (#14); who may change it is `movesFor`. */
export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, result] = await Promise.all([params, getMe()]);
  const role = result.kind === 'ok' ? roleOf(result.me) : null;
  if (result.kind !== 'ok' || !role || !mayReadTickets(role))
    return <SystemPage kind="forbidden" />;
  return (
    <section aria-label="Chi tiết ticket" className="flex max-w-[720px] flex-col gap-6">
      <TicketView id={id} role={role} meId={result.me.id} />
      <p className="text-12 text-text-muted">Không áp dụng AI ở màn này.</p>
    </section>
  );
}
