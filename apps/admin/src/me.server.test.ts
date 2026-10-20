import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ toString: () => 'session=abc' }),
}));

const { getMe } = await import('./me.server');

afterEach(() => vi.unstubAllGlobals());

describe('getMe', () => {
  it('asks the API with the cookie of the request and never caches the answer', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response('{}', { status: 401 })));
    vi.stubGlobal('fetch', fetch);
    expect(await getMe()).toEqual({ kind: 'signed_out' });
    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/v1/me', {
      headers: { cookie: 'session=abc' },
      cache: 'no-store',
    });
  });

  it('shows the error page when the API cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
    );
    expect(await getMe()).toEqual({ kind: 'error', status: 503, traceId: null });
  });
});
