import { describe, expect, it } from 'vitest';

import { emptyOf, filterOf, holderOf, listPath, NO_FILTER, paramsOf, whenOf } from './list';

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
    expect(listPath(NO_FILTER, null)).toBe('/v1/conversations?assignee=any&limit=50');
    expect(listPath({ assignee: 'none', state: 'HUMAN_WAITING_Q' }, 'c1')).toBe(
      '/v1/conversations?assignee=none&limit=50&state=HUMAN_WAITING_Q&cursor=c1',
    );
    expect(listPath({ assignee: 'me', state: 'hold' }, null)).toBe(
      '/v1/conversations?assignee=me&limit=50&hold=true',
    );
  });
});

describe('holderOf', () => {
  it('says me, someone else or nobody, never a made-up name', () => {
    expect(holderOf({ assignedUserId: null }, 'u1')).toBe('Chưa ai nhận');
    expect(holderOf({ assignedUserId: 'u1' }, 'u1')).toBe('Tôi');
    expect(holderOf({ assignedUserId: 'u2' }, 'u1')).toBe('Người khác');
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
