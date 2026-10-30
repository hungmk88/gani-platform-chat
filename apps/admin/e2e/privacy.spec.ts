import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';

// #23 Dữ liệu khách, Đợt 1 read only (PR A, CEO 30/10): the requests on customers' personal data from a route planned for S5, by
// cursor as #29. No button records or carries out a request (PR B), and the route has no filter.
const rows = (page: Page) =>
  page.getByRole('region', { name: 'Yêu cầu dữ liệu cá nhân' }).getByRole('table').getByRole('row');

const problem = (status: number, code: string, traceId: string) => ({
  status,
  contentType: 'application/problem+json',
  body: JSON.stringify({ status, code, traceId }),
});

test('an Owner reads the requests, with nothing to record or carry out', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/v1/privacy-requests')) asked.push(new URL(r.url()).search);
  });
  await signIn(page, accountOf('owner'));
  await page.goto('/settings/customer-data');
  await expect(page.getByRole('heading', { name: 'Dữ liệu khách', level: 1 })).toBeVisible();
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).nth(0)).toHaveText(
    /^KháchYêu cầuTrạng tháiLý doNgười ghi nhậnGhi nhận lúcThực hiện lúc$/,
  );
  await expect(rows(page).nth(1)).toHaveText(
    /^Trần BìnhXóa dữ liệuChờ thực hiệnKhách gọi tổng đài xin xóa hồ sơ\.Nguyễn An00:30 29\/10\/2026—$/,
  );
  await expect(rows(page).nth(2)).toHaveText(/^Khách chưa có tênXuất dữ liệuĐã thực hiện/);
  expect(asked[0]).toBe('?limit=50');
  await expect(page.getByRole('main').getByRole('button', { name: 'Tải thêm' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Ghi nhận|Thực hiện|Xóa/ })).toHaveCount(0);
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expectAccessible(page);
});

test('"Tải thêm" reads the next requests once each, then says the list is over', async ({
  page,
}) => {
  await signIn(page, accountOf('admin'));
  await page.goto('/settings/customer-data');
  await expect(rows(page)).toHaveCount(3);
  await expect(page.getByText('Đã hiện hết.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Tải thêm' }).click();
  // The second page repeats one row of the first: it shows once.
  await expect(rows(page)).toHaveCount(4);
  await expect(rows(page).nth(3)).toHaveText(/^Lê ChâuXóa dữ liệuKhông thực hiện được/);
  await expect(page.getByText('Khách chưa có tên')).toHaveCount(1);
  await expect(page.getByText('Đã hiện hết.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tải thêm' })).toHaveCount(0);
});

test('a Manager has no such screen: the 404 inside the frame', async ({ page }) => {
  await signIn(page, accountOf('manager'));
  const res = await page.goto('/settings/customer-data');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Không tìm thấy trang.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Yêu cầu dữ liệu cá nhân' })).toHaveCount(0);
});

test('no request says so with one action', async ({ page }) => {
  await page.route('**/v1/privacy-requests?*', (r) =>
    r.fulfill({ json: { data: [], nextCursor: null } }),
  );
  await signIn(page, accountOf('owner'));
  await page.goto('/settings/customer-data');
  await expect(page.getByText('Chưa có yêu cầu nào về dữ liệu cá nhân.')).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  const asked = page.waitForRequest((r) => r.url().includes('/v1/privacy-requests?limit=50'));
  await page.getByRole('button', { name: 'Làm mới' }).click();
  await asked;
  await expectAccessible(page);
});

test('requests that fail say why, with the trace and Thử lại', async ({ page }) => {
  let failing = true;
  await page.route('**/v1/privacy-requests?*', (r) =>
    failing ? r.fulfill(problem(503, 'service_unavailable', 'trace-privacy')) : r.fallback(),
  );
  await signIn(page, accountOf('admin'));
  await page.goto('/settings/customer-data');
  const alert = page.getByRole('main').getByRole('alert');
  await expect(alert).toContainText('Mã: trace-privacy');
  await expect(page.getByRole('table')).toHaveCount(0);
  failing = false;
  await alert.getByRole('button', { name: 'Thử lại' }).click();
  await expect(rows(page)).toHaveCount(3);
  await expect(alert).toHaveCount(0);
});

test('a next page that fails keeps the rows read and asks that page again', async ({ page }) => {
  let failing = true;
  await page.route('**/v1/privacy-requests?*cursor=*', (r) =>
    failing ? r.fulfill(problem(503, 'service_unavailable', 'trace-page-2')) : r.fallback(),
  );
  await signIn(page, accountOf('owner'));
  await page.goto('/settings/customer-data');
  await page.getByRole('button', { name: 'Tải thêm' }).click();
  const alert = page.getByRole('main').getByRole('alert');
  await expect(alert).toContainText('Mã: trace-page-2');
  await expect(rows(page)).toHaveCount(3);
  failing = false;
  await alert.getByRole('button', { name: 'Thử lại' }).click();
  await expect(rows(page)).toHaveCount(4);
  await expect(page.getByText('Đã hiện hết.')).toBeVisible();
});

test('while the API has no request route, the screen says it is not there, never a made-up list', async ({
  page,
}) => {
  await page.route('**/v1/privacy-requests?*', (r) =>
    r.fulfill(problem(404, 'not_found', 'trace-404')),
  );
  await signIn(page, accountOf('owner'));
  await page.goto('/settings/customer-data');
  await expect(
    page.getByRole('heading', { name: 'Dữ liệu khách: màn này chưa có trong bản hiện tại.' }),
  ).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.getByText(/nối API|đã xóa|đã lưu/i)).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Mở Hộp thư' })).toHaveAttribute('href', '/inbox');
  await expectAccessible(page);
});
