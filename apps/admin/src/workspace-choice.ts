// The workspace being worked in (Brief UI §2.6, T1): chosen in the top bar, kept in a cookie that the frame reads on the server.
// The cookie only picks among the workspaces `GET /v1/me` gives this person; the API checks every workspaceId it receives anyway.
import type { Me } from './me';

export const WORKSPACE_COOKIE = 'gani_ws';

/** The workspace chosen if it is still one of theirs, else the first; null for one who has none (a platform operator). */
export function pickWorkspace(
  workspaces: Me['workspaces'],
  chosen: string | undefined,
): string | null {
  return workspaces.find((w) => w.id === chosen)?.id ?? workspaces[0]?.id ?? null;
}

/** The cookie that keeps a choice for a year, for the whole admin; not a secret, so readable by the page that sets it. */
export const choiceCookie = (id: string): string =>
  `${WORKSPACE_COOKIE}=${encodeURIComponent(id)}; Path=/; Max-Age=31536000; SameSite=Lax`;
