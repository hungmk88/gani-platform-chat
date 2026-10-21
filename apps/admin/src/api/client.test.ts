import { describe, expect, it, vi } from 'vitest';

import { api, MAX_WAIT_SECONDS, type ApiDeps } from './client';
import { NETWORK_ERROR } from './errors';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

function deps(...answers: (Response | Error)[]) {
  const fetch = vi.fn<typeof globalThis.fetch>(() => {
    const next = answers.shift();
    return next instanceof Error || !next
      ? Promise.reject(next ?? new Error('no more'))
      : Promise.resolve(next);
  });
  const sleep = vi.fn(() => Promise.resolve());
  let n = 0;
  const d: ApiDeps = { fetch, sleep, newKey: () => `key-${++n}` };
  const init = (call = 0) =>
    fetch.mock.calls[call]?.[1] as RequestInit & { headers: Record<string, string> };
  return { d, fetch, sleep, init };
}

describe('api', () => {
  it('GETs on the same origin with the cookie and no Idempotency-Key', async () => {
    const { d, fetch, init } = deps(json(200, { items: [] }));
    await expect(api('/v1/conversations', {}, d)).resolves.toEqual({
      ok: true,
      data: { items: [] },
    });
    expect(fetch.mock.calls[0]?.[0]).toBe('/v1/conversations');
    expect(init()).toMatchObject({ method: 'GET', credentials: 'same-origin', cache: 'no-store' });
    expect(init().headers['idempotency-key']).toBeUndefined();
  });

  it('gives every POST an Idempotency-Key, the one of the action when given', async () => {
    const { d, init } = deps(json(200, {}), json(200, {}));
    await api('/v1/conversations/c/claim', { method: 'POST', body: { version: 1 } }, d);
    await api('/v1/conversations/c/close', { method: 'POST', body: {}, idempotencyKey: 'mine' }, d);
    expect(init(0).headers).toMatchObject({
      'idempotency-key': 'key-1',
      'content-type': 'application/json',
    });
    expect(init(0).body).toBe('{"version":1}');
    expect(init(1).headers['idempotency-key']).toBe('mine');
  });

  it('answers the P9 error of a refusal', async () => {
    const { d } = deps(json(409, { code: 'version_conflict', traceId: 't' }));
    const r = await api('/v1/x', { method: 'POST' }, d);
    expect(r).toMatchObject({ ok: false, error: { code: 'version_conflict', action: 'reload' } });
  });

  it('tries a wait error again once after Retry-After, with the same key', async () => {
    const { d, sleep, init } = deps(
      json(429, { code: 'rate_limited' }, { 'retry-after': '2' }),
      json(200, { done: true }),
    );
    await expect(api('/v1/x', { method: 'POST' }, d)).resolves.toEqual({
      ok: true,
      data: { done: true },
    });
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(init(1).headers['idempotency-key']).toBe(init(0).headers['idempotency-key']);
  });

  it('does not try again a second time, nor past the longest wait, nor a show error', async () => {
    const twice = deps(
      json(409, { code: 'idempotency_in_progress' }),
      json(409, { code: 'idempotency_in_progress' }),
    );
    expect((await api('/v1/x', { method: 'POST' }, twice.d)).ok).toBe(false);
    expect(twice.fetch).toHaveBeenCalledTimes(2);
    expect(twice.sleep).toHaveBeenCalledWith(1000);

    const long = deps(
      json(429, { code: 'rate_limited' }, { 'retry-after': String(MAX_WAIT_SECONDS + 1) }),
    );
    expect((await api('/v1/x', {}, long.d)).ok).toBe(false);
    expect(long.sleep).not.toHaveBeenCalled();

    const internal = deps(json(500, { code: 'internal_error' }));
    expect((await api('/v1/x', { method: 'POST' }, internal.d)).ok).toBe(false);
    expect(internal.fetch).toHaveBeenCalledTimes(1);
  });

  it('answers no connection, 204 and a body that is not JSON', async () => {
    await expect(api('/v1/x', {}, deps(new Error('offline')).d)).resolves.toEqual({
      ok: false,
      error: NETWORK_ERROR,
    });
    await expect(api('/v1/x', {}, deps(new Response(null, { status: 204 })).d)).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    await expect(
      api('/v1/x', {}, deps(new Response('<html>', { status: 200 })).d),
    ).resolves.toMatchObject({
      ok: false,
      error: { status: 502, code: 'internal_error' },
    });
  });
});
