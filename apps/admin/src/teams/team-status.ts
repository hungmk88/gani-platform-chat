// #20 Team, "Trạng thái" of a team (U85, U42, brief 122, tầng 1): each member who holds conversations, by name, with the status and
// the minutes "Bận" today (`GET /v1/teams/{id}/agent-status`, planned S4, #626), read only. Owner, Admin, a Manager of the team.
import type { components } from '../api/planned';

export type TeamAgentStatus = components['schemas']['TeamAgentStatus'];
export type TeamAgentStatusList = components['schemas']['TeamAgentStatusList'];

export const teamStatusPath = (teamId: string) =>
  `/v1/teams/${encodeURIComponent(teamId)}/agent-status`;

/** The minutes "Bận" since 00:00 today, counted by the API (in the time zone of the team's workspace), in words. */
export function busyText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} phút`;
  return m ? `${h} giờ ${m} phút` : `${h} giờ`;
}
