import { describe, expect, it } from 'vitest';

import {
  cursorString,
  cursorWhole,
  decodeCursor,
  encodeCursor,
  InvalidCursorError,
} from './cursor.js';

describe('cursor', () => {
  it('gives back the fields it encoded, with its version', () => {
    const raw = encodeCursor({ at: '2026-10-01T00:00:00.000000Z', before: 7 });
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    const fields = decodeCursor(raw);
    expect(fields).toEqual({ at: '2026-10-01T00:00:00.000000Z', before: 7, v: 1 });
    expect(cursorString(fields, 'at', /^\d{4}-/)).toBe('2026-10-01T00:00:00.000000Z');
    expect(cursorWhole(fields, 'before')).toBe(7);
  });

  it('refuses what it did not make, without echoing it', () => {
    const b64 = (text: string) => Buffer.from(text).toString('base64url');
    for (const raw of [
      '',
      'a+b',
      'x'.repeat(513),
      b64('not json'),
      b64('[1]'),
      b64('null'),
      b64('{"v":2}'),
      b64('{}'),
    ]) {
      expect(() => decodeCursor(raw), raw).toThrow(InvalidCursorError);
    }
    expect(() => decodeCursor('0912345678x!')).toThrow('the cursor is not one this API gave');
  });

  it('checks each field it reads', () => {
    const fields = decodeCursor(encodeCursor({ at: 'x', before: 0 }));
    expect(() => cursorString(fields, 'at', /^\d+$/)).toThrow(InvalidCursorError);
    expect(() => cursorString(fields, 'missing', /./)).toThrow(InvalidCursorError);
    expect(() => cursorWhole(fields, 'before')).toThrow(InvalidCursorError);
    expect(() => cursorWhole(decodeCursor(encodeCursor({ before: 1.5 })), 'before')).toThrow(
      InvalidCursorError,
    );
  });
});
