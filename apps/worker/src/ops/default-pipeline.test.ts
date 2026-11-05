import { describe, expect, it } from 'vitest';

import type { Queryable } from './create-org.js';
import { addDefaultPipeline, DEFAULT_LOST_REASON, DEFAULT_STAGES } from './default-pipeline.js';

/** A client over which workspaces have steps or reasons, recording what is written. */
function fakeDb(withStages: string[] = [], withReasons: string[] = []) {
  const written: { sql: string; params: unknown[] }[] = [];
  const stages = new Set(withStages);
  const reasons = new Set(withReasons);
  const client: Queryable = {
    query: <R extends object>(sql: string, params: unknown[] = []) => {
      const out = (has: boolean) =>
        Promise.resolve({ rows: (has ? [{}] : []) as R[], rowCount: has ? 1 : 0 });
      if (sql.startsWith('SELECT 1 FROM public.pipeline_stages'))
        return out(stages.has(String(params[1])));
      if (sql.startsWith('SELECT 1 FROM public.pipeline_lost_reasons'))
        return out(reasons.has(String(params[1])));
      written.push({ sql, params });
      if (sql.includes('INTO public.pipeline_stages')) stages.add(String(params[2]));
      if (sql.includes('INTO public.pipeline_lost_reasons')) reasons.add(String(params[2]));
      return out(false);
    },
  };
  return { client, written };
}
let n = 0;
const newId = () => `id-${++n}`;

describe('addDefaultPipeline (N200)', () => {
  it('names the steps by place only and keeps the one reason until Q9', () => {
    expect(DEFAULT_STAGES).toEqual(['Bước 1', 'Bước 2', 'Bước 3', 'Bước 4', 'Bước 5', 'Bước 6']);
    expect(DEFAULT_LOST_REASON).toBe('Khác (chờ Q9)');
  });

  it('adds six steps at positions 0 to 5 and the one reason to a workspace that has none, then nothing', async () => {
    const { client, written } = fakeDb();
    expect(await addDefaultPipeline(client, 'org', 'w1', newId)).toEqual({ stages: 6, reasons: 1 });
    expect(written.map((w) => w.params.slice(1))).toEqual([
      ...DEFAULT_STAGES.map((name, position) => ['org', 'w1', name, position]),
      ['org', 'w1', DEFAULT_LOST_REASON],
    ]);
    expect(await addDefaultPipeline(client, 'org', 'w1', newId)).toEqual({ stages: 0, reasons: 0 });
    expect(written).toHaveLength(7);
  });

  it('never touches the steps of a workspace that has some, and still gives it the reason when it has no list', async () => {
    const { client, written } = fakeDb(['w1']);
    expect(await addDefaultPipeline(client, 'org', 'w1', newId)).toEqual({ stages: 0, reasons: 1 });
    expect(written.some((w) => w.sql.includes('pipeline_stages'))).toBe(false);
  });
});
