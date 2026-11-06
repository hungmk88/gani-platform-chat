// The SLA of a conversation in the Inbox (U81, #626; CEO brief 116, which replaces brief 84 for this): the chip of a row and the
// filter `sla`, from the API only. No threshold of the FE (no "15 minutes"): "sắp quá hạn" is the API's `sla=due_soon`; a warning
// colour comes with Q7/U40 when the contract gives one. Until Q7 the API sends `sla: null` and the filter answers nothing.
import { useSyncExternalStore } from 'react';

import type { Conversation } from './list';

export type SlaFilter = 'all' | 'due_soon' | 'overdue';
export const SLA_FILTER: Readonly<Record<SlaFilter, string>> = {
  all: 'Tất cả',
  due_soon: 'Sắp quá hạn',
  overdue: 'Quá hạn',
};

const MINUTE = 60_000;

/**
 * The chip of a row (brief 116), or null for none: a closed conversation without SLA has no chip; an open one says it has none;
 * a paused SLA says why, grey, without counting; else the minutes left, plain, or the minutes past `dueAt`, red. `now` is null
 * until the browser's time is known (hydration): no count is shown then.
 */
export function slaChipOf(
  c: Pick<Conversation, 'state'> & { readonly sla?: Conversation['sla'] },
  now: number | null,
): { readonly text: string; readonly tone: 'faint' | 'paused' | 'plain' | 'overdue' } | null {
  const sla = c.sla ?? null;
  if (!sla) return c.state === 'CLOSED' ? null : { text: 'Chưa có SLA', tone: 'faint' };
  if (sla.pausedReason === 'waiting_customer')
    return { text: 'SLA tạm dừng · chờ khách', tone: 'paused' };
  if (sla.pausedReason === 'outside_hours')
    return { text: 'SLA tạm dừng · ngoài giờ', tone: 'paused' };
  if (now === null) return null;
  const left = Date.parse(sla.dueAt) - now;
  if (left > 0) return { text: `Còn ${Math.ceil(left / MINUTE)} phút`, tone: 'plain' };
  return { text: `Quá hạn ${Math.max(1, Math.ceil(-left / MINUTE))} phút`, tone: 'overdue' };
}

/** The classes of a chip: red only past `dueAt`; grey otherwise (the tokens of a state, apps/admin/CLAUDE.md). */
export const SLA_TONE: Readonly<Record<'faint' | 'paused' | 'plain' | 'overdue', string>> = {
  faint: 'text-text-muted',
  paused: 'bg-bg-subtle text-text-muted',
  plain: '',
  overdue: 'bg-error-bg font-semibold text-error-text',
};

// The browser's clock, by steps of 30 s: the same number between two steps (a stable snapshot), null on the server and while
// hydrating so both render the same (React #418, as `useBrowserNow` of #28).
const STEP = 30_000;
const subscribe = (tick: () => void) => {
  const id = setInterval(tick, STEP);
  return () => clearInterval(id);
};
const snapshot = () => Math.floor(Date.now() / STEP) * STEP;
const serverNull = () => null;
export const useClock = (): number | null => useSyncExternalStore(subscribe, snapshot, serverNull);
