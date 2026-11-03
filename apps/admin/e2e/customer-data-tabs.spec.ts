import { expect, test, type Page, type Route } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';

// #23 Dữ liệu khách, tabs (CEO 02/11, brief 33, 46–47: 23a, read only): the requests on personal data stay the first tab; the
// custom fields of the company come from `GET /v1/customer-fields` (planned S4, #548), its tags from `GET /v1/tags` (real API,
// #559). The requests themselves are tested in privacy*.spec.ts.
const tabs = (page: Page) => page.getByRole('navigation', { name: 'Phần dữ liệu khách' });
const rows = (page: Page, name: string) =>
  page.getByRole('region', { name }).getByRole('table').getByRole('row');
const problem = (status: number, code: string, traceId: string) => ({
  status,
  contentType: 'application/problem+json',
  body: JSON.stringify({ status, code, traceId }),
});
const isFields = (u: URL) => u.pathname === '/v1/customer-fields';
const isTags = (u: URL) => u.pathname === '/v1/tags';

test('an Owner goes from the requests to the custom fields of the company, and nothing writes', async ({
  page,
}) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (isFields(u) || u.pathname === '/v1/customer-field-defs')
      asked.push(`${r.method()} ${u.pathname}${u.search}`);
  });
  await signIn(page, accountOf('owner'));
  await page.goto('/settings/customer-data');
  await expect(tabs(page).getByRole('link')).toHaveText([
    'Yêu cầu dữ liệu cá nhân',
    'Trường tùy chỉnh',
    'Tag',
  ]);
  await expect(tabs(page).getByRole('link', { name: 'Yêu cầu dữ liệu cá nhân' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await tabs(page).getByRole('link', { name: 'Trường tùy chỉnh' }).click();
  await expect(page).toHaveURL(/\?tab=fields$/);
  await expect(tabs(page).getByRole('link', { name: 'Trường tùy chỉnh' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(rows(page, 'Trường tùy chỉnh')).toHaveText([
    'TrườngKiểuLựa chọnBắt buộcNhạy cảmDữ liệuTrạng thái',
    'Tên quánChữ—CóKhôngĐã cóĐang dùng',
    'Sản lượng/thángSố—KhôngKhôngChưa cóĐang dùng',
    'Ngày khai trươngNgày—KhôngKhôngChưa cóĐang dùng',
    'Kênh biết đếnChọn mộtZalo, Hội chợKhôngKhôngChưa cóĐã ẩn',
    'Sản phẩm quan tâmChọn nhiềuPhở khô, Bún, MiếnKhôngKhôngChưa cóĐang dùng',
    'SĐT kế toánSố điện thoại—KhôngCóĐã cóĐang dùng',
    'Email hóa đơnEmail—KhôngKhôngChưa cóĐang dùng',
  ]);
  await expect(
    page.getByText('Giá trị của trường nhạy cảm được che với Marketing và Viewer.'),
  ).toBeVisible();
  await expect(page.getByText('Chỉ xem: không tạo, sửa, ẩn, gộp hay xóa ở màn này.')).toBeVisible();
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0);
  await expectAccessible(page);
  expect(asked).toEqual(['GET /v1/customer-fields']);
});

test('an Admin reads the tags of the company by name, a hidden one too; a 404 says only that tab is not there', async ({
  page,
}) => {
  let served = true;
  await page.route(isTags, (r: Route) =>
    served ? r.fallback() : r.fulfill(problem(404, 'not_found', 'trace-404')),
  );
  await signIn(page, accountOf('admin'));
  await page.goto('/settings/customer-data?tab=tags');
  await expect(tabs(page).getByRole('link', { name: 'Tag' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(rows(page, 'Tag')).toHaveText([
    'TagSố kháchTrạng thái',
    'Khách sỉ12Đang dùng',
    'Quán ăn30Đang dùng',
    'Thử nghiệm cũ0Đã ẩn',
  ]);
  await expect(
    page.getByText('Tag đã ẩn không gắn thêm cho khách được; khách đang mang vẫn giữ.'),
  ).toBeVisible();
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0);
  await expectAccessible(page);
  served = false;
  await page.reload();
  await expect(page.getByText('Tag: chưa có trong bản hiện tại.')).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  await expectAccessible(page);
});

test('the tab loading, then a failure with its trace and Thử lại, then empty with Làm mới', async ({
  page,
}) => {
  let answer: 'slow' | 'down' | 'empty' = 'slow';
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  await page.route(isFields, async (r) => {
    if (answer === 'slow') await held;
    if (answer === 'empty') return r.fulfill({ json: { data: [] } });
    return r.fulfill(problem(503, 'service_unavailable', 'trace-fields'));
  });
  await signIn(page, accountOf('admin'));
  await page.goto('/settings/customer-data?tab=fields');
  await expect(page.getByRole('main').getByRole('status')).toHaveText('Đang tải trường tùy chỉnh…');
  answer = 'down';
  release();
  const alert = page.getByRole('main').getByRole('alert');
  await expect(alert).toContainText('Mã: trace-fields');
  await expectAccessible(page);
  answer = 'empty';
  await alert.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByText('Công ty chưa có trường tùy chỉnh nào.')).toBeVisible();
  await expect(page.getByRole('main').getByRole('button')).toHaveText(['Làm mới']);
  await expectAccessible(page);
});

test('a 404 says only that tab is not there yet; the requests not served keep the link to it', async ({
  page,
}) => {
  await page.route(isFields, (r: Route) => r.fulfill(problem(404, 'not_found', 'trace-404')));
  await page.route('**/v1/privacy-requests?*', (r) =>
    r.fulfill(problem(404, 'not_found', 'trace-404')),
  );
  await signIn(page, accountOf('owner'));
  await page.goto('/settings/customer-data?tab=fields');
  await expect(page.getByText('Trường tùy chỉnh: chưa có trong bản hiện tại.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dữ liệu khách', level: 1 })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  await tabs(page).getByRole('link', { name: 'Yêu cầu dữ liệu cá nhân' }).click();
  await expect(
    page.getByRole('heading', { name: 'Dữ liệu khách: màn này chưa có trong bản hiện tại.' }),
  ).toBeVisible();
  await expect(tabs(page).getByRole('link', { name: 'Trường tùy chỉnh' })).toHaveAttribute(
    'href',
    '/settings/customer-data?tab=fields',
  );
  await expectAccessible(page);
});

test('a Manager has no such tab either: the 404 inside the frame', async ({ page }) => {
  await signIn(page, accountOf('manager'));
  const res = await page.goto('/settings/customer-data?tab=fields');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Không tìm thấy trang.' })).toBeVisible();
  await expect(tabs(page)).toHaveCount(0);
});
