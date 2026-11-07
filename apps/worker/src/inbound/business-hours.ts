import { listDaysOff, readWorkingWeek, type TenantTx } from '@gani/db';
import { isOpen, localTime } from '@gani/domain';

// Whether a workspace is open at a moment (C10-4a, Brief F6/P14, N192): its week (the default one, Monday to Friday 08:00–17:30, break 12:00–13:00, while
// none is set) and its days off, in its time zone. The state machine never reads a clock: the caller gives it `inHours`, so a customer
// who needs a person goes to the queue (T02) in hours and is held (T03, after_hours_hold) outside them.

export const businessHoursStore = { readWorkingWeek, listDaysOff };
/** The SQL of packages/db the check uses; a unit test passes a fake. */
export type BusinessHoursStore = typeof businessHoursStore;

/** Whether the workspace `workspaceId`, of the transaction's organisation, is open at `at`; fails loud when it is not visible. */
export async function workspaceOpenAt(
  tx: TenantTx,
  store: BusinessHoursStore,
  workspaceId: string,
  at: Date,
): Promise<boolean> {
  const hours = await store.readWorkingWeek(tx, workspaceId);
  if (!hours) throw new Error('the workspace is not visible in the transaction');
  // Only the days off that end today or later can hold `at`.
  const daysOff = await store.listDaysOff(tx, workspaceId, localTime(at, hours.timezone).date);
  return isOpen({ week: hours.week, daysOff, timeZone: hours.timezone }, at);
}
