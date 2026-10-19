import { describe, expect, it } from 'vitest';

import { WorkerMetrics } from './metrics.js';

describe('WorkerMetrics', () => {
  it('counts what the relay reports, in the text format of Prometheus, with no label', () => {
    let now = 1_000_000;
    const m = new WorkerMetrics(() => now);
    m.passEnded(true);
    now += 500;
    m.passEnded(false);
    m.publishFailed(3);
    m.deadLettered();
    m.queueFull();
    m.queueFull();
    const text = m.render();
    expect(text).toContain(
      '# HELP outbox_relay_passes_total Passes of the outbox relay that ended.\n# TYPE outbox_relay_passes_total counter\noutbox_relay_passes_total 2\n',
    );
    // prettier-ignore
    const values = Object.fromEntries(text.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(' ') as [string, string]));
    expect(values).toEqual({
      outbox_relay_passes_total: '2',
      outbox_relay_failed_passes_total: '1',
      outbox_relay_last_pass_timestamp_seconds: '1000.5',
      outbox_publish_failures_total: '3',
      outbox_dead_lettered_total: '1',
      outbox_queue_full_total: '2',
    });
    expect(text).not.toMatch(/[{}]/);
  });

  it('is healthy while a pass ended within the limit, counting from the start until the first one', () => {
    let now = 0;
    const m = new WorkerMetrics(() => now);
    now = 1000;
    expect(m.healthy(1000)).toBe(true);
    now = 1001;
    expect(m.healthy(1000)).toBe(false);
    m.passEnded(false);
    expect(m.healthy(1000)).toBe(true);
  });
});
