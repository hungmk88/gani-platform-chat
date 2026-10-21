import {
  defaultPartitionRows,
  ensureLogPartitions,
  purgeIdempotencyKeys,
  purgeInboundEventKeys,
} from '@gani/db';

import type { PartitionStore } from './partition-job.js';

/** The pool of `app_role`. Its type is taken from the store functions: the worker does not import `pg` (ADR-002). */
export type DbPool = Parameters<typeof ensureLogPartitions>[0];

const dbFunctions = {
  ensureLogPartitions,
  purgeInboundEventKeys,
  purgeIdempotencyKeys,
  defaultPartitionRows,
};

export interface PartitionStoreDeps {
  readonly pool: DbPool;
  /** The SQL of `packages/db`: given by the caller only so that a test can see what is asked. */
  readonly fns?: typeof dbFunctions;
}

/** The `PartitionStore` over PostgreSQL as app_role: four SECURITY DEFINER functions, no tenant, no table of its own. */
export function createDbPartitionStore(deps: PartitionStoreDeps): PartitionStore {
  const { pool, fns = dbFunctions } = deps;
  return {
    ensure: (monthsAhead) => fns.ensureLogPartitions(pool, monthsAhead),
    purgeKeys: (retentionDays, limit) => fns.purgeInboundEventKeys(pool, retentionDays, limit),
    purgeIdempotencyKeys: (hours, limit) => fns.purgeIdempotencyKeys(pool, hours, limit),
    defaultRows: () => fns.defaultPartitionRows(pool),
  };
}
