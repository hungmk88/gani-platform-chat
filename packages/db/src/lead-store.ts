import { and, asc, desc, eq, isNull, or, sql, type SQL } from 'drizzle-orm';

import { insertAuditLog } from './audit-log.js';
import type { Page } from './conversation-read.js';
import { cursorString, decodeCursor, encodeCursor } from './cursor.js';
import {
  canSeeLead,
  LEAD_OWNER_ROLES,
  LeadAccessDeniedError,
  leadReadScope,
  mayCreateLead,
  mayWriteLead,
  type LeadViewer,
} from './lead-access.js';
import { lostReasonsInForce } from './pipeline-read.js';
import { leadEvents, leads } from './schema/leads.js';
import { pipelineStages } from './schema/pipelines.js';
import { currentTenantContext } from './tenant-context.js';
import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

// The leads of a workspace: reading, making, moving and closing them (L3a, L3b; G1–G3, T-3, N188, N196, N200; CEO 05/11/2026).
// Row-level security keeps them to the organisation and the workspaces of the transaction; lead-access.ts narrows them to who may see
// and change them, here, on every read and write, so the API never writes that rule itself. Every change writes its lead_events row in
// the same transaction. The title is the agents' free words: never logged, and no lead_events row carries it.

export const LEAD_STATUSES = ['open', 'won', 'lost'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** The most leads one read gives (GET /v1/leads). */
export const LEAD_MAX_LIMIT = 100;
/** The most events one lead gives back (N201 (A)): past it the read says so, and the API logs `lead_events_capped`. */
export const LEAD_EVENTS_CAP = 500;

/** The step is not one of the lead's workspace (422 invalid_stage). */
export class InvalidLeadStageError extends Error {
  constructor() {
    super('this step is not one of the workspace’s pipeline');
    this.name = 'InvalidLeadStageError';
  }
}

/** Not an active Owner, Admin, Manager or Sales of the lead's workspace (422 invalid_assignee). */
export class InvalidLeadOwnerError extends Error {
  constructor() {
    super('this person cannot follow a lead of this workspace');
    this.name = 'InvalidLeadOwnerError';
  }
}

/** The customer is not one of the organisation, or the conversation not one of the workspace (404). */
export class LeadReferenceNotFoundError extends Error {
  constructor() {
    super('the customer or the conversation of the lead is not there');
    this.name = 'LeadReferenceNotFoundError';
  }
}

/** Won or lost already: closing is final (409 lead_closed, T-3). */
export class LeadClosedError extends Error {
  constructor() {
    super('the lead is won or lost, which is final');
    this.name = 'LeadClosedError';
  }
}

/** The `version` sent back is not the lead's any more (409 version_conflict). */
export class LeadVersionConflictError extends Error {
  constructor() {
    super('the lead changed since it was read');
    this.name = 'LeadVersionConflictError';
  }
}

/** Not one of the workspace's reasons to lose in force (422 invalid_lost_reason). */
export class InvalidLostReasonError extends Error {
  constructor() {
    super('not one of the workspace’s reasons to lose');
    this.name = 'InvalidLostReasonError';
  }
}

/** The workspace has no pipeline: a setup error (tenant:create-pipeline was not run), never a lead without a step. */
export class LeadPipelineMissingError extends Error {
  constructor() {
    super('the workspace has no pipeline steps');
    this.name = 'LeadPipelineMissingError';
  }
}

export interface LeadRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly customerId: string;
  /** null until someone knows the customer's name. */
  readonly customerDisplayName: string | null;
  readonly conversationId: string | null;
  readonly stageId: string;
  readonly stageName: string;
  readonly status: LeadStatus;
  readonly ownerUserId: string | null;
  /** Through app.org_users: null for an owner who gave no name or is no longer an active member. */
  readonly ownerName: string | null;
  readonly createdBy: string;
  readonly lostReason: string | null;
  readonly closedAt: Date | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const l = leads;
const leadColumns = {
  id: l.id,
  workspaceId: l.workspaceId,
  title: l.title,
  customerId: l.customerId,
  customerDisplayName: sql<
    string | null
  >`(SELECT c.display_name FROM public.customers c WHERE c.org_id = ${l.orgId} AND c.id = ${l.customerId})`,
  conversationId: l.conversationId,
  stageId: l.stageId,
  stageName: sql<string>`(SELECT s.name FROM public.pipeline_stages s WHERE s.org_id = ${l.orgId} AND s.id = ${l.stageId})`,
  status: l.status,
  ownerUserId: l.ownerUserId,
  ownerName: sql<
    string | null
  >`(SELECT nullif(btrim(u.display_name), '') FROM app.org_users u WHERE u.user_id = ${l.ownerUserId})`,
  createdBy: l.createdBy,
  lostReason: l.lostReason,
  closedAt: l.closedAt,
  version: l.version,
  createdAt: l.createdAt,
  updatedAt: l.updatedAt,
};

/** Throws LeadAccessDeniedError for Support; the scope of everyone else. */
function scopeOf(viewer: LeadViewer): 'workspace' | 'own' {
  const scope = leadReadScope(viewer.role);
  if (scope === 'none') throw new LeadAccessDeniedError();
  return scope;
}

/** The narrowing of a scope: a Sales reads the leads they made or own. */
function scopeWhere(viewer: LeadViewer): SQL | undefined {
  if (scopeOf(viewer) === 'workspace') return undefined;
  const me = assertUuid(viewer.userId, 'userId');
  return or(eq(l.createdBy, me), eq(l.ownerUserId, me));
}

/** Throws InvalidLeadOwnerError unless `userId` is an active Owner, Admin, Manager or Sales, member of the live workspace. */
async function assertLeadOwner(tx: TenantTx, workspaceId: string, userId: string): Promise<void> {
  const { rows } = await tx.execute(sql`
    SELECT 1 FROM app.org_users u
    JOIN public.workspace_members wm ON wm.org_id = u.org_id AND wm.user_id = u.user_id
      AND wm.workspace_id = ${workspaceId}::uuid AND wm.deleted_at IS NULL
    JOIN public.workspaces w ON w.org_id = wm.org_id AND w.id = wm.workspace_id AND w.deleted_at IS NULL
    WHERE u.user_id = ${assertUuid(userId, 'ownerUserId')}::uuid
      AND u.role = ANY(${`{${LEAD_OWNER_ROLES.join(',')}}`}::text[])`);
  if (rows.length === 0) throw new InvalidLeadOwnerError();
}

/** The step a new lead starts at: the one asked for, which must be of the workspace, or the first one. */
async function startingStage(tx: TenantTx, workspaceId: string, stageId?: string): Promise<string> {
  const where = [eq(pipelineStages.workspaceId, workspaceId)];
  if (stageId !== undefined) where.push(eq(pipelineStages.id, assertUuid(stageId, 'stageId')));
  const [stage] = await tx
    .select({ id: pipelineStages.id })
    .from(pipelineStages)
    .where(and(...where))
    .orderBy(asc(pipelineStages.position))
    .limit(1);
  if (stage) return stage.id;
  if (stageId !== undefined) throw new InvalidLeadStageError();
  throw new LeadPipelineMissingError();
}

/** Runs `fn` in a savepoint and turns a missing customer or conversation (23503 on their keys) into LeadReferenceNotFoundError. */
async function referencesThere<T>(tx: TenantTx, fn: (t: TenantTx) => Promise<T>): Promise<T> {
  try {
    return await tx.transaction(fn);
  } catch (error) {
    for (let e: unknown = error; e instanceof Error; e = e.cause) {
      const { code, constraint } = e as { code?: unknown; constraint?: unknown };
      if (
        code === '23503' &&
        (constraint === 'leads_customer_fk' || constraint === 'leads_conversation_fk')
      )
        throw new LeadReferenceNotFoundError();
    }
    throw error;
  }
}

export interface LeadCreate {
  readonly workspaceId: string;
  readonly customerId: string;
  readonly title: string;
  readonly conversationId?: string;
  /** Absent: the first step of the workspace's pipeline. */
  readonly stageId?: string;
  readonly ownerUserId?: string;
  readonly newId: () => string;
}

/**
 * Makes an open lead (title trimmed and in NFC) with its `created` event, in the caller's transaction, and gives it back. The maker is
 * the viewer; only an Owner, Admin, Manager or Sales makes one (LeadAccessDeniedError, 403).
 */
export async function createLead(
  tx: TenantTx,
  viewer: LeadViewer,
  input: LeadCreate,
): Promise<LeadRow> {
  if (!mayCreateLead(viewer.role)) throw new LeadAccessDeniedError();
  const createdBy = assertUuid(viewer.userId, 'userId');
  const workspaceId = assertUuid(input.workspaceId, 'workspaceId');
  const stageId = await startingStage(tx, workspaceId, input.stageId);
  if (input.ownerUserId !== undefined) await assertLeadOwner(tx, workspaceId, input.ownerUserId);
  const { orgId } = currentTenantContext();
  const id = input.newId();
  await referencesThere(tx, (t) =>
    t.insert(l).values({
      id,
      orgId,
      workspaceId,
      title: input.title.trim().normalize('NFC'),
      customerId: assertUuid(input.customerId, 'customerId'),
      conversationId:
        input.conversationId === undefined
          ? null
          : assertUuid(input.conversationId, 'conversationId'),
      stageId,
      ownerUserId: input.ownerUserId ?? null,
      createdBy,
    }),
  );
  await tx.insert(leadEvents).values({
    id: input.newId(),
    orgId,
    workspaceId,
    leadId: id,
    type: 'created',
    toStageId: stageId,
    actorUserId: createdBy,
  });
  const [row] = await tx.select(leadColumns).from(l).where(eq(l.id, id));
  return row as LeadRow;
}

// The key as text with microseconds, as ticket-read.ts: a Date would round it and a page could repeat or skip a lead.
const SORT_TEXT = sql<string>`to_char(${l.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const SORT_FORMAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface LeadQuery {
  /** One of the transaction's workspaces; absent: all of them. */
  readonly workspaceId?: string;
  readonly stageId?: string;
  readonly status?: LeadStatus;
  /** `none` (nobody follows it), or the id of a member (the API turns `me` into the caller's id). */
  readonly owner?: string;
  /** The id of a member (the API turns `me` into the caller's id). */
  readonly createdBy?: string;
  readonly customerId?: string;
  /** 1..LEAD_MAX_LIMIT. */
  readonly limit: number;
  /** The `nextCursor` of the page before, read with the same filters. */
  readonly cursor?: string;
}

/**
 * A page of the leads the viewer sees, newest first (`id` breaking ties): every filter, the viewer's scope and the cursor are one WHERE.
 * Support throws LeadAccessDeniedError; a wrong filter throws before any query; a foreign cursor InvalidCursorError.
 */
export async function listLeads(
  tx: TenantTx,
  viewer: LeadViewer,
  q: LeadQuery,
): Promise<Page<LeadRow>> {
  const scope = scopeWhere(viewer);
  if (!Number.isInteger(q.limit) || q.limit < 1 || q.limit > LEAD_MAX_LIMIT)
    throw new RangeError(`limit must be a whole number between 1 and ${LEAD_MAX_LIMIT}`);
  if (q.status !== undefined && !(LEAD_STATUSES as readonly string[]).includes(q.status))
    throw new RangeError('status is not one of a lead');
  const where: (SQL | undefined)[] = [scope];
  if (q.workspaceId !== undefined)
    where.push(eq(l.workspaceId, assertUuid(q.workspaceId, 'workspaceId')));
  if (q.stageId !== undefined) where.push(eq(l.stageId, assertUuid(q.stageId, 'stageId')));
  if (q.status !== undefined) where.push(eq(l.status, q.status));
  if (q.owner === 'none') where.push(isNull(l.ownerUserId));
  else if (q.owner !== undefined) where.push(eq(l.ownerUserId, assertUuid(q.owner, 'owner')));
  if (q.createdBy !== undefined) where.push(eq(l.createdBy, assertUuid(q.createdBy, 'createdBy')));
  if (q.customerId !== undefined)
    where.push(eq(l.customerId, assertUuid(q.customerId, 'customerId')));
  if (q.cursor !== undefined) {
    const fields = decodeCursor(q.cursor);
    const at = cursorString(fields, 'at', SORT_FORMAT);
    const id = cursorString(fields, 'id', UUID_FORMAT);
    where.push(sql`(${l.createdAt}, ${l.id}) < (${at}::timestamptz, ${id}::uuid)`);
  }
  const rows = await tx
    .select({ ...leadColumns, sortKey: SORT_TEXT })
    .from(l)
    .where(and(...where))
    .orderBy(desc(l.createdAt), desc(l.id))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  return {
    rows: page.map(({ sortKey, ...row }) => {
      void sortKey;
      return row;
    }),
    nextCursor:
      rows.length > q.limit && last ? encodeCursor({ at: last.sortKey, id: last.id }) : null,
  };
}

export interface LeadEventRow {
  readonly type: 'created' | 'stage_changed' | 'owner_changed' | 'closed';
  readonly fromStage: { readonly id: string; readonly name: string } | null;
  readonly toStage: { readonly id: string; readonly name: string } | null;
  readonly outcome: 'won' | 'lost' | null;
  readonly actorUserId: string | null;
  readonly occurredAt: Date;
}

export interface LeadDetail {
  readonly lead: LeadRow;
  /** Oldest first, at most LEAD_EVENTS_CAP. */
  readonly events: readonly LeadEventRow[];
  /** More than LEAD_EVENTS_CAP: the API logs `lead_events_capped` with the lead's id (N201). */
  readonly eventsCapped: boolean;
}

/** The lead `id` with what happened to it, or null when it is not there or the viewer may not see it (404). Support throws. */
export async function getLead(
  tx: TenantTx,
  viewer: LeadViewer,
  id: string,
): Promise<LeadDetail | null> {
  scopeOf(viewer);
  const [row] = await tx
    .select(leadColumns)
    .from(l)
    .where(eq(l.id, assertUuid(id, 'id')));
  const lead = row as LeadRow | undefined;
  if (!lead || !canSeeLead(viewer, lead)) return null;
  const e = leadEvents;
  const stageName = (stage: typeof e.fromStageId | typeof e.toStageId) =>
    sql<
      string | null
    >`(SELECT s.name FROM public.pipeline_stages s WHERE s.org_id = ${e.orgId} AND s.id = ${stage})`;
  const rows = await tx
    .select({
      type: e.type,
      fromStageId: e.fromStageId,
      fromStageName: stageName(e.fromStageId),
      toStageId: e.toStageId,
      toStageName: stageName(e.toStageId),
      outcome: e.outcome,
      actorUserId: e.actorUserId,
      occurredAt: e.occurredAt,
    })
    .from(e)
    .where(eq(e.leadId, lead.id))
    .orderBy(asc(e.occurredAt), asc(e.id))
    .limit(LEAD_EVENTS_CAP + 1);
  const stage = (stageId: string | null, name: string | null) =>
    stageId === null ? null : { id: stageId, name: name ?? '' };
  return {
    lead,
    events: rows.slice(0, LEAD_EVENTS_CAP).map((r) => ({
      type: r.type,
      fromStage: stage(r.fromStageId, r.fromStageName),
      toStage: stage(r.toStageId, r.toStageName),
      outcome: r.outcome,
      actorUserId: r.actorUserId,
      occurredAt: r.occurredAt,
    })),
    eventsCapped: rows.length > LEAD_EVENTS_CAP,
  };
}

export interface Pipeline {
  readonly stages: readonly {
    readonly id: string;
    readonly name: string;
    readonly position: number;
  }[];
  /** The list in force (lostReasonsInForce, N200). */
  readonly lostReasons: readonly string[];
}

/** The steps of a workspace in order and its reasons to lose a lead. Support throws (403 on the pipeline too, N196). */
export async function readPipeline(
  tx: TenantTx,
  viewer: LeadViewer,
  workspaceId: string,
): Promise<Pipeline> {
  scopeOf(viewer);
  const ws = assertUuid(workspaceId, 'workspaceId');
  const stages = await tx
    .select({ id: pipelineStages.id, name: pipelineStages.name, position: pipelineStages.position })
    .from(pipelineStages)
    .where(eq(pipelineStages.workspaceId, ws))
    .orderBy(asc(pipelineStages.position));
  return { stages, lostReasons: await lostReasonsInForce(tx, ws) };
}

/** What a change locks and checks of the lead it changes. */
interface LockedLead {
  readonly id: string;
  readonly workspaceId: string;
  readonly stageId: string;
  readonly status: LeadStatus;
  readonly createdBy: string;
  readonly ownerUserId: string | null;
  readonly version: number;
}

/**
 * Locks the lead `id` for a change by the viewer: null when it is not there or the viewer may not see it (404), LeadAccessDeniedError
 * when they see it but may not change it (403), then a stale `version` (409) and a closed lead (409).
 */
async function lockForChange(
  tx: TenantTx,
  viewer: LeadViewer,
  id: string,
  version: number,
): Promise<LockedLead | null> {
  scopeOf(viewer);
  const [lead] = await tx
    .select({
      id: l.id,
      workspaceId: l.workspaceId,
      stageId: l.stageId,
      status: l.status,
      createdBy: l.createdBy,
      ownerUserId: l.ownerUserId,
      version: l.version,
    })
    .from(l)
    .where(eq(l.id, assertUuid(id, 'id')))
    .for('update');
  if (!lead) return null;
  if (!mayWriteLead(viewer, lead)) {
    if (canSeeLead(viewer, lead)) throw new LeadAccessDeniedError();
    return null;
  }
  if (lead.version !== version) throw new LeadVersionConflictError();
  if (lead.status !== 'open') throw new LeadClosedError();
  return lead;
}

/** Writes the change and its event, bumps the version, and gives the lead back as it is now. */
async function applyChange(
  tx: TenantTx,
  viewer: LeadViewer,
  lead: LockedLead,
  set: Partial<Pick<typeof l.$inferInsert, 'stageId' | 'status' | 'lostReason'>> & {
    closedAt?: SQL;
  },
  event: Pick<typeof leadEvents.$inferInsert, 'type' | 'fromStageId' | 'toStageId' | 'outcome'>,
  newId: () => string,
): Promise<LeadRow> {
  const { orgId } = currentTenantContext();
  await tx
    .update(l)
    .set({ ...set, version: lead.version + 1, updatedAt: sql`now()` })
    .where(eq(l.id, lead.id));
  await tx.insert(leadEvents).values({
    id: newId(),
    orgId,
    workspaceId: lead.workspaceId,
    leadId: lead.id,
    actorUserId: assertUuid(viewer.userId, 'userId'),
    ...event,
  });
  const [row] = await tx.select(leadColumns).from(l).where(eq(l.id, lead.id));
  return row as LeadRow;
}

export interface LeadStageChange {
  readonly id: string;
  /** The `version` last read. */
  readonly version: number;
  readonly stageId: string;
  readonly newId: () => string;
}

/**
 * Moves an open lead to another step of its workspace's pipeline (any step, either way) with a `stage_changed` event. null: not
 * there or not visible (404). The step it is at already, or one of another workspace: InvalidLeadStageError, nothing written.
 */
export async function changeLeadStage(
  tx: TenantTx,
  viewer: LeadViewer,
  change: LeadStageChange,
): Promise<LeadRow | null> {
  const lead = await lockForChange(tx, viewer, change.id, change.version);
  if (!lead) return null;
  const to = assertUuid(change.stageId, 'stageId');
  if (to === lead.stageId) throw new InvalidLeadStageError();
  const [stage] = await tx
    .select({ id: pipelineStages.id })
    .from(pipelineStages)
    .where(and(eq(pipelineStages.workspaceId, lead.workspaceId), eq(pipelineStages.id, to)));
  if (!stage) throw new InvalidLeadStageError();
  return applyChange(
    tx,
    viewer,
    lead,
    { stageId: to },
    { type: 'stage_changed', fromStageId: lead.stageId, toStageId: to },
    change.newId,
  );
}

export interface LeadClose {
  readonly id: string;
  /** The `version` last read. */
  readonly version: number;
  readonly outcome: 'won' | 'lost';
  /** Required when lost, one of the workspace's reasons in force; never when won. */
  readonly lostReason?: string;
  readonly newId: () => string;
}

/**
 * Wins or loses an open lead, for good, with a `closed` event and a `lead.closed` audit row that have the outcome and no reason (the
 * reason is the lead's). null: not there or not visible (404). A reason that is not in force: InvalidLostReasonError, nothing written.
 */
export async function closeLead(
  tx: TenantTx,
  viewer: LeadViewer,
  close: LeadClose,
): Promise<LeadRow | null> {
  if (close.outcome !== 'won' && close.outcome !== 'lost')
    throw new RangeError('outcome is won or lost');
  if ((close.outcome === 'lost') !== (close.lostReason !== undefined))
    throw new RangeError('lostReason is required when lost, and only then');
  const lead = await lockForChange(tx, viewer, close.id, close.version);
  if (!lead) return null;
  let lostReason: string | null = null;
  if (close.lostReason !== undefined) {
    lostReason = close.lostReason.trim().normalize('NFC');
    if (!(await lostReasonsInForce(tx, lead.workspaceId)).includes(lostReason))
      throw new InvalidLostReasonError();
  }
  const row = await applyChange(
    tx,
    viewer,
    lead,
    { status: close.outcome, lostReason, closedAt: sql`now()` },
    { type: 'closed', outcome: close.outcome },
    close.newId,
  );
  // The outcome only: the reason and the title are the workspace's and the agents' words, kept on the lead, never in the audit log.
  await insertAuditLog(tx, {
    id: close.newId(),
    actorUserId: assertUuid(viewer.userId, 'userId'),
    action: 'lead.closed',
    targetType: 'lead',
    targetId: lead.id,
    detail: { outcome: close.outcome },
  });
  return row;
}
