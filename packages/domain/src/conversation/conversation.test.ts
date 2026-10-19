import { describe, expect, it } from 'vitest';

import { InvalidSnapshotError, InvalidTransitionError } from './errors.js';
import { INITIAL_SNAPSHOT, REOPEN_WINDOW_MS, snapshotViolations } from './snapshot.js';
import { CONVERSATION_OUTCOMES, CONVERSATION_STATES, type ConversationSnapshot } from './types.js';

const closed: ConversationSnapshot = {
  state: 'CLOSED',
  afterHoursHold: false,
  assignedUserId: null,
  closedAt: new Date('2026-10-01T00:00:00Z'),
  outcome: 'resolved',
};

describe('the vocabulary matches the database', () => {
  // The same lists as the CHECKs of migrations 202610031830 and 202610191300 (N130).
  it('has the five states and the four outcomes', () => {
    expect(CONVERSATION_STATES).toEqual([
      'BOT_ACTIVE',
      'HUMAN_WAITING_Q',
      'HUMAN_ACTIVE',
      'PENDING_CUSTOMER',
      'CLOSED',
    ]);
    expect(CONVERSATION_OUTCOMES).toEqual(['resolved', 'no_response', 'spam', 'resolved_by_bot']);
  });

  it('reopens within 72 hours (F5)', () => {
    expect(REOPEN_WINDOW_MS).toBe(72 * 3600 * 1000);
  });
});

describe('snapshotViolations mirrors the CHECKs of the conversations table', () => {
  it('accepts the initial snapshot and a closed one', () => {
    expect(snapshotViolations(INITIAL_SNAPSHOT)).toEqual([]);
    expect(snapshotViolations(closed)).toEqual([]);
  });

  it.each<[string, Partial<ConversationSnapshot>, number]>([
    ['a hold outside BOT_ACTIVE', { state: 'HUMAN_WAITING_Q', afterHoursHold: true }, 1],
    ['HUMAN_ACTIVE with nobody assigned', { state: 'HUMAN_ACTIVE' }, 1],
    ['a person assigned to BOT_ACTIVE', { assignedUserId: 'u' }, 1],
    ['CLOSED without closed_at and outcome', { state: 'CLOSED' }, 2],
    [
      'closed_at and outcome on an open conversation',
      { closedAt: new Date(0), outcome: 'resolved' },
      2,
    ],
    ['a person assigned to CLOSED', { ...closed, assignedUserId: 'u' }, 1],
  ])('finds %s', (_name, over, count) => {
    expect(snapshotViolations({ ...INITIAL_SNAPSHOT, ...over })).toHaveLength(count);
  });
});

describe('the errors', () => {
  it('InvalidTransitionError carries the code and the reason, and names no user', () => {
    const error = new InvalidTransitionError('HUMAN_WAITING_Q', 'claim', 'guard_failed');
    expect(error).toMatchObject({
      code: 'invalid_transition',
      from: 'HUMAN_WAITING_Q',
      reason: 'guard_failed',
    });
    expect(error.message).toBe('event claim is not allowed from HUMAN_WAITING_Q (guard_failed)');
    expect(new InvalidTransitionError(null, 'claim', 'not_in_table').message).toContain(
      'no conversation',
    );
  });

  it('InvalidSnapshotError lists what is broken', () => {
    const error = new InvalidSnapshotError(['a', 'b']);
    expect(error.violations).toEqual(['a', 'b']);
    expect(error.message).toContain('a; b');
  });
});
