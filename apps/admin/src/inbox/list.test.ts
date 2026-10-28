import { describe, expect, it } from 'vitest';

import {
  customerNameOf,
  emptyOf,
  filterOf,
  channelOf,
  holderOf,
  listPath,
  NO_FILTER,
  channelChoice,
  channelFilterOf,
  inboxChannelsPath,
  paramsOf,
  tooFewDigits,
  whenOf,
} from './list';

describe('filterOf and paramsOf', () => {
  it('reads a filter from the URL and writes it back', () => {
    const f = filterOf(new URLSearchParams('assignee=me&state=HUMAN_WAITING_Q'));
    expect(f).toEqual({ assignee: 'me', state: 'HUMAN_WAITING_Q', q: '', channel: '' });
    expect(paramsOf(f).toString()).toBe('assignee=me&state=HUMAN_WAITING_Q');
    expect(paramsOf(NO_FILTER).toString()).toBe('');
  });

  it('drops what it does not know', () => {
    expect(filterOf(new URLSearchParams('assignee=team&state=DROP%20TABLE'))).toEqual(NO_FILTER);
    expect(filterOf(new URLSearchParams('state=hold')).state).toBe('hold');
  });
});

describe('the customer search q (#390)', () => {
  it('is trimmed and cut to what the API takes, and none is no q at all (an empty q is a 400)', () => {
    expect(filterOf(new URLSearchParams('q=%20%20an%20%20')).q).toBe('an');
    expect(filterOf(new URLSearchParams('q=%20%20%20')).q).toBe('');
    expect(filterOf(new URLSearchParams(`q=${'a'.repeat(120)}`)).q).toBe('a'.repeat(100));
    expect(paramsOf({ ...NO_FILTER, q: 'an' }).toString()).toBe('q=an');
    expect(listPath({ ...NO_FILTER, q: '', channel: '' }, null, null)).not.toContain('q=');
    expect(listPath({ ...NO_FILTER, q: '0912' }, null, null)).toBe(
      '/v1/conversations?assignee=any&limit=50&q=0912',
    );
  });
  it('says 1 or 2 digits are not a phone search yet', () => {
    expect(['0', '09', ' 0 9 '].map((q) => tooFewDigits(q.trim()))).toEqual([true, true, true]);
    expect(['091', 'an', 'an 09', ''].map(tooFewDigits)).toEqual([false, false, false, false]);
  });
  it('says nothing matched the search, with a way to drop it', () => {
    expect(emptyOf({ ...NO_FILTER, q: 'an' }, 'sales')).toEqual({
      text: 'Không có hội thoại khớp "an".',
      action: 'search',
    });
  });
});

describe('the channel filter (#392, U56)', () => {
  const ID = '0190c200-0000-7000-8000-000000000001';
  it('keeps a UUID from the URL and drops anything else; sends it as channelId', () => {
    expect(filterOf(new URLSearchParams(`channel=${ID}`)).channel).toBe(ID);
    expect(filterOf(new URLSearchParams('channel=zalo')).channel).toBe('');
    expect(paramsOf({ ...NO_FILTER, channel: ID }).toString()).toBe(`channel=${ID}`);
    expect(listPath({ ...NO_FILTER, channel: ID }, null, null)).toBe(
      `/v1/conversations?assignee=any&limit=50&channelId=${ID}`,
    );
    expect(listPath(NO_FILTER, null, null)).not.toContain('channelId');
    expect(inboxChannelsPath('w1')).toBe('/v1/conversations/channels?workspaceId=w1');
    expect(emptyOf({ ...NO_FILTER, channel: ID }, 'sales').action).toBe('clear');
  });
  it('names a channel, with its status unless connected', () => {
    expect(channelChoice({ displayName: 'Gani', type: 'zalo_oa', status: 'connected' })).toBe(
      'Gani · Zalo OA',
    );
    expect(channelChoice({ displayName: 'Gani', type: 'zalo_oa', status: 'disconnected' })).toBe(
      'Gani · Zalo OA · Mất kết nối',
    );
  });
  it('shows a select from 2 channels or when one filters, a line when the list cannot be read', () => {
    const one = [{ id: ID }];
    const two = [{ id: ID }, { id: 'x' }];
    expect(channelFilterOf('pending', ID)).toBe('none');
    expect(channelFilterOf('error', '')).toBe('none');
    expect(channelFilterOf('error', ID)).toBe('line');
    expect(channelFilterOf(one, '')).toBe('none');
    expect(channelFilterOf(one, ID)).toBe('select');
    expect(channelFilterOf(two, '')).toBe('select');
    expect(channelFilterOf([], 'gone')).toBe('select');
  });
});

describe('listPath', () => {
  it('asks the API with its own words', () => {
    expect(listPath(NO_FILTER, null, null)).toBe('/v1/conversations?assignee=any&limit=50');
    expect(
      listPath({ assignee: 'none', state: 'HUMAN_WAITING_Q', q: '', channel: '' }, 'c1', 'w1'),
    ).toBe(
      '/v1/conversations?assignee=none&limit=50&workspaceId=w1&state=HUMAN_WAITING_Q&cursor=c1',
    );
    expect(listPath({ assignee: 'me', state: 'hold', q: '', channel: '' }, null, null)).toBe(
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
    expect(emptyOf({ assignee: 'me', state: 'all', q: '', channel: '' }, 'sales')).toEqual({
      text: 'Chưa có hội thoại nào giao cho bạn.',
      action: 'unassigned',
    });
    expect(emptyOf({ assignee: 'none', state: 'all', q: '', channel: '' }, 'manager').action).toBe(
      'clear',
    );
    expect(emptyOf({ assignee: 'any', state: 'CLOSED', q: '', channel: '' }, 'admin').action).toBe(
      'clear',
    );
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
