// When an official account may still send to a person on a channel (channel-policy-spec §2, C1–C5). A pure function: the caller gives
// it the facts, read in the transaction of the send, and the policy in force; nothing here reads a clock or a database, and nothing
// is stored as the truth (C2): a decision is computed again from these facts every time.

/** The part of a `channel_policies` row the decision needs. A null window means the class has no free window (a transaction message). */
export interface ChannelPolicy {
  readonly freeWindowSeconds: number | null;
  /** Free messages inside the window, counted since the last message of the person; null means no limit inside the window. */
  readonly freeMessageQuota: number | null;
  readonly outsideWindowAllowed: boolean;
}

export interface WindowFacts {
  readonly now: Date;
  /** The last message of the person in the conversation; null when they never wrote (outside the window). */
  readonly lastCustomerMessageAt: Date | null;
  /** Messages the account sent (agent, bot, system) after that message (C5). */
  readonly officialMessagesSinceCustomer: number;
  readonly policy: ChannelPolicy;
}

export type WindowState = 'open' | 'paid_only' | 'api_closed';
export type WindowReason =
  'within_window' | 'no_customer_message' | 'no_free_window' | 'window_expired' | 'quota_exhausted';

export interface WindowDecision {
  readonly state: WindowState;
  readonly reason: WindowReason;
}

/**
 * `open` inside the free window with free messages left; otherwise `paid_only` when the policy lets the account send outside it, or
 * `api_closed` when it does not. The window is open while less than `freeWindowSeconds` has passed since the person's last message:
 * at exactly the limit it is closed. A new message of the person moves `lastCustomerMessageAt` and puts the count back to 0, so the
 * window opens again with no one updating anything.
 */
export function windowState(facts: WindowFacts): WindowDecision {
  const { policy } = facts;
  const outside = (reason: WindowReason): WindowDecision => ({
    state: policy.outsideWindowAllowed ? 'paid_only' : 'api_closed',
    reason,
  });
  if (policy.freeWindowSeconds === null) return outside('no_free_window');
  if (facts.lastCustomerMessageAt === null) return outside('no_customer_message');
  const elapsedMs = facts.now.getTime() - facts.lastCustomerMessageAt.getTime();
  if (elapsedMs >= policy.freeWindowSeconds * 1000) return outside('window_expired');
  const quota = policy.freeMessageQuota;
  if (quota !== null && facts.officialMessagesSinceCustomer >= quota)
    return outside('quota_exhausted');
  return { state: 'open', reason: 'within_window' };
}
