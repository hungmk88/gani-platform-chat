import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';

// #19 Thành viên: inviting (N152). The stub answers 409 for `da-moi@`, emailSent false for `khong-gui@`.
async function invite(page: Page, email: string, role?: string) {
  const form = page.getByRole('form', { name: 'Mời thành viên' });
  await form.getByLabel('Email').fill(email);
  if (role) await form.getByLabel('Vai trò').selectOption({ label: role });
  await form.getByRole('button', { name: 'Gửi lời mời' }).click();
  return form;
}

test('an Owner invites an Admin: one request with a key, the expiry of the API', async ({
  page,
}) => {
  await signIn(page, accountOf('owner'));
  await page.goto('/settings/members');
  await expect(page.getByRole('heading', { name: 'Thành viên', exact: true })).toBeVisible();
  const posted = page.waitForRequest((r) => r.url().endsWith('/v1/members/invite'));
  const form = await invite(page, '  Nguoi.Moi@Example.test ', 'Admin');
  const req = await posted;
  expect(req.postDataJSON()).toEqual({ email: 'nguoi.moi@example.test', role: 'admin' });
  expect(req.headers()['idempotency-key']).toBeTruthy();
  await expect(form.getByRole('status')).toHaveText(
    /^Đã gửi lời mời tới nguoi\.moi@example\.test\. Link dùng được đến .*29\/10\/2026/,
  );
  await expect(form.getByLabel('Email')).toHaveValue('');
  await expectAccessible(page);
});

test('an Admin cannot pick Owner; a pending invitation and an email that did not go are said', async ({
  page,
}) => {
  await signIn(page, accountOf('admin'));
  await page.goto('/settings/members');
  const form = page.getByRole('form', { name: 'Mời thành viên' });
  await expect(form.getByRole('option', { name: 'Owner' })).toHaveCount(0);
  await expect(form.getByLabel('Vai trò')).toHaveValue('sales');
  await invite(page, 'sai-dang');
  await expect(form.getByRole('alert')).toHaveText(/Email chưa đúng dạng/);
  await invite(page, 'da-moi@example.test');
  await expect(form.getByRole('alert')).toContainText('Email này đang có lời mời chờ nhận.');
  await invite(page, 'khong-gui@example.test');
  await expect(form.getByRole('status')).toContainText('chưa gửi được email');
  await expectAccessible(page);
});

test('an invitation whose email did not go is sent again: new expiry, one key', async ({
  page,
}) => {
  await signIn(page, accountOf('owner'));
  await page.goto('/settings/members');
  const form = await invite(page, 'khong-gui@example.test');
  await expect(form.getByRole('status')).toContainText('chưa gửi được email');
  const posted = page.waitForRequest((r) => r.url().endsWith('/resend-invite'));
  await form.getByRole('button', { name: 'Gửi lại lời mời' }).click();
  expect((await posted).headers()['idempotency-key']).toBeTruthy();
  await expect(form.getByRole('status')).toHaveText(
    /^Đã gửi lời mời tới khong-gui@example\.test\. Link dùng được đến .*30\/10\/2026/,
  );
  await expect(form.getByRole('button', { name: 'Gửi lại lời mời' })).toHaveCount(0);
  await expectAccessible(page);
});

test('a Manager gets the forbidden page', async ({ page }) => {
  await signIn(page, accountOf('manager'));
  await page.goto('/settings/members');
  await expect(
    page.getByRole('heading', { name: 'Bạn không có quyền xem trang này.' }),
  ).toBeVisible();
});
