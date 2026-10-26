import type { WorkspaceRow } from '@gani/db';

/** A row of workspaces as the API answers it (WorkspaceSchema). */
export const workspaceView = (row: WorkspaceRow) => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  template: row.template,
  timezone: row.timezone,
  defaultMaxConcurrent: row.defaultMaxConcurrent,
  contactPhone: row.contactPhone,
  createdAt: row.createdAt.toISOString(),
});
