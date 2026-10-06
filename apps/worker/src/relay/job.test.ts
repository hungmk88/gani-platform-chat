import type { ClaimedOutboxEvent } from '@gani/db';
import { describe, expect, it } from 'vitest';

import { backoffSeconds, queueNameOf, toJob } from './job.js';

// prettier-ignore
const event = (over: Partial<ClaimedOutboxEvent> = {}): ClaimedOutboxEvent => ({
  id: 'e-1', orgId: 'org-1', workspaceId: 'ws-1', eventType: 'conversation.state_changed', eventVersion: 1, aggregateType: 'conversation',
  aggregateId: 'c-1', aggregateVersion: 3, payload: { conversationId: 'c-1', to: 'HUMAN_ACTIVE' }, actorKind: 'agent', actorId: 'u-1',
  traceId: 'trace-1', occurredAt: new Date('2026-10-06T10:00:00Z'), attempts: 1, ...over,
});

describe('queueNameOf', () => {
  it('is one queue per workspace, and one per organisation for an event with no workspace', () => {
    expect(queueNameOf(event())).toBe('q.events.ws.ws-1');
    expect(queueNameOf(event({ workspaceId: null }))).toBe('q.events.org.org-1');
  });
});

describe('toJob', () => {
  // prettier-ignore
  it('uses the id of the event as the job id and carries the tenant and the references, nothing else', () => {
    expect(toJob(event())).toEqual({
      queue: 'q.events.ws.ws-1', jobId: 'e-1',
      data: {
        id: 'e-1', type: 'conversation.state_changed', version: 1, orgId: 'org-1', workspaceId: 'ws-1', occurredAt: '2026-10-06T10:00:00.000Z',
        traceId: 'trace-1', actor: { kind: 'agent', id: 'u-1' }, aggregate: { type: 'conversation', id: 'c-1', version: 3 },
        payload: { conversationId: 'c-1', to: 'HUMAN_ACTIVE' },
      },
    });
  });

  it('keeps an actor without id and an aggregate without version as null', () => {
    const { data } = toJob(event({ actorId: null, aggregateVersion: null, workspaceId: null }));
    expect(data).toMatchObject({
      workspaceId: null,
      actor: { kind: 'agent', id: null },
      aggregate: { version: null },
    });
  });
});

describe('backoffSeconds', () => {
  // prettier-ignore
  it.each([[1, 2], [2, 4], [3, 8], [4, 16], [5, 32], [6, 60], [7, 60], [30, 60], [0, 2]])('after attempt %i waits %i seconds', (attempts, seconds) => {
    expect(backoffSeconds(attempts)).toBe(seconds);
  });
});
