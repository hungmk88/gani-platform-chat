// "Trạng thái của tôi" (U82, #626; planned S4, `GET/PUT /v1/me/agent-status`): the signed-in agent's own status in the top bar,
// for the roles that hold conversations (Marketing/Viewer: 403, not shown). Until the API serves it (404) nothing is shown.
import type { components } from './api/planned';

export type AgentStatus = components['schemas']['AgentStatus'];
export type AgentStatusValue = AgentStatus['status'];

export const AGENT_STATUS_PATH = '/v1/me/agent-status';
export const AGENT_STATUS_KEY = ['me', 'agent-status'] as const;

/** The three statuses in words (wireframe of brief 61/84), in this order in the choice. */
export const AGENT_STATUS: Readonly<Record<AgentStatusValue, string>> = {
  online: 'Online',
  busy: 'Bận',
  offline: 'Offline',
};

/** The line under the top bar, or null: an Offline the API set itself because the connection was lost (`reason: disconnected`). */
export function stripOf(s: Pick<AgentStatus, 'status' | 'reason'>): string | null {
  if (s.status === 'offline' && s.reason === 'disconnected')
    return 'Đã chuyển Offline do mất kết nối. Bật Online khi sẵn sàng.';
  return null;
}
