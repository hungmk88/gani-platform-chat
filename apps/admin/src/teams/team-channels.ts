// #20 Team: the channels a team answers (N161). The channels of the workspace (`GET /v1/channels?workspaceId=`, metadata only) each
// name their team, null for the default team of the workspace; `PUT /v1/teams/{id}/channels` sets the whole list of a team: a
// channel of another team moves to it, one left out goes back to the default team.
import type { ApiError } from '../api/errors';
import type { components } from '../api/schema';
import type { Team } from './teams';

export type Channel = components['schemas']['Channel'];
export type ChannelList = components['schemas']['ChannelList'];

export const channelsPath = (workspaceId: string): string =>
  `/v1/channels?${new URLSearchParams({ workspaceId }).toString()}`;

export const teamChannelsPath = (teamId: string): string =>
  `/v1/teams/${encodeURIComponent(teamId)}/channels`;

export const CHANNEL_TYPE: Record<Channel['type'], string> = {
  zalo_oa: 'Zalo OA',
  facebook: 'Facebook',
  webchat: 'Webchat',
};

export const CHANNEL_STATUS: Record<Channel['status'], string> = {
  connected: 'Đang kết nối',
  token_expiring: 'Kết nối sắp hết hạn',
  disconnected: 'Mất kết nối',
};

/** The ids of the channels a team answers now. */
export const channelsOf = (channels: readonly Channel[], teamId: string): Set<string> =>
  new Set(channels.filter((c) => c.teamId === teamId).map((c) => c.id));

/** Whether the picked ids are those the team answers already, in any order. */
export function sameChannels(
  picked: ReadonlySet<string>,
  channels: readonly Channel[],
  teamId: string,
): boolean {
  const now = channelsOf(channels, teamId);
  return picked.size === now.size && [...now].every((id) => picked.has(id));
}

/** Who answers a channel now, in words: another team by name, or the default team. Null when it is this team. */
export function answeredBy(c: Channel, teamId: string, teams: readonly Team[]): string | null {
  if (c.teamId === teamId) return null;
  if (c.teamId === null) return 'team mặc định';
  return teams.find((t) => t.id === c.teamId)?.name ?? 'team khác';
}

/** The list with the channels as the PUT set them: the picked to the team, the others it had back to the default team. */
export function withAssigned(
  list: ChannelList | undefined,
  teamId: string,
  picked: readonly string[],
): ChannelList | undefined {
  if (!list) return list;
  return {
    data: list.data.map((c) =>
      picked.includes(c.id) ? { ...c, teamId } : c.teamId === teamId ? { ...c, teamId: null } : c,
    ),
  };
}

/** The refusals of `PUT /v1/teams/{id}/channels` in words of the screen. */
export function teamChannelsError(error: ApiError): string {
  if (error.code === 'validation_failed')
    return 'Có kênh không còn thuộc workspace của team. Tải lại trang rồi chọn lại.';
  if (error.code === 'forbidden') return 'Chỉ Owner hoặc Admin đổi được kênh của team.';
  if (error.code === 'not_found') return 'Không tìm thấy team này. Tải lại trang rồi thử lại.';
  return error.message;
}
