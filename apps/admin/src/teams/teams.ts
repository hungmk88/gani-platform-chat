// #20 Team (`/settings/teams`, A4, N160): the teams of the workspace being worked in (`GET /v1/teams?workspaceId=`) and making one
// (`POST /v1/teams`). Changing, removing a team and picking its people come with the next part of the API (A4-T2b).
import type { ApiError } from '../api/errors';
import type { components } from '../api/schema';

export type Team = components['schemas']['Team'];
export type TeamList = components['schemas']['TeamList'];
type TeamCreate = components['schemas']['TeamCreate'];

export const MAX_TEAM_NAME = 100;
export const MAX_TEAM_DESCRIPTION = 500;

export const teamsPath = (workspaceId: string): string =>
  `/v1/teams?${new URLSearchParams({ workspaceId }).toString()}`;

/** The body of `POST /v1/teams`, trimmed like the API (a blank description is none), or why it cannot be sent. */
export function teamDraftOf(
  workspaceId: string,
  rawName: string,
  rawDescription: string,
): TeamCreate | string {
  const name = rawName.trim();
  const description = rawDescription.trim();
  if (!name) return 'Nhập tên team.';
  if (name.length > MAX_TEAM_NAME) return `Tên team tối đa ${MAX_TEAM_NAME} ký tự.`;
  if (description.length > MAX_TEAM_DESCRIPTION)
    return `Mô tả tối đa ${MAX_TEAM_DESCRIPTION} ký tự.`;
  return { workspaceId, name, ...(description ? { description } : {}) };
}

/** The list with a team the API made, kept by name as the API sorts it; one already there is not added twice. */
export function withTeam(list: TeamList | undefined, team: Team): TeamList | undefined {
  if (!list || list.data.some((t) => t.id === team.id)) return list;
  return { data: [...list.data, team].sort((a, b) => a.name.localeCompare(b.name, 'vi')) };
}

/** The refusals of the team routes in words of the screen. */
export function teamError(error: ApiError): string {
  if (error.code === 'forbidden') return 'Chỉ Owner hoặc Admin tạo và sửa team.';
  if (error.code === 'not_found') return 'Không tìm thấy workspace này. Tải lại trang rồi thử lại.';
  if (error.code === 'validation_failed')
    return `Máy chủ không nhận giá trị này (tên 1–${MAX_TEAM_NAME} ký tự, mô tả tối đa ${MAX_TEAM_DESCRIPTION}).`;
  return error.message;
}
