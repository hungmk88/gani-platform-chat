import { describe, expect, it } from 'vitest';

import {
  customerNameOf,
  emptyOf,
  filterOf,
  channelOf,
  holderOf,
  listPath,
  NO_FILTER,
  paramsOf,
  whenOf,
} from './list';

describe('filterOf and paramsOf', () => {
  it('reads a filter from the URL and writes it back', () => {
    const f = filterOf(new URLSearchParams('assignee=me&state=HUMAN_WAITING_Q'));
    expect(f).toEqual({ assignee: 'me', state: 'HUMAN_WAITING_Q' });
    expect(paramsOf(f).toString()).toBe('assignee=me&state=HUMAN_WAITING_Q');
    expect(paramsOf(NO_FILTER).toString()).toBe('');
  });

  it('drops what it does not know', () => {
    expect(filterOf(new URLSearchParams('assignee=team&state=DROP%20TABLE'))).toEqual(NO_FILTER);
    expect(filterOf(new URLSearchParams('state=hold')).state).toBe('hold');
  });
});

describe('listPath', () => {
  it('asks the API with its own words', () => {
    expect(listPath(NO_FILTER, null, null)).toBe('/v1/conversations?assignee=any&limit=50');
    expect(listPath({ assignee: 'none', state: 'HUMAN_WAITING_Q' }, 'c1', 'w1')).toBe(
      '/v1/conversations?assignee=none&limit=50&workspaceId=w1&state=HUMAN_WAITING_Q&cursor=c1',
    );
    expect(listPath({ assignee: 'me', state: 'hold' }, null, null)).toBe(
      '/v1/conversations?assignee=me&limit=50&hold=true',
    );
  });
});

describe('holderOf and channelOf', () => {
  it('says me, the name, or nobody; a holder with no name is the end of their id', () => {
    const c = (assignedUserId: string | null, name: string | null = 'Hà Linh') => ({
      assignedUserId,
      assignee: assignedUserId ? { id: assignedUserId, name } : null,
    });
    expect(holderOf(c(null), 'u1')).toEqual({ text: 'Chưa ai nhận' });
    expect(holderOf(c('u1'), 'u1')).toEqual({ text: 'Tôi' });
    expect(holderOf(c('user-2'), 'u1')).toEqual({ text: 'Hà Linh' });
    expect(holderOf(c('user-abcd', null), 'u1')).toEqual({
      text: '…abcd',
      title: 'Nhân viên chưa có tên',
    });
    expect(holderOf(c('user-abcd', '  '), 'u1')).toEqual({
      text: '…abcd',
      title: 'Nhân viên chưa có tên',
    });
  });

  it('uses a name only for the id it came with (a realtime change before the next read)', () => {
    expect(
      holderOf({ assignedUserId: 'user-new2', assignee: { id: 'u-old', name: 'Hà Linh' } }, 'u1'),
    ).toEqual({
      text: '…new2',
      title: 'Nhân viên chưa có tên',
    });
  });

  it('names the channel, or nothing', () => {
    expect(channelOf({ channel: { id: 'c', type: 'zalo_oa', displayName: 'Gani Hà Nội' } })).toBe(
      'Zalo OA · Gani Hà Nội',
    );
    expect(channelOf({ channel: null })).toBeNull();
  });
});

describe('emptyOf', () => {
  it('has one sentence and one action for each case', () => {
    expect(emptyOf(NO_FILTER, 'owner')).toEqual({ text: 'Chưa có hội thoại.', action: 'channels' });
    expect(emptyOf({ assignee: 'me', state: 'all' }, 'sales')).toEqual({
      text: 'Chưa có hội thoại nào giao cho bạn.',
      action: 'unassigned',
    });
    expect(emptyOf({ assignee: 'none', state: 'all' }, 'manager').action).toBe('clear');
    expect(emptyOf({ assignee: 'any', state: 'CLOSED' }, 'admin').action).toBe('clear');
  });
});

describe('whenOf', () => {
  it('writes the time of the last message in Vietnam time', () => {
    expect(
      whenOf({ lastMessageAt: '2026-10-21T02:05:00Z', createdAt: '2026-10-20T00:00:00Z' }),
    ).toContain('09:05');
    expect(whenOf({ lastMessageAt: null, createdAt: '2026-10-20T17:30:00Z' })).toContain('00:30');
  });
});

describe('customerNameOf', () => {
  it('names the customer of the conversation, or says nobody has named them yet', () => {
    expect(customerNameOf({ customer: { id: 'c1', displayName: ' Chị Lan ' } })).toBe('Chị Lan');
    expect(customerNameOf({ customer: { id: 'c1', displayName: null } })).toBe('Khách chưa có tên');
    expect(customerNameOf({ customer: { id: 'c1', displayName: ' ' } })).toBe('Khách chưa có tên');
    expect(customerNameOf({ customer: null })).toBe('Khách chưa có tên');
  });
});
