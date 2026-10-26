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

// A screen of the menu not built yet (most wait for their API) says so, with one way to a screen that is: never the 404, whose "Về
// trang chính" would lead back to /overview, the home of Owner, Admin and Manager.
test('the home of a Manager, not built yet, says so and opens the inbox', async ({ page }) => {
  await signIn(page, accountOf('manager'));
  await expect(page).toHaveURL('/overview');
  await expect(
    page.getByRole('heading', { name: 'Tổng quan: màn này chưa có trong bản hiện tại.' }),
  ).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('link', { name: 'Mở Hộp thư' }).click();
  await expect(page).toHaveURL('/inbox');
});

test('a Manager has the quick replies in Cài đặt, not built yet, and no other setting', async ({
  page,
}) => {
  await signIn(page, accountOf('manager'));
  // Its only item, so the group is the link (shell.tsx).
  const settings = page.getByRole('navigation', { name: 'Menu chính' }).getByRole('link', {
    name: 'Cài đặt',
  });
  await expect(settings).toHaveAttribute('href', '/settings/quick-replies');
  await settings.click();
  await expect(
    page.getByRole('heading', { name: 'Mẫu trả lời nhanh: màn này chưa có trong bản hiện tại.' }),
  ).toBeVisible();
});

test('a Viewer goes to the profile; an item outside the menu of the role is still the 404', async ({
  page,
}) => {
  await signIn(page, accountOf('viewer'));
  await page.goto('/leads');
  await expect(page.getByRole('heading', { name: /^Lead: màn này chưa có/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Mở hồ sơ cá nhân' })).toHaveAttribute('href', '/me');
  const res = await page.goto('/settings/ai');
  expect(res?.status()).toBe(404);
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
