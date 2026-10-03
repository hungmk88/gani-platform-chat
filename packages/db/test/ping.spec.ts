import { describe, expect, it } from 'vitest';

import { createDbPool, pingDb } from '../src/index.js';
import { url } from './db.js';

describe('pingDb against PostgreSQL', () => {
  it('is true for a reachable database, as app_role (no tenant context needed)', async () => {
    const pool = createDbPool(url('app'), { max: 1 });
    try {
      expect(await pingDb(pool)).toBe(true);
    } finally {
      await pool.end();
    }
  });

  it('is false, quickly, when nothing listens on the port', async () => {
    const pool = createDbPool('postgres://nobody@127.0.0.1:1/none', { max: 1 });
    try {
      const started = Date.now();
      expect(await pingDb(pool, 1_000)).toBe(false);
      expect(Date.now() - started).toBeLessThan(3_000);
    } finally {
      await pool.end();
    }
  });
});
