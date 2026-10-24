import { expect, test } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';
import { WORKSPACES } from './stub-workspaces';

// #21 Workspace (N157): the workspaces of the company, Owner and Admin only, each changed in a dialog that sends only what changed.
test('an Admin sees the workspaces: name and slug, template in words, time zone, default limit', async ({
  page,
}) => {
  await signIn(page, accountOf('admin'));
  await page.goto('/settings/workspace');
  await expect(page.getByRole('heading', { name: 'Workspace', exact: true })).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(1 + WORKSPACES.length);
  const row = page.getByRole('row', { name: /Workspace thử/ });
  await expect(row).toContainText('b2b');
  await expect(row).toContainText('B2B bán hàng');
  await expect(row).toContainText('Asia/Ho_Chi_Minh');
  await expect(row).toContainText('5 hội thoại');
  await expect(page.getByRole('row', { name: /CSKH thử/ })).toContainText('Dịch vụ');
  await expectAccessible(page);
});

test('a Manager gets the forbidden page', async ({ page }) => {
  await signIn(page, accountOf('manager'));
  await page.goto('/settings/workspace');
  await expect(
    page.getByRole('heading', { name: 'Bạn không có quyền xem trang này.' }),
  ).toBeVisible();
});

test('an Admin changes the name, the time zone and the default limit, only what changed', async ({
  page,
}) => {
  await signIn(page, accountOf('admin'));
  await page.goto('/settings/workspace');
  await page.getByRole('button', { name: 'Sửa workspace Workspace thử' }).click();
  const dialog = page.getByRole('dialog', { name: /Sửa workspace/ });
  await expect(dialog).toContainText('Mẫu B2B bán hàng và mã b2b');
  await dialog.getByLabel('Tên workspace').fill('   ');
  await dialog.getByRole('button', { name: 'Lưu' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Nhập tên workspace.');
  await dialog.getByLabel('Tên workspace').fill('  Gani B2B ');
  await dialog.getByLabel('Múi giờ').selectOption('Asia/Bangkok');
  await dialog.getByLabel(/Giới hạn tải mặc định/).fill('8');
  await expectAccessible(page);
  const patched = page.waitForRequest((r) => r.method() === 'PATCH');
  await dialog.getByRole('button', { name: 'Lưu' }).click();
  const req = await patched;
  expect(req.url()).toMatch(new RegExp(`/v1/workspaces/${WORKSPACES[1]!.id}$`));
  expect(req.postDataJSON()).toEqual({
    name: 'Gani B2B',
    timezone: 'Asia/Bangkok',
    defaultMaxConcurrent: 8,
  });
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status')).toHaveText('Đã lưu workspace Gani B2B.');
  const saved = page.getByRole('row', { name: /Gani B2B/ });
  await expect(saved).toContainText('Asia/Bangkok');
  await expect(saved).toContainText('8 hội thoại');
});

test('a dialog where nothing changed sends nothing and closes', async ({ page }) => {
  await signIn(page, accountOf('owner'));
  await page.goto('/settings/workspace');
  let patched = false;
  page.on('request', (r) => {
    if (r.method() === 'PATCH') patched = true;
  });
  await page.getByRole('button', { name: 'Sửa workspace CSKH thử' }).click();
  const dialog = page.getByRole('dialog', { name: /Sửa workspace/ });
  await dialog.getByRole('button', { name: 'Lưu' }).click();
  await expect(dialog).toBeHidden();
  expect(patched).toBe(false);
});
