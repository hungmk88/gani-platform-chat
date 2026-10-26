import { describe, expect, it } from 'vitest';

import { cardsOf, durationText, overviewPath, updatedAt, type Overview } from './overview';

const workspace: Overview = {
  scope: 'workspace',
  openConversations: 12,
  waitingForAgent: 3,
  firstResponseP90Seconds: 220,
  overSla: null,
  agentsOnline: 4,
  agentsTotal: 7,
  generatedAt: '2026-10-26T03:05:00Z',
};

describe('overviewPath and updatedAt', () => {
  it('asks for the workspace being worked in and says when the figures were made', () => {
    expect(overviewPath('ws-1')).toBe('/v1/overview?workspaceId=ws-1');
    expect(updatedAt(workspace)).toBe('10:05');
  });
});

describe('durationText', () => {
  it('says a duration in seconds, minutes and hours', () => {
    expect(durationText(45)).toBe('45 giây');
    expect(durationText(220)).toBe('3 phút 40 giây');
    expect(durationText(180)).toBe('3 phút');
    expect(durationText(3900)).toBe('1 giờ 5 phút');
    expect(durationText(7200)).toBe('2 giờ');
  });
});

describe('cardsOf', () => {
  it('gives the five cards of a workspace, with words for a figure not there yet', () => {
    const cards = cardsOf(workspace);
    expect(cards.map((c) => [c.label, c.value])).toEqual([
      ['Hội thoại đang mở', '12'],
      ['Chờ nhân viên nhận', '3'],
      ['Phản hồi đầu tiên (P90)', '3 phút 40 giây'],
      ['Quá hạn SLA', 'Chưa tính'],
      ['Nhân viên trực tuyến', '4 / 7'],
    ]);
    expect(cards.map((c) => c.tone)).toEqual([null, 'warn', null, null, null]);
  });
  it('gives four cards for what I hold, red when some are over their SLA', () => {
    const cards = cardsOf({
      ...workspace,
      scope: 'me',
      waitingForAgent: 0,
      firstResponseP90Seconds: null,
      overSla: 2,
      agentsOnline: null,
      agentsTotal: null,
    });
    expect(cards.map((c) => [c.label, c.value, c.tone])).toEqual([
      ['Hội thoại tôi đang giữ', '12', null],
      ['Chờ nhân viên nhận', '0', null],
      ['Phản hồi đầu tiên (P90)', 'Chưa có', null],
      ['Quá hạn SLA', '2', 'error'],
    ]);
  });
});
