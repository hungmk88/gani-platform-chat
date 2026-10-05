import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';

import { authSchema } from './schema/auth.js';

/** The Drizzle handle for Better Auth's `drizzleAdapter`: give it the pool of `auth_role` and `authSchema` (N79). */
export function createAuthDb(pool: pg.Pool) {
  return drizzle({ client: pool, schema: authSchema });
}
