import { describe, expect, it } from 'vitest';

import { changedAt, mayReadTickets, slaText, STATUS, ticketsPath } from './tickets';

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
