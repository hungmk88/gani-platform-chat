import {
  localTime,
  sameSla,
  slaAtHours,
  type ConversationSla,
  type WorkSchedule,
} from '@gani/domain';
import {
  insertOutboxEvent,
  listDaysOff,
  loadConversation,
  lockConversation,
  readWorkingWeek,
  setConversationSla,
  type ConversationRow,
  type TenantTx,
} from '@gani/db';

import { ConversationNotFoundError } from './errors.js';
import { OutboxWriter, slaChangedOutboxEvent } from './outbox-writer.js';

/** The SLA a conversation row holds (E3), or null. */
export const slaOfRow = (row: ConversationRow): ConversationSla | null =>
  row.slaDueAt === null
    ? null
    : {
        dueAt: row.slaDueAt,
        pausedReason:
          row.slaPausedReason === 'waiting_customer' || row.slaPausedReason === 'outside_hours'
            ? row.slaPausedReason
            : null,
        remainingSeconds: row.slaRemainingSeconds,
      };

type ScheduleStore = Pick<typeof slaClockStore, 'readWorkingWeek' | 'listDaysOff'>;

/** The working week and the days off of a workspace from the local date of `at` (E2, E3): what an SLA is reckoned in. */
export async function readSchedule(
  store: ScheduleStore,
  tx: TenantTx,
  workspaceId: string,
  at: Date,
): Promise<WorkSchedule> {
  const hours = await store.readWorkingWeek(tx, workspaceId);
  if (!hours) throw new ConversationNotFoundError();
  const daysOff = await store.listDaysOff(tx, workspaceId, localTime(at, hours.timezone).date);
  return { week: hours.week, daysOff, timeZone: hours.timezone };
}

export const slaClockStore = {
  lockConversation,
  loadConversation,
  readWorkingWeek,
  listDaysOff,
  setConversationSla,
  insertOutboxEvent,
};
/** The functions the SLA clock writes through; a test passes a fake. */
export type SlaClockStore = typeof slaClockStore;

/**
 * The opening hours of a workspace moving the SLA of one of its conversations (E4b, N211): for the job that looks each minute. It
 * takes the lock of the conversation first, as every write of a conversation does (N107), so a transition of the state machine and
 * this never cross: what it reads is what it changes. Then `slaAtHours` at `now`, and, when the SLA changed, the SLA and one row
 * `conversation.sla_changed` (E4a) in the one transaction of the caller. Not a transition: the state and the version stay.
 */
export class SlaClock {
  constructor(
    private readonly store: SlaClockStore = slaClockStore,
    private readonly outbox: OutboxWriter = new OutboxWriter(store),
  ) {}

  /** Moves the SLA of the conversation `id` as the hours of its workspace say at `now`; true when it changed. */
  async atHours(tx: TenantTx, id: string, now: Date, traceId: string): Promise<boolean> {
    await this.store.lockConversation(tx, id);
    const row = await this.store.loadConversation(tx, id);
    if (!row) return false;
    const had = slaOfRow(row);
    if (had === null || had.pausedReason === 'waiting_customer') return false;
    const next = slaAtHours(had, now, await readSchedule(this.store, tx, row.workspaceId, now));
    if (sameSla(had, next)) return false;
    await this.store.setConversationSla(tx, id, next);
    await this.outbox.add(
      tx,
      slaChangedOutboxEvent({
        conversationId: id,
        workspaceId: row.workspaceId,
        version: row.version,
        actor: { kind: 'system' },
        traceId,
      }),
    );
    return true;
  }
}
