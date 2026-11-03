import type { FieldRow } from '@gani/db';

/** A field as the API gives it (schema CustomerField). */
export const fieldView = (row: FieldRow) => ({
  id: row.id,
  name: row.name,
  type: row.type,
  options: [...row.options],
  required: row.required,
  sensitive: row.sensitive,
  hidden: row.hidden,
  position: row.position,
  hasData: row.hasData,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
