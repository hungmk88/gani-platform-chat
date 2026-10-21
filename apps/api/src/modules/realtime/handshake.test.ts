import type { IncomingMessage } from 'node:http';

import type { MemberContext } from '@gani/db';
import { describe, expect, it, vi } from 'vitest';

import {
  createAgentHandshake,
  HandshakeRefusedError,
  type AgentContext,
  type HandshakeDeps,
} from './handshake.js';
import { roomsFor } from './rooms.js';

const ORIGIN = 'https://app.example';
const session = { userId: 'u1', sessionId: 's1', activeOrgId: 'o1', resolvedAt: new Date(0) };
const member: MemberContext = { role: 'sales', workspaceIds: ['w1'] };

// Every dependency is a fake; the order of the calls is recorded, so the test sees that a refused step stops the next ones.
function setup(over: Partial<HandshakeDeps> = {}) {
  const calls: string[] = [];
  const warnings: string[] = [];
  const deps: HandshakeDeps = {
    origin: ORIGIN,
    sessions: { resolve: vi.fn(() => (calls.push('session'), Promise.resolve(session))) },
    mustSetUp: vi.fn(() => (calls.push('2fa'), Promise.resolve(false))),
    organisations: vi.fn(() => (calls.push('orgs'), Promise.resolve(['o1']))),
    member: vi.fn(() => (calls.push('member'), Promise.resolve(member))),
    connections: vi.fn(() => (calls.push('count'), Promise.resolve(0))),
    maxPerUser: 5,
    log: { warn: (line: string) => void warnings.push(line) },
    now: () => 42,
    ...over,
  };
  const run = async (origin: string | null = ORIGIN, query = {}) => {
    const socket = {
      id: 'sock',
      request: {
        headers: { origin: origin ?? undefined, cookie: 'c' },
      } as unknown as IncomingMessage,
      handshake: { auth: { orgId: 'evil' }, query },
      data: {} as { ctx?: AgentContext },
    };
    const error = await new Promise<Error | undefined>((resolve) =>
      createAgentHandshake(deps)(socket, resolve),
    );
    return { error, ctx: socket.data.ctx };
  };
  return { deps, run, calls, warnings };
}

const codeOf = (error: Error | undefined) =>
  (error as HandshakeRefusedError | undefined)?.data.code;

describe('the handshake of /agent', () => {
  it('lets a member in with the context the server decided, whatever the client sends', async () => {
    const t = setup();
    const { error, ctx } = await t.run(ORIGIN, { orgId: 'evil', workspaceIds: 'w9' });
    expect(error).toBeUndefined();
    expect(ctx).toMatchObject({
      userId: 'u1',
      orgId: 'o1',
      role: 'sales',
      workspaceIds: ['w1'],
      sessionId: 's1',
      checkedAt: 42,
    });
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(t.calls).toEqual(['session', '2fa', 'member', 'count']);
  });

  it.each([
    ['another origin', { origin: 'https://evil.example' }, 'forbidden_origin', []],
    ['no origin', { origin: null }, 'forbidden_origin', []],
    ['no session', { session: null }, 'unauthorized', ['session']],
    ['2FA to set up', { twoFactor: true }, 'two_factor_setup_required', ['session', '2fa']],
    ['no organisation', { orgs: [], active: null }, 'no_organisation', ['session', '2fa', 'orgs']],
    [
      'two organisations, none chosen',
      { orgs: ['o1', 'o2'], active: null },
      'org_not_selected',
      ['session', '2fa', 'orgs'],
    ],
    ['five sockets already', { count: 5 }, 'rate_limited', ['session', '2fa', 'member', 'count']],
  ] as const)('refuses %s with %s and stops there', async (_name, o, code, calls) => {
    const t = setup({
      sessions: {
        resolve: () => (
          t.calls.push('session'),
          Promise.resolve('session' in o ? o.session : session)
        ),
      },
      mustSetUp: () => (t.calls.push('2fa'), Promise.resolve('twoFactor' in o)),
      organisations: () => (
        t.calls.push('orgs'),
        Promise.resolve('orgs' in o ? [...o.orgs] : ['o1'])
      ),
      connections: () => (t.calls.push('count'), Promise.resolve('count' in o ? o.count : 0)),
    });
    if ('active' in o)
      t.deps.sessions.resolve = () => (
        t.calls.push('session'),
        Promise.resolve({ ...session, activeOrgId: null })
      );
    const { error, ctx } = await t.run('origin' in o ? o.origin : ORIGIN);
    expect(error).toBeInstanceOf(HandshakeRefusedError);
    expect(codeOf(error)).toBe(code);
    expect((error as HandshakeRefusedError).data.traceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(ctx).toBeUndefined();
    expect(t.calls).toEqual(calls);
  });

  it('answers a database that fails as unavailable, with its code in the log and not in the answer', async () => {
    const boom = Object.assign(new Error('password authentication failed for user x'), {
      code: '28P01',
    });
    const t = setup({ member: () => Promise.reject(boom) });
    const { error } = await t.run();
    expect(codeOf(error)).toBe('service_unavailable');
    expect(error?.message).toBe('service_unavailable');
    expect(t.warnings.join()).toContain('28P01');
    expect(t.warnings.join()).not.toContain('password');
  });
});

describe('roomsFor', () => {
  const ctx = { orgId: 'o1', userId: 'u1', workspaceIds: ['w1', 'w2'] };
  it('puts a reader in its organisation, its own room and each of its workspaces', () => {
    for (const role of ['owner', 'admin', 'manager', 'sales', 'support'] as const)
      expect(roomsFor({ ...ctx, role })).toEqual(['org:o1', 'user:u1', 'ws:w1', 'ws:w2']);
  });

  it('keeps a role that may not read conversations out of the rooms of the workspaces (N142)', () => {
    for (const role of ['marketing', 'viewer'] as const)
      expect(roomsFor({ ...ctx, role })).toEqual(['org:o1', 'user:u1']);
  });
});
