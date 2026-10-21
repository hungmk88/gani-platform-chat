import { describe, expect, it } from 'vitest';

import { redirectFor, scopeId, scopeKey } from './keys';

describe('scopeKey', () => {
  it('starts every key with the company and the workspace', () => {
    expect(
      scopeKey({ orgId: 'o1', workspaceId: 'w1' }, 'conversations', { state: 'open' }),
    ).toEqual(['org', 'o1', 'ws', 'w1', 'conversations', { state: 'open' }]);
  });

  it('keeps two workspaces of one company apart, and a platform operator outside any', () => {
    const a = scopeKey({ orgId: 'o1', workspaceId: 'w1' }, 'x');
    const b = scopeKey({ orgId: 'o1', workspaceId: 'w2' }, 'x');
    expect(a).not.toEqual(b);
    expect(scopeKey({ orgId: null, workspaceId: null })).toEqual(['org', '-', 'ws', '-']);
    expect(scopeId({ orgId: 'o1', workspaceId: null })).toBe('o1:-');
  });
});

describe('redirectFor', () => {
  it.each([
    ['sign_in', '/login'],
    ['set_up_2fa', '/two-factor/setup'],
    ['reload', null],
    ['show', null],
  ] as const)('%s → %s', (action, to) => {
    expect(redirectFor({ action })).toBe(to);
  });
});
