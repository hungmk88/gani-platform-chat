// #24 Kênh (`/settings/channels`, B1–B3): the channel accounts of the workspace being worked in (`GET /v1/channels?workspaceId=`,
// N161), metadata only: name, type, connection status and the team that answers each (null: the default team of the workspace).
// Connecting, refreshing a token and disconnecting wait for U26.
import type { components } from '../api/schema';

export type Channel = components['schemas']['Channel'];
export type ChannelList = components['schemas']['ChannelList'];

export const channelsPath = (workspaceId: string): string =>
  `/v1/channels?${new URLSearchParams({ workspaceId }).toString()}`;

export const CHANNEL_TYPE: Record<Channel['type'], string> = {
  zalo_oa: 'Zalo OA',
  facebook: 'Facebook',
  webchat: 'Webchat',
};

/** The connection status in plain words, with its tone: green, amber or red are only for states (Brief UI §1.2). */
export const CHANNEL_STATUS: Record<
  Channel['status'],
  { readonly label: string; readonly tone: 'ok' | 'warn' | 'error' }
> = {
  connected: { label: 'Đang kết nối', tone: 'ok' },
  token_expiring: { label: 'Kết nối sắp hết hạn', tone: 'warn' },
  disconnected: { label: 'Mất kết nối', tone: 'error' },
};

/** The team that answers a channel, by name: the default team when none is set, nothing while the teams are not known. */
export function answeringTeam(
  c: Channel,
  teams: readonly { readonly id: string; readonly name: string }[] | undefined,
): string {
  if (c.teamId === null) return 'Team mặc định';
  return teams?.find((t) => t.id === c.teamId)?.name ?? '—';
}
