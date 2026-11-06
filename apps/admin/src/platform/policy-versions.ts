// #30 Platform, "Phiên bản" of a channel policy (U80, brief B-U80, tầng 1): every version of one channel and class, the latest
// `effectiveFrom` first (`GET /v1/channel-policies/{channelType}/{messageClass}/versions`, planned S5, #617), read only.
import type { components } from '../api/planned';
import type { ChannelPolicy } from './platform';

export type PolicyVersion = components['schemas']['ChannelPolicyVersion'];
export type PolicyVersionList = components['schemas']['ChannelPolicyVersionList'];

export const versionsPath = (p: Pick<ChannelPolicy, 'channelType' | 'messageClass'>) =>
  `/v1/channel-policies/${encodeURIComponent(p.channelType)}/${encodeURIComponent(p.messageClass)}/versions`;

/** Where a version stands against now, in words. */
export const VERSION_STATE: Readonly<Record<PolicyVersion['state'], string>> = {
  scheduled: 'Đã đặt lịch',
  in_force: 'Đang áp dụng',
  past: 'Đã qua',
};

/** Who added it: the API gives only an id (null for the versions a migration wrote). */
export const creatorText = (createdBy: string | null, meId: string) =>
  createdBy === null ? 'Hệ thống' : createdBy === meId ? 'Bạn' : 'Người khác';
