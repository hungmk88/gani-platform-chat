import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { toProblem } from '../modules/request-context/problem.filter.js';
import { CursorQuerySchema } from './schemas.js';
import { ValidationFailedError, ZodPipe } from './zod-pipe.js';

const Body = z.object({ toUserId: z.uuid(), note: z.string().max(5).optional() });

describe('ZodPipe', () => {
  it('passes a valid value through, converted by the schema', () => {
    expect(new ZodPipe(CursorQuerySchema).transform({ limit: '20' })).toEqual({ limit: 20 });
    expect(new ZodPipe(CursorQuerySchema).transform({})).toEqual({ limit: 50 });
  });

  it('refuses an invalid one with 400 validation_failed that names the fields and never their values', () => {
    const secret = '0912345678';
    let error: unknown;
    try {
      new ZodPipe(Body).transform({ toUserId: secret, note: `call ${secret}` });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ValidationFailedError);
    const body = toProblem(error, '0190a000-0000-7000-8000-000000000001');
    expect(body).toMatchObject({ status: 400, code: 'validation_failed' });
    expect(body.detail).toBe('Invalid request: toUserId: invalid_format, note: too_big.');
    expect(JSON.stringify(body)).not.toContain(secret);
  });

  it('caps the limit at 100 and refuses a cursor that is empty or too long (P9)', () => {
    const pipe = new ZodPipe(CursorQuerySchema);
    expect(() => pipe.transform({ limit: '101' })).toThrow(ValidationFailedError);
    expect(() => pipe.transform({ limit: '0' })).toThrow(ValidationFailedError);
    expect(() => pipe.transform({ cursor: '' })).toThrow(ValidationFailedError);
    expect(() => pipe.transform({ cursor: 'x'.repeat(513) })).toThrow(ValidationFailedError);
  });

  it('names the root when the value itself is wrong', () => {
    expect(() => new ZodPipe(Body).transform('not an object')).toThrow(
      'Invalid request: (root): invalid_type.',
    );
  });
});
