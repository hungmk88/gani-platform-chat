import {
  PLATFORM_CLOCK_SKEW_WARN_SECONDS,
  PLATFORM_TIME_FLOOR_DAYS,
  insertMessage,
  insertOutboxEvent,
  loadConversation,
  type MessageKind,
  type MessageSenderKind,
  type StoredMessage,
  type TenantTx,
} from '@gani/db';
import { uuidv7 } from '@gani/domain';
import { Logger } from '@nestjs/common';

import { ConversationStateMachine, type TransitionOutcome } from './conversation-state-machine.js';
import { ConversationNotFoundError, InvalidMessageError } from './errors.js';
import { OutboxWriter, messageCreatedOutboxEvent } from './outbox-writer.js';

// prettier-ignore
export const messageStore = { loadConversation, insertMessage, insertOutboxEvent };
/** The functions of the stores the message service writes through; a test passes a fake. */
export type MessageStore = typeof messageStore;

export interface AppendMessageInput {
  readonly conversationId: string;
  readonly senderKind: MessageSenderKind;
  /** The person who sent it. Only an agent has one. */
  readonly senderUserId?: string | null;
  readonly kind: MessageKind;
  /** What was said: PII. It goes to the database and nowhere else; no error of this service repeats it. */
  readonly body?: string | null;
  readonly platformMessageId?: string | null;
  readonly platformSentAt?: Date | null;
  /** Names the request in the logs of whatever this service calls. */
  readonly traceId: string;
}

export interface ReceiveCustomerMessageInput extends Omit<
  AppendMessageInput,
  'senderKind' | 'senderUserId'
> {
  /** Whether an agent is online: presence is S4, so the caller says and there is no default (N107). */
  readonly agentOnline: boolean;
  /** The time of the event for the state machine (the reopen window is counted from it). Absent: now. */
  readonly now?: Date;
}

function check(input: AppendMessageInput): void {
  const hasUser = typeof input.senderUserId === 'string' && input.senderUserId !== '';
  if (input.senderKind === 'agent' && !hasUser) throw new InvalidMessageError('agent_needs_user');
  if (input.senderKind !== 'agent' && hasUser) throw new InvalidMessageError('only_agent_has_user');
  if (input.kind === 'text' && (input.body ?? '').trim() === '')
    throw new InvalidMessageError('text_needs_body');
}

/**
 * Stores the messages of a conversation (inbound spec §4). Every method takes the caller's `TenantTx` and never commits, so a message
 * and the state change it causes are one transaction (FSM spec §4). The SQL is in `packages/db` (`insertMessage`).
 *
 * LOCK ORDER (N107, review AR-05): `insertMessage` and the state machine's `applyTransition` both take the conversation's lock before
 * they update its row (packages/db conversation-lock.ts), so a message and a transition may come in either order in one transaction
 * (a claim, then the agent's first reply) without a deadlock (40P01). `receiveCustomerMessage` stores the message first.
 */
export class MessageService {
  private readonly logger = new Logger(MessageService.name);

  constructor(
    private readonly fsm: ConversationStateMachine,
    private readonly store: MessageStore = messageStore,
    private readonly outbox: OutboxWriter = new OutboxWriter(store),
  ) {}

  /**
   * Adds a message to a conversation the tenant can see (`ConversationNotFoundError` otherwise, 404), after checking it: an agent has
   * a `senderUserId` and nobody else does; a text has a body (an image, a file or a sticker may have none). The rule that broke is
   * named by `InvalidMessageError`, and the error never carries the message. Writes `message.created` to the outbox right after the
   * message, in the same transaction: both stay or both go. Returns its id and `sequence_number`.
   */
  async append(tx: TenantTx, input: AppendMessageInput): Promise<StoredMessage> {
    check(input);
    const conversation = await this.store.loadConversation(tx, input.conversationId);
    if (!conversation) throw new ConversationNotFoundError();
    const stored = await this.store.insertMessage(tx, {
      id: uuidv7(),
      conversationId: conversation.id,
      workspaceId: conversation.workspaceId,
      senderKind: input.senderKind,
      senderUserId: input.senderUserId ?? null,
      kind: input.kind,
      body: input.body ?? null,
      platformMessageId: input.platformMessageId ?? null,
      platformSentAt: input.platformSentAt ?? null,
    });
    const ahead = stored.platformSentAtAheadSeconds;
    if (ahead !== null && ahead > PLATFORM_CLOCK_SKEW_WARN_SECONDS) {
      // Ids and a number only: the time was clamped to now() by the store (N116), this is for whoever looks at the platform's clock.
      this.logger.warn(
        `platform time ahead by ${Math.round(ahead)}s, clamped: message=${stored.id} conversation=${conversation.id} workspace=${conversation.workspaceId} trace=${input.traceId}`,
      );
    }
    const behind = stored.platformSentAtBehindSeconds;
    if (behind !== null) {
      // Ids and a number only: older than the floor, so the store clamped it to the floor (N117). Clock skew backward, or a bad time.
      this.logger.warn(
        `clock skew backward: platform time ${Math.round(behind)}s behind, more than ${PLATFORM_TIME_FLOOR_DAYS} days, clamped: message=${stored.id} conversation=${conversation.id} workspace=${conversation.workspaceId} trace=${input.traceId}`,
      );
    }
    await this.outbox.add(
      tx,
      messageCreatedOutboxEvent({
        conversationId: conversation.id,
        workspaceId: conversation.workspaceId,
        messageId: stored.id,
        sequenceNumber: stored.sequenceNumber,
        senderKind: input.senderKind,
        senderUserId: input.senderUserId ?? null,
        traceId: input.traceId,
      }),
    );
    return stored;
  }

  /**
   * The one way a customer's message comes in: the message is stored, then the state machine decides what it means for the
   * conversation, both in the caller's transaction. A message never stays without its state change, and the lock order above holds.
   *
   * A conversation that is `CLOSED` for more than 72 hours is not reopened (N2): the message is stored in it and the outcome is
   * `unchanged`. **The caller must check that BEFORE calling, and start a new conversation instead** (inbound spec §3, step 3): this
   * method follows the state machine and has no policy of its own (N107).
   */
  async receiveCustomerMessage(
    tx: TenantTx,
    input: ReceiveCustomerMessageInput,
  ): Promise<{ readonly message: StoredMessage; readonly outcome: TransitionOutcome }> {
    const { agentOnline, now, ...message } = input;
    const stored = await this.append(tx, { ...message, senderKind: 'customer' });
    const outcome = await this.fsm.onCustomerMessage(tx, input.conversationId, {
      now: now ?? new Date(),
      agentOnline,
      traceId: input.traceId,
    });
    return { message: stored, outcome };
  }
}
