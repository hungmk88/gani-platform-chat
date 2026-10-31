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
  // Recorded only, nothing carried out: the new row is pending, and like every pending erase it has its button (PR B2).
  await expect(rows(page).nth(1).getByRole('cell')).toHaveCount(8);
  await expect(
    rows(page).nth(1).getByRole('button', { name: 'Xóa dữ liệu của Lê Minh Châu' }),
  ).toBeVisible();
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
  // Two clicks, two requests (`retry: false`: nothing is sent again by itself), with the one key of this body.
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
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

// #455: since #450 the client does not ask a 409 `idempotency_in_progress` again by itself; the person sees why and sends again,
// with the same key.
test('a recording still being carried out says so, and sending again keeps its key', async ({
  page,
}) => {
  let busy = true;
  await page.route('**/v1/privacy-requests', (r) => {
    if (r.request().method() !== 'POST' || !busy) return r.fallback();
    busy = false;
    return r.fulfill({
      status: 409,
      contentType: 'application/problem+json',
      body: JSON.stringify({ status: 409, code: 'idempotency_in_progress' }),
    });
  });
  const posted = () =>
    page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/v1/privacy-requests'));
  await signIn(page, accountOf('owner'));
  await page.goto('/settings/customer-data');
  await page.getByRole('button', { name: 'Ghi nhận yêu cầu' }).click();
  const form = page.getByRole('dialog', { name: 'Ghi nhận yêu cầu' });
  await form.getByRole('searchbox', { name: 'Khách hàng' }).fill('Lê');
  await form.getByRole('button', { name: /^Lê Minh Châu/ }).click();
  await form.getByRole('combobox', { name: /^Khách yêu cầu/ }).selectOption('erase');
  await form.getByRole('textbox', { name: 'Lý do' }).fill('Khách hỏi lại.');
  const first = posted();
  await form.getByRole('button', { name: 'Ghi nhận', exact: true }).click();
  const key = (await first).headers()['idempotency-key'];
  await expect(form.getByRole('alert')).toContainText(
    'Yêu cầu trước vẫn đang xử lý. Đợi một chút.',
  );
  const second = posted();
  await form.getByRole('button', { name: 'Ghi nhận', exact: true }).click();
  expect(key).toMatch(/^[0-9a-f-]{36}$/);
  expect((await second).headers()['idempotency-key']).toBe(key);
});
