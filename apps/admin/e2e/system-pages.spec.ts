import { expect, test } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf, STATUS_DOWN_TRACE } from './stub-api';

// The system pages (Phụ lục C v3 dòng 0): one sentence, one action, and axe.
for (const [path, title, action] of [
  ['/forbidden', 'Bạn không có quyền xem trang này.', 'Về trang chính'],
  ['/maintenance', 'Hệ thống đang bảo trì.', 'Tải lại'],
] as const) {
  test(`${path} says one sentence with one action`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.getByRole('link', { name: action })).toHaveAttribute('href', '/');
    await expectAccessible(page);
  });
}

test('an unknown path of a signed-in person is the 404 inside the frame', async ({ page }) => {
  await signIn(page, accountOf('manager'));
  await expect(page).toHaveURL('/overview');
  const res = await page.goto('/khong-co-trang-nay');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Không tìm thấy trang.' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Menu chính' })).toBeVisible();
  await expectAccessible(page);
});

// An error of the frame comes back on "/" as well, so its one action asks again instead of going home (no loop).
test('an error of the frame offers "Thử lại", not a way home', async ({ page }) => {
  await signIn(page, accountOf('manager+status-down'));
  await expect(page.getByRole('heading', { name: 'Đã có lỗi.' })).toBeVisible();
  await expect(page.getByText(`Mã: ${STATUS_DOWN_TRACE}`)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Về trang chính' })).toHaveCount(0);
  await expectAccessible(page);
  const asked = page.waitForRequest((r) => r.headers()['rsc'] === '1');
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await asked;
  await expect(page.getByRole('button', { name: 'Thử lại' })).toBeEnabled();
  await expect(page.getByRole('heading', { name: 'Đã có lỗi.' })).toBeVisible();
});
