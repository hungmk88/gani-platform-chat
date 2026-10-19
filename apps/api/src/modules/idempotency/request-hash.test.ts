import { describe, expect, it } from 'vitest';

import { canonicalJson, requestHash } from './request-hash.js';

describe('requestHash', () => {
  it('is the same for the same body with its keys in another order, at any depth', () => {
    expect(canonicalJson({ b: [{ y: 1, x: null }], a: 'é' })).toBe(
      '{"a":"é","b":[{"x":null,"y":1}]}',
    );
    expect(requestHash('POST', '/v1/x', { a: 1, b: { d: 2, c: 3 } })).toBe(
      requestHash('POST', '/v1/x', { b: { c: 3, d: 2 }, a: 1 }),
    );
  });

  it('differs when the method, the path or the body differs, and takes no body as null', () => {
    const base = requestHash('POST', '/v1/x', { a: 1 });
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    for (const other of [
      requestHash('PUT', '/v1/x', { a: 1 }),
      requestHash('POST', '/v1/y', { a: 1 }),
      requestHash('POST', '/v1/x', { a: '1' }),
      requestHash('POST', '/v1/x', [{ a: 1 }]),
    ])
      expect(other).not.toBe(base);
    expect(requestHash('POST', '/v1/x', undefined)).toBe(requestHash('POST', '/v1/x', null));
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});
