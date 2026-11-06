import { describe, expect, it } from 'vitest';

import {
  AgentStatusChangeSchema,
  AgentStatusSchema,
  TeamAgentStatusSchema,
} from './agent-status.schemas.js';

// The rules the planned contract of U82 and U85 already states (CEO 05/11/2026), checked before the module is built.
const ID = '01900000-0000-7000-8000-000000000001';

describe('the agent status contract', () => {
  it('has three statuses, a start and a reason; a person sets only the status', () => {
    const status = { status: 'busy', since: '2026-11-06T08:00:00Z', reason: 'manual' };
    expect(AgentStatusSchema.safeParse(status).success).toBe(true);
    expect(AgentStatusSchema.safeParse({ ...status, reason: null }).success).toBe(true);
    expect(AgentStatusSchema.safeParse({ ...status, status: 'away' }).success).toBe(false);
    expect(AgentStatusChangeSchema.safeParse({ status: 'offline' }).success).toBe(true);
    expect(AgentStatusChangeSchema.safeParse({ status: 'online', userId: ID }).success).toBe(false);
  });

  it('gives a team member’s minutes busy today as a whole number from 0', () => {
    const member = {
      userId: ID,
      name: null,
      status: 'online',
      since: '2026-11-06T08:00:00Z',
      busyMinutesToday: 0,
    };
    expect(TeamAgentStatusSchema.safeParse(member).success).toBe(true);
    expect(TeamAgentStatusSchema.safeParse({ ...member, busyMinutesToday: -1 }).success).toBe(
      false,
    );
  });
});
