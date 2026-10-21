import { loadWindowFacts, readChannelPolicy, type TenantTx } from '@gani/db';
import { windowState, type WindowDecision } from '@gani/domain';

import { ChannelWindowClosedError, ConversationNotFoundError } from './errors.js';

// The one gate of a send to a channel (channel-policy-spec §3): the agent's POST /v1/conversations/{id}/messages, the outbound worker
// and the automation all ask `check`, in the transaction of the send and after the lock of the conversation, so the facts it reads
// are the ones the send commits with. The policy comes from `channel_policies` (§1, never a number here); the decision from the pure
// `windowState` of the domain package (§2).

export const channelWindowReads = { loadWindowFacts, readChannelPolicy };
export type ChannelWindowReads = typeof channelWindowReads;

/** The class of an agent's reply to the person (Zalo "tin tư vấn"). */
export const ADVISORY = 'advisory';

export class ChannelPolicyService {
  constructor(private readonly reads: ChannelWindowReads = channelWindowReads) {}

  /**
   * `open`, or ChannelWindowClosedError (422 `channel_window_closed`) with the state and the reason. Only `open` may be sent: `paid_only`
   * is refused too until there is a policy for the cost (C3, N124 F-05). A conversation without a channel, or a channel with no
   * policy in force at `now`, is refused as well (`no_policy`, N146): nothing goes out on rules nobody wrote down.
   */
  async check(
    tx: TenantTx,
    conversationId: string,
    now: Date,
    messageClass: string = ADVISORY,
  ): Promise<WindowDecision> {
    const facts = await this.reads.loadWindowFacts(tx, conversationId);
    if (!facts) throw new ConversationNotFoundError();
    const policy = facts.channelType
      ? await this.reads.readChannelPolicy(tx, facts.channelType, messageClass, now)
      : null;
    if (!policy) throw new ChannelWindowClosedError('api_closed', 'no_policy');
    const decision = windowState({
      now,
      lastCustomerMessageAt: facts.lastCustomerMessageAt,
      officialMessagesSinceCustomer: facts.officialMessagesSinceCustomer,
      policy,
    });
    if (decision.state !== 'open')
      throw new ChannelWindowClosedError(decision.state, decision.reason);
    return decision;
  }
}
