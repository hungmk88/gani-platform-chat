import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';

// #30 "Phiên truy cập" (U79, brief A-U79, tầng 1; PR U79a): the operator's sessions and ending one early, on the contract
// planned for S5 (#617) served here by page.route.
const COMPANY = { orgId: '0190f000-0000-7000-8000-000000000001', slug: 'gani', name: 'Gani Foods' };
const health = (c: typeof COMPANY) => ({
  ...c,
  channels: { total: 1, tokenExpiringSoon: 0, tokenExpired: 0 },
  aiCostMonthVnd: null,
});
const RUNNING = {
  id: '0190f200-0000-7000-8000-000000000001',
  orgId: COMPANY.orgId,
  orgName: COMPANY.name,
  operatorUserId: 'user-platform_operator',
  reason: 'Hỗ trợ lỗi kênh Zalo theo yêu cầu #128',
  startedAt: '2030-01-01T03:00:00Z',
  expiresAt: '2030-01-01T04:00:00Z',
  endedAt: null,
  endReason: null,
};
const ENDED = { ...RUNNING, id: 'ended', endedAt: '2030-01-01T03:20:00Z', endReason: 'manual' };

/** The companies, the sessions (each query kept) and "end" (each path kept). */
async function serve(page: Page) {
  const asked: string[] = [];
  const posts: string[] = [];
  const other = { ...COMPANY, orgId: '0190f000-0000-7000-8000-000000000002', name: 'The Smile' };
  await page.route(
    (u) => u.pathname === '/v1/platform/tenants/health',
    (r) => r.fulfill({ json: { data: [health(COMPANY), health(other)], nextCursor: null } }),
  );
  await page.route(
    (u) => u.pathname.startsWith('/v1/platform/access-sessions'),
    (r) => {
      const url = new URL(r.request().url());
      if (r.request().method() === 'GET') {
        asked.push(url.search);
        return r.fulfill({ json: { data: [RUNNING, ENDED], nextCursor: null } });
      }
      posts.push(url.pathname);
      return r.fulfill({ json: { ...RUNNING, endedAt: RUNNING.startedAt, endReason: 'manual' } });
    },
  );
  await signIn(page, accountOf('platform_operator'));
  await page.goto('/platform?tab=access');
  return { asked, posts };
}
const rows = (page: Page) =>
  page.getByRole('region', { name: 'Phiên truy cập' }).getByRole('table').getByRole('row');

test('the operator reads their own sessions, only the running ones by default, by company or all', async ({
  page,
}) => {
  const { asked } = await serve(page);
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).nth(0)).toHaveText(/^Công tyLý doBắt đầuTrạng tháiThao tác$/);
  await expect(rows(page).nth(1)).toHaveText(
    /Gani FoodsHỗ trợ lỗi kênh Zalo.*Còn hiệu lực tới 11:00 01\/01\/2030Kết thúc sớm…/,
  );
  await expect(rows(page).nth(2)).toHaveText(/Đã kết thúc lúc 10:20 01\/01\/2030—$/);
  expect(asked[0]).toBe('?limit=50&active=true');
  await page.getByRole('combobox', { name: /^Công ty/ }).selectOption({ label: 'The Smile' });
  await page.getByRole('checkbox', { name: 'Chỉ phiên còn hiệu lực' }).uncheck();
  await expect
    .poll(() => asked.at(-1))
    .toBe('?limit=50&orgId=0190f000-0000-7000-8000-000000000002');
  await expectAccessible(page);
});

test('"Kết thúc sớm…" asks again, ends the session and reads the list again', async ({ page }) => {
  const { asked, posts } = await serve(page);
  await page.getByRole('button', { name: 'Kết thúc sớm phiên ở Gani Foods' }).click();
  const dialog = page.getByRole('dialog', { name: 'Kết thúc sớm phiên truy cập' });
  await expect(dialog).toBeFocused(); // never on "Kết thúc phiên" or "Hủy"
  await expectAccessible(page);
  const reads = asked.length;
  await dialog.getByRole('button', { name: 'Kết thúc phiên' }).click();
  await expect(dialog).toBeHidden();
  expect(posts).toEqual([`/v1/platform/access-sessions/${RUNNING.id}/end`]);
  await expect(page.getByRole('status')).toHaveText(
    'Đã kết thúc phiên ở Gani Foods. Đã ghi audit.',
  );
  await expect.poll(() => asked.length).toBeGreaterThan(reads);
});
