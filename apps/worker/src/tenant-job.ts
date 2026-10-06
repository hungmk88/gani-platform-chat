import { runWithTenantContext, type TenantContext } from '@gani/db';

/** A job without a usable tenant: a bug in whoever made the job, never something to guess around (P16). */
export class JobTenantMissingError extends Error {
  constructor() {
    super(
      'job payload has no usable orgId (or a malformed workspaceId): refusing to run it without a tenant',
    );
    this.name = 'JobTenantMissingError';
  }
}

/** A job payload carries more than its tenant; only these two fields are read. */
export interface JobTenantPayload {
  readonly orgId?: unknown;
  readonly workspaceId?: unknown;
  readonly [field: string]: unknown;
}

/** The tenant a job acts for, from its payload and nothing else. A job names one organisation and at most one workspace. */
export function tenantOfJob(payload: JobTenantPayload): TenantContext {
  const { orgId, workspaceId } = payload;
  const workspaceIds =
    workspaceId === undefined || workspaceId === null
      ? []
      : typeof workspaceId === 'string'
        ? [workspaceId]
        : null;
  if (typeof orgId !== 'string' || orgId === '' || workspaceIds === null)
    throw new JobTenantMissingError();
  return { orgId, workspaceIds };
}

/**
 * Runs `fn` for the tenant of a job (worker/CLAUDE.md: `TenantContext.runForJob`). The tenant is checked before anything else: a
 * missing or malformed `orgId`/`workspaceId` rejects and `fn` never runs, so no query is made.
 */
export async function runForJob<T>(
  payload: JobTenantPayload,
  fn: (tenant: TenantContext) => Promise<T>,
): Promise<T> {
  const tenant = tenantOfJob(payload);
  return runWithTenantContext(tenant, () => fn(tenant));
}
