import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';
import { FIELDS } from './stub-customer-data';
import { CUSTOMERS } from './stub-customers';

// #8 Hồ sơ khách, trường tùy chỉnh (J1, N191; CEO brief 169 P2b-1): the company's fields (the stub's GET /v1/customer-fields: one
// of each kind, "Kênh biết đến" hidden, "SĐT kế toán" sensitive) with this customer's values (GET …/fields, answered here).
const AN = CUSTOMERS[0]!;
const id = (name: string) => FIELDS.find((f) => f.name === name)!.id;
const isValues = (u: URL) => u.pathname === `/v1/customers/${AN.id}/fields`;
const section = (page: Page) => page.getByRole('region', { name: 'Thông tin thêm' });
const VALUES = [
  { fieldId: id('Tên quán'), value: 'Quán Ba Miền' },
  { fieldId: id('Sản lượng/tháng'), value: 1500 },
  { fieldId: id('Ngày khai trương'), value: '2026-03-08' },
  { fieldId: id('Kênh biết đến'), value: 'Zalo' },
  { fieldId: id('Sản phẩm quan tâm'), value: ['Phở khô', 'Miến'] },
  { fieldId: id('SĐT kế toán'), value: '+84912345678' },
];
const serve = (page: Page, values: { fieldId: string; value: unknown }[]) =>
  page.route(isValues, (r) => r.fulfill({ json: { data: values } }));

test('sales reads the values by position, in words; a hidden field shows only with a value', async ({
  page,
}) => {
  await serve(page, VALUES);
  await signIn(page, accountOf('sales'));
  await page.goto(`/customers/${AN.id}`);
  await expect(section(page).locator('dt, dd')).toHaveText([
    'Tên quán',
    'Quán Ba Miền',
    'Sản lượng/tháng',
    '1.500',
    'Ngày khai trương',
    '08/03/2026',
    'Kênh biết đến (đã ẩn)',
    'Zalo',
    'Sản phẩm quan tâm',
    'Phở khô, Miến',
    'SĐT kế toán',
    '0912 345 678',
    'Email hóa đơn',
    'Chưa có',
  ]);
  await expectAccessible(page);
});

for (const role of ['viewer', 'marketing'] as const)
  test(`a ${role} reads the sensitive value masked; the hidden field without a value is left out`, async ({
    page,
  }) => {
    await serve(page, [{ fieldId: id('SĐT kế toán'), value: '••••' }]);
    await signIn(page, accountOf(role));
    await page.goto(`/customers/${AN.id}`);
    await expect(section(page).locator('dt')).toHaveText([
      'Tên quán',
      'Sản lượng/tháng',
      'Ngày khai trương',
      'Sản phẩm quan tâm',
      'SĐT kế toán',
      'Email hóa đơn',
    ]);
    await expect(section(page).locator('dd').nth(4)).toHaveText('••••');
  });

test('while it loads it says so; a failure says why with its trace, and Thử lại reads again', async ({
  page,
}) => {
  let release = () => {};
  const gate = new Promise<void>((r) => (release = r));
  let n = 0;
  await page.route(isValues, async (r) => {
    if (++n === 1) {
      await gate;
      return r.fulfill({
        status: 500,
        contentType: 'application/problem+json',
        body: JSON.stringify({ status: 500, code: 'internal_error', traceId: 'trace-values' }),
      });
    }
    return r.fulfill({ json: { data: [] } });
  });
  await signIn(page, accountOf('support'));
  await page.goto(`/customers/${AN.id}`);
  await expect(section(page).getByRole('status')).toHaveText('Đang tải thông tin thêm…');
  release();
  await expect(section(page).getByRole('alert')).toContainText('Mã: trace-values');
  await section(page).getByRole('button', { name: 'Thử lại' }).click();
  await expect(section(page).locator('dd').first()).toHaveText('Chưa có');
  await expectAccessible(page);
});

test('a company without fields says where to add them', async ({ page }) => {
  await page.route('**/v1/customer-fields', (r) => r.fulfill({ json: { data: [] } }));
  await signIn(page, accountOf('owner'));
  await page.goto(`/customers/${AN.id}`);
  await expect(section(page)).toContainText(
    'Công ty chưa có trường tùy chỉnh. Owner hoặc Admin thêm ở Cài đặt › Dữ liệu khách.',
  );
});
