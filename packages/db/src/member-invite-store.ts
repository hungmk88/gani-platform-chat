import { createHash, randomBytes } from 'node:crypto';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { orgMembers, type OrgRole } from './schema/org-members.js';
import { currentTenantContext } from './tenant-context.js';
import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

/** How long an invitation lives (spec RLS M01 §4.3, agreed): the same for the first Owner (tenant:create-org) and for members. */
export const INVITE_DAYS = 7;

/** A pending invitation of the organisation of the transaction. `invitedEmail` is PII: it goes in the email and the answer, never a log. */
export interface PendingInvite {
  readonly id: string;
  readonly invitedEmail: string;
  readonly role: OrgRole;
  readonly expiresAt: Date;
}

/**
 * A new token of 32 bytes from the CSPRNG and its SHA-256, the only form the table keeps (spec RLS M01 §3.7). The token goes in the
 * email and nowhere else: not in the database, not in a log, not in the answer of the API.
 */
export function newInviteToken(): { readonly token: string; readonly hash: Buffer } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: createHash('sha256').update(token, 'utf8').digest() };
}

const view = {
  id: orgMembers.id,
  invitedEmail: orgMembers.invitedEmail,
  role: orgMembers.role,
  expiresAt: orgMembers.inviteExpiresAt,
};
const expiry = sql`now() + make_interval(days => ${INVITE_DAYS})`;
const pending = (row: {
  id: string;
  invitedEmail: string | null;
  role: OrgRole;
  expiresAt: Date | null;
}): PendingInvite => ({
  id: row.id,
  // CHECK org_members_pending_check: a pending row has both.
  invitedEmail: row.invitedEmail as string,
  role: row.role,
  expiresAt: row.expiresAt as Date,
});

/**
 * Invites `email` (normalised by the caller: the CHECK refuses another form) to the organisation of the transaction as `role`.
 * Null when that email has a pending invitation of this organisation already (UNIQUE org_members_pending_email_key): one invitation
 * per person, which a resend renews. `invitedBy` is the member who invites, from the session.
 */
export async function createMemberInvite(
  tx: TenantTx,
  invite: {
    readonly id: string;
    readonly email: string;
    readonly role: OrgRole;
    readonly invitedBy: string;
    readonly tokenHash: Buffer;
  },
): Promise<PendingInvite | null> {
  const [row] = await tx
    .insert(orgMembers)
    .values({
      id: assertUuid(invite.id, 'id'),
      orgId: currentTenantContext().orgId,
      invitedEmail: invite.email,
      role: invite.role,
      status: 'pending',
      inviteTokenHash: invite.tokenHash,
      inviteExpiresAt: expiry,
      invitedBy: assertUuid(invite.invitedBy, 'invitedBy'),
    })
    .onConflictDoNothing({
      target: [orgMembers.orgId, orgMembers.invitedEmail],
      where: sql`status = 'pending'`,
    })
    .returning(view);
  return row ? pending(row) : null;
}

/** The pending invitation `id`, locked until the end of the transaction (two resends of one invitation take turns), or null. */
export async function lockPendingInvite(tx: TenantTx, id: string): Promise<PendingInvite | null> {
  const [row] = await tx
    .select(view)
    .from(orgMembers)
    .where(
      and(
        eq(orgMembers.id, assertUuid(id, 'id')),
        eq(orgMembers.status, 'pending'),
        isNull(orgMembers.deletedAt),
      ),
    )
    .for('update');
  return row ? pending(row) : null;
}

/** A new token and seven more days for the pending invitation `id`: the token sent before stops working at once. */
export async function renewMemberInvite(
  tx: TenantTx,
  id: string,
  tokenHash: Buffer,
): Promise<PendingInvite | null> {
  const [row] = await tx
    .update(orgMembers)
    .set({ inviteTokenHash: tokenHash, inviteExpiresAt: expiry, updatedAt: sql`now()` })
    .where(
      and(
        eq(orgMembers.id, assertUuid(id, 'id')),
        eq(orgMembers.status, 'pending'),
        isNull(orgMembers.deletedAt),
      ),
    )
    .returning(view);
  return row ? pending(row) : null;
}
