import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';

// #27 Tự chủ & feature flag, Đợt 1 read only (PR A, CEO 30/10): the level of the workspace being worked in and its flags, from
// two routes planned for S5. No button lowers the level or turns a flag off (PR B), and nothing says "not wired" on the screen.
const flagRows = (page: Page) =>
  page.getByRole('table', { name: 'Feature flag của workspace' }).getByRole('row');
const levels = (page: Page) =>
  page.getByRole('table', { name: 'Ý nghĩa các mức tự chủ' }).getByRole('row');

const fail = (page: Page, route: string, status: number, code: string, traceId: string) =>
  page.route(route, (r) =>
    r.fulfill({
      status,
      contentType: 'application/problem+json',
      body: JSON.stringify({ status, code, traceId }),
    }),
  );

test('an Owner reads the level and the flags, with nothing to change them', async ({ page }) => {
  await signIn(page, accountOf('owner'));
  await page.goto('/settings/autonomy');
  await expect(
    page.getByRole('heading', { name: 'Tự chủ & feature flag', level: 1 }),
  ).toBeVisible();
  await expect(page.getByText('L0 — Bot kịch bản, AI không trả lời khách')).toBeVisible();
  await expect(page.getByText('Đợt 1 chỉ dùng L0', { exact: true })).toBeVisible();
  await expect(page.getByText('Người khác, 00:30 30/10/2026')).toBeVisible();
  await expect(levels(page)).toHaveCount(5);
  await expect(levels(page).nth(4)).toHaveText(/L3–L5chưa có định nghĩa \(U29\)/);
  await expect(flagRows(page)).toHaveCount(4);
  await expect(flagRows(page).nth(1)).toHaveText(/ai\.internal.*Đang bật$/);
  await expect(flagRows(page).nth(2)).toHaveText(/ai\.customer_reply.*Khóa ở Đợt 1$/);
  await expect(flagRows(page).nth(3)).toHaveText(/channel\.zalo.*Đang tắt$/);
  // Read only (PR B waits), and no developer banner on the screen.
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('main').getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByText(/nối API/i)).toHaveCount(0);
  await expectAccessible(page);
});

test('an Admin who changed the level reads "Bạn"', async ({ page }) => {
  await signIn(page, accountOf('admin'));
  await page.goto('/settings/autonomy');
  await expect(page.getByText('Bạn, 00:30 30/10/2026')).toBeVisible();
  await expect(page.getByText('Người khác, 00:30 30/10/2026')).toHaveCount(0);
  await expect(flagRows(page)).toHaveCount(4);
});

test('a Manager has no such screen: the 404 inside the frame', async ({ page }) => {
  await signIn(page, accountOf('manager'));
  const res = await page.goto('/settings/autonomy');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Không tìm thấy trang.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mức tự chủ' })).toHaveCount(0);
});

test('a workspace without flags says so with one action', async ({ page }) => {
  await page.route('**/v1/feature-flags?*', (r) => r.fulfill({ json: { data: [] } }));
  await signIn(page, accountOf('owner'));
  await page.goto('/settings/autonomy');
  await expect(page.getByText('Workspace này chưa có cờ nào.')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Feature flag của workspace' })).toHaveCount(0);
  await expect(page.getByText('L0 — Bot kịch bản, AI không trả lời khách')).toBeVisible();
  const asked = page.waitForRequest((r) =>
    r.url().includes('/v1/feature-flags?workspaceId=ws-e2e'),
  );
  await page.getByRole('button', { name: 'Làm mới' }).click();
  await asked;
  await expectAccessible(page);
});

test('a level that fails says why, with the trace and Thử lại; the flags still show', async ({
  page,
}) => {
  let failing = true;
  await page.route('**/v1/workspaces/*/autonomy', (r) =>
    failing
      ? r.fulfill({
          status: 503,
          contentType: 'application/problem+json',
          body: JSON.stringify({
            status: 503,
            code: 'service_unavailable',
            traceId: 'trace-level',
          }),
        })
      : r.fallback(),
  );
  await signIn(page, accountOf('admin'));
  await page.goto('/settings/autonomy');
  const alert = page.getByRole('main').getByRole('alert');
  await expect(alert).toContainText('Mã: trace-level');
  await expect(flagRows(page)).toHaveCount(4);
  await expect(page.getByText(/^L0 — /)).toHaveCount(0);
  failing = false;
  await alert.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByText('L0 — Bot kịch bản, AI không trả lời khách')).toBeVisible();
  await expect(alert).toHaveCount(0);
});

for (const [what, route] of [
  ['level', '**/v1/workspaces/*/autonomy'],
  ['flags', '**/v1/feature-flags?*'],
] as const)
  test(`while the API has no ${what} route, the screen says it is not there, never made-up data`, async ({
    page,
  }) => {
    await fail(page, route, 404, 'not_found', 'trace-404');
    await signIn(page, accountOf('owner'));
    await page.goto('/settings/autonomy');
    await expect(
      page.getByRole('heading', {
        name: 'Tự chủ & feature flag: màn này chưa có trong bản hiện tại.',
      }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Mức tự chủ' })).toHaveCount(0);
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.getByText(/nối API|đã lưu/i)).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Mở Hộp thư' })).toHaveAttribute('href', '/inbox');
    await expectAccessible(page);
  });
