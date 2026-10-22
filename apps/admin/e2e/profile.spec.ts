import { expect, test } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf, GOOD } from './stub-api';

// #5 Hồ sơ cá nhân: the name in the header opens it; password changes are checked here first (ADR-003), then by Better Auth.
test('the name in the header opens the profile with what /v1/me says', async ({ page }) => {
  await signIn(page, accountOf('sales'));
  await page.getByRole('link', { name: 'Người thử sales' }).click();
  await expect(page.getByRole('heading', { name: 'Hồ sơ cá nhân' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Thông tin' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const profile = page.getByRole('region', { name: 'Hồ sơ cá nhân' });
  await expect(profile.getByText('Công ty thử', { exact: true })).toBeVisible();
  await expect(profile.getByText('Workspace thử', { exact: true })).toBeVisible();
  await expect(profile.getByText('Sales', { exact: true })).toBeVisible();
  await expectAccessible(page);
});

test('changing the password: the rule first, then the wrong current one, then done', async ({
  page,
}) => {
  await signIn(page, accountOf('admin'));
  await page.goto('/me?tab=security');
  await expect(page.getByText('Xác thực 2 lớp:')).toBeVisible();
  const form = page.getByRole('form', { name: 'Đổi mật khẩu' });
  const fill = async (current: string, next: string, again = next) => {
    await form.getByLabel('Mật khẩu hiện tại').fill(current);
    await form.getByLabel(/^Mật khẩu mới/).fill(next);
    await form.getByLabel('Nhập lại mật khẩu mới').fill(again);
    await form.getByRole('button', { name: 'Đổi mật khẩu' }).click();
  };
  const sent = page
    .waitForRequest((r) => r.url().endsWith('/api/auth/change-password'), { timeout: 1500 })
    .catch(() => null);
  await fill(GOOD, 'aaaaaaaaaaaa');
  await expect(form.getByRole('alert')).toHaveText('Mật khẩu mới cần có cả chữ và số.');
  expect(await sent).toBeNull();
  await fill('sai-mat-khau-1', 'matkhau-moi-123');
  await expect(form.getByRole('alert')).toHaveText('Mật khẩu hiện tại chưa đúng.');
  const posted = page.waitForRequest((r) => r.url().endsWith('/api/auth/change-password'));
  await fill(GOOD, 'matkhau-moi-123');
  expect((await posted).postDataJSON()).toMatchObject({
    newPassword: 'matkhau-moi-123',
    revokeOtherSessions: true,
  });
  await expect(form.getByRole('status')).toHaveText(
    'Đã đổi mật khẩu. Các thiết bị khác đã bị đăng xuất.',
  );
  await expect(form.getByLabel('Mật khẩu hiện tại')).toHaveValue('');
  await expectAccessible(page);
});

test('signing out the other devices keeps this one', async ({ page }) => {
  await signIn(page, accountOf('manager'));
  await page.goto('/me?tab=security');
  await page.getByRole('button', { name: 'Đăng xuất khỏi các thiết bị khác' }).click();
  await expect(page.getByText('Đã đăng xuất các thiết bị khác.')).toBeVisible();
  await page.getByRole('link', { name: 'Thông báo' }).click();
  await expect(page.getByText(/Cài đặt thông báo .*chờ API/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Hồ sơ cá nhân' })).toBeVisible();
});
