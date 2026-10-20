import type { IncomingMessage, ServerResponse } from 'node:http';

import { describe, expect, it, vi } from 'vitest';

import { createSameOriginCheck, sameOriginAllowed } from './same-origin.js';

const APP = 'https://app.example.test';
const req = (method: string, headers: IncomingMessage['headers']) => ({ method, headers });
const cookie = 'session=x';

describe('sameOriginAllowed (P17, N136)', () => {
  it('lets a change through only from the application origin when the session cookie is sent', () => {
    expect(sameOriginAllowed(req('POST', { cookie, origin: APP }), APP)).toBe(true);
    for (const origin of [
      'https://evil.example.test',
      'null',
      `${APP}.evil.test`,
      'http://app.example.test',
    ])
      expect(sameOriginAllowed(req('POST', { cookie, origin }), APP), origin).toBe(false);
    for (const method of ['PUT', 'PATCH', 'DELETE'])
      expect(
        sameOriginAllowed(req(method, { cookie, origin: 'https://evil.example.test' }), APP),
      ).toBe(false);
  });

  it('falls back on Sec-Fetch-Site without Origin, and refuses a change that says neither', () => {
    expect(sameOriginAllowed(req('POST', { cookie, 'sec-fetch-site': 'same-origin' }), APP)).toBe(
      true,
    );
    expect(sameOriginAllowed(req('POST', { cookie, 'sec-fetch-site': 'same-site' }), APP)).toBe(
      false,
    );
    expect(sameOriginAllowed(req('POST', { cookie, 'sec-fetch-site': 'cross-site' }), APP)).toBe(
      false,
    );
    expect(sameOriginAllowed(req('POST', { cookie }), APP)).toBe(false);
  });

  it('does not check a read, nor a request without a cookie', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS'])
      expect(
        sameOriginAllowed(req(method, { cookie, origin: 'https://evil.example.test' }), APP),
      ).toBe(true);
    expect(sameOriginAllowed(req('POST', { origin: 'https://evil.example.test' }), APP)).toBe(true);
  });
});

describe('createSameOriginCheck', () => {
  it('answers 403 forbidden as problem+json without repeating the origin, or calls next', () => {
    const check = createSameOriginCheck(APP);
    const next = vi.fn();
    const res = { setHeader: vi.fn(), end: vi.fn(), statusCode: 200 };
    check(
      req('POST', { cookie, origin: 'https://evil.example.test' }) as IncomingMessage,
      res as unknown as ServerResponse,
      next,
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.setHeader).toHaveBeenCalledWith('content-type', 'application/problem+json');
    const body = String(res.end.mock.calls[0]?.[0]);
    expect(JSON.parse(body)).toMatchObject({ status: 403, code: 'forbidden' });
    expect(body).not.toContain('evil');
    check(
      req('POST', { cookie, origin: APP }) as IncomingMessage,
      res as unknown as ServerResponse,
      next,
    );
    expect(next).toHaveBeenCalledOnce();
  });
});
