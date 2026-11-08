import { describe, expect, it } from 'vitest';

import {
  assigneeOf,
  changedAt,
  mayReadTickets,
  slaText,
  STATUS,
  ticketsPath,
  conversationTicketsPath,
} from './tickets';

describe('ticketsPath', () => {
  it('asks a page of the workspace, with the filters that are set and the cursor', () => {
    expect(ticketsPath('ws-1', { status: 'all', assignee: 'any' }, null)).toBe(
      '/v1/tickets?workspaceId=ws-1&limit=50',
    );
    expect(ticketsPath('ws-1', { status: 'waiting_customer', assignee: 'me' }, 'c2')).toBe(
      '/v1/tickets?workspaceId=ws-1&limit=50&status=waiting_customer&assignee=me&cursor=c2',
    );
  });
});

describe('mayReadTickets and STATUS', () => {
  it('lets the roles of the menu work with tickets', () => {
    expect(['owner', 'admin', 'manager', 'sales', 'support'].every(mayReadTickets)).toBe(true);
    expect(mayReadTickets('viewer')).toBe(false);
    expect(mayReadTickets(null)).toBe(false);
  });
  it('says the five states of U27 in words', () => {
    expect(Object.values(STATUS).map(([label]) => label)).toEqual([
      'Mới',
      'Đang xử lý',
      'Chờ khách',
      'Đã xong',
      'Đã hủy',
    ]);
  });
});

describe('slaText and changedAt', () => {
  const open = { status: 'in_progress' } as const;
  it('says the SLA of an open ticket, paused or not, and nothing for a closed one', () => {
    expect(slaText({ ...open, sla: null })).toBe('Chưa có SLA');
    expect(slaText({ ...open, sla: { dueAt: '2026-10-26T03:00:00Z', pausedReason: null } })).toBe(
      'Hạn 10:00 26/10/2026',
    );
    expect(
      slaText({
        ...open,
        sla: { dueAt: '2026-10-26T03:00:00Z', pausedReason: 'waiting_customer' },
      }),
    ).toBe('Tạm dừng: chờ khách');
    expect(
      slaText({ ...open, sla: { dueAt: '2026-10-26T03:00:00Z', pausedReason: 'outside_hours' } }),
    ).toBe('Tạm dừng: ngoài giờ');
    expect(slaText({ status: 'done', sla: null })).toBe('—');
  });
  it('gives the time of the last change in Viet Nam', () => {
    expect(changedAt({ updatedAt: '2026-10-26T03:00:00Z' })).toBe('10:00 26/10/2026');
  });
});

describe('assigneeOf (K1c-1: the name of the assignee may be null)', () => {
  it('says the name, nobody, or the end of the id of a person without a name, never "Chưa giao" for someone', () => {
    const id = '0190c300-0000-7000-8000-00000000abcd';
    expect(assigneeOf({ assignee: null })).toEqual({ text: 'Chưa giao', none: true });
    expect(assigneeOf({ assignee: { id, name: 'Người thử' } })).toEqual({ text: 'Người thử' });
    expect(assigneeOf({ assignee: { id, name: null } })).toEqual({
      text: '…abcd',
      title: 'Nhân viên chưa có tên',
    });
    expect(assigneeOf({ assignee: { id, name: '  ' } }).text).toBe('…abcd');
  });
});

describe('conversationTicketsPath (U53, CEO brief 171 B8)', () => {
  it('the tickets of one conversation, by cursor, the id encoded', () => {
    expect(conversationTicketsPath('c/1', null)).toBe('/v1/tickets?conversationId=c%2F1&limit=50');
    expect(conversationTicketsPath('c1', 'p2')).toBe(
      '/v1/tickets?conversationId=c1&limit=50&cursor=p2',
    );
  });
});
