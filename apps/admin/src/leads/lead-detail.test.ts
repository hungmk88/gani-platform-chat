import { describe, expect, it } from 'vitest';

import { eventText, leadPath, type LeadEvent } from './lead-detail';

const step = (n: number) => ({ id: `s${n}`, name: `Bước ${n}` });
const event = (e: Partial<LeadEvent> & Pick<LeadEvent, 'type'>): LeadEvent => ({
  fromStage: null,
  toStage: null,
  outcome: null,
  actorUserId: 'me',
  occurredAt: '2026-11-02T00:00:00.000Z',
  ...e,
});

describe('#13a Chi tiết lead, on the contract planned for S4 (#544)', () => {
  it('says each kind of event in words, people as Bạn, Người khác or Hệ thống', () => {
    expect(eventText(event({ type: 'created', toStage: step(1) }), 'me')).toBe(
      'Bạn tạo lead ở Bước 1',
    );
    expect(eventText(event({ type: 'created' }), 'other')).toBe('Người khác tạo lead');
    expect(
      eventText(event({ type: 'stage_changed', fromStage: step(1), toStage: step(2) }), 'me'),
    ).toBe('Bạn chuyển từ Bước 1 sang Bước 2');
    expect(eventText(event({ type: 'stage_changed', toStage: step(2) }), 'me')).toBe(
      'Bạn chuyển sang Bước 2',
    );
    expect(eventText(event({ type: 'owner_changed', actorUserId: null }), 'me')).toBe(
      'Hệ thống đổi người phụ trách',
    );
    expect(eventText(event({ type: 'closed', outcome: 'won' }), 'me')).toBe('Bạn đánh dấu Thắng');
    expect(eventText(event({ type: 'closed', outcome: 'lost' }), 'other')).toBe(
      'Người khác đánh dấu Thua',
    );
    expect(eventText(event({ type: 'closed' }), 'me')).toBe('Bạn đóng lead');
  });

  it('asks one lead by its id, escaped', () => {
    expect(leadPath('a/b')).toBe('/v1/leads/a%2Fb');
  });
});
