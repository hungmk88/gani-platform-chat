import { describe, expect, it } from 'vitest';

import type { ChannelPolicy } from './platform';
import { changeOf, draftOf, savedText } from './policy-edit';

const NOW: ChannelPolicy = {
  id: 'p1',
  channelType: 'zalo_oa',
  messageClass: 'advisory',
  effectiveFrom: '2023-06-19T17:00:00Z', // 20/06/2023 00:00 in Viet Nam
  freeWindowSeconds: 172800,
  freeMessageQuota: 8,
  unitPriceVnd: null,
  outsideWindowAllowed: false,
  sourceUrl: 'https://oa.zalo.me/thong-bao',
  sourceDate: '2023-06-20',
  note: 'Theo thông báo Zalo',
};

describe('#30 PR 30b, a new version of a channel policy', () => {
  it('starts from the version in force, without a day', () => {
    expect(draftOf(NOW)).toEqual({
      from: '',
      hours: '48',
      quota: '8',
      price: '',
      outside: false,
      sourceUrl: 'https://oa.zalo.me/thong-bao',
      sourceDate: '2023-06-20',
      note: 'Theo thông báo Zalo',
    });
  });

  it('sends every field, from 00:00 of the day in Viet Nam; blanks are null', () => {
    const d = { ...draftOf(NOW), from: '2026-12-01', hours: '1.5', price: '1500', sourceUrl: ' ' };
    expect(changeOf(d, NOW)).toEqual({
      effectiveFrom: '2026-12-01T00:00:00+07:00',
      freeWindowSeconds: 5400,
      freeMessageQuota: 8,
      unitPriceVnd: 1500,
      outsideWindowAllowed: false,
      sourceUrl: null,
      sourceDate: '2023-06-20',
      note: 'Theo thông báo Zalo',
    });
  });

  it('says the first problem, as the API checks it', () => {
    const ok = { ...draftOf(NOW), from: '2026-12-01' };
    expect(changeOf(draftOf(NOW), NOW)).toBe('Chọn ngày hiệu lực.');
    expect(changeOf({ ...ok, from: '2023-06-20' }, NOW)).toBe(
      'Ngày hiệu lực phải sau 20/06/2023, ngày của phiên bản đang dùng.',
    );
    expect(changeOf({ ...ok, hours: '-1' }, NOW)).toMatch(/^Khung miễn phí/);
    expect(changeOf({ ...ok, quota: '2.5' }, NOW)).toMatch(/^Số tin miễn phí/);
    expect(changeOf({ ...ok, price: 'abc' }, NOW)).toMatch(/^Giá/);
    expect(changeOf({ ...ok, note: '  ' }, NOW)).toBe('Ghi chú không được để trống.');
  });

  it('says a later day keeps the version in force in the table until then', () => {
    const sent = '2026-12-01T00:00:00+07:00';
    expect(savedText(sent, { ...NOW, effectiveFrom: '2026-11-30T17:00:00Z' })).toBe(
      'Đã thêm phiên bản có hiệu lực từ 01/12/2026. Đã ghi audit.',
    );
    expect(savedText(sent, NOW)).toBe(
      'Đã thêm phiên bản có hiệu lực từ 01/12/2026. Tới ngày đó bảng vẫn hiện phiên bản đang dùng. Đã ghi audit.',
    );
  });
});
