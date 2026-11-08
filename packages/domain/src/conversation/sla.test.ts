import { describe, expect, it } from 'vitest';

import type { WorkingWeek } from '../workspace/business-hours.js';
import type { WorkSchedule } from '../workspace/working-time.js';
import { sameSla, slaAfterTransition, slaAtHours, type ConversationSla } from './sla.js';

// The SLA after each kind of transition (E3a; N208), in the working time of Q7 (provisional): Monday to Friday 08:00–17:30, break
// 12:00–13:00, Hồ Chí Minh City. 2026-11-03 is a Tuesday.
const DAY = { opensAt: '08:00', closesAt: '17:30', breakStartsAt: '12:00', breakEndsAt: '13:00' };
const WEEK: WorkingWeek = [DAY, DAY, DAY, DAY, DAY, null, null];
const s: WorkSchedule = { week: WEEK, daysOff: [], timeZone: 'Asia/Ho_Chi_Minh' };
const at = (local: string) => new Date(`${local}+07:00`);
const running = (due: string): ConversationSla => ({
  dueAt: at(due),
  pausedReason: null,
  remainingSeconds: null,
});
const paused = (due: string, left: number): ConversationSla => ({
  dueAt: at(due),
  pausedReason: 'waiting_customer',
  remainingSeconds: left,
});

describe('slaAfterTransition', () => {
  it('starts 60 working minutes when the bot hands over to the queue (T02, T08)', () => {
    expect(
      slaAfterTransition(null, 'BOT_ACTIVE', 'HUMAN_WAITING_Q', at('2026-11-03T09:00:00'), s),
    ).toEqual(running('2026-11-03T10:00:00'));
  });

  it('starts again from 0 when an agent is away (T17, T19), with no time of the one before', () => {
    expect(
      slaAfterTransition(
        running('2026-11-03T09:10:00'),
        'HUMAN_ACTIVE',
        'HUMAN_WAITING_Q',
        at('2026-11-03T09:50:00'),
        s,
      ),
    ).toEqual(running('2026-11-03T10:50:00'));
  });

  it('starts again from 0 when the customer answers while the agent is offline (T11): all three columns reset (E3-1)', () => {
    expect(
      slaAfterTransition(
        paused('2026-11-03T10:00:00', 1200),
        'PENDING_CUSTOMER',
        'HUMAN_WAITING_Q',
        at('2026-11-04T15:00:00'),
        s,
      ),
    ).toEqual(running('2026-11-04T16:00:00'));
  });

  it('resumes with what was left when the customer answers and the agent is online (T10, Q-c)', () => {
    expect(
      slaAfterTransition(
        paused('2026-11-03T10:00:00', 1200),
        'PENDING_CUSTOMER',
        'HUMAN_ACTIVE',
        at('2026-11-04T15:00:00'),
        s,
      ),
    ).toEqual(running('2026-11-04T15:20:00'));
  });

  it('keeps the old due time when nothing was left as it paused (Q-c): overdue at once', () => {
    expect(
      slaAfterTransition(
        paused('2026-11-03T10:00:00', 0),
        'PENDING_CUSTOMER',
        'HUMAN_ACTIVE',
        at('2026-11-04T15:00:00'),
        s,
      ),
    ).toEqual(running('2026-11-03T10:00:00'));
  });

  it('pauses when the agent waits for the customer (T09), with the working seconds left, 0 when already overdue', () => {
    expect(
      slaAfterTransition(
        running('2026-11-03T10:00:00'),
        'HUMAN_ACTIVE',
        'PENDING_CUSTOMER',
        at('2026-11-03T09:40:00'),
        s,
      ),
    ).toEqual(paused('2026-11-03T10:00:00', 1200));
    expect(
      slaAfterTransition(
        running('2026-11-03T10:00:00'),
        'HUMAN_ACTIVE',
        'PENDING_CUSTOMER',
        at('2026-11-03T10:30:00'),
        s,
      ),
    ).toEqual(paused('2026-11-03T10:00:00', 0));
  });

  it('keeps the SLA through a claim from the queue, a transfer and a reassignment (T05, T15, T16, T21)', () => {
    const had = running('2026-11-03T10:00:00');
    expect(
      slaAfterTransition(had, 'HUMAN_WAITING_Q', 'HUMAN_ACTIVE', at('2026-11-03T09:30:00'), s),
    ).toBe(had);
    expect(
      slaAfterTransition(had, 'HUMAN_ACTIVE', 'HUMAN_ACTIVE', at('2026-11-03T09:30:00'), s),
    ).toBe(had);
  });

  it('starts one when an agent claims a held conversation of the bot (T06), or has none yet', () => {
    expect(
      slaAfterTransition(null, 'BOT_ACTIVE', 'HUMAN_ACTIVE', at('2026-11-03T16:00:00'), s),
    ).toEqual(running('2026-11-03T17:00:00'));
    expect(
      slaAfterTransition(null, 'HUMAN_WAITING_Q', 'HUMAN_ACTIVE', at('2026-11-03T16:00:00'), s),
    ).toEqual(running('2026-11-03T17:00:00'));
  });

  it('has none with the bot or once closed (T03, T04, T07, T12, T13, T14, T18, T20)', () => {
    for (const to of ['BOT_ACTIVE', 'CLOSED'] as const)
      expect(
        slaAfterTransition(
          running('2026-11-03T10:00:00'),
          'HUMAN_ACTIVE',
          to,
          at('2026-11-03T09:00:00'),
          s,
        ),
      ).toBeNull();
  });

  it('keeps a pause that is already one, and a running SLA in the queue', () => {
    const p = paused('2026-11-03T10:00:00', 600);
    expect(
      slaAfterTransition(p, 'PENDING_CUSTOMER', 'PENDING_CUSTOMER', at('2026-11-03T11:00:00'), s),
    ).toBe(p);
    const r = running('2026-11-03T10:00:00');
    expect(
      slaAfterTransition(r, 'HUMAN_WAITING_Q', 'HUMAN_WAITING_Q', at('2026-11-03T09:30:00'), s),
    ).toBe(r);
  });
});

describe('sameSla', () => {
  it('compares the due time, the pause and what was left', () => {
    expect(sameSla(null, null)).toBe(true);
    expect(sameSla(running('2026-11-03T10:00:00'), running('2026-11-03T10:00:00'))).toBe(true);
    expect(sameSla(running('2026-11-03T10:00:00'), null)).toBe(false);
    expect(sameSla(running('2026-11-03T10:00:00'), paused('2026-11-03T10:00:00', 0))).toBe(false);
    expect(sameSla(paused('2026-11-03T10:00:00', 0), paused('2026-11-03T10:00:00', 60))).toBe(
      false,
    );
  });
});

// The opening hours move the clock (E4b, N211; CEO 07/11/2026, 2.4). 2026-11-03 is a Tuesday in Hồ Chí Minh City.
describe('slaAtHours', () => {
  const outside = (due: string, left: number): ConversationSla => ({
    dueAt: at(due),
    pausedReason: 'outside_hours',
    remainingSeconds: left,
  });

  it('pauses a running SLA at 17:30, keeping its due time and the working seconds left', () => {
    expect(slaAtHours(running('2026-11-04T08:20:00'), at('2026-11-03T17:30:00'), s)).toEqual(
      outside('2026-11-04T08:20:00', 1200),
    );
  });

  it('runs it again at 08:00 the next day from now with what was left; nothing left keeps the old due time (Q-c)', () => {
    expect(slaAtHours(outside('2026-11-04T08:20:00', 1200), at('2026-11-04T08:00:00'), s)).toEqual(
      running('2026-11-04T08:20:00'),
    );
    expect(slaAtHours(outside('2026-11-03T17:00:00', 0), at('2026-11-04T08:00:00'), s)).toEqual(
      running('2026-11-03T17:00:00'),
    );
  });

  it('pauses over the break, 12:00–13:00, and runs again at 13:00', () => {
    const paused12 = slaAtHours(running('2026-11-03T13:30:00'), at('2026-11-03T12:00:00'), s);
    expect(paused12).toEqual(outside('2026-11-03T13:30:00', 1800));
    expect(slaAtHours(paused12, at('2026-11-03T13:00:00'), s)).toEqual(
      running('2026-11-03T13:30:00'),
    );
  });

  it('stays paused the whole of a day off and runs again the next morning', () => {
    const holiday: typeof s = { ...s, daysOff: [{ startsOn: '2026-11-04', endsOn: '2026-11-04' }] };
    const p = slaAtHours(running('2026-11-05T08:30:00'), at('2026-11-04T09:00:00'), holiday);
    expect(p).toEqual(outside('2026-11-05T08:30:00', 1800));
    expect(slaAtHours(p, at('2026-11-04T15:00:00'), holiday)).toBe(p);
    expect(slaAtHours(p, at('2026-11-05T08:00:00'), holiday)).toEqual(
      running('2026-11-05T08:30:00'),
    );
  });

  it('counts from now when the job is 5 minutes late: 08:05 + what was left, not 08:00 + it', () => {
    expect(slaAtHours(outside('2026-11-04T08:20:00', 1200), at('2026-11-04T08:05:00'), s)).toEqual(
      running('2026-11-04T08:25:00'),
    );
  });

  it('uses the schedule it is given when the workspace changed its hours', () => {
    const early: typeof s = {
      ...s,
      week: WEEK.map((d) => d && { ...d, opensAt: '07:00' }) as unknown as WorkingWeek,
    };
    expect(
      slaAtHours(outside('2026-11-04T08:20:00', 1200), at('2026-11-04T07:00:00'), early),
    ).toEqual(running('2026-11-04T07:20:00'));
    expect(slaAtHours(outside('2026-11-04T08:20:00', 1200), at('2026-11-04T07:00:00'), s)).toEqual(
      outside('2026-11-04T08:20:00', 1200),
    );
  });

  it('leaves alone a running SLA while open, the customer’s pause, and no SLA', () => {
    const r = running('2026-11-03T10:00:00');
    expect(slaAtHours(r, at('2026-11-03T09:00:00'), s)).toBe(r);
    const p = paused('2026-11-03T10:00:00', 600);
    expect(slaAtHours(p, at('2026-11-03T20:00:00'), s)).toBe(p);
    expect(slaAtHours(null, at('2026-11-03T20:00:00'), s)).toBeNull();
  });
});

// Fix (E4b-2a): T09 while the SLA was paused outside the hours used to keep the pause `outside_hours`, so the opening hours ran the
// clock again although the conversation waits for the customer. Now the pause becomes the customer's, with the same rest.
describe('T09 while the SLA is paused outside the hours (fix)', () => {
  const outside = (due: string, left: number): ConversationSla => ({
    dueAt: at(due),
    pausedReason: 'outside_hours',
    remainingSeconds: left,
  });
  const before = outside('2026-11-04T08:20:00', 1200);
  const after = slaAfterTransition(
    before,
    'HUMAN_ACTIVE',
    'PENDING_CUSTOMER',
    at('2026-11-03T18:00:00'),
    s,
  );

  it('becomes the customer’s pause with the same rest and due time, not the pause of the hours as before', () => {
    expect(after).toEqual(paused('2026-11-04T08:20:00', 1200));
    expect(after).not.toEqual(before);
  });

  it('so the opening the next morning leaves it paused; the old pause would have run again at 08:00', () => {
    const opening = at('2026-11-04T08:00:00');
    expect(slaAtHours(after, opening, s)).toBe(after);
    expect(slaAtHours(before, opening, s)).toEqual(running('2026-11-04T08:20:00'));
  });
});
