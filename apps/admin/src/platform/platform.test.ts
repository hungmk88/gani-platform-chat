import { describe, expect, it } from 'vitest';

import { dayText, healthPath, priceText, sourceLink, tabOf, windowText } from './platform';

describe('#30 Platform', () => {
  it('opens the health of the companies unless the URL asks for another tab', () => {
    expect(tabOf(undefined)).toBe('health');
    expect(tabOf('policies')).toBe('policies');
    expect(tabOf('access')).toBe('access');
    expect(tabOf('xyz')).toBe('health');
  });

  it('reads the companies 50 a page, the next by its cursor', () => {
    expect(healthPath(null)).toBe('/v1/platform/tenants/health?limit=50');
    expect(healthPath('c 2')).toBe('/v1/platform/tenants/health?limit=50&cursor=c+2');
  });

  it('says the free window in hours (or minutes) and messages, leaving out what the policy does not set', () => {
    expect(windowText({ freeWindowSeconds: 172800, freeMessageQuota: 8 })).toBe('48 giờ, 8 tin');
    expect(windowText({ freeWindowSeconds: 5400, freeMessageQuota: null })).toBe('90 phút');
    expect(windowText({ freeWindowSeconds: null, freeMessageQuota: 0 })).toBe('0 tin');
    expect(windowText({ freeWindowSeconds: null, freeMessageQuota: null })).toBe('—');
  });

  it('says the price per message in đồng, or "—"', () => {
    expect(priceText(1500)).toBe('1.500 đ/tin');
    expect(priceText(null)).toBe('—');
  });

  it('says a day in Viet Nam, a bare date never moved by the time zone', () => {
    expect(dayText('2023-06-20')).toBe('20/06/2023');
    expect(dayText('2026-11-04T18:00:00Z')).toBe('05/11/2026');
    expect(dayText(null)).toBe('—');
  });

  it('links a source only when it is an https URL', () => {
    expect(sourceLink('https://oa.zalo.me/home/thong-bao')).toEqual({
      href: 'https://oa.zalo.me/home/thong-bao',
      text: 'oa.zalo.me',
    });
    expect(sourceLink('javascript:alert(1)')).toBeNull();
    expect(sourceLink('http://example.com')).toBeNull();
    expect(sourceLink('https://')).toBeNull();
    expect(sourceLink(null)).toBeNull();
  });
});
