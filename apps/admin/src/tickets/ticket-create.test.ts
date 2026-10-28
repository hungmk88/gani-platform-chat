import { describe, expect, it } from 'vitest';

import type { Member } from '../members/list';
import {
  customerLine,
  customerSearchPath,
  picksAssignee,
  ticketAssigneesOf,
  ticketBodyOf,
  type TicketDraft,
} from './ticket-create';

const draft: TicketDraft = {
  title: '',
  description: '',
  priority: 'normal',
  assigneeUserId: '',
  customerId: '',
};

describe('ticketBodyOf', () => {
  it('trims, and leaves out an empty description or assignee', () => {
    expect(ticketBodyOf('ws-1', { ...draft, title: '  Đổi lịch  ', description: '  ' })).toEqual({
      workspaceId: 'ws-1',
      title: 'Đổi lịch',
      priority: 'normal',
    });
    expect(
      ticketBodyOf('ws-1', {
        ...draft,
        title: 'A',
        description: 'B',
        priority: 'urgent',
        assigneeUserId: 'u1',
      }),
    ).toEqual({
      workspaceId: 'ws-1',
      title: 'A',
      description: 'B',
      priority: 'urgent',
      assigneeUserId: 'u1',
    });
  });

  it('says what is wrong as the API would refuse it', () => {
    expect(ticketBodyOf('ws-1', { ...draft, title: '   ' })).toBe('Nhập tiêu đề ticket.');
    expect(ticketBodyOf('ws-1', { ...draft, title: 'x'.repeat(201) })).toBe(
      'Tiêu đề tối đa 200 ký tự.',
    );
    expect(ticketBodyOf('ws-1', { ...draft, title: 'x', description: 'x'.repeat(5001) })).toBe(
      'Mô tả tối đa 5000 ký tự.',
    );
  });
});

describe('the assignee field (stage 1, issue #357)', () => {
  it('is for Owner and Admin only until the API lists assignees at workspace level', () => {
    expect(picksAssignee('owner')).toBe(true);
    expect(picksAssignee('admin')).toBe(true);
    for (const r of ['manager', 'sales', 'support', 'marketing', 'viewer'] as const)
      expect(picksAssignee(r)).toBe(false);
  });

  it('offers active Owner/Admin/Manager/Support of the workspace, never Sales', () => {
    const m = (id: string, role: Member['role'], status: Member['status'] = 'active') =>
      ({ id, userId: `user-${id}`, name: null, email: `${id}@x.test`, role, status }) as Member;
    const all = [
      m('o', 'owner'),
      m('s', 'sales'),
      m('p', 'support'),
      m('g', 'manager', 'suspended'),
    ];
    expect(ticketAssigneesOf(all, null).map((a) => a.userId)).toEqual(['user-o', 'user-p']);
    expect(ticketAssigneesOf(all, new Set(['p'])).map((a) => a.name)).toEqual(['p@x.test']);
  });
});

describe('the customer of a new ticket (#359)', () => {
  it('sends the customer picked, and leaves it out when none is', () => {
    expect(ticketBodyOf('ws-1', { ...draft, title: 'A', customerId: 'c1' })).toMatchObject({
      customerId: 'c1',
    });
    expect(ticketBodyOf('ws-1', { ...draft, title: 'A' })).not.toHaveProperty('customerId');
  });
  it('searches one short page, trimmed to what the API takes', () => {
    expect(customerSearchPath('  0912 ')).toBe('/v1/customers?limit=10&q=0912');
    expect(customerSearchPath('a'.repeat(120))).toBe(`/v1/customers?limit=10&q=${'a'.repeat(100)}`);
  });
  it('shows the name and the phone, else the email, as the API gives them', () => {
    expect(customerLine({ displayName: 'An', phone: '+84912345678', email: 'an@x.vn' })).toBe(
      'An · 0912 345 678',
    );
    expect(customerLine({ displayName: null, phone: null, email: 'b@x.vn' })).toBe(
      'Khách chưa có tên · b@x.vn',
    );
    expect(customerLine({ displayName: 'C', phone: '+8491*****78', email: null })).toBe(
      'C · 091*****78',
    );
    expect(customerLine({ displayName: 'D', phone: null, email: null })).toBe('D');
  });
});
