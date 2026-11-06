import { describe, expect, it } from 'vitest';

import { slaChipOf } from './sla';

const NOW = Date.parse('2026-11-06T03:00:00Z');
const at = (min: number) => new Date(NOW + min * 60_000).toISOString();

describe('slaChipOf (U81, brief 116)', () => {
  it('says there is no SLA on an open conversation, nothing on a closed one', () => {
    expect(slaChipOf({ state: 'HUMAN_WAITING_Q', sla: null }, NOW)).toEqual({
      text: 'Chưa có SLA',
      tone: 'faint',
    });
    expect(slaChipOf({ state: 'HUMAN_ACTIVE' }, NOW)?.text).toBe('Chưa có SLA'); // no field yet: as null
    expect(slaChipOf({ state: 'CLOSED', sla: null }, NOW)).toBeNull();
  });

  it('counts from dueAt only: minutes left plain, minutes past red; no threshold of its own', () => {
    const due = (min: number) => ({ dueAt: at(min), pausedReason: null });
    expect(slaChipOf({ state: 'HUMAN_ACTIVE', sla: due(42) }, NOW)).toEqual({
      text: 'Còn 42 phút',
      tone: 'plain',
    });
    expect(slaChipOf({ state: 'HUMAN_ACTIVE', sla: due(3) }, NOW)?.tone).toBe('plain'); // never "15 minutes"
    expect(slaChipOf({ state: 'HUMAN_ACTIVE', sla: due(0.5) }, NOW)?.text).toBe('Còn 1 phút');
    expect(slaChipOf({ state: 'HUMAN_ACTIVE', sla: due(0) }, NOW)).toEqual({
      text: 'Quá hạn 1 phút',
      tone: 'overdue',
    });
    expect(slaChipOf({ state: 'HUMAN_ACTIVE', sla: due(-6) }, NOW)?.text).toBe('Quá hạn 6 phút');
    expect(slaChipOf({ state: 'HUMAN_ACTIVE', sla: due(-6) }, null)).toBeNull(); // time not known yet
  });

  it('says why a paused SLA does not count, grey', () => {
    const paused = (r: 'waiting_customer' | 'outside_hours') => ({
      dueAt: at(-60),
      pausedReason: r,
    });
    expect(slaChipOf({ state: 'PENDING_CUSTOMER', sla: paused('waiting_customer') }, NOW)).toEqual({
      text: 'SLA tạm dừng · chờ khách',
      tone: 'paused',
    });
    expect(slaChipOf({ state: 'HUMAN_WAITING_Q', sla: paused('outside_hours') }, null)).toEqual({
      text: 'SLA tạm dừng · ngoài giờ',
      tone: 'paused',
    });
  });
});
