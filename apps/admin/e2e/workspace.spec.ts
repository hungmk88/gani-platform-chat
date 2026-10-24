import { expect, test } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';
import { WORKSPACES } from './stub-workspaces';

// #21 Workspace (N157): the workspaces of the company, Owner and Admin only.
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
