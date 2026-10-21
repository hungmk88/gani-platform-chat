import { describe, expect, it, vi } from 'vitest';

import type { api } from '../api/client';
import { errorOf } from '../api/errors';
import { ApiFailure, getter, unwrap } from './fetch';

describe('unwrap', () => {
  it('gives the data of an answer', async () => {
    await expect(unwrap(Promise.resolve({ ok: true, data: 1 }))).resolves.toBe(1);
  });

  it('throws the ApiError of a refusal as an ApiFailure', async () => {
    const error = errorOf(409, { code: 'version_conflict' });
    const thrown = await unwrap(Promise.resolve({ ok: false, error })).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(ApiFailure);
    expect((thrown as ApiFailure).error).toBe(error);
  });
});

describe('getter', () => {
  it('GETs the path with the signal of the query', async () => {
    const call = vi.fn(() => Promise.resolve({ ok: true as const, data: 'x' }));
    const signal = new AbortController().signal;
    await expect(getter('/v1/x', call as unknown as typeof api)({ signal })).resolves.toBe('x');
    expect(call).toHaveBeenCalledWith('/v1/x', { signal });
  });
});
