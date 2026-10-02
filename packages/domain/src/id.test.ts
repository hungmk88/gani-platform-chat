import { describe, expect, it } from 'vitest';

import { createUuidV7Generator, uuidv7 } from './id.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Encodes a 74-bit random value as the 10 bytes the generator consumes (top 74 bits). */
function randToBytes(rand: bigint): Uint8Array {
  let value = rand << 6n;
  const bytes = new Uint8Array(10);
  for (let i = 9; i >= 0; i--) {
    bytes[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return bytes;
}

function timestampOf(id: string): number {
  return parseInt(id.replaceAll('-', '').slice(0, 12), 16);
}

/** The 74 random bits of a UUIDv7 as an array of 0/1. */
function randomBitsOf(id: string): number[] {
  const hex = id.replaceAll('-', '');
  const bits: number[] = [];
  const push = (value: number, width: number): void => {
    for (let i = width - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  push(parseInt(hex.slice(13, 16), 16), 12); // rand_a
  push(parseInt(hex.slice(16, 17), 16) & 0b11, 2); // first 2 bits of rand_b (after var=0b10)
  for (const nibble of hex.slice(17)) push(parseInt(nibble, 16), 4); // remaining 60 bits
  return bits;
}

describe('uuidv7', () => {
  it('matches the RFC 9562 Appendix A.6 test vector', () => {
    const rand = (0xcc3n << 62n) | 0x18c4dc0c0c07398fn; // rand_a | rand_b from the RFC
    const generate = createUuidV7Generator({
      now: () => 0x017f22e279b0,
      randomBytes: () => randToBytes(rand),
    });
    expect(generate()).toBe('017f22e2-79b0-7cc3-98c4-dc0c0c07398f');
  });

  it('produces well-formed ids and no duplicates in 10,000 calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = uuidv7();
      expect(id).toMatch(UUID_V7);
      ids.add(id);
    }
    expect(ids.size).toBe(10_000);
  });

  it('is strictly increasing for 1,000 ids generated in the same millisecond', () => {
    const generate = createUuidV7Generator({ now: () => 1_700_000_000_000 });
    let previous = generate();
    for (let i = 1; i < 1_000; i++) {
      const next = generate();
      expect(next > previous).toBe(true);
      previous = next;
    }
  });

  it('increases the timestamp when the clock advances', () => {
    let clock = 1_700_000_000_000;
    const generate = createUuidV7Generator({ now: () => clock });
    const first = generate();
    clock += 1;
    const second = generate();
    expect(timestampOf(second)).toBe(timestampOf(first) + 1);
    expect(second > first).toBe(true);
  });

  it('never moves the timestamp backwards when the clock does', () => {
    let clock = 1_700_000_000_000;
    const generate = createUuidV7Generator({ now: () => clock });
    const first = generate();
    clock -= 5_000;
    const second = generate();
    expect(timestampOf(second)).toBe(timestampOf(first));
    expect(second > first).toBe(true);
  });

  it('borrows the next millisecond when the counter overflows', () => {
    const allOnes = new Uint8Array(10).fill(0xff);
    const generate = createUuidV7Generator({
      now: () => 1_700_000_000_000,
      randomBytes: () => allOnes,
    });
    const first = generate();
    const second = generate();
    expect(timestampOf(second)).toBe(timestampOf(first) + 1);
    expect(second > first).toBe(true);
  });

  it('has per-bit balance and summed bit entropy >= 60 over 10,000 samples', () => {
    // Clock advances on every call so each id gets fresh CSPRNG bits (no counter increments).
    let clock = 1_700_000_000_000;
    const generate = createUuidV7Generator({ now: () => clock++ });
    const samples = 10_000;
    const ones = new Array<number>(74).fill(0);
    for (let i = 0; i < samples; i++) {
      randomBitsOf(generate()).forEach((bit, index) => {
        ones[index] = (ones[index] ?? 0) + bit;
      });
    }
    let entropy = 0;
    for (const count of ones) {
      const p = count / samples;
      expect(p).toBeGreaterThan(0.47);
      expect(p).toBeLessThan(0.53);
      entropy += -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
    }
    // NOTE: this checks the marginal entropy of each bit. Joint entropy cannot be measured from
    // 10,000 samples (log2(10,000) ~ 13 bits); it comes from the CSPRNG, not from this test.
    expect(entropy).toBeGreaterThanOrEqual(60);
  });

  it('rejects an invalid clock value', () => {
    expect(() => createUuidV7Generator({ now: () => Number.NaN })()).toThrow(RangeError);
    expect(() => createUuidV7Generator({ now: () => -1 })()).toThrow(RangeError);
    expect(() => createUuidV7Generator({ now: () => 2 ** 48 })()).toThrow(RangeError);
  });

  it('rejects a random source that returns the wrong number of bytes', () => {
    const generate = createUuidV7Generator({ randomBytes: () => new Uint8Array(9) });
    expect(() => generate()).toThrow(RangeError);
  });
});
