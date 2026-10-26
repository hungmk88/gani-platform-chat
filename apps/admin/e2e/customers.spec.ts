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

test('a search goes to the API: by a part of the name, by the start of a phone number, and says when nothing matches', async ({
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
