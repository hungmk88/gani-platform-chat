import type { ConversationRow, NewOutboxEvent, TenantTx } from '@gani/db';
import { DEFAULT_WORKING_WEEK } from '@gani/domain';
import { describe, expect, it } from 'vitest';

import { ConversationNotFoundError } from './errors.js';
import { SlaClock, type SlaClockStore } from './sla-clock.js';

// The SLA clock of the opening hours (E4b, N211) against a fake store; the rule itself is tested in @gani/domain (slaAtHours).
// 2026-11-03 is a Tuesday in Hồ Chí Minh City (UTC+7), Q7 hours 08:00–17:30, break 12:00–13:00.
const TX = {} as TenantTx;
const ID = 'c-1';
const hcm = (local: string) => new Date(`${local}+07:00`);
// prettier-ignore
const row = (over: Partial<ConversationRow> = {}): ConversationRow => ({
  id: ID, orgId: 'org', workspaceId: 'w-1', state: 'HUMAN_WAITING_Q', version: 4, assignedUserId: null, afterHoursHold: false, closedAt: null, outcome: null, slaDueAt: hcm('2026-11-04T08:20:00'), slaPausedReason: null, slaRemainingSeconds: null, ...over,
});

function fake(initial: ConversationRow | null, hours = true) {
  const calls: string[] = [];
  const outbox: NewOutboxEvent[] = [];
  let current = initial;
  const store: SlaClockStore = {
    lockConversation: (_tx, id) => (calls.push(`lock ${id}`), Promise.resolve()),
    loadConversation: () => (calls.push('load'), Promise.resolve(current)),
    readWorkingWeek: () =>
      Promise.resolve(
        hours
          ? { timezone: 'Asia/Ho_Chi_Minh', week: DEFAULT_WORKING_WEEK, isDefault: true }
          : null,
      ),
    listDaysOff: () => Promise.resolve([]),
    setConversationSla: (_tx, _id, sla) => {
      calls.push('set');
      if (current)
        current = {
          ...current,
          slaDueAt: sla?.dueAt ?? null,
          slaPausedReason: sla?.pausedReason ?? null,
          slaRemainingSeconds: sla?.remainingSeconds ?? null,
        };
      return Promise.resolve();
    },
    insertOutboxEvent: (_tx, e) => (outbox.push(e), Promise.resolve()),
  };
  return { clock: new SlaClock(store), calls, outbox, now: () => current };
}

describe('SlaClock.atHours', () => {
  it('locks the conversation before it reads it, pauses at 17:30 and tells the Inbox by one row, as the system', async () => {
    const f = fake(row());
    expect(await f.clock.atHours(TX, ID, hcm('2026-11-03T17:30:00'), 'trace-1')).toBe(true);
    expect(f.calls).toEqual([`lock ${ID}`, 'load', 'set']);
    expect(f.now()).toMatchObject({
      slaPausedReason: 'outside_hours',
      slaRemainingSeconds: 1200,
      version: 4,
      state: 'HUMAN_WAITING_Q',
    });
    expect(f.outbox).toMatchObject([
      {
        eventType: 'conversation.sla_changed',
        aggregateId: ID,
        aggregateVersion: 4,
        workspaceId: 'w-1',
        actorKind: 'system',
        traceId: 'trace-1',
        payload: { conversationId: ID },
      },
    ]);
  });

  it('runs it again at 08:00 and writes one row more', async () => {
    const f = fake(row({ slaPausedReason: 'outside_hours', slaRemainingSeconds: 1200 }));
    expect(await f.clock.atHours(TX, ID, hcm('2026-11-04T08:00:00'), 't')).toBe(true);
    expect(f.now()).toMatchObject({
      slaDueAt: hcm('2026-11-04T08:20:00'),
      slaPausedReason: null,
      slaRemainingSeconds: null,
    });
    expect(f.outbox).toHaveLength(1);
  });

  it('writes nothing while the hours do not move it, for the customer’s pause, with no SLA, or with no conversation', async () => {
    for (const [r, at] of [
      [row(), '2026-11-03T10:00:00'],
      [row({ slaPausedReason: 'outside_hours', slaRemainingSeconds: 1200 }), '2026-11-03T20:00:00'],
      [
        row({ slaPausedReason: 'waiting_customer', slaRemainingSeconds: 600 }),
        '2026-11-03T20:00:00',
      ],
      [row({ slaDueAt: null }), '2026-11-03T20:00:00'],
      [null, '2026-11-03T20:00:00'],
    ] as const) {
      const f = fake(r);
      expect(await f.clock.atHours(TX, ID, hcm(at), 't')).toBe(false);
      expect(f.calls).not.toContain('set');
      expect(f.outbox).toEqual([]);
    }
  });

  it('fails when the workspace of the conversation cannot be read', async () => {
    await expect(
      fake(row(), false).clock.atHours(TX, ID, hcm('2026-11-03T17:30:00'), 't'),
    ).rejects.toThrow(ConversationNotFoundError);
  });
});
