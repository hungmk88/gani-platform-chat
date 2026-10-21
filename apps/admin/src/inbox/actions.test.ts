import { describe, expect, it } from 'vitest';

import { actionsFor, bodyOf } from './actions';

const c = (state: string, assignedUserId: string | null, afterHoursHold = false) =>
  ({ state, assignedUserId, afterHoursHold }) as Parameters<typeof actionsFor>[0];

describe('actionsFor', () => {
  it('offers to claim from the queue and from the out-of-hours hold, to anyone who reads conversations', () => {
    expect(actionsFor(c('HUMAN_WAITING_Q', null), 'sales', 'u1')).toEqual(['claim']);
    expect(actionsFor(c('BOT_ACTIVE', null, true), 'support', 'u1')).toEqual(['claim']);
    expect(actionsFor(c('BOT_ACTIVE', null), 'manager', 'u1')).toEqual([]);
  });

  it('lets sales and support act only on their own, and managers up on any', () => {
    expect(actionsFor(c('HUMAN_ACTIVE', 'u1'), 'sales', 'u1')).toEqual(['wait_customer', 'close']);
    expect(actionsFor(c('HUMAN_ACTIVE', 'u2'), 'sales', 'u1')).toEqual([]);
    expect(actionsFor(c('HUMAN_ACTIVE', 'u2'), 'manager', 'u1')).toEqual([
      'wait_customer',
      'close',
    ]);
    expect(actionsFor(c('PENDING_CUSTOMER', 'u1'), 'support', 'u1')).toEqual(['close']);
  });

  it('offers nothing on a closed conversation, nor to a role without the Inbox', () => {
    expect(actionsFor(c('CLOSED', 'u1'), 'owner', 'u1')).toEqual([]);
    expect(actionsFor(c('HUMAN_WAITING_Q', null), 'viewer', 'u1')).toEqual([]);
  });
});

describe('bodyOf', () => {
  it('sends the version read, and the outcome to close; nothing to claim', () => {
    expect(bodyOf('claim', 3)).toBeUndefined();
    expect(bodyOf('wait_customer', 3)).toEqual({ version: 3 });
    expect(bodyOf('close', 3, 'spam')).toEqual({ version: 3, outcome: 'spam' });
  });
});
