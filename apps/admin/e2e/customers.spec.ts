import { expect, test } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';
import { CUSTOMERS, CUSTOMERS_PAGE } from './stub-customers';

// #7 Khách hàng (N165): the customers of the company, newest first, by cursor; searched by name or the start of a phone number;
// Marketing and Viewer get phones and emails masked from the API and search by name only.
const list = (page: import('@playwright/test').Page) =>
  page.getByRole('region', { name: 'Danh sách khách' });
const rows = (page: import('@playwright/test').Page) => list(page).getByRole('row');

test('a Sales opens Khách hàng from the menu and pages through the customers, newest first', async ({
  page,
}) => {
  await signIn(page, accountOf('sales'));
  await page
    .getByRole('navigation', { name: 'Menu chính' })
    .getByRole('link', { name: 'Khách hàng', exact: true })
    .click();
  await expect(page).toHaveURL('/customers');
  await expect(page.getByRole('heading', { name: 'Khách hàng', level: 1 })).toBeVisible();
  await expect(rows(page)).toHaveCount(CUSTOMERS_PAGE + 1); // the header row and a page
  const first = rows(page).nth(1);
  await expect(first).toContainText('Nguyễn Văn An');
  await expect(first).toContainText('0900 000 001');
  await expect(first).toContainText('an@example.test');
  await expect(first).toContainText('Zalo OA');
  await expect(first).toContainText('24/10/2026');
  await expect(rows(page).nth(2)).toContainText('Khách chưa có tên');
  await expectAccessible(page);

  await list(page).getByRole('button', { name: 'Tải thêm' }).click();
  await expect(rows(page)).toHaveCount(CUSTOMERS.length + 1);
  await expect(rows(page).last()).toContainText('Lê Minh Châu');
  await expect(list(page).getByRole('button', { name: 'Tải thêm' })).toHaveCount(0);
});

test('a search goes to the API: by a part of the name, the start of a phone number, a whole email, and says when nothing matches', async ({
  page,
}) => {
  await signIn(page, accountOf('support'));
  await page.goto('/customers');
  const search = list(page).getByLabel('Tìm khách');
  const asked = page.waitForRequest(
    (r) => r.url().includes('/v1/customers?') && r.url().includes('q=b%C3%ACnh'),
  );
  await search.fill(' bình ');
  await asked;
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).nth(1)).toContainText('Trần Thị Bình');

  await search.fill('0910');
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).nth(1)).toContainText('Lê Minh Châu');

  await search.fill('AN@example.test');
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).nth(1)).toContainText('Nguyễn Văn An');
  await search.fill('an@example');
  await expect(list(page).getByText('Tìm theo email cần gõ đủ cả địa chỉ.')).toBeVisible();

  await search.fill('không có ai');
  await expect(list(page).getByText('Không có khách khớp “không có ai”.')).toBeVisible();
  await list(page).getByRole('button', { name: 'Xóa tìm kiếm' }).click();
  await expect(search).toHaveValue('');
  await expect(rows(page)).toHaveCount(CUSTOMERS_PAGE + 1);
});

test('a Viewer sees phones and emails masked and is told to search by name', async ({ page }) => {
  await signIn(page, accountOf('viewer'));
  await page.goto('/customers');
  await expect(
    list(page).getByText('Theo tên. Vai trò của bạn thấy SĐT và email dạng che.'),
  ).toBeVisible();
  const first = rows(page).nth(1);
  await expect(first).toContainText('090*****01');
  await expect(first).toContainText('a***@example.test');
  await expect(first).not.toContainText('0900 000 001');
  await expectAccessible(page);
});

test('a list that fails says why, with the trace and Thử lại', async ({ page }) => {
  let failing = true;
  await page.route('**/v1/customers?*', (route) =>
    failing
      ? route.fulfill({
          status: 503,
          contentType: 'application/problem+json',
          body: JSON.stringify({
            status: 503,
            code: 'service_unavailable',
            traceId: 'trace-customers',
          }),
        })
      : route.fallback(),
  );
  await signIn(page, accountOf('manager'));
  await page.goto('/customers');
  const alert = list(page).getByRole('alert');
  await expect(alert).toContainText('Mã: trace-customers');
  failing = false;
  await alert.getByRole('button', { name: 'Thử lại' }).click();
  await expect(rows(page)).toHaveCount(CUSTOMERS_PAGE + 1);
});

test('a platform operator gets the forbidden page', async ({ page }) => {
  await signIn(page, accountOf('platform_operator'));
  await page.goto('/customers');
  await expect(
    page.getByRole('heading', { name: 'Bạn không có quyền xem trang này.' }),
  ).toBeVisible();
});

// #8 Hồ sơ khách (N165): one customer, from its row in the list; another company's or a missing one is "not found".
test('a Sales opens a customer from the list and sees the profile and how the channels know them', async ({
  page,
}) => {
  await signIn(page, accountOf('sales'));
  await page.goto('/customers');
  await list(page).getByRole('link', { name: 'Nguyễn Văn An' }).click();
  await expect(page).toHaveURL(`/customers/${CUSTOMERS[0]!.id}`);
  await expect(page.getByRole('heading', { name: 'Nguyễn Văn An', level: 1 })).toBeVisible();
  const info = page.getByRole('region', { name: 'Thông tin' });
  await expect(info).toContainText('0900 000 001');
  await expect(info).toContainText('an@example.test');
  await expect(info).toContainText('Chỉ người phục vụKhông');
  await expect(page.getByRole('region', { name: 'Định danh' })).toContainText(
    'Zalo OAChưa xác thực',
  );
  await expectAccessible(page);
  await page.getByRole('link', { name: 'Về danh sách khách' }).click();
  await expect(page).toHaveURL('/customers');
});

test('a Viewer sees the profile masked; a customer that is not there is "not found"', async ({
  page,
}) => {
  await signIn(page, accountOf('viewer'));
  await page.goto(`/customers/${CUSTOMERS[3]!.id}`);
  const info = page.getByRole('region', { name: 'Thông tin' });
  await expect(info).toContainText('091*****03');
  await expect(info).toContainText('c***@example.test');
  await expect(info).toContainText('Vai trò của bạn thấy SĐT và email dạng che.');
  await expect(page.getByRole('region', { name: 'Định danh' })).toContainText(
    'Chưa kênh nào biết khách này.',
  );
  await page.goto('/customers/0190c100-0000-7000-8000-000000000099');
  await expect(page.getByRole('heading', { name: 'Không tìm thấy khách' })).toBeVisible();
  await expectAccessible(page);
});

// "Sửa hồ sơ khách" (PATCH, N165): only what changed is sent, the phone in E.164, a blank field clears it; Marketing/Viewer cannot.
test('a Support changes the name, the phone and the flag of a customer, and the list shows the new name', async ({
  page,
}) => {
  await signIn(page, accountOf('support'));
  await page.goto(`/customers/${CUSTOMERS[0]!.id}`);
  await page.getByRole('button', { name: 'Sửa hồ sơ' }).click();
  const dialog = page.getByRole('dialog', { name: 'Sửa hồ sơ — Nguyễn Văn An' });
  await dialog.getByLabel(/Tên khách/).fill(' Anh An ');
  await dialog.getByLabel(/SĐT/).fill('0912 345 678');
  await dialog.getByLabel(/Chỉ người phục vụ/).check();
  await expectAccessible(page);
  const patched = page.waitForRequest(
    (r) => r.method() === 'PATCH' && r.url().endsWith(CUSTOMERS[0]!.id),
  );
  await dialog.getByRole('button', { name: 'Lưu' }).click();
  expect((await patched).postDataJSON()).toEqual({
    displayName: 'Anh An',
    phone: '+84912345678',
    humanOnly: true,
  });
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status')).toHaveText('Đã lưu hồ sơ khách.');
  await expect(page.getByRole('heading', { name: 'Anh An', level: 1 })).toBeVisible();
  const info = page.getByRole('region', { name: 'Thông tin' });
  await expect(info).toContainText('0912 345 678');
  await expect(info).toContainText('Có: bot không trả lời khách này');
  await page.getByRole('link', { name: 'Về danh sách khách' }).click();
  await expect(rows(page).nth(1)).toContainText('Anh An');
});

test('a wrong phone is said before sending, a blank email clears it, nothing changed sends nothing', async ({
  page,
}) => {
  const patches: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'PATCH') patches.push(r.postData() ?? '');
  });
  await signIn(page, accountOf('manager'));
  await page.goto(`/customers/${CUSTOMERS[3]!.id}`);
  await page.getByRole('button', { name: 'Sửa hồ sơ' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Lưu' }).click();
  await expect(dialog).toBeHidden();
  expect(patches).toEqual([]);

  await page.getByRole('button', { name: 'Sửa hồ sơ' }).click();
  await dialog.getByLabel(/SĐT/).fill('0912');
  await dialog.getByRole('button', { name: 'Lưu' }).click();
  await expect(dialog.getByRole('alert')).toContainText('SĐT chưa đúng dạng');
  expect(patches).toEqual([]);
  await dialog.getByLabel(/SĐT/).fill('0910 000 003');
  await dialog.getByLabel(/Email/).fill('');
  await dialog.getByRole('button', { name: 'Lưu' }).click();
  await expect(dialog).toBeHidden();
  expect(patches.map((p) => JSON.parse(p) as unknown)).toEqual([{ email: null }]);
  await expect(page.getByRole('region', { name: 'Thông tin' })).toContainText('EmailChưa có');
});

test('a Marketing reads a profile but has no way to change it', async ({ page }) => {
  await signIn(page, accountOf('marketing'));
  await page.goto(`/customers/${CUSTOMERS[0]!.id}`);
  await expect(page.getByRole('heading', { name: 'Nguyễn Văn An', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sửa hồ sơ' })).toHaveCount(0);
});
