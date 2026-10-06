import { describe, expect, it } from 'vitest';

import { startProducer } from './producer.js';

// The producer of K3 needs neither Valkey nor PostgreSQL: these run on any machine. What matters to K3 is that after `stop()` nothing is
// being written, so that the `SELECT` of the written set is complete (a missing event would be a bug of the test, not of the relay).
describe('startProducer', () => {
  it('writes at the pace asked for, one write at a time', async () => {
    let writes = 0;
    let inFlight = 0;
    let peak = 0;
    const producer = startProducer(async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      writes++;
    }, 20);
    await new Promise((resolve) => setTimeout(resolve, 210));
    await producer.stop();
    expect(peak).toBe(1);
    expect(writes).toBeGreaterThanOrEqual(7);
    expect(writes).toBeLessThanOrEqual(13);
  });

  it('waits for the write in flight before it returns, and writes nothing afterwards', async () => {
    const done: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const producer = startProducer(async () => {
      await gate;
      done.push('written');
    }, 10);
    const stopped = producer.stop().then(() => done.push('stopped'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(done).toEqual([]); // stop() has not returned: the write is still in flight
    release();
    await stopped;
    const writtenAtStop = done.length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(done).toEqual(['written', 'stopped']);
    expect(done).toHaveLength(writtenAtStop);
  });

  it('throws what a write threw, at stop()', async () => {
    const producer = startProducer(() => Promise.reject(new Error('database gone')), 10);
    await new Promise((resolve) => setTimeout(resolve, 30));
    await expect(producer.stop()).rejects.toThrow('the producer could not write');
  });
});
