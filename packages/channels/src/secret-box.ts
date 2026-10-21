import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// SecretBox (zalo-channel spec §2, N100): the one place that encrypts and decrypts the secrets of a channel account, until a KMS
// replaces the keys from the environment behind the same interface (Z5). AES-256-GCM; stored as nonce(12) ‖ tag(16) ‖ ciphertext;
// the additional data is the row id and the column name, so a ciphertext copied to another row or column does not decrypt. Never
// logs a key, a plaintext or a ciphertext: a failure is the code E_SECRET_DECRYPT, nothing else.

const NONCE = 12;
const TAG = 16;
const KEY_VAR = /^CHANNEL_SECRET_KEY_([1-9][0-9]{0,3})$/;

/** Where a secret lives: what binds a ciphertext to its place. */
export interface SecretPlace {
  readonly rowId: string;
  readonly column: string;
}

export class SecretDecryptError extends Error {
  readonly code = 'E_SECRET_DECRYPT';
  constructor() {
    super('a channel secret could not be decrypted');
    this.name = 'SecretDecryptError';
  }
}

export class SecretBox {
  private readonly keys: ReadonlyMap<number, Buffer>;

  constructor(keys: ReadonlyMap<number, Buffer>) {
    for (const [version, key] of keys)
      if (key.length !== 32) throw new RangeError(`key version ${version} must be 32 bytes`);
    this.keys = keys;
  }

  /** The keys of `CHANNEL_SECRET_KEY_<version>` (64 hex characters each). A malformed key stops the start, named, never shown. */
  static fromEnv(env: Readonly<Record<string, string | undefined>>): SecretBox {
    const keys = new Map<number, Buffer>();
    for (const [name, value] of Object.entries(env)) {
      const m = KEY_VAR.exec(name);
      if (!m || value === undefined) continue;
      if (!/^[0-9a-f]{64}$/i.test(value))
        throw new Error(`${name} must be 64 hexadecimal characters (32 bytes)`);
      keys.set(Number(m[1]), Buffer.from(value, 'hex'));
    }
    return new SecretBox(keys);
  }

  /** The latest version, the one a new or rotated secret is written with. */
  get latestVersion(): number {
    const versions = [...this.keys.keys()];
    if (versions.length === 0) throw new Error('no CHANNEL_SECRET_KEY_<version> is set');
    return Math.max(...versions);
  }

  encrypt(plaintext: string, place: SecretPlace, version = this.latestVersion): Buffer {
    const nonce = randomBytes(NONCE);
    const cipher = createCipheriv('aes-256-gcm', this.key(version), nonce);
    cipher.setAAD(aad(place));
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), data]);
  }

  decrypt(stored: Buffer, place: SecretPlace, version: number): string {
    try {
      if (stored.length < NONCE + TAG) throw new SecretDecryptError();
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.key(version),
        stored.subarray(0, NONCE),
      );
      decipher.setAAD(aad(place));
      decipher.setAuthTag(stored.subarray(NONCE, NONCE + TAG));
      return Buffer.concat([
        decipher.update(stored.subarray(NONCE + TAG)),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new SecretDecryptError();
    }
  }

  private key(version: number): Buffer {
    const key = this.keys.get(version);
    if (!key) throw new SecretDecryptError();
    return key;
  }
}

const aad = (place: SecretPlace) => Buffer.from(`${place.rowId}:${place.column}`, 'utf8');
