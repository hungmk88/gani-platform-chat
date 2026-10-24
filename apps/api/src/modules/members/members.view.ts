import type { MemberEntry } from '@gani/db';

/** A row of app.org_member_directory as `GET /v1/members` answers it (MemberSchema): an invitation past its date is `expired`. */
export function memberView(entry: MemberEntry, now: Date) {
  const expired =
    entry.status === 'pending' && entry.inviteExpiresAt !== null && entry.inviteExpiresAt <= now;
  return {
    id: entry.id,
    userId: entry.userId,
    name: entry.displayName,
    email: entry.email ?? '',
    role: entry.role,
    status: expired ? ('expired' as const) : entry.status,
    twoFactorEnabled: entry.twoFactorEnabled,
    expiresAt: entry.inviteExpiresAt?.toISOString() ?? null,
    maxConcurrentConversations: entry.maxConcurrentConversations,
  };
}
