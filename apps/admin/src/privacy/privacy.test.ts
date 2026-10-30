import { describe, expect, it } from 'vitest';

import { KIND, STATUS } from './labels';
import { customerOf, MAX_REASON, requestBodyOf, requestsPath, timeText } from './privacy';

describe('Dữ liệu khách (PR A)', () => {
  it('asks the requests with no filter, by cursor', () => {
    expect(requestsPath(null)).toBe('/v1/privacy-requests?limit=50');
    expect(requestsPath('c 2')).toBe('/v1/privacy-requests?limit=50&cursor=c+2');
  });

  it('has a word for every kind and status', () => {
    expect(Object.values(KIND)).toEqual(['Xuất dữ liệu', 'Xóa dữ liệu']);
    expect(Object.values(STATUS).map(([w]) => w)).toEqual([
      'Chờ thực hiện',
      'Đã thực hiện',
      'Không thực hiện được',
    ]);
  });

  it('names a customer without a name, and writes times in Viet Nam', () => {
    expect(customerOf({ customer: { id: 'c', displayName: null } })).toBe('Khách chưa có tên');
    expect(customerOf({ customer: { id: 'c', displayName: 'Nguyễn An' } })).toBe('Nguyễn An');
    expect(timeText('2026-10-29T17:30:00.000Z')).toBe('00:30 30/10/2026');
    expect(timeText(null)).toBe('—');
  });
});

describe('Dữ liệu khách (PR B1)', () => {
  it('checks the form as the contract does and trims the reason', () => {
    const d = { customerId: 'c1', kind: 'erase' as const, reason: '  Khách xin xóa  ' };
    expect(requestBodyOf(d)).toEqual({ customerId: 'c1', kind: 'erase', reason: 'Khách xin xóa' });
    expect(requestBodyOf({ ...d, customerId: '' })).toBe('Chọn khách đã gửi yêu cầu.');
    expect(requestBodyOf({ ...d, reason: '   ' })).toBe('Ghi lý do: lý do được lưu cùng yêu cầu.');
    expect(requestBodyOf({ ...d, reason: 'x'.repeat(MAX_REASON) })).not.toBeTypeOf('string');
    expect(requestBodyOf({ ...d, reason: 'x'.repeat(MAX_REASON + 1) })).toBe(
      'Lý do tối đa 500 ký tự.',
    );
  });
});
