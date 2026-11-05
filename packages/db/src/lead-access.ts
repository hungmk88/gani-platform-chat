import type { OrgRole } from './schema/org-members.js';

// Who reads and who changes the leads of a workspace (Phụ lục B "Lead", T-2, N188; CEO 04–05/11/2026). The one place these rules live:
// lead-store.ts applies them to every read, and the API (L4, L5) calls them instead of writing its own. Row-level security has already
// kept the organisation and the workspaces of the session; this narrows inside them.
// - owner, admin, manager: every lead of their workspaces, and change any;
// - sales: only the leads they made or own (another one is not found, 404, P9), and change only those;
// - marketing, viewer: read every lead of their workspaces, change none;
// - support: nothing at all, not even the pipeline (403 on all six paths, N196).

export type LeadReadScope = 'workspace' | 'own' | 'none';

const READ: Readonly<Record<OrgRole, LeadReadScope>> = {
  owner: 'workspace',
  admin: 'workspace',
  manager: 'workspace',
  sales: 'own',
  marketing: 'workspace',
  viewer: 'workspace',
  support: 'none',
};

/** Who may follow a lead (`ownerUserId`): an active Owner, Admin, Manager or Sales of the lead's workspace (422 invalid_assignee). */
export const LEAD_OWNER_ROLES = ['owner', 'admin', 'manager', 'sales'] as const;

const WRITERS: readonly OrgRole[] = LEAD_OWNER_ROLES;

/** Support may not touch a lead at all: the store throws this before any query, the API answers it 403. */
export class LeadAccessDeniedError extends Error {
  constructor() {
    super('this role has no access to the leads');
    this.name = 'LeadAccessDeniedError';
  }
}

/** What a person reads: `none` throws LeadAccessDeniedError in the store, never an empty page. */
export const leadReadScope = (role: OrgRole): LeadReadScope => READ[role];

/** Who a scope is for: the store narrows `own` to the leads this user made or owns. */
export interface LeadViewer {
  readonly role: OrgRole;
  readonly userId: string;
}

/** Is this lead one the person made or owns? */
const isTheirs = (userId: string, lead: LeadOwnership): boolean =>
  lead.createdBy === userId || lead.ownerUserId === userId;

export interface LeadOwnership {
  readonly createdBy: string;
  readonly ownerUserId: string | null;
}

/** May this person see this lead, once RLS has let it through? Not seeing it is answered 404, never 403 (P9). */
export function canSeeLead(viewer: LeadViewer, lead: LeadOwnership): boolean {
  const scope = leadReadScope(viewer.role);
  if (scope === 'workspace') return true;
  if (scope === 'none') return false;
  return isTheirs(viewer.userId, lead);
}

/** May this person make a lead (POST /v1/leads)? An Owner, Admin, Manager or Sales. */
export const mayCreateLead = (role: OrgRole): boolean => WRITERS.includes(role);

/** May this person change this lead (its step, its closing)? Owner, Admin, Manager any lead; Sales only one they made or own. */
export function mayWriteLead(viewer: LeadViewer, lead: LeadOwnership): boolean {
  if (!WRITERS.includes(viewer.role)) return false;
  return viewer.role !== 'sales' || isTheirs(viewer.userId, lead);
}
