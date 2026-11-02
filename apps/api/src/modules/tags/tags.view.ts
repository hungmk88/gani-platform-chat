import type { TagRow } from '@gani/db';

/** A tag as the API gives it (schema Tag). */
export const tagView = (row: TagRow) => ({
  id: row.id,
  name: row.name,
  hidden: row.hidden,
  customerCount: row.customerCount,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
