import type { OrgRole } from '@gani/db';

// Phụ lục B "Ticket: tạo" (Owner, Admin, Manager, Sales, Support) and the contract of /v1/tickets (U27, N170): those roles read and
// make tickets, a Sales only the ones they made; Marketing and Viewer have no ticket at all (403). Changing one is for those who may
// receive one (U52, N170): Owner, Admin, Manager, Support.
const HANDLERS: readonly OrgRole[] = ['owner', 'admin', 'manager', 'support'];
const MAKERS: readonly OrgRole[] = [...HANDLERS, 'sales'];

export const mayUseTickets = (role: OrgRole): boolean => MAKERS.includes(role);
/** A Sales reads only the tickets they made (N170): the list is narrowed to them whatever the filters say. */
export const readsOwnTicketsOnly = (role: OrgRole): boolean => role === 'sales';
/** PATCH /v1/tickets/{id}: Sales, Marketing and Viewer are 403. Who may cancel is the store's check (TICKET_CANCEL_ROLES). */
export const mayChangeTickets = (role: OrgRole): boolean => HANDLERS.includes(role);
