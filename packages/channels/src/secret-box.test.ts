import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { SecretBox, SecretDecryptError } from './secret-box.js';

const key = () => randomBytes(32);
const place = { rowId: '0190a000-0000-7000-8000-000000000001', column: 'oa_secret_key_enc' };

describe('SecretBox (zalo spec §2, Z-N7)', () => {
  it('encrypts with the latest key and decrypts with the version stored on the row', () => {
    const box = new SecretBox(
      new Map([
        [1, key()],
        [2, key()],
      ]),
    );
    const stored = box.encrypt('the oa secret', place);
    expect(stored.length).toBe(12 + 16 + 'the oa secret'.length);
    expect(box.decrypt(stored, place, 2)).toBe('the oa secret');
    expect(box.decrypt(box.encrypt('old', place, 1), place, 1)).toBe('old');
  });

  it('refuses another key, another row, another column, a changed byte or a short value, with one code and no detail', () => {
    const box = new SecretBox(
      new Map([
        [1, key()],
        [2, key()],
      ]),
    );
    const stored = box.encrypt('the oa secret', place, 1);
    const flipped = Buffer.from(stored);
    flipped[stored.length - 1] = (flipped.at(-1) ?? 0) ^ 1;
    const tries: (() => string)[] = [
      () => box.decrypt(stored, place, 2),
      () => box.decrypt(stored, { ...place, rowId: '0190a000-0000-7000-8000-000000000002' }, 1),
      () => box.decrypt(stored, { ...place, column: 'app_secret_enc' }, 1),
      () => box.decrypt(flipped, place, 1),
      () => box.decrypt(stored.subarray(0, 20), place, 1),
      () => box.decrypt(stored, place, 9),
    ];
    for (const attempt of tries) {
      const error = (() => {
        try {
          attempt();
        } catch (e) {
          return e;
        }
      })();
      expect(error).toBeInstanceOf(SecretDecryptError);
      expect(error).toMatchObject({
        code: 'E_SECRET_DECRYPT',
        message: 'a channel secret could not be decrypted',
      });
    }
  });

  it('reads CHANNEL_SECRET_KEY_<version> from the environment, and refuses a malformed key without showing it', () => {
    const hex = key().toString('hex');
    const box = SecretBox.fromEnv({
      CHANNEL_SECRET_KEY_3: hex,
      CHANNEL_SECRET_KEY_1: key().toString('hex'),
      OTHER: 'x',
    });
    expect(box.latestVersion).toBe(3);
    expect(() => SecretBox.fromEnv({ CHANNEL_SECRET_KEY_1: 'not-hex-at-all' })).toThrow(
      /^CHANNEL_SECRET_KEY_1 must be 64/,
    );
    expect(() => SecretBox.fromEnv({ CHANNEL_SECRET_KEY_1: 'not-hex-at-all' })).not.toThrow(
      /not-hex/,
    );
    expect(() => SecretBox.fromEnv({}).latestVersion).toThrow(/no CHANNEL_SECRET_KEY/);
    expect(() => new SecretBox(new Map([[1, randomBytes(16)]]))).toThrow(RangeError);
  });
});
