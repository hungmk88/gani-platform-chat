import { readScope } from '../conversations/permissions.js';
import type { RequestContext } from '../request-context/request-context.js';

// The rooms a socket of /agent joins by itself (realtime spec §3, N142). Their names are made here from the context the server
// decided, never from anything the client sent.

export const orgRoom = (orgId: string): string => `org:${orgId}`;
export const workspaceRoom = (workspaceId: string): string => `ws:${workspaceId}`;
export const userRoom = (userId: string): string => `user:${userId}`;

/**
 * `org:` and `user:` for everyone; `ws:` of each of their workspaces only for a role that reads conversations: the room carries the
 * summary of every message of the workspace (no content, R3), which a marketing or viewer member may not read at all (N142).
 */
export function roomsFor(
  ctx: Pick<RequestContext, 'orgId' | 'userId' | 'role' | 'workspaceIds'>,
): string[] {
  const workspaces = readScope(ctx.role) === 'none' ? [] : ctx.workspaceIds.map(workspaceRoom);
  return [orgRoom(ctx.orgId), userRoom(ctx.userId), ...workspaces];
}
