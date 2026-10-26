// #20 Team (`/settings/teams`, A4, N160): the teams of the workspace being worked in (`GET /v1/teams?workspaceId=`), making one
// (`POST /v1/teams`), changing one (`PATCH /v1/teams/{id}`) and ending one (`DELETE /v1/teams/{id}`). Its people:
// `team-members.ts`.
import type { ApiError } from '../api/errors';
import type { components } from '../api/schema';

export type Team = components['schemas']['Team'];
export type TeamList = components['schemas']['TeamList'];
type TeamCreate = components['schemas']['TeamCreate'];
type TeamChange = components['schemas']['TeamChange'];

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

export interface TeamDraft {
  readonly name: string;
  readonly description: string;
  readonly isDefault: boolean;
}

export const teamDraftFrom = (t: Team): TeamDraft => ({
  name: t.name,
  description: t.description ?? '',
  isDefault: t.isDefault,
});

/**
 * What the dialog changes, as the body of the PATCH (only what differs; a blank description is none), or why it cannot be sent.
 * Empty: nothing changed (the API refuses an empty body, so the dialog just closes). A team is made the default, never unmade:
 * another one is made the default instead, so the workspace keeps one.
 */
export function teamChangeOf(t: Team, d: TeamDraft): TeamChange | string {
  const name = d.name.trim();
  const description = d.description.trim() || null;
  if (!name) return 'Nhập tên team.';
  if (name.length > MAX_TEAM_NAME) return `Tên team tối đa ${MAX_TEAM_NAME} ký tự.`;
  if (description && description.length > MAX_TEAM_DESCRIPTION)
    return `Mô tả tối đa ${MAX_TEAM_DESCRIPTION} ký tự.`;
  return {
    ...(name !== t.name ? { name } : {}),
    ...(description !== t.description ? { description } : {}),
    ...(d.isDefault && !t.isDefault ? { isDefault: true } : {}),
  };
}

/** The list with a changed team in its place, by name; the default flag moves to it when it became the default. */
export function withChanged(list: TeamList | undefined, team: Team): TeamList | undefined {
  if (!list) return list;
  return {
    data: list.data
      .map((t) => (t.id === team.id ? team : team.isDefault ? { ...t, isDefault: false } : t))
      .sort((a, b) => a.name.localeCompare(b.name, 'vi')),
  };
}

/** The list without a team that was ended. */
export const withoutTeam = (list: TeamList | undefined, id: string): TeamList | undefined =>
  list && { data: list.data.filter((t) => t.id !== id) };

/** The refusals of the team routes in words of the screen. */
export function teamError(error: ApiError): string {
  if (error.code === 'forbidden') return 'Chỉ Owner hoặc Admin tạo và sửa team.';
  if (error.code === 'team_in_use')
    return 'Đây là team mặc định của workspace: đặt team khác làm mặc định trước rồi mới kết thúc.';
  if (error.code === 'not_found')
    return 'Không tìm thấy team hoặc workspace này. Tải lại trang rồi thử lại.';
  if (error.code === 'validation_failed')
    return `Máy chủ không nhận giá trị này (tên 1–${MAX_TEAM_NAME} ký tự, mô tả tối đa ${MAX_TEAM_DESCRIPTION}).`;
  return error.message;
}
