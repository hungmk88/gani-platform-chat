/**
 * What the SLA job of the opening hours needs from the database (E4b, N211); every call is one short transaction of one organisation
 * (or of one of its workspaces). Implemented over PostgreSQL in db-store.ts; the job is in sla-hours-job.ts.
 */
export interface SlaHoursStore {
  runningOrgs(limit: number): Promise<string[]>;
  /** The workspaces of the organisation whose hours move an SLA at `at`, with at most `limit` such conversations each. */
  toMove(
    orgId: string,
    at: Date,
    limit: number,
  ): Promise<{ readonly workspaceId: string; readonly conversationIds: readonly string[] }[]>;
  /** The SLA of one conversation as the hours say at `at`, in its own transaction: true when it changed. */
  move(orgId: string, workspaceId: string, conversationId: string, at: Date): Promise<boolean>;
}
