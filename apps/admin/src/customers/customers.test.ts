import { describe, expect, it } from 'vitest';

import {
  channelsOf,
  customersPath,
  dayOf,
  mayReadCustomers,
  nameOf,
  phoneText,
  seesMasked,
} from './customers';

describe('mayReadCustomers and seesMasked', () => {
  it('lets every role of a company read the list, Marketing and Viewer masked', () => {
    expect(mayReadCustomers('sales')).toBe(true);
    expect(mayReadCustomers('viewer')).toBe(true);
    expect(mayReadCustomers('platform_operator')).toBe(false);
    expect(mayReadCustomers(null)).toBe(false);
    expect(seesMasked('marketing')).toBe(true);
    expect(seesMasked('viewer')).toBe(true);
    expect(seesMasked('support')).toBe(false);
  });
});

describe('customersPath', () => {
  it('asks a page, with the search trimmed and cut to 100, and the cursor', () => {
    expect(customersPath('  ', null)).toBe('/v1/customers?limit=50');
    expect(customersPath(' 0912 ', 'c2')).toBe('/v1/customers?limit=50&q=0912&cursor=c2');
    expect(customersPath('a'.repeat(120), null)).toBe(
      `/v1/customers?limit=50&q=${'a'.repeat(100)}`,
    );
  });
});

describe('nameOf, phoneText, channelsOf and dayOf', () => {
  it('has words for a customer with no name', () => {
    expect(nameOf({ displayName: 'Chị Lan' })).toBe('Chị Lan');
    expect(nameOf({ displayName: null })).toBe('Khách chưa có tên');
  });
  it('writes a Vietnamese number as people do, masked or not, and leaves the others', () => {
    expect(phoneText('+84912345678')).toBe('0912 345 678');
    expect(phoneText('+8491*****78')).toBe('091*****78');
    expect(phoneText('+6591234567')).toBe('+6591234567');
  });
  it('names each channel once', () => {
    const zalo = {
      type: 'zalo_uid',
      channelAccountId: 'oa-1',
      verification: 'unverified',
    } as const;
    expect(channelsOf({ identities: [zalo, zalo] })).toEqual(['Zalo OA']);
    expect(channelsOf({ identities: [] })).toEqual([]);
  });
  it('gives the day in Viet Nam', () => {
    expect(dayOf('2026-10-25T18:30:00Z')).toBe('26/10/2026');
  });
});
