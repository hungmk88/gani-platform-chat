import {
  insertMessage,
  loadConversation,
  type MessageKind,
  type MessageSenderKind,
  type StoredMessage,
  type TenantTx,
} from '@gani/db';
import { uuidv7 } from '@gani/domain';

import { ConversationStateMachine, type TransitionOutcome } from './conversation-state-machine.js';
import { ConversationNotFoundError, InvalidMessageError } from './errors.js';

// prettier-ignore
export const messageStore = { loadConversation, insertMessage };
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
 * LOCK ORDER (N107): `insertMessage` takes the advisory lock of the conversation and only then updates its row. Whatever else changes
 * the conversation in the same transaction must come after the message, never before it: `receiveCustomerMessage` does it in that
 * order. A path that changed the conversation first could wait for a writer that holds the lock and wants the row (deadlock, 40P01).
 */
export class MessageService {
  constructor(
    private readonly fsm: ConversationStateMachine,
    private readonly store: MessageStore = messageStore,
  ) {}

  /**
   * Adds a message to a conversation the tenant can see (`ConversationNotFoundError` otherwise, 404), after checking it: an agent has
   * a `senderUserId` and nobody else does; a text has a body (an image, a file or a sticker may have none). The rule that broke is
   * named by `InvalidMessageError`, and the error never carries the message. Returns its id and `sequence_number`.
   */
  async append(tx: TenantTx, input: AppendMessageInput): Promise<StoredMessage> {
    check(input);
    const conversation = await this.store.loadConversation(tx, input.conversationId);
    if (!conversation) throw new ConversationNotFoundError();
    return this.store.insertMessage(tx, {
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
