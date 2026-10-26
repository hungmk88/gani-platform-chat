import { describe, expect, it } from 'vitest';

import { builtFor, homeFor, menuItemAt, navFor, ROLES, type Role } from './nav';

const hrefs = (role: Role) => navFor(role).flatMap((g) => g.items.map((i) => i.href));

describe('navFor', () => {
  it('keeps the five groups of the brief and never more, at most two levels', () => {
    for (const role of ROLES) {
      expect(navFor(role).length).toBeLessThanOrEqual(5);
      for (const g of navFor(role)) expect(g.items.length).toBeGreaterThan(0);
    }
    expect(navFor('owner').map((g) => g.label)).toEqual([
      'Hộp thư',
      'Khách hàng',
      'Tự động hóa',
      'Tổng quan & Báo cáo',
      'Cài đặt',
    ]);
  });

  it.each<[Role, string[]]>([
    [
      'owner',
      ['/inbox', '/customers', '/leads', '/tickets', '/bots', '/overview', '/settings/workspace'],
    ],
    [
      'manager',
      [
        '/inbox',
        '/customers',
        '/leads',
        '/tickets',
        '/bots',
        '/overview',
        '/settings/quick-replies',
      ],
    ],
    ['sales', ['/inbox', '/customers', '/leads', '/tickets', '/overview']],
    ['support', ['/inbox', '/customers', '/leads', '/tickets', '/overview']],
    ['marketing', ['/customers', '/leads', '/overview']],
    ['viewer', ['/customers', '/leads', '/overview']],
    ['platform_operator', ['/platform']],
  ])('%s sees what Phụ lục B gives it', (role, expected) => {
    expect(hrefs(role)).toEqual(expect.arrayContaining(expected));
    // A Manager manages the quick replies (Phụ lục B, N163) and no other setting.
    const settings = hrefs(role).filter((h) => h.startsWith('/settings'));
    if (role === 'manager') expect(settings).toEqual(['/settings/quick-replies']);
    else if (role !== 'owner' && role !== 'admin') expect(settings).toEqual([]);
  });

  it('shows /platform to the platform operator only', () => {
    for (const role of ROLES)
      expect(hrefs(role).includes('/platform')).toBe(role === 'platform_operator');
  });

  it('shows no Đợt 2 screen to anyone', () => {
    const dot2 = [
      '/quotes',
      '/orders',
      '/automation',
      '/knowledge',
      '/reports',
      '/settings/widget',
    ];
    for (const role of ROLES) expect(hrefs(role).filter((h) => dot2.includes(h))).toEqual([]);
  });
});

describe('homeFor', () => {
  it.each<[Role, string]>([
    ['owner', '/overview'],
    ['admin', '/overview'],
    ['manager', '/overview'],
    ['sales', '/inbox'],
    ['support', '/inbox'],
    ['marketing', '/overview'],
    ['viewer', '/overview'],
    ['platform_operator', '/platform'],
  ])('%s starts at %s', (role, home) => {
    expect(homeFor(role)).toBe(home);
    expect(hrefs(role)).toContain(home);
  });
});

describe('menuItemAt and builtFor', () => {
  it('finds an item of the menu of the role, not of another role, not an unknown path', () => {
    expect(menuItemAt('owner', '/overview')).toEqual({ href: '/overview', label: 'Tổng quan' });
    expect(menuItemAt('owner', '/settings/teams')?.label).toBe('Team');
    expect(menuItemAt('sales', '/settings/teams')).toBeUndefined();
    expect(menuItemAt('platform_operator', '/platform')?.label).toBe('Platform');
    expect(menuItemAt('owner', '/khong-co')).toBeUndefined();
  });

  it('sends those who hold conversations to the inbox, the others to their profile', () => {
    expect(builtFor('manager').href).toBe('/inbox');
    expect(builtFor('viewer').href).toBe('/me');
    expect(builtFor('platform_operator').href).toBe('/me');
  });
});
