import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';
import { MEMBERS, MEMBERS_PAGE } from './stub-members';

// #19 Thành viên: inviting (N152) and the list (N153). The stub answers 409 for `da-moi@`, emailSent false for `khong-gui@`.
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

test('the list: members then invitations, by pages, 2FA required said, an expired invitation sent again', async ({
  page,
}) => {
  await signIn(page, accountOf('owner'));
  await page.goto('/settings/members');
  const list = page.getByRole('region', { name: 'Danh sách thành viên' });
  const rows = list.getByRole('row');
  await expect(rows).toHaveCount(1 + MEMBERS_PAGE);
  await expect(list.getByRole('row', { name: /owner@e2e\.test/ })).toContainText('(bạn)');
  await expect(list.getByRole('row', { name: /admin@e2e\.test/ })).toContainText(
    'Bắt buộc, chưa cài',
  );
  await expect(list.getByRole('row', { name: /support@e2e\.test/ })).toContainText('Tạm khóa');
  await list.getByRole('button', { name: 'Tải thêm' }).click();
  await expect(rows).toHaveCount(1 + MEMBERS.length);
  await expect(list.getByRole('row', { name: /moi@example\.test/ })).toContainText(
    /Chờ nhận lời mời.*Hạn .*28\/10\/2026/,
  );
  const expired = list.getByRole('row', { name: /cu@example\.test/ });
  await expect(expired).toContainText('Lời mời hết hạn');
  const posted = page.waitForRequest((r) => r.url().endsWith(`/${MEMBERS[5]!.id}/resend-invite`));
  await expired.getByRole('button', { name: 'Gửi lại lời mời cho cu@example.test' }).click();
  expect((await posted).headers()['idempotency-key']).toBeTruthy();
  await expect(list.getByRole('status')).toHaveText('Đã gửi lại lời mời tới cu@example.test.');
  await expect(expired).toContainText(/Chờ nhận lời mời.*Hạn .*30\/10\/2026/);
  await expectAccessible(page);
});

test('an Admin cannot send an Owner invitation again, and a new invitation joins the list', async ({
  page,
}) => {
  await signIn(page, accountOf('admin'));
  await page.goto('/settings/members');
  const list = page.getByRole('region', { name: 'Danh sách thành viên' });
  await list.getByRole('button', { name: 'Tải thêm' }).click();
  await expect(list.getByRole('button', { name: /^Gửi lại lời mời cho/ })).toHaveCount(1);
  await expect(
    list.getByRole('button', { name: 'Gửi lại lời mời cho moi@example.test' }),
  ).toBeVisible();
  const reloaded = page.waitForResponse((r) => r.url().includes('/v1/members?'));
  await invite(page, 'ban-moi@example.test', 'Support');
  await reloaded;
  await expect(list.getByRole('row', { name: /ban-moi@example\.test/ })).toContainText('Support');
});

test('an Owner changes the role of an Admin in a dialog; never their own, never an invitation', async ({
  page,
}) => {
  await signIn(page, accountOf('owner'));
  await page.goto('/settings/members');
  const list = page.getByRole('region', { name: 'Danh sách thành viên' });
  await expect(list.getByRole('row', { name: /owner@e2e\.test/ }).getByRole('button')).toHaveCount(
    0,
  );
  await list.getByRole('button', { name: 'Đổi vai trò của Người thử admin' }).click();
  const dialog = page.getByRole('dialog', { name: /Đổi vai trò/ });
  await dialog.getByLabel('Vai trò mới').selectOption({ label: 'Manager' });
  await expectAccessible(page);
  const patched = page.waitForRequest((r) => r.method() === 'PATCH');
  await dialog.getByRole('button', { name: 'Lưu vai trò' }).click();
  expect((await patched).postDataJSON()).toEqual({ role: 'manager' });
  await expect(dialog).toBeHidden();
  await expect(list.getByRole('status')).toHaveText(
    'Đã đổi vai trò của Người thử admin thành Manager.',
  );
  await expect(list.getByRole('row', { name: /admin@e2e\.test/ })).toContainText('Manager');
  await list.getByRole('button', { name: 'Tải thêm' }).click();
  await expect(list.getByRole('button', { name: /^Đổi vai trò của/ })).toHaveCount(3);
});

test('an Admin changes no Owner and cannot pick Owner', async ({ page }) => {
  await signIn(page, accountOf('admin'));
  await page.goto('/settings/members');
  const list = page.getByRole('region', { name: 'Danh sách thành viên' });
  await expect(list.getByRole('row', { name: /owner@e2e\.test/ }).getByRole('button')).toHaveCount(
    0,
  );
  await list.getByRole('button', { name: 'Đổi vai trò của Người thử sales' }).click();
  const dialog = page.getByRole('dialog', { name: /Đổi vai trò/ });
  await expect(dialog.getByRole('option', { name: 'Owner' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Hủy' }).click();
  await expect(dialog).toBeHidden();
});

test('an Owner resets the 2FA of a member with a reason; a shared account is said', async ({
  page,
}) => {
  await signIn(page, accountOf('owner'));
  await page.goto('/settings/members');
  const list = page.getByRole('region', { name: 'Danh sách thành viên' });
  await expect(list.getByRole('button', { name: 'Đặt lại 2FA của Người thử admin' })).toHaveCount(
    0,
  );
  await list.getByRole('button', { name: 'Đặt lại 2FA của Người thử sales' }).click();
  const dialog = page.getByRole('dialog', { name: /Đặt lại 2FA/ });
  await dialog.getByRole('button', { name: 'Đặt lại 2FA' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(/bắt buộc/);
  await dialog.getByLabel(/Lý do/).fill('Mất điện thoại');
  await expectAccessible(page);
  const posted = page.waitForRequest((r) => r.url().endsWith('/2fa/reset'));
  await dialog.getByRole('button', { name: 'Đặt lại 2FA' }).click();
  const req = await posted;
  expect(req.postDataJSON()).toEqual({ reason: 'Mất điện thoại' });
  expect(req.headers()['idempotency-key']).toBeTruthy();
  await expect(dialog).toBeHidden();
  await expect(list.getByRole('status')).toHaveText(/^Đã đặt lại 2FA của Người thử sales\./);
  await expect(list.getByRole('row', { name: /sales@e2e\.test/ })).toContainText('Chưa bật');
  await list.getByRole('button', { name: 'Đặt lại 2FA của Người thử support' }).click();
  await dialog.getByLabel(/Lý do/).fill('Nhờ đặt lại');
  await dialog.getByRole('button', { name: 'Đặt lại 2FA' }).click();
  await expect(dialog.getByRole('alert')).toContainText('quản trị nền tảng');
});

test('an Admin cannot reset the 2FA of an Owner', async ({ page }) => {
  await signIn(page, accountOf('admin'));
  await page.goto('/settings/members');
  const list = page.getByRole('region', { name: 'Danh sách thành viên' });
  await expect(list.getByRole('button', { name: 'Đặt lại 2FA của Người thử sales' })).toBeVisible();
  await expect(list.getByRole('button', { name: 'Đặt lại 2FA của Người thử owner' })).toHaveCount(
    0,
  );
});
