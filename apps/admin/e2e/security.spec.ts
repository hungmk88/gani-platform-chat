import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';

// #29 Bảo mật, Đợt 1 read only (PR A, CEO 30/10): the incidents of one status and every alert of the company, from two routes
// planned for S5. No button opens, closes or hands over an incident (PR B); the alerts have no person or channel column (U69).
const table = (page: Page, heading: string) =>
  page.getByRole('region', { name: heading }).getByRole('table');
const rows = (page: Page, heading: string) => table(page, heading).getByRole('row');
const status = (page: Page) => page.getByRole('combobox', { name: /^Trạng thái/ });

const problem = (status: number, code: string, traceId: string) => ({
  status,
  contentType: 'application/problem+json',
  body: JSON.stringify({ status, code, traceId }),
});

test('an Owner reads the open incidents and the alerts, with nothing to change them', async ({
  page,
}) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/v1/security-incidents')) asked.push(new URL(r.url()).search);
  });
  await signIn(page, accountOf('owner'));
  await page.goto('/settings/security');
  await expect(page.getByRole('heading', { name: 'Bảo mật', level: 1 })).toBeVisible();
  await expect(rows(page, 'Sự cố')).toHaveCount(3);
  await expect(rows(page, 'Sự cố').nth(0)).toHaveText(/^Sự cốMức độNgười xử lýNgười mởMở lúc$/);
  await expect(rows(page, 'Sự cố').nth(1)).toHaveText(
    /Đăng nhập sai liên tục.*CaoNguyễn AnTrần Bình00:30 30\/10\/2026/,
  );
  await expect(rows(page, 'Sự cố').nth(2)).toContainText('Nghiêm trọng');
  expect(asked[0]).toBe('?status=open&limit=50');
  await expect(rows(page, 'Cảnh báo')).toHaveCount(3);
  await expect(rows(page, 'Cảnh báo').nth(0)).toHaveText(/^LoạiMức độThời điểmSố lầnSự cố$/);
  await expect(rows(page, 'Cảnh báo').nth(1)).toHaveText(
    /Đăng nhập sai nhiều lầnCao.*12Đã gắn sự cố/,
  );
  await expect(rows(page, 'Cảnh báo').nth(2)).toHaveText(
    /Truy cập từ quản trị nền tảngThấp.*1Chưa gắn sự cố/,
  );
  await expect(page.getByRole('main').getByRole('button', { name: 'Tải thêm' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Mở sự cố|Đóng|Giao/ })).toHaveCount(0);
  await expectAccessible(page);
});

test('"Tải thêm" reads the next alerts once each, then says the list is over', async ({ page }) => {
  await signIn(page, accountOf('admin'));
  await page.goto('/settings/security');
  await expect(rows(page, 'Cảnh báo')).toHaveCount(3);
  await expect(page.getByText('Đã hiện hết.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Tải thêm' }).click();
  // The second page repeats one row of the first: it shows once.
  await expect(rows(page, 'Cảnh báo')).toHaveCount(4);
  await expect(rows(page, 'Cảnh báo').nth(3)).toContainText('Xuất dữ liệu hàng loạt');
  await expect(page.getByText('Truy cập từ quản trị nền tảng')).toHaveCount(1);
  await expect(page.getByText('Đã hiện hết.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tải thêm' })).toHaveCount(0);
});

test('the closed incidents are asked with their status, with the time they closed', async ({
  page,
}) => {
  await signIn(page, accountOf('owner'));
  await page.goto('/settings/security');
  await expect(rows(page, 'Sự cố')).toHaveCount(3);
  const asked = page.waitForRequest((r) => r.url().includes('status=closed'));
  await status(page).selectOption('closed');
  await asked;
  await expect(rows(page, 'Sự cố')).toHaveCount(2);
  await expect(rows(page, 'Sự cố').nth(0)).toContainText('Đóng lúc');
  await expect(rows(page, 'Sự cố').nth(1)).toHaveText(
    /Xuất danh sách.*Trung bình.*10:15 21\/10\/2026$/,
  );
});

test('a Manager has no such screen: the 404 inside the frame', async ({ page }) => {
  await signIn(page, accountOf('manager'));
  const res = await page.goto('/settings/security');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Không tìm thấy trang.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sự cố' })).toHaveCount(0);
});

test('no open incident and no alert each say so with one action', async ({ page }) => {
  await page.route('**/v1/security-incidents?status=open*', (r) =>
    r.fulfill({ json: { data: [], nextCursor: null } }),
  );
  await page.route('**/v1/security-alerts?*', (r) =>
    r.fulfill({ json: { data: [], nextCursor: null } }),
  );
  await signIn(page, accountOf('owner'));
  await page.goto('/settings/security');
  await expect(page.getByText('Không có sự cố đang mở.')).toBeVisible();
  await expect(page.getByText('Chưa có cảnh báo bảo mật nào.')).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Xem sự cố đã đóng' }).click();
  await expect(status(page)).toHaveValue('closed');
  await expect(rows(page, 'Sự cố')).toHaveCount(2);
});

test('incidents that fail say why, with the trace and Thử lại; the alerts still show', async ({
  page,
}) => {
  let failing = true;
  await page.route('**/v1/security-incidents?*', (r) =>
    failing ? r.fulfill(problem(503, 'service_unavailable', 'trace-incidents')) : r.fallback(),
  );
  await signIn(page, accountOf('admin'));
  await page.goto('/settings/security');
  const alert = page.getByRole('main').getByRole('alert');
  await expect(alert).toContainText('Mã: trace-incidents');
  await expect(rows(page, 'Cảnh báo')).toHaveCount(3);
  await expect(table(page, 'Sự cố')).toHaveCount(0);
  failing = false;
  await alert.getByRole('button', { name: 'Thử lại' }).click();
  await expect(rows(page, 'Sự cố')).toHaveCount(3);
  await expect(alert).toHaveCount(0);
});

test('a next page that fails keeps the rows read and asks that page again', async ({ page }) => {
  let failing = true;
  await page.route('**/v1/security-alerts?*cursor=*', (r) =>
    failing ? r.fulfill(problem(503, 'service_unavailable', 'trace-page-2')) : r.fallback(),
  );
  await signIn(page, accountOf('owner'));
  await page.goto('/settings/security');
  await page.getByRole('button', { name: 'Tải thêm' }).click();
  const alert = page.getByRole('main').getByRole('alert');
  await expect(alert).toContainText('Mã: trace-page-2');
  await expect(rows(page, 'Cảnh báo')).toHaveCount(3);
  failing = false;
  await alert.getByRole('button', { name: 'Thử lại' }).click();
  await expect(rows(page, 'Cảnh báo')).toHaveCount(4);
  await expect(page.getByText('Đã hiện hết.')).toBeVisible();
});

for (const [what, route] of [
  ['incident', '**/v1/security-incidents?*'],
  ['alert', '**/v1/security-alerts?*'],
] as const)
  test(`while the API has no ${what} route, the screen says it is not there, never a made-up list`, async ({
    page,
  }) => {
    await page.route(route, (r) => r.fulfill(problem(404, 'not_found', 'trace-404')));
    await signIn(page, accountOf('owner'));
    await page.goto('/settings/security');
    await expect(
      page.getByRole('heading', { name: 'Bảo mật: màn này chưa có trong bản hiện tại.' }),
    ).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.getByText(/nối API|đã lưu/i)).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Mở Hộp thư' })).toHaveAttribute('href', '/inbox');
    await expectAccessible(page);
  });
