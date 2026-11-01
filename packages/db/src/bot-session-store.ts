import { and, eq, sql } from 'drizzle-orm';

import { botFlowVersions } from './schema/bot-flows.js';
import { botSessionSteps, botSessions } from './schema/bot-sessions.js';
import { currentTenantContext } from './tenant-context.js';
import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

// The sessions of the scripted bot (D1b1b, Brief P13, N183): start one on a published version, lock the active one of a conversation,
// write the result of a turn (BotRuntime.step of @gani/bot-runtime) with its steps. Row-level security keeps them to who sees the
// conversation. The caller holds the transaction: lock, step, advance, in that order, so two turns of one conversation never interleave.

export type BotSessionStatus = 'active' | 'completed' | 'handed_off' | 'abandoned';

export interface BotSessionRow {
  readonly id: string;
  readonly conversationId: string;
  readonly versionId: string;
  readonly status: BotSessionStatus;
  readonly currentNodeKey: string | null;
  readonly awaiting: Readonly<Record<string, unknown>> | null;
  readonly vars: Readonly<Record<string, string | number | boolean>>;
  readonly recentSteps: readonly BotStepRecord[];
  readonly stepCount: number;
  readonly version: number;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
}

/** A step as bot_session_steps keeps it: never free text nor a value (the CHECK of the table). */
export interface BotStepRecord {
  readonly nodeKey: string;
  readonly nodeType: string;
  readonly edgeLabel?: string;
  readonly variable?: string;
}

/** The conversation has an active session already (bot_sessions_active_key). */
export class BotSessionActiveError extends Error {
  constructor() {
    super('the conversation has an active bot session');
    this.name = 'BotSessionActiveError';
  }
}

/** A session runs a published version only; a draft or a discarded one never runs (P13). */
export class BotVersionNotPublishedError extends Error {
  constructor() {
    super('a bot session runs a published version only');
    this.name = 'BotVersionNotPublishedError';
  }
}

/** The session changed since it was read (its version moved): the turn must be done again on the new state. */
export class BotSessionConflictError extends Error {
  constructor() {
    super('the bot session changed since it was read');
    this.name = 'BotSessionConflictError';
  }
}

const RECENT = 20;
const columns = {
  id: botSessions.id,
  conversationId: botSessions.conversationId,
  versionId: botSessions.versionId,
  status: botSessions.status,
  currentNodeKey: botSessions.currentNodeKey,
  awaiting: botSessions.awaiting,
  vars: botSessions.vars,
  recentSteps: botSessions.recentSteps,
  stepCount: botSessions.stepCount,
  version: botSessions.version,
  startedAt: botSessions.startedAt,
  endedAt: botSessions.endedAt,
};
const row = (r: Record<keyof typeof columns, unknown>) => r as unknown as BotSessionRow;

/** Starts the session of `conversationId` on the published version `versionId`. */
export async function startBotSession(
  tx: TenantTx,
  q: { readonly conversationId: string; readonly versionId: string; readonly newId: () => string },
): Promise<BotSessionRow> {
  const versionId = assertUuid(q.versionId, 'versionId');
  const [version] = await tx
    .select({ status: botFlowVersions.status })
    .from(botFlowVersions)
    .where(eq(botFlowVersions.id, versionId));
  if (version?.status !== 'published') throw new BotVersionNotPublishedError();
  try {
    const [made] = await tx.transaction((t) =>
      t
        .insert(botSessions)
        .values({
          id: assertUuid(q.newId(), 'newId'),
          orgId: currentTenantContext().orgId,
          conversationId: assertUuid(q.conversationId, 'conversationId'),
          versionId,
        })
        .returning(columns),
    );
    return row(made!);
  } catch (error) {
    for (let e: unknown = error; e instanceof Error; e = e.cause)
      if ((e as { code?: unknown }).code === '23505') throw new BotSessionActiveError();
    throw error;
  }
}

/** The active session of `conversationId`, locked until the end of the transaction, or null. */
export async function lockActiveBotSession(
  tx: TenantTx,
  conversationId: string,
): Promise<BotSessionRow | null> {
  const [found] = await tx
    .select(columns)
    .from(botSessions)
    .where(
      and(
        eq(botSessions.conversationId, assertUuid(conversationId, 'conversationId')),
        eq(botSessions.status, 'active'),
      ),
    )
    .for('update');
  return found ? row(found) : null;
}

/**
 * Writes a turn of `session` (locked before): its new node, what it waits for, its vars and status, the steps appended to
 * bot_session_steps and to the last 20 kept on the session. BotSessionConflictError when the session's version moved since it was read.
 */
export async function advanceBotSession(
  tx: TenantTx,
  q: {
    readonly session: BotSessionRow;
    readonly nodeKey: string | null;
    readonly awaiting: Readonly<Record<string, unknown>> | null;
    readonly vars: Readonly<Record<string, string | number | boolean>>;
    readonly status: BotSessionStatus;
    readonly steps: readonly BotStepRecord[];
    readonly newId: () => string;
    /** The published version the session runs from now on: a jump_to_flow moves it to the other flow's (D1b3b, P13). */
    readonly versionId?: string;
  },
): Promise<BotSessionRow> {
  const { session } = q;
  const recent = [...session.recentSteps, ...q.steps].slice(-RECENT);
  const [moved] = await tx
    .update(botSessions)
    .set({
      ...(q.versionId === undefined ? {} : { versionId: assertUuid(q.versionId, 'versionId') }),
      currentNodeKey: q.nodeKey,
      awaiting: q.awaiting,
      vars: q.vars,
      status: q.status,
      recentSteps: recent,
      stepCount: session.stepCount + q.steps.length,
      version: session.version + 1,
      updatedAt: sql`now()`,
      endedAt: q.status === 'active' ? null : sql`now()`,
    })
    .where(
      and(
        eq(botSessions.id, assertUuid(session.id, 'sessionId')),
        eq(botSessions.version, session.version),
      ),
    )
    .returning(columns);
  if (!moved) throw new BotSessionConflictError();
  if (q.steps.length > 0)
    await tx.insert(botSessionSteps).values(
      q.steps.map((s, i) => ({
        id: assertUuid(q.newId(), 'newId'),
        orgId: currentTenantContext().orgId,
        sessionId: session.id,
        conversationId: session.conversationId,
        stepIndex: session.stepCount + i,
        nodeKey: s.nodeKey,
        nodeType: s.nodeType,
        payload: {
          ...(s.edgeLabel !== undefined ? { edge_label: s.edgeLabel } : {}),
          ...(s.variable !== undefined ? { variable: s.variable } : {}),
        },
      })),
    );
  return row(moved);
}
