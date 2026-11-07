// "Team" of #5 Hồ sơ cá nhân (U84, #626): the person's own teams from `GET /v1/me` (`Me.teams`), each with where it belongs.
import type { Me } from '../me';

/** One line per team: "CSKH · Workspace thử", or "· cả công ty" for a team of the whole company (`workspaceId: null`). */
export function myTeamsText(me: Pick<Me, 'teams' | 'workspaces'>): readonly string[] {
  return me.teams.map((t) => {
    if (t.workspaceId === null) return `${t.name} · cả công ty`;
    const ws = me.workspaces.find((w) => w.id === t.workspaceId);
    return ws ? `${t.name} · ${ws.name}` : t.name;
  });
}
