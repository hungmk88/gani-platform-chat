import { describe, expect, it } from 'vitest';

import {
  eventText,
  mayChangeTickets,
  moveLabel,
  movesFor,
  NEXT,
  ticketPath,
} from './ticket-detail';

describe('movesFor', () => {
  it('follows the moves of N167, cancelling for Owner/Admin/Manager only', () => {
    expect(movesFor('new', 'manager')).toEqual(['in_progress', 'cancelled']);
    expect(movesFor('new', 'support')).toEqual(['in_progress']);
    expect(movesFor('waiting_customer', 'admin')).toEqual(['in_progress', 'done', 'cancelled']);
    expect(movesFor('done', 'owner')).toEqual(['in_progress']);
    expect(movesFor('cancelled', 'owner')).toEqual([]);
  });

  it('gives Sales and the roles without tickets no move', () => {
    expect(mayChangeTickets('sales')).toBe(false);
    expect(movesFor('in_progress', 'sales')).toEqual([]);
    expect(movesFor('in_progress', 'viewer')).toEqual([]);
    expect(movesFor('in_progress', null)).toEqual([]);
  });

  it('never moves a ticket back to new', () => {
    expect(Object.values(NEXT).flat()).not.toContain('new');
  });
});

describe('moveLabel and ticketPath', () => {
  it('names the move by where it comes from', () => {
    expect(moveLabel('new', 'in_progress')).toBe('Bắt đầu xử lý');
    expect(moveLabel('waiting_customer', 'in_progress')).toBe('Tiếp tục xử lý');
    expect(moveLabel('done', 'in_progress')).toBe('Mở lại');
    expect(moveLabel('in_progress', 'cancelled')).toBe('Hủy ticket');
  });

  it('escapes the id', () => {
    expect(ticketPath('a/b')).toBe('/v1/tickets/a%2Fb');
  });
});

describe('eventText', () => {
  const at = '2026-10-26T03:00:00.000Z';
  it('says who did what in words, never a code', () => {
    const base = { fromStatus: null, toStatus: null, occurredAt: at } as const;
    expect(eventText({ ...base, type: 'created', actorUserId: 'me' }, 'me')).toBe('Bạn tạo ticket');
    expect(eventText({ ...base, type: 'assigned', actorUserId: null }, 'me')).toBe(
      'Hệ thống đổi người phụ trách',
    );
    expect(
      eventText(
        {
          type: 'status_changed',
          fromStatus: 'new',
          toStatus: 'in_progress',
          actorUserId: 'u2',
          occurredAt: at,
        },
        'me',
      ),
    ).toBe('Người khác chuyển từ Mới sang Đang xử lý');
  });
});
