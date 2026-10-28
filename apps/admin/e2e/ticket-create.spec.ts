import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';

// #15(b) Tạo ticket (U27, N167, issue #357): POST /v1/tickets (planned S4) from the list's one primary button, with an
// Idempotency-Key per body. "Người nhận" is stage 1: Owner/Admin only, from GET /v1/members; no other role ever asks it.
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Tạo ticket' });
const open = async (page: Page) => {
  await page.goto('/tickets');
  await page.getByRole('button', { name: 'Tạo ticket' }).click();
  await expect(dialog(page)).toBeVisible();
};

test('an Owner makes a ticket for a person of the workspace, then lands on it', async ({
  page,
}) => {
  await signIn(page, accountOf('owner'));
  await open(page);
  await expectAccessible(page);
  await dialog(page).getByRole('button', { name: 'Tạo ticket' }).click();
  await expect(dialog(page).getByRole('alert')).toHaveText('Nhập tiêu đề ticket.');
  await dialog(page).getByLabel('Tiêu đề').fill('  Giao bù đơn thiếu  ');
  await dialog(page).getByLabel('Mô tả (không bắt buộc)').fill('Thiếu 2 thùng.');
  await dialog(page).getByLabel('Ưu tiên').selectOption('high');
  const people = dialog(page).getByLabel('Người nhận');
  // Active Owner/Admin/Manager/Support of the workspace only: its Sales is not offered (U52).
  await expect(people.getByRole('option')).toHaveText(['Chưa giao', 'Người thử owner']);
  await people.selectOption('user-owner');
  await dialog(page).getByRole('button', { name: 'Tạo ticket' }).click();
  await expect(page).toHaveURL(/\/tickets\/0190c3ff-/);
  const screen = page.getByRole('region', { name: 'Chi tiết ticket' });
  await expect(screen.getByRole('heading', { level: 1 })).toHaveText('Giao bù đơn thiếu');
  await expect(screen).toContainText('Cao');
  await expect(screen).toContainText('Người thử owner');
  await page.getByRole('link', { name: 'Về danh sách ticket' }).click();
  await expect(page.getByRole('row').nth(1)).toContainText('Giao bù đơn thiếu');
});

test('a Sales makes a ticket without the assignee field, and never asks for the members', async ({
  page,
}) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/v1/members')) asked.push(r.url());
  });
  await signIn(page, accountOf('sales'));
  await open(page);
  await expect(dialog(page).getByLabel('Người nhận')).toHaveCount(0);
  await dialog(page).getByLabel('Tiêu đề').fill('Khách hỏi lại báo giá');
  await dialog(page).getByRole('button', { name: 'Tạo ticket' }).click();
  await expect(page.getByRole('region', { name: 'Chi tiết ticket' })).toContainText('Chưa giao');
  expect(asked).toEqual([]);
});

test('a refused assignee or a lost connection keeps the form, and the same body keeps its key', async ({
  page,
}) => {
  await signIn(page, accountOf('admin+bad-assignee'));
  await open(page);
  await dialog(page).getByLabel('Tiêu đề').fill('Kiểm kho');
  await dialog(page).getByLabel('Người nhận').selectOption('user-owner');
  const keys: (string | null)[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/v1/tickets'))
      keys.push(r.headers()['idempotency-key'] ?? null);
  });
  await page.route('**/v1/tickets', (r) =>
    r.request().method() === 'POST' ? r.abort() : r.fallback(),
  );
  await dialog(page).getByRole('button', { name: 'Tạo ticket' }).click();
  await expect(dialog(page).getByRole('alert')).toContainText('Không kết nối được máy chủ');
  await expect(dialog(page).getByLabel('Tiêu đề')).toHaveValue('Kiểm kho');
  await page.unroute('**/v1/tickets');
  await dialog(page).getByRole('button', { name: 'Tạo ticket' }).click();
  await expect(dialog(page).getByRole('alert')).toContainText('Chọn người khác');
  await expect(dialog(page).getByRole('alert')).toContainText('trace-e2e-422');
  await expect(dialog(page).getByLabel('Người nhận')).toHaveValue('user-owner');
  expect(keys.length).toBeGreaterThanOrEqual(2);
  expect(new Set(keys).size).toBe(1);
  await dialog(page).getByLabel('Tiêu đề').fill('Kiểm kho tháng 10');
  await dialog(page).getByRole('button', { name: 'Tạo ticket' }).click();
  await expect.poll(() => new Set(keys).size).toBe(2);
});

// #359: from the list, a customer may be picked by name, the start of a phone or a whole email (GET /v1/customers, limit 10).
const customerBox = (page: Page) => dialog(page).getByLabel('Khách hàng (không bắt buộc)');
const found = (page: Page) => dialog(page).getByRole('list', { name: 'Khách tìm được' });
const bodies = (page: Page) => {
  const sent: Record<string, unknown>[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/v1/tickets'))
      sent.push(r.postDataJSON() as Record<string, unknown>);
  });
  return sent;
};

test('a Manager finds a customer by name, then by phone, and the ticket carries them', async ({
  page,
}) => {
  await signIn(page, accountOf('manager'));
  const sent = bodies(page);
  await open(page);
  await expect(customerBox(page)).toHaveAttribute('placeholder', 'Gõ tên, SĐT hoặc email khách');
  await customerBox(page).fill('khong ai');
  await expect(dialog(page)).toContainText('Không có khách khớp "khong ai".');
  await customerBox(page).fill('binh');
  await expect(found(page).getByRole('button')).toHaveText(['Trần Thị Bình · 0900 000 002']);
  await customerBox(page).fill('0910');
  await expect(found(page).getByRole('button')).toHaveText(['Lê Minh Châu · 0910 000 003']);
  await expectAccessible(page);
  await found(page).getByRole('button').click();
  await expect(dialog(page)).toContainText('Khách: Lê Minh Châu · 0910 000 003');
  await dialog(page).getByLabel('Tiêu đề').fill('Gửi lại báo giá');
  await dialog(page).getByRole('button', { name: 'Tạo ticket' }).click();
  await expect(page).toHaveURL(/\/tickets\/0190c3ff-/);
  expect(sent.at(-1)?.['customerId']).toBe('0190c100-0000-7000-8000-000000000004');
  await expect(page.getByRole('region', { name: 'Chi tiết ticket' })).toContainText('Lê Minh Châu');
});

test('a Sales picks a customer then drops it: none is sent', async ({ page }) => {
  await signIn(page, accountOf('sales'));
  const sent = bodies(page);
  await open(page);
  await customerBox(page).fill('an@example.test');
  await found(page)
    .getByRole('button', { name: /Nguyễn Văn An/ })
    .click();
  await dialog(page).getByRole('button', { name: 'Bỏ chọn' }).click();
  await expect(customerBox(page)).toHaveValue('');
  await dialog(page).getByLabel('Tiêu đề').fill('Hỏi lại địa chỉ');
  await customerBox(page).press('Enter'); // Enter in the search never sends the ticket
  expect(sent).toEqual([]);
  await dialog(page).getByRole('button', { name: 'Tạo ticket' }).click();
  await expect(page).toHaveURL(/\/tickets\/0190c3ff-/);
  expect(sent.at(-1)).not.toHaveProperty('customerId');
});

test('a customer no longer visible is dropped with its sentence, and the ticket goes without', async ({
  page,
}) => {
  await signIn(page, accountOf('manager+gone-customer'));
  const sent = bodies(page);
  await open(page);
  await dialog(page).getByLabel('Tiêu đề').fill('Đổi lịch hẹn');
  await customerBox(page).fill('binh');
  await found(page).getByRole('button').click();
  await dialog(page).getByRole('button', { name: 'Tạo ticket' }).click();
  await expect(dialog(page).getByRole('alert')).toContainText(
    'Khách này không còn thấy được. Đã bỏ chọn, chọn khách khác hoặc để trống.',
  );
  await expect(dialog(page).getByRole('alert')).toContainText('trace-e2e-404');
  await expect(customerBox(page)).toHaveValue('');
  await expect(dialog(page).getByLabel('Tiêu đề')).toHaveValue('Đổi lịch hẹn');
  await expectAccessible(page);
  await dialog(page).getByRole('button', { name: 'Tạo ticket' }).click();
  await expect(page).toHaveURL(/\/tickets\/0190c3ff-/);
  expect(sent.at(-1)).not.toHaveProperty('customerId');
});

test('with more customers than one short page, the person is asked to type more', async ({
  page,
}) => {
  await signIn(page, accountOf('support'));
  // More than 10 customers match one word: the API answers 10 and a cursor (GET /v1/customers?limit=10).
  const asked: string[] = [];
  await page.route('**/v1/customers?*', (r) => {
    asked.push(r.request().url());
    return r.fulfill({
      json: {
        data: Array.from({ length: 10 }, (_, n) => ({
          id: `0190c1aa-0000-7000-8000-0000000000${String(n + 10)}`,
          displayName: `Nguyễn Khách ${n + 1}`,
          phone: `+849000001${String(n + 10)}`,
          email: null,
          humanOnly: false,
          identities: [],
          createdAt: '2026-10-20T03:00:00.000Z',
          updatedAt: '2026-10-20T03:00:00.000Z',
        })),
        nextCursor: '10',
      },
    });
  });
  await open(page);
  await customerBox(page).fill('nguyen');
  await expect(found(page).getByRole('button')).toHaveCount(10);
  await expect(dialog(page)).toContainText('Gõ thêm để thu hẹp.');
  expect(new URL(asked.at(-1)!).searchParams.get('limit')).toBe('10');
});
