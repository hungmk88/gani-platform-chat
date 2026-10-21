import type { Logger } from '../logger.js';
import type { EventHandler, EventHandlers } from './event-consumer.js';

/**
 * The handlers until the realtime emitter (V8): each event the inbox will show is logged by its ids, which is what the tests of the
 * chain see. Logging twice is harmless, so they are idempotent. The other types are left to `event_unhandled`.
 */
export function loggingHandlers(log: Logger): EventHandlers {
  const consumed: EventHandler = (event) => {
    log.info('event_consumed', {
      eventId: event.id,
      type: event.type,
      orgId: event.orgId,
      workspaceId: event.workspaceId,
    });
    return Promise.resolve();
  };
  return {
    'message.created': consumed,
    'conversation.created': consumed,
    'conversation.state_changed': consumed,
    'conversation.assigned': consumed,
  };
}
