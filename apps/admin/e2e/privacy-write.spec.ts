import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';

// #23 Dữ liệu khách PR B1 (CEO 30/10): "Ghi nhận yêu cầu" (POST /v1/privacy-requests) records a request and carries nothing out.
const rows = (page: Page) =>
  page.getByRole('region', { name: 'Yêu cầu dữ liệu cá nhân' }).getByRole('table').getByRole('row');

test('recording a request: the form checks, then the request joins the list', async ({ page }) => {
  await signIn(page, accountOf('admin'));
  await page.goto('/settings/customer-data');
  await page.getByRole('button', { name: 'Ghi nhận yêu cầu' }).click();
  const form = page.getByRole('dialog', { name: 'Ghi nhận yêu cầu' });
  await form.getByRole('button', { name: 'Ghi nhận', exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText('Chọn khách đã gửi yêu cầu.');
  await form.getByRole('searchbox', { name: 'Khách hàng' }).fill('Lê');
  await form.getByRole('button', { name: /^Lê Minh Châu/ }).click();
  await form.getByRole('combobox', { name: /^Khách yêu cầu/ }).selectOption('erase');
  await form.getByRole('button', { name: 'Ghi nhận', exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText('Ghi lý do: lý do được lưu cùng yêu cầu.');
  await form.getByRole('textbox', { name: 'Lý do' }).fill('Khách gọi tổng đài xin xóa.');
  await expectAccessible(page);
  await form.getByRole('button', { name: 'Ghi nhận', exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(rows(page).nth(1)).toHaveText(
    /^Lê Minh ChâuXóa dữ liệuChờ thực hiệnKhách gọi tổng đài xin xóa\./,
  );
  // Recorded only: the new row is pending and carries nothing out (no button on any row, PR B2 adds the erase).
  await expect(rows(page).nth(1).getByRole('cell')).toHaveCount(7);
  await expect(rows(page).getByRole('button')).toHaveCount(0);
});

test('a recording that fails keeps the form and its key; one already waiting says so', async ({
  page,
}) => {
  const keys: (string | undefined)[] = [];
  let failing = true;
  await page.route('**/v1/privacy-requests', (r) => {
    if (r.request().method() !== 'POST') return r.fallback();
    keys.push(r.request().headers()['idempotency-key']);
    return failing
      ? r.fulfill({
          status: 503,
          contentType: 'application/problem+json',
          body: JSON.stringify({
            status: 503,
            code: 'service_unavailable',
            traceId: 'trace-record',
          }),
        })
      : r.fallback();
  });
  await signIn(page, accountOf('owner'));
  await page.goto('/settings/customer-data');
  await page.getByRole('button', { name: 'Ghi nhận yêu cầu' }).click();
  const form = page.getByRole('dialog', { name: 'Ghi nhận yêu cầu' });
  await form.getByRole('searchbox', { name: 'Khách hàng' }).fill('Lê');
  await form.getByRole('button', { name: /^Lê Minh Châu/ }).click();
  await form.getByRole('combobox', { name: /^Khách yêu cầu/ }).selectOption('erase');
  await form.getByRole('textbox', { name: 'Lý do' }).fill('Xin xóa.');
  await form.getByRole('button', { name: 'Ghi nhận', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('Mã: trace-record');
  await expect(form.getByRole('textbox', { name: 'Lý do' })).toHaveValue('Xin xóa.');
  failing = false;
  await form.getByRole('button', { name: 'Ghi nhận', exact: true }).click();
  await expect(form).toHaveCount(0);
  // Two clicks, three requests: the API client asks a 503 (`wait`) once more by itself, as for every POST of the admin (F5b);
  // all three carry the one key of this body.
  expect(keys).toHaveLength(3);
  expect(new Set(keys).size).toBe(1);
  // The same customer and kind again: the API says one waits.
  await page.getByRole('button', { name: 'Ghi nhận yêu cầu' }).click();
  await form.getByRole('searchbox', { name: 'Khách hàng' }).fill('Lê');
  await form.getByRole('button', { name: /^Lê Minh Châu/ }).click();
  await form.getByRole('combobox', { name: /^Khách yêu cầu/ }).selectOption('erase');
  await form.getByRole('textbox', { name: 'Lý do' }).fill('Lần hai.');
  await form.getByRole('button', { name: 'Ghi nhận', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText(
    'Khách này đã có một yêu cầu "Xóa dữ liệu" đang chờ thực hiện.',
  );
});
