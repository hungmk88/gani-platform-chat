// Errors of the conversation state machine. `status` and `code` are what a controller's exception filter will answer with (P9,
// RFC 9457); `InvalidTransitionError` comes from the domain package with code `invalid_transition` (409, F6).

export class ConversationNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'not_found';
  constructor() {
    super('conversation not found');
    this.name = 'ConversationNotFoundError';
  }
}

/** Somebody else holds the conversation; `assignedUserId` lets the client say who (P9). */
export class ConversationAlreadyClaimedError extends Error {
  readonly status = 409;
  readonly code = 'conversation_already_claimed';
  constructor(readonly assignedUserId: string | null) {
    super('conversation already claimed');
    this.name = 'ConversationAlreadyClaimedError';
  }
  /** Added to the 409 body by ProblemFilter (PRR-05): an id, which the person may see once the conversation is in their workspace. */
  get problemExtensions() {
    return { assignedUserId: this.assignedUserId };
  }
}

/** Transfer or assign to someone who cannot hold it: one answer for every reason, so nobody learns who is a member (P9). */
export class InvalidAssigneeError extends Error {
  readonly status = 422;
  readonly code = 'invalid_assignee';
  constructor() {
    super('This person cannot take the conversation.');
    this.name = 'InvalidAssigneeError';
  }
}

/** The client acted on a version that is no longer current: reload and try again. */
export class VersionConflictError extends Error {
  readonly status = 409;
  readonly code = 'version_conflict';
  constructor() {
    super('conversation changed since it was read');
    this.name = 'VersionConflictError';
  }
}

/**
 * The channel may not carry this message now (channel-policy-spec §3, P9): outside the free window, past the free messages, paid only
 * (blocked in M1.3, C3), or no policy at all. Nothing was written and the channel was not called (C-N4).
 */
export class ChannelWindowClosedError extends Error {
  readonly status = 422;
  readonly code = 'channel_window_closed';
  constructor(
    readonly windowState: 'paid_only' | 'api_closed',
    readonly reason: string,
  ) {
    super('the channel window is closed');
    this.name = 'ChannelWindowClosedError';
  }
  /** Added to the 422 body by ProblemFilter: what the client shows instead of the composer (Phụ lục #13). */
  get problemExtensions() {
    return { windowState: this.windowState, reason: this.reason };
  }
}

/** A system event lost the race three times: not an answer for a user, the job that raised it is retried (N96). */
export class ConversationContendedError extends Error {
  readonly code = 'conversation_contended';
  constructor(readonly attempts: number) {
    super(`conversation kept changing under the event (${attempts} attempts)`);
    this.name = 'ConversationContendedError';
  }
}

/** A bug in the caller: an action of a person (T09, T12, T13, T15, T16, T21) must say which version it saw. */
export class MissingExpectedVersionError extends Error {
  constructor(readonly transition: string) {
    super(`transition ${transition} needs expectedVersion`);
    this.name = 'MissingExpectedVersionError';
  }
}

/** What is wrong with a message the caller asked to store: a fixed sentence, never a part of the message. */
export type InvalidMessageReason = 'agent_needs_user' | 'only_agent_has_user' | 'text_needs_body';

/** A bug in the caller: the message breaks a rule of the message service. The error says which rule, and never repeats the message. */
export class InvalidMessageError extends Error {
  readonly code = 'invalid_message';
  constructor(readonly reason: InvalidMessageReason) {
    super(`invalid message: ${reason}`);
    this.name = 'InvalidMessageError';
  }
}
