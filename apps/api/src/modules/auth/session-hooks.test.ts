import { describe, expect, it } from 'vitest';

import { MAX_SESSION_MS, sessionCreateBefore } from './session-hooks.js';

const START = new Date('2026-10-05T10:00:00Z');
const hours = (n: number) => new Date(START.getTime() + n * 3_600_000);
const NOW = Date.UTC(2026, 9, 5, 9, 0, 0);

const run = async (session: Record<string, unknown>) =>
  (await sessionCreateBefore(() => NOW)(session)).data;

describe('sessionCreateBefore', () => {
  it('blanks the address and the user agent and keeps every other field', async () => {
    const data = await run({
      token: 't',
      userId: 'u',
      createdAt: START,
      expiresAt: hours(1),
      ipAddress: '127.0.0.1',
      userAgent: 'Mozilla/5.0',
    });
    expect(data).toMatchObject({ token: 't', userId: 'u', ipAddress: '', userAgent: '' });
  });

  it('cuts a 24 hour lifetime to 12 hours counted from createdAt, and leaves a shorter one alone', async () => {
    expect((await run({ createdAt: START, expiresAt: hours(24) }))['expiresAt']).toEqual(hours(12));
    expect((await run({ createdAt: START, expiresAt: hours(6) }))['expiresAt']).toEqual(hours(6));
    expect(MAX_SESSION_MS).toBe(12 * 3_600_000);
  });

  it('counts from the clock when the session has no createdAt, and gives the maximum when it has no expiresAt', async () => {
    expect((await run({ expiresAt: new Date(NOW + 24 * 3_600_000) }))['expiresAt']).toEqual(
      new Date(NOW + MAX_SESSION_MS),
    );
    expect((await run({ createdAt: START }))['expiresAt']).toEqual(hours(12));
  });
});
