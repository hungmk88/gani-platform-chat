import { describe, expect, it } from 'vitest';

import { errorOf } from '../api/errors';
import { nameError, nameOf } from './name';

describe('nameOf', () => {
  it('trims like the API and says a missing or long name', () => {
    expect(nameOf('  Trần Thu ')).toEqual({ name: 'Trần Thu' });
    expect(nameOf('   ')).toBe('Nhập tên.');
    expect(nameOf('x'.repeat(100))).toEqual({ name: 'x'.repeat(100) });
    expect(nameOf('x'.repeat(101))).toMatch(/100 ký tự/);
  });
});

describe('nameError', () => {
  it('says a name refused in words of the screen, else the message of the code', () => {
    expect(nameError(errorOf(400, { code: 'validation_failed' }))).toMatch(/1–100/);
    expect(nameError(errorOf(503, {}))).toBe(errorOf(503, {}).message);
  });
});
