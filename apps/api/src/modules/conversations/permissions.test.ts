import type { OrgRole } from '@gani/db';
import { describe, expect, it } from 'vitest';

import { actionScope, canSee, mayAct, readScope, type ConversationAction } from './permissions.js';

const ME = '0190a000-0000-7000-8000-000000000001';
const OTHER = '0190a000-0000-7000-8000-000000000002';
const ROLES: OrgRole[] = ['owner', 'admin', 'manager', 'sales', 'support', 'marketing', 'viewer'];

describe('who sees which conversations (Phụ lục B rows 11–12, N133)', () => {
  it('gives each of the seven roles its scope', () => {
    expect(Object.fromEntries(ROLES.map((r) => [r, readScope(r)]))).toEqual({
      owner: 'workspace',
      admin: 'workspace',
      manager: 'workspace',
      sales: 'mine_or_unassigned',
      support: 'mine_or_unassigned',
      marketing: 'none',
      viewer: 'none',
    });
  });

  it('lets sales and support see their own and the unclaimed, a manager everything, marketing nothing', () => {
    const [mine, theirs, free] = [
      { assignedUserId: ME },
      { assignedUserId: OTHER },
      { assignedUserId: null },
    ];
    expect([mine, theirs, free].map((c) => canSee('sales', ME, c))).toEqual([true, false, true]);
    expect([mine, theirs, free].map((c) => canSee('support', ME, c))).toEqual([true, false, true]);
    expect([mine, theirs, free].map((c) => canSee('manager', ME, c))).toEqual([true, true, true]);
    expect([mine, theirs, free].map((c) => canSee('marketing', ME, c))).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe('who may act on a conversation (Phụ lục B rows 13–17)', () => {
  it('gives each of the seven roles its scope for the six actions', () => {
    const actions: ConversationAction[] = [
      'claim',
      'wait_customer',
      'transfer',
      'assign',
      'close',
      'send_message',
    ];
    const row = (role: OrgRole) => actions.map((a) => actionScope(role, a)).join(' ');
    expect(Object.fromEntries(ROLES.map((r) => [r, row(r)]))).toEqual({
      owner: 'any any any any any any',
      admin: 'any any any any any any',
      manager: 'any any any any any any',
      sales: 'any own own none own own',
      support: 'any own own none own own',
      marketing: 'none none none none none none',
      viewer: 'none none none none none none',
    });
  });

  it('lets sales close only what they hold, a manager anything, and nobody assign below manager', () => {
    const on = (role: OrgRole, action: ConversationAction) =>
      [ME, OTHER, null]
        .map((assignedUserId) => mayAct(role, ME, action, { assignedUserId }))
        .join(' ');
    expect(on('sales', 'close')).toBe('true false false');
    expect(on('manager', 'close')).toBe('true true true');
    expect(on('support', 'claim')).toBe('true true true');
    expect(on('sales', 'assign')).toBe('false false false');
    expect(on('viewer', 'claim')).toBe('false false false');
    expect(on('support', 'send_message')).toBe('true false false');
    expect(on('admin', 'send_message')).toBe('true true true');
  });
});
