import type { IncomingMessage } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';

import { describe, expect, it, vi } from 'vitest';

import { SessionResolver, type SessionSource } from './session-resolver.js';

const req = (cookie = 'a=1') => ({ headers: { cookie } }) as unknown as IncomingMessage;

function source(
  answer: unknown = { session: { id: 's1', activeOrgId: 'o1' }, user: { id: 'u1' } },
) {
  const getSession = vi.fn<SessionSource['api']['getSession']>(async () => {
    await sleep(2);
    return answer as never;
  });
  return { api: { getSession } };
}

describe('SessionResolver', () => {
  it('asks once when two layers of the same request ask', async () => {
    const src = source();
    const resolver = new SessionResolver(src);
    const request = req();
    const first = await resolver.resolve(request);
    const second = await resolver.resolve(request);
    expect(src.api.getSession).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(first).toMatchObject({ userId: 'u1', sessionId: 's1', activeOrgId: 'o1' });
    expect(first?.resolvedAt).toBeInstanceOf(Date);
  });

  it('shares one lookup between callers that ask at the same moment', async () => {
    const src = source();
    const resolver = new SessionResolver(src);
    const request = req();
    const results = await Promise.all([resolver.resolve(request), resolver.resolve(request)]);
    expect(src.api.getSession).toHaveBeenCalledTimes(1);
    expect(results[0]).toBe(results[1]);
  });

  it('never shares an answer between two requests, even with the same cookie', async () => {
    const src = source();
    const resolver = new SessionResolver(src);
    await resolver.resolve(req('same'));
    await resolver.resolve(req('same'));
    expect(src.api.getSession).toHaveBeenCalledTimes(2);
  });

  it('passes the cookie of the request on to Better Auth', async () => {
    const src = source();
    await new SessionResolver(src).resolve(req('session_token=abc'));
    expect(src.api.getSession.mock.calls[0]?.[0].headers.get('cookie')).toBe('session_token=abc');
  });

  it('answers null without a session, and an organisation that is not a string becomes null', async () => {
    expect(await new SessionResolver(source(null)).resolve(req())).toBeNull();
    const noOrg = source({ session: { id: 's1', activeOrgId: null }, user: { id: 'u1' } });
    expect((await new SessionResolver(noOrg).resolve(req()))?.activeOrgId).toBeNull();
  });

  it('does not remember a failed lookup: the next ask tries again', async () => {
    const getSession = vi
      .fn<SessionSource['api']['getSession']>()
      .mockRejectedValueOnce(new Error('database down'))
      .mockResolvedValueOnce({ session: { id: 's1' }, user: { id: 'u1' } });
    const resolver = new SessionResolver({ api: { getSession } });
    const request = req();
    await expect(resolver.resolve(request)).rejects.toThrow('database down');
    await expect(resolver.resolve(request)).resolves.toMatchObject({ userId: 'u1' });
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it('looks again past the cache when asked for a fresh answer, and the cache still answers the other callers', async () => {
    const src = source();
    const resolver = new SessionResolver(src);
    const request = req();
    const cached = await resolver.resolve(request);
    src.api.getSession.mockResolvedValueOnce(null);
    expect(await resolver.resolveFresh(request)).toBeNull();
    expect(await resolver.resolve(request)).toBe(cached);
    expect(src.api.getSession).toHaveBeenCalledTimes(2);
  });
});
