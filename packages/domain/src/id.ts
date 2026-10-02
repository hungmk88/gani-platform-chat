/**
 * UUIDv7 generator (RFC 9562 §5.7), used for every primary key (Brief P8, CLAUDE.md rule 2).
 *
 * Layout: 48-bit unix_ts_ms | ver=7 | 12-bit rand_a | var=0b10 | 62-bit rand_b.
 * The 74 bits rand_a + rand_b are random; within one millisecond they are treated as a counter
 * (RFC 9562 §6.2 method 3) so ids from one generator are strictly increasing. Ordering across
 * processes is only guaranteed at millisecond resolution.
 */

const RAND_BITS = 74n;
const RAND_MASK = (1n << RAND_BITS) - 1n;
const RAND_B_BITS = 62n;
const RAND_B_MASK = (1n << RAND_B_BITS) - 1n;
const LOW_60_MASK = (1n << 60n) - 1n;
const MAX_TIMESTAMP_MS = 0xffffffffffff;
const RANDOM_BYTES = 10;

export interface UuidV7Options {
  /** Returns the current unix time in milliseconds. Defaults to `Date.now`. */
  now?: () => number;
  /** Returns exactly 10 random bytes (only the top 74 bits are used). Defaults to CSPRNG. */
  randomBytes?: () => Uint8Array;
}

function defaultRandomBytes(): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(RANDOM_BYTES));
}

function bytesToRand(bytes: Uint8Array): bigint {
  if (bytes.length !== RANDOM_BYTES) {
    throw new RangeError(`randomBytes must return ${RANDOM_BYTES} bytes, got ${bytes.length}`);
  }
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value >> 6n; // 80 bits -> keep the top 74
}

function format(timestampMs: number, rand: bigint): string {
  const randA = rand >> RAND_B_BITS;
  const randB = rand & RAND_B_MASK;
  const ts = timestampMs.toString(16).padStart(12, '0');
  const a = randA.toString(16).padStart(3, '0');
  const variant = (8n | (randB >> 60n)).toString(16);
  const b = (randB & LOW_60_MASK).toString(16).padStart(15, '0');
  return `${ts.slice(0, 8)}-${ts.slice(8)}-7${a}-${variant}${b.slice(0, 3)}-${b.slice(3)}`;
}

/** Creates an independent generator; state (last timestamp and counter) is per generator. */
export function createUuidV7Generator(options: UuidV7Options = {}): () => string {
  const now = options.now ?? Date.now;
  const randomBytes = options.randomBytes ?? defaultRandomBytes;
  let lastMs = -1;
  let lastRand = 0n;

  return () => {
    const clock = now();
    if (!Number.isSafeInteger(clock) || clock < 0 || clock > MAX_TIMESTAMP_MS) {
      throw new RangeError(`clock returned ${clock}; expected an integer in [0, 2^48 - 1] ms`);
    }
    let ms = Math.max(clock, lastMs); // never go backwards if the clock does
    let rand: bigint;
    if (ms > lastMs) {
      rand = bytesToRand(randomBytes());
    } else {
      rand = lastRand + 1n;
      if (rand > RAND_MASK) {
        ms += 1; // counter overflow: borrow the next millisecond
        rand = bytesToRand(randomBytes());
      }
    }
    lastMs = ms;
    lastRand = rand;
    return format(ms, rand);
  };
}

/** Process-wide generator; use this for production ids. */
export const uuidv7: () => string = createUuidV7Generator();
