// #20 Team: the people of a team (`GET/PUT /v1/teams/{id}/members`, N160), picked among the people of its workspace
// (`GET /v1/workspaces/{id}/members`, N159); the PUT sets the whole list. Names come from the members of the company (N153).
import type { ApiError } from '../api/errors';
import type { Member } from '../members/list';
import { pickable, type WorkspaceMemberList } from '../workspaces/workspace-members';
import type { TeamList } from './teams';

export const teamMembersPath = (teamId: string): string =>
  `/v1/teams/${encodeURIComponent(teamId)}/members`;

/** Who can be picked: an account of the company (as for a workspace) that is a person of the team's workspace (the API checks it). */
export function inWorkspace(members: readonly Member[], people: WorkspaceMemberList): Member[] {
  const ids = new Set(people.data.map((p) => p.memberId));
  return pickable(members).filter((m) => ids.has(m.id));
}

/** The list with the number of people of one team as the PUT answered. */
export function withCount(
  list: TeamList | undefined,
  teamId: string,
  memberCount: number,
): TeamList | undefined {
  if (!list) return list;
  return { data: list.data.map((t) => (t.id === teamId ? { ...t, memberCount } : t)) };
}

/** The refusals of `PUT /v1/teams/{id}/members` in words of the screen. */
export function teamMembersError(error: ApiError): string {
  if (error.code === 'validation_failed')
    return 'Có người không còn thuộc workspace của team. Tải lại trang rồi chọn lại.';
  if (error.code === 'forbidden') return 'Chỉ Owner hoặc Admin đổi được người của team.';
  if (error.code === 'not_found') return 'Không tìm thấy team này. Tải lại trang rồi thử lại.';
  return error.message;
}
