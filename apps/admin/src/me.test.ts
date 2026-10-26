import { describe, expect, it } from 'vitest';

import { readMe, roleOf, type Me } from './me';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const me: Me = {
  id: 'u1',
  name: 'Hà Linh',
  isPlatformOperator: false,
  org: { id: 'o1', name: 'Gani Foods', role: 'sales' },
  workspaces: [{ id: 'w1', name: 'B2B', contactPhone: null }],
};

describe('readMe', () => {
  it('returns the person on 200', async () => {
    expect(await readMe(json(200, me))).toEqual({ kind: 'ok', me });
  });

  it('treats a body of another shape as an error, not as a person', async () => {
    expect(await readMe(json(200, { ...me, org: { ...me.org, role: 'root' } }))).toEqual({
      kind: 'error',
      status: 502,
      traceId: null,
    });
    expect(await readMe(new Response('not json', { status: 200 }))).toEqual({
      kind: 'error',
      status: 502,
      traceId: null,
    });
  });

  it('sends a person without a session to sign in', async () => {
    expect(await readMe(json(401, { code: 'unauthorized' }))).toEqual({ kind: 'signed_out' });
  });

  it('sends a person who must set up 2FA to set it up (N93)', async () => {
    expect(await readMe(json(403, { code: 'two_factor_setup_required', traceId: 't' }))).toEqual({
      kind: 'two_factor_setup',
    });
  });

  it('keeps the traceId of any other error for the error page', async () => {
    expect(await readMe(json(404, { code: 'not_found', traceId: 't-404' }))).toEqual({
      kind: 'error',
      status: 404,
      traceId: 't-404',
    });
    expect(await readMe(json(500, null))).toEqual({ kind: 'error', status: 500, traceId: null });
  });
});

describe('roleOf', () => {
  it('reads the role in the company, and platform_operator before it', () => {
    expect(roleOf(me)).toBe('sales');
    expect(roleOf({ ...me, isPlatformOperator: true })).toBe('platform_operator');
    expect(roleOf({ ...me, org: null })).toBeNull();
  });
});
