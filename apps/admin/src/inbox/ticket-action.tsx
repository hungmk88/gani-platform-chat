'use client';

import { useState } from 'react';

import type { components } from '../api/schema';
import type { Role } from '../nav';
import { TicketCreateDialog } from '../tickets/ticket-create-dialog';
import type { TicketSource } from '../tickets/ticket-create';
import { mayReadTickets } from '../tickets/tickets';
import { customerNameOf } from './list';
import type { Message } from './messages';
import { titleFromMessages } from './ticket-title';

type Conversation = components['schemas']['Conversation'];

const button = 'rounded-input border border-border-strong px-3 py-1';

/**
 * "Tạo ticket" on the open conversation (#358): the roles that make tickets (Phụ lục B), in every state of the conversation,
 * CLOSED included on purpose: a ticket is often what is left to do once the conversation is over (CEO 27/10), not an oversight.
 * Several tickets may come from one conversation; the dialog's lock and Idempotency-Key stop a double click.
 */
export function TicketAction({
  c,
  role,
  newestPage,
}: {
  c: Conversation;
  role: Role;
  /** The newest page of messages the conversation loaded (50): the title is taken from it only (`titleFromMessages`). */
  newestPage: readonly Message[];
}) {
  const [from, setFrom] = useState<TicketSource | null>(null);
  if (!mayReadTickets(role)) return null;
  return (
    <>
      <button
        type="button"
        className={`${button} self-start`}
        onClick={() =>
          setFrom({
            workspaceId: c.workspaceId,
            conversationId: c.id,
            customerId: c.customer?.id ?? null,
            customerName: customerNameOf(c),
            title: titleFromMessages(newestPage),
          })
        }
      >
        Tạo ticket
      </button>
      {from ? <TicketCreateDialog role={role} from={from} onClose={() => setFrom(null)} /> : null}
    </>
  );
}
