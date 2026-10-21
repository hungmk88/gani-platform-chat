import {
  applyTransition,
  insertConversation,
  insertConversationEvent,
  insertOutboxEvent,
  loadConversation,
  type ConversationRow,
  type TenantTx,
} from '@gani/db';
import {
  CONVERSATION_OUTCOMES,
  CONVERSATION_STATES,
  InvalidTransitionError,
  decide,
  uuidv7,
  type ConversationEffect,
  type ConversationEvent,
  type ConversationSnapshot,
  type DecideResult,
  type NoChangeReason,
  type TransitionId,
} from '@gani/domain';

import {
  ConversationAlreadyClaimedError,
  ConversationContendedError,
  ConversationNotFoundError,
  MissingExpectedVersionError,
  VersionConflictError,
} from './errors.js';
import { OutboxWriter, conversationOutboxEvent } from './outbox-writer.js';

// prettier-ignore
export const conversationStore = { loadConversation, insertConversation, applyTransition, insertConversationEvent, insertOutboxEvent };
/** The functions of the conversation store and of the outbox the state machine writes through; a test passes a fake. */
export type ConversationStore = typeof conversationStore;

export interface Actor {
  readonly kind: 'customer' | 'agent' | 'bot' | 'system' | 'platform_operator';
  readonly id?: string;
}
export interface TransitionOptions {
  readonly actor: Actor;
  /** Explicit: the request context carries none (N96). */
  readonly traceId: string;
  /** The version the client saw. Required for the actions of a person; ignored for a claim. */
  readonly expectedVersion?: number;
}
export interface ConversationRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly version: number;
  readonly snapshot: ConversationSnapshot;
}
// prettier-ignore
export type TransitionOutcome =
  | { readonly kind: 'changed'; readonly conversation: ConversationRecord; readonly transition: TransitionId; readonly effects: readonly ConversationEffect[] }
  | { readonly kind: 'unchanged'; readonly reason: NoChangeReason };

// Actions of a person carry the version they saw (FSM spec §6); a claim does not (the state test decides); the rest are system events.
const OF_A_PERSON: ReadonlySet<TransitionId> = new Set(['T09', 'T12', 'T13', 'T15', 'T16', 'T21']);
const CLAIMS: ReadonlySet<TransitionId> = new Set(['T05', 'T06']);
const MAX_ATTEMPTS = 3;

// prettier-ignore
function toRecord(row: ConversationRow): ConversationRecord {
  const state = CONVERSATION_STATES.find((s) => s === row.state);
  const outcome = row.outcome === null ? null : CONVERSATION_OUTCOMES.find((o) => o === row.outcome);
  if (!state || outcome === undefined) throw new Error('conversation row holds a state or outcome the table does not know');
  const { id, workspaceId, version, assignedUserId, afterHoursHold, closedAt } = row;
  return { id, workspaceId, version, snapshot: { state, afterHoursHold, assignedUserId, closedAt, outcome } };
}
// prettier-ignore
const changed = (row: ConversationRow, d: { transition: TransitionId; effects: readonly ConversationEffect[] }): TransitionOutcome => ({
  kind: 'changed', conversation: toRecord(row), transition: d.transition, effects: d.effects,
});

/**
 * The only module that changes the state of a conversation (CLAUDE.md rule 4). Every method takes the caller's `TenantTx` and never
 * commits, so a message, its transition and its history are one transaction. It decides with the pure `decide` of the domain package
 * and writes through the conversation store: the new state, the rows of the outbox for each of its effects, and the history, in that
 * order, on the one transaction. The history goes last on purpose: if it fails, the rollback has to take the outbox rows away too.
 */
export class ConversationStateMachine {
  constructor(
    private readonly store: ConversationStore = conversationStore,
    private readonly outbox: OutboxWriter = new OutboxWriter(store),
  ) {}

  /** T01: a new conversation in `workspaceId`, `BOT_ACTIVE`, version 0; of a person of a channel account when `channel` is given. */
  async create(
    tx: TenantTx,
    input: {
      workspaceId: string;
      actor: Actor;
      traceId: string;
      channel?: { channelAccountId: string; externalUserId: string };
    },
  ): Promise<TransitionOutcome> {
    const decision = decide(null, { type: 'conversation_started' });
    if (decision.kind !== 'transition')
      throw new Error('conversation_started must be a transition');
    const row = await this.store.insertConversation(tx, {
      id: uuidv7(),
      workspaceId: input.workspaceId,
      channel: input.channel,
      ...decision.next,
    });
    await this.record(tx, toRecord(row), null, decision, input);
    return changed(row, decision);
  }

  /**
   * Applies `event` to the conversation, or says why not. A claim that finds the conversation held (or loses the race) is
   * `ConversationAlreadyClaimedError`; an action of a person on a stale version is `VersionConflictError`; a system event that
   * loses the race re-reads and decides again, up to three times (and a re-read that makes it a no-op just ends it).
   */
  async transition(
    tx: TenantTx,
    id: string,
    event: ConversationEvent,
    options: TransitionOptions,
  ): Promise<TransitionOutcome> {
    for (let attempt = 1; ; attempt++) {
      const row = await this.store.loadConversation(tx, id);
      if (!row) throw new ConversationNotFoundError();
      const current = toRecord(row).snapshot;
      let decision: DecideResult;
      try {
        decision = decide(current, event);
      } catch (error) {
        const held = current.state === 'HUMAN_ACTIVE' || current.state === 'PENDING_CUSTOMER';
        if (error instanceof InvalidTransitionError && event.type === 'claim' && held)
          throw new ConversationAlreadyClaimedError(current.assignedUserId);
        throw error;
      }
      if (decision.kind === 'no_change') return { kind: 'unchanged', reason: decision.reason };
      const ofAPerson = OF_A_PERSON.has(decision.transition);
      const version = ofAPerson ? options.expectedVersion : undefined;
      if (ofAPerson && version === undefined)
        throw new MissingExpectedVersionError(decision.transition);
      if (version !== undefined && version !== row.version) throw new VersionConflictError();
      const written = await this.store.applyTransition(tx, {
        id,
        from: { state: row.state, afterHoursHold: row.afterHoursHold },
        ...(version === undefined ? {} : { expectedVersion: version }),
        next: decision.next,
      });
      if (written) {
        await this.record(tx, toRecord(written), row, decision, options);
        return changed(written, decision);
      }
      if (CLAIMS.has(decision.transition))
        throw new ConversationAlreadyClaimedError(
          (await this.store.loadConversation(tx, id))?.assignedUserId ?? null,
        );
      if (ofAPerson) throw new VersionConflictError();
      if (attempt >= MAX_ATTEMPTS) throw new ConversationContendedError(attempt);
    }
  }

  /**
   * A customer wrote (inbound spec §4): T10/T11 from `PENDING_CUSTOMER`, T14 from `CLOSED` within 72 hours, nothing else changes. The
   * caller says whether an agent is `agentOnline` (presence is S4, so there is no default: a silent one would change what happens to
   * the customer). The message itself is stored by `MessageService`, in the same transaction and before this call.
   */
  onCustomerMessage(
    tx: TenantTx,
    conversationId: string,
    input: { readonly now: Date; readonly agentOnline: boolean; readonly traceId: string },
  ): Promise<TransitionOutcome> {
    const event: ConversationEvent = {
      type: 'customer_message',
      now: input.now,
      agentOnline: input.agentOnline,
    };
    return this.transition(tx, conversationId, event, {
      actor: { kind: 'customer' },
      traceId: input.traceId,
    });
  }

  // prettier-ignore
  private async record(
    tx: TenantTx,
    row: ConversationRecord,
    from: ConversationRow | null,
    d: { transition: TransitionId; history: string; next: ConversationSnapshot; effects: readonly ConversationEffect[] },
    by: { actor: Actor; traceId: string },
  ): Promise<void> {
    const fact = { conversationId: row.id, workspaceId: row.workspaceId, version: row.version, transition: d.transition, from, to: d.next, actor: by.actor, traceId: by.traceId };
    for (const effect of d.effects) await this.outbox.add(tx, conversationOutboxEvent(effect, fact));
    await this.store.insertConversationEvent(tx, {
      id: uuidv7(), conversationId: row.id, eventType: d.history, fromState: from?.state ?? null, toState: d.next.state,
      fromHold: from?.afterHoursHold ?? null, toHold: d.next.afterHoursHold, actorKind: by.actor.kind, actorId: by.actor.id ?? null,
      versionAfter: row.version, outcome: d.next.outcome, traceId: by.traceId, detail: { transition: d.transition },
    });
  }
}
