import { randomBytes } from 'node:crypto';

import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildAuthOptions } from './auth.config.js';
import { loadAuthEnv } from './auth.env.js';
import { revokingAdapter } from './revoking-adapter.js';

// Review C-01 (N112): what the rate limiter of sign-in does with the address of the caller TODAY. Every case below pins a behaviour
// that CHANGES when N112 (the deployment topology: which proxy stands in front of the API, which header it sets) is decided; a red
// case here after that decision is the test to rewrite, not a bug of the library. The limit is 10 sign-ins per 60 seconds per address
// (auth.config.ts). The library falls back to 127.0.0.1 outside production, which hides all of this, so the file runs as production.
// The library reads NODE_ENV once, when it is loaded, and vitest sets TEST=true as well: both are set before the first import (a
// `vi.resetModules` would not reload it, it is an external package). The first case checks the premise.
const saved = vi.hoisted(() => {
  const before = { node: process.env['NODE_ENV'], test: process.env['TEST'] };
  process.env['NODE_ENV'] = 'production';
  process.env['TEST'] = 'false';
  return before;
});
const URL_BASE = 'https://app.example.test';
const LIMIT = 10;
const ATTEMPTS = LIMIT + 2;
const EMAIL = 'nobody@example.test';
const WRONG = randomBytes(18).toString('base64url');
const BASE = Date.now();
let epoch = 0;

const makeAuth = () => {
  const env = loadAuthEnv({
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    BETTER_AUTH_URL: URL_BASE,
  });
  const db = { user: [], session: [], account: [], verification: [], twoFactor: [] };
  return betterAuth(buildAuthOptions(env, revokingAdapter(memoryAdapter(db))));
};
const auth = makeAuth();
/** One wrong sign-in; the status says whether the limiter answered (429) or the sign-in did (401). */
const hit = async (headers: Record<string, string> = {}): Promise<number> =>
  (
    await auth.handler(
      new Request(`${URL_BASE}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: URL_BASE, ...headers },
        body: JSON.stringify({ email: EMAIL, password: WRONG }),
      }),
    )
  ).status;
const run = async (headers: (i: number) => Record<string, string>) => {
  const out: number[] = [];
  for (let i = 0; i < ATTEMPTS; i++) out.push(await hit(headers(i)));
  return out;
};

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
});
// The counters live in the process, not in the instance: every case starts ten minutes later, outside the 60 second window.
beforeEach(() => {
  epoch += 10 * 60_000;
  vi.setSystemTime(new Date(BASE + epoch));
});
afterAll(() => {
  vi.useRealTimers();
  const back = (name: string, value: string | undefined) =>
    value === undefined ? delete process.env[name] : (process.env[name] = value);
  back('NODE_ENV', saved.node);
  back('TEST', saved.test);
});

describe('the address of the caller for the sign-in limiter (changes when N112 is decided)', () => {
  it('shares ONE bucket among everyone who sends no address header, and keeps it apart from 127.0.0.1', async () => {
    const first = await run(() => ({}));
    expect(first).toEqual([...Array<number>(LIMIT).fill(401), 429, 429]);
    // Another caller, no header either: the same bucket, already full.
    expect(await hit({ 'user-agent': 'someone-else' })).toBe(429);
    // The premise of the file: production has its own bucket for "no address", it is not the address 127.0.0.1.
    expect(await hit({ 'x-forwarded-for': '127.0.0.1' })).toBe(401);
  });

  it('takes a single value as it comes: a caller that changes it on every request is never limited', async () => {
    const statuses = await run((i) => ({ 'x-forwarded-for': `203.0.113.${i + 1}` }));
    expect(statuses).toEqual(Array<number>(ATTEMPTS).fill(401));
  });

  it('shares ONE bucket among everyone whose header is a chain "a, b", and a single value stays outside it', async () => {
    const first = await run(() => ({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }));
    expect(first).toEqual([...Array<number>(LIMIT).fill(401), 429, 429]);
    // Another caller, another chain: the same bucket, already full.
    expect(await hit({ 'x-forwarded-for': '198.51.100.5, 10.0.0.2' })).toBe(429);
    // A caller with a single address has a bucket of its own.
    expect(await hit({ 'x-forwarded-for': '203.0.113.99' })).toBe(401);
  });

  it('limits one address by itself: the same single value reaches the limit', async () => {
    const statuses = await run(() => ({ 'x-forwarded-for': '203.0.113.200' }));
    expect(statuses).toEqual([...Array<number>(LIMIT).fill(401), 429, 429]);
  });
});
