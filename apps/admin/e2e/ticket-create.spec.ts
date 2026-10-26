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
