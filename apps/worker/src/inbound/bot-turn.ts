import {
  chooseTrigger,
  coreHandlers,
  step,
  type Effect,
  type TurnResult,
  type TurnStatus,
} from '@gani/bot-runtime';
import {
  ChannelWindowClosedError,
  type ChannelPolicyService,
  type ConversationStateMachine,
  type MessageService,
} from '@gani/conversations';
import {
  advanceBotSession,
  CONVERSATION_PRIORITIES,
  insertPendingDelivery,
  listBotTriggers,
  loadBotFlowVersion,
  loadConversation,
  loadCustomer,
  lockActiveBotSession,
  setConversationPriority,
  startBotSession,
  type TenantTx,
} from '@gani/db';
import { uuidv7 } from '@gani/domain';

import type { Logger } from '../logger.js';

// The scripted bot's turn on a customer's message (D1b3a, Brief P13, N184; A 01/11/2026), in the transaction of the inbound event,
// after the message is stored: a crash rolls the whole event back and the event is claimed again, so a turn is never sent twice nor
// lost. Only a conversation the bot holds (BOT_ACTIVE, no after-hours hold) gets a turn; a person's conversation never hears the bot
// (P14 Silent Co-pilot). The active session goes on; without one, the flow the message starts (chooseTrigger), and when no flow fits
// the conversation goes to a person (T02: always in hours until business hours exist, C8/C10). A bot message goes out the way an
// agent's does (N146): ChannelPolicyService.check, MessageService.append, a pending delivery. A closed window stops the turn and
// abandons the session; a broken flow is abandoned and handed over. Logs carry ids and codes only.

// prettier-ignore
export const botTurnStore = { loadConversation, lockActiveBotSession, listBotTriggers, startBotSession, loadBotFlowVersion, loadCustomer, insertPendingDelivery, advanceBotSession, setConversationPriority };
/** The SQL of packages/db the turn uses; a unit test passes a fake. */
export type BotTurnStore = typeof botTurnStore;

export interface BotTurnServices {
  readonly fsm: ConversationStateMachine;
  readonly messages: MessageService;
  readonly policy: ChannelPolicyService;
  readonly log: Logger;
  readonly store?: BotTurnStore;
}

export interface BotTurnInput {
  readonly conversationId: string;
  readonly workspaceId: string;
  readonly channelAccountId: string;
  readonly customerId: string;
  /** The text of the message; null for an image, a file or a sticker. */
  readonly text: string | null;
  /** The message made the conversation (T01): first_message flows start only then. */
  readonly firstOfConversation: boolean;
  readonly traceId: string;
  readonly now: Date;
}

export type BotTurnOutcome = 'skipped' | 'no_flow' | TurnStatus;

/** Jumps from flow to flow in one turn before the session is abandoned (jump_limit). */
export const MAX_JUMPS = 3;

/** A send effect as the customer reads it: the choices of a question numbered under its text, so "2" answers it. */
const textOf = (effect: Effect): string => {
  const choices = Array.isArray(effect.choices) ? effect.choices.map(String) : [];
  return [String(effect.text), ...choices.map((c, i) => `${i + 1}. ${c}`)].join('\n');
};

export async function runBotTurn(
  tx: TenantTx,
  services: BotTurnServices,
  input: BotTurnInput,
): Promise<BotTurnOutcome> {
  const db = services.store ?? botTurnStore;
  const conversation = await db.loadConversation(tx, input.conversationId);
  if (conversation?.state !== 'BOT_ACTIVE' || conversation.afterHoursHold) return 'skipped';
  const ids = {
    conversationId: input.conversationId,
    workspaceId: input.workspaceId,
    traceId: input.traceId,
  };
  // T02 with the reason in the history (conversation_events.detail) and the priority on the conversation (U78): the handoff node's,
  // else normal. A conversation the state machine did not move (already waiting) keeps its priority.
  const handOver = async (reason: string, priority?: unknown) => {
    const moved = await services.fsm.transition(
      tx,
      input.conversationId,
      { type: 'needs_human', inHours: true },
      { actor: { kind: 'bot' }, traceId: input.traceId, detail: { reason } },
    );
    if (moved.kind !== 'changed') return;
    const known = CONVERSATION_PRIORITIES.find((p) => p === priority);
    await db.setConversationPriority(tx, input.conversationId, known ?? 'normal');
  };

  let session = await db.lockActiveBotSession(tx, input.conversationId);
  let fresh = false;
  if (!session) {
    const chosen = chooseTrigger(await db.listBotTriggers(tx, input.workspaceId), input);
    if (!chosen) {
      await handOver('no_flow');
      return 'no_flow';
    }
    session = await db.startBotSession(tx, {
      conversationId: input.conversationId,
      versionId: chosen.versionId,
      newId: uuidv7,
    });
    fresh = true;
  }
  // A published version is frozen and a session keeps it (RESTRICT): it is always there.
  const version = await db.loadBotFlowVersion(tx, session.versionId);
  if (!version) throw new Error('the version of an active bot session is missing');
  const customer = await db.loadCustomer(tx, input.customerId);
  const handlers = coreHandlers({
    customer: { name: customer?.displayName ?? null },
    workspace: { isBusinessHours: true },
  });
  const state = { nodeKey: session.currentNodeKey, awaiting: session.awaiting, vars: session.vars };
  let turn: TurnResult = step(
    version.graph,
    state,
    fresh ? { kind: 'start' } : { kind: 'message', text: input.text ?? '' },
    handlers,
  );
  // jump_to_flow (D1b3b): the turn goes on at the trigger of the other flow's published version, in the same workspace, with the
  // session's variables; at most MAX_JUMPS a turn, so two flows that jump to each other never spin. A flow that is not there
  // (deleted, inactive, never published, another workspace) abandons the session and hands over.
  let versionId = session.versionId;
  let problem: string | undefined = turn.error;
  for (let jumps = 0; turn.status === 'completed'; jumps++) {
    const jump = turn.effects.find((e) => e.kind === 'jump');
    if (!jump) break;
    const target =
      jumps < MAX_JUMPS
        ? (await db.listBotTriggers(tx, input.workspaceId)).find((t) => t.flowId === jump.flowId)
        : undefined;
    const next = target ? await db.loadBotFlowVersion(tx, target.versionId) : null;
    if (!target || !next) {
      problem = jumps < MAX_JUMPS ? 'jump_target' : 'jump_limit';
      turn = { ...turn, status: 'abandoned' };
      break;
    }
    versionId = target.versionId;
    const after = step(
      next.graph,
      { nodeKey: null, awaiting: null, vars: turn.state.vars },
      { kind: 'start' },
      handlers,
    );
    problem = after.error;
    turn = {
      ...after,
      effects: [...turn.effects.filter((e) => e.kind !== 'jump'), ...after.effects],
      steps: [...turn.steps, ...after.steps],
    };
  }

  let windowClosed = false;
  for (const effect of turn.effects.filter((e) => e.kind === 'send')) {
    try {
      await services.policy.check(tx, input.conversationId, input.now);
    } catch (error) {
      if (!(error instanceof ChannelWindowClosedError)) throw error;
      services.log.warn('bot_window_closed', { ...ids, code: error.windowState });
      windowClosed = true;
      break;
    }
    const stored = await services.messages.append(tx, {
      conversationId: input.conversationId,
      senderKind: 'bot',
      kind: 'text',
      body: textOf(effect),
      traceId: input.traceId,
    });
    await db.insertPendingDelivery(tx, {
      id: uuidv7(),
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      messageId: stored.id,
      channelAccountId: input.channelAccountId,
    });
  }
  if (windowClosed) turn = { ...turn, status: 'abandoned' };

  await db.advanceBotSession(tx, {
    session,
    nodeKey: turn.state.nodeKey,
    awaiting: turn.status === 'active' ? turn.state.awaiting : null,
    vars: turn.state.vars,
    status: turn.status,
    steps: turn.steps,
    newId: uuidv7,
    ...(versionId === session.versionId ? {} : { versionId }),
  });
  if (problem) services.log.warn('bot_flow_broken', { ...ids, code: problem });
  if (turn.status === 'handed_off' || (turn.status === 'abandoned' && !windowClosed)) {
    const asked = turn.effects.find((e) => e.kind === 'handoff');
    const reason = typeof asked?.reason === 'string' ? asked.reason : (problem ?? 'bot_abandoned');
    await handOver(reason, asked?.priority);
  }
  return turn.status;
}

/** The bot of InboundServices over these services (main.ts and crash-main.mjs wire it the same way). */
export const createBotTurn =
  (services: BotTurnServices) =>
  (tx: TenantTx, input: BotTurnInput): Promise<BotTurnOutcome> =>
    runBotTurn(tx, services, input);
