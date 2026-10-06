import { describe, expect, it } from 'vitest';

import { createLogger } from './logger.js';

describe('createLogger', () => {
  it('writes one JSON object per line with the level, the time, the message and the fields it is given', () => {
    const lines: string[] = [];
    const log = createLogger(
      (line) => lines.push(line),
      () => new Date('2026-10-06T10:00:00Z'),
    );
    log.info('claimed', { orgId: 'org-1', count: 3, full: true, note: null });
    log.warn('slow');
    log.error('failed', { error: 'Error' });
    expect(lines.map((l) => JSON.parse(l) as unknown)).toEqual([
      {
        level: 'info',
        time: '2026-10-06T10:00:00.000Z',
        message: 'claimed',
        orgId: 'org-1',
        count: 3,
        full: true,
        note: null,
      },
      { level: 'warn', time: '2026-10-06T10:00:00.000Z', message: 'slow' },
      { level: 'error', time: '2026-10-06T10:00:00.000Z', message: 'failed', error: 'Error' },
    ]);
  });

  it('writes to stdout by default', () => {
    const out: string[] = [];
    const spy = (chunk: unknown): boolean => (out.push(String(chunk)), true);
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = spy;
    try {
      createLogger().info('hello');
    } finally {
      process.stdout.write = original;
    }
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^\{"level":"info".*"message":"hello"\}\n$/);
  });
});
