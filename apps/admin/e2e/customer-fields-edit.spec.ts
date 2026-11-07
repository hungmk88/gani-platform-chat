import { expect, test, type Page, type Request } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';
import { FIELDS } from './stub-customer-data';
import { CUSTOMERS } from './stub-customers';

// #8 Hồ sơ khách, sửa thông tin thêm (J1, N191; CEO brief 169 P2b-2): the company's fields (the stub's GET /v1/customer-fields: one of
// each kind, "Kênh biết đến" hidden, "SĐT kế toán" sensitive) with this customer's values (GET …/fields), and the PUT, answered here.
const AN = CUSTOMERS[0]!;
const id = (name: string) => FIELDS.find((f) => f.name === name)!.id;
const isValues = (u: URL) => u.pathname === `/v1/customers/${AN.id}/fields`;
const section = (page: Page) => page.getByRole('region', { name: 'Thông tin thêm' });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Sửa thông tin thêm' });
const VALUES = [
  { fieldId: id('Tên quán'), value: 'Quán Ba Miền' },
  { fieldId: id('Sản lượng/tháng'), value: 1500 },
  { fieldId: id('Ngày khai trương'), value: '2026-03-08' },
  { fieldId: id('Kênh biết đến'), value: 'Zalo' },
  { fieldId: id('Sản phẩm quan tâm'), value: ['Phở khô', 'Miến'] },
  { fieldId: id('SĐT kế toán'), value: '+84912345678' },
];

/** GET answers `values`; each PUT is kept and answered with the values it set. */
async function serve(page: Page, values: { fieldId: string; value: unknown }[] = VALUES) {
  const puts: Request[] = [];
  await page.route(isValues, (r) => {
    if (r.request().method() !== 'PUT') return r.fulfill({ json: { data: values } });
    puts.push(r.request());
    const sent = (r.request().postDataJSON() as { values: { fieldId: string; value: unknown }[] })
      .values;
    const kept = values.filter((v) => !sent.some((s) => s.fieldId === v.fieldId));
    return r.fulfill({ json: { data: [...kept, ...sent.filter((s) => s.value !== null)] } });
  });
  return puts;
}

test('sales changes two values: only those are sent, the section takes the answer', async ({
  page,
}) => {
  const puts = await serve(page);
  await signIn(page, accountOf('sales'));
  await page.goto(`/customers/${AN.id}`);
  await section(page).getByRole('button', { name: 'Sửa thông tin thêm' }).click();
  // The hidden field is not offered; the others hold their values.
  const name = dialog(page).getByRole('textbox', { name: 'Tên quán (nên điền)' });
  await expect(name).toHaveValue('Quán Ba Miền');
  await expect(section(page).locator('dt')).toContainText(['Kênh biết đến (đã ẩn)']);
  await expect(dialog(page)).not.toContainText('Kênh biết đến');
  await expect(dialog(page).getByRole('checkbox', { name: 'Miến' })).toBeChecked();
  await expectAccessible(page);
  await dialog(page).getByRole('textbox', { name: 'Sản lượng/tháng' }).fill('2,5');
  await dialog(page).getByRole('textbox', { name: 'Email hóa đơn' }).fill(' Ke.Toan@Example.Test ');
  await dialog(page).getByRole('button', { name: 'Lưu' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(section(page).getByRole('status')).toHaveText('Đã lưu thông tin thêm.');
  expect(puts.map((p) => p.postDataJSON() as unknown)).toEqual([
    {
      values: [
        { fieldId: id('Sản lượng/tháng'), value: 2.5 },
        { fieldId: id('Email hóa đơn'), value: 'ke.toan@example.test' },
      ],
    },
  ]);
  await expect(section(page)).toContainText('2,5');
  await expect(section(page)).toContainText('ke.toan@example.test');
});

test('a value that cannot go is said before sending; a refusal says why and keeps the dialog', async ({
  page,
}) => {
  const puts: Request[] = [];
  await page.route(isValues, (r) => {
    if (r.request().method() !== 'PUT') return r.fulfill({ json: { data: VALUES } });
    puts.push(r.request());
    return r.fulfill({
      status: 422,
      contentType: 'application/problem+json',
      body: JSON.stringify({ status: 422, code: 'invalid_field_value', traceId: 'trace-field' }),
    });
  });
  await signIn(page, accountOf('manager'));
  await page.goto(`/customers/${AN.id}`);
  await section(page).getByRole('button', { name: 'Sửa thông tin thêm' }).click();
  await dialog(page).getByRole('textbox', { name: 'SĐT kế toán' }).fill('12');
  await dialog(page).getByRole('button', { name: 'Lưu' }).click();
  await expect(dialog(page).getByRole('alert')).toHaveText(
    'SĐT kế toán: SĐT chưa đúng (ví dụ 0912 345 678).',
  );
  expect(puts).toHaveLength(0);
  await dialog(page).getByRole('textbox', { name: 'SĐT kế toán' }).fill('');
  await dialog(page).getByRole('button', { name: 'Lưu' }).click();
  await expect(dialog(page).getByRole('alert')).toContainText('Có giá trị sai kiểu');
  await expect(dialog(page).getByRole('alert')).toContainText('Mã: trace-field');
  expect(puts[0]?.postDataJSON()).toEqual({
    values: [{ fieldId: id('SĐT kế toán'), value: null }],
  });
});

test('nothing changed: Lưu closes and sends nothing', async ({ page }) => {
  const puts = await serve(page);
  await signIn(page, accountOf('owner'));
  await page.goto(`/customers/${AN.id}`);
  await section(page).getByRole('button', { name: 'Sửa thông tin thêm' }).click();
  await dialog(page).getByRole('button', { name: 'Lưu' }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(puts).toHaveLength(0);
});

for (const role of ['viewer', 'marketing'] as const)
  test(`a ${role} changes nothing`, async ({ page }) => {
    await serve(page, [{ fieldId: id('SĐT kế toán'), value: '••••' }]);
    await signIn(page, accountOf(role));
    await page.goto(`/customers/${AN.id}`);
    await expect(section(page).locator('dd').nth(4)).toHaveText('••••');
    await expect(section(page).getByRole('button', { name: 'Sửa thông tin thêm' })).toHaveCount(0);
  });
