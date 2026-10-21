import { expect, test } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';

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
