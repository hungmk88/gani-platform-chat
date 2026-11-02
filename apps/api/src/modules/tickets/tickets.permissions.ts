import type { OrgRole } from '@gani/db';

// Phụ lục B "Ticket: tạo" (Owner, Admin, Manager, Sales, Support) and the contract of /v1/tickets (U27, N170): those roles read and
// make tickets, a Sales only the ones they made; Marketing and Viewer have no ticket at all (403).
const MAKERS: readonly OrgRole[] = ['owner', 'admin', 'manager', 'sales', 'support'];

export const mayUseTickets = (role: OrgRole): boolean => MAKERS.includes(role);
/** A Sales reads only the tickets they made (N170): the list is narrowed to them whatever the filters say. */
export const readsOwnTicketsOnly = (role: OrgRole): boolean => role === 'sales';
