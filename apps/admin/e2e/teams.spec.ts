import { expect, test } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';
import { TEAMS } from './stub-teams';

// #20 Team (N160): the teams of the workspace being worked in, and making one (one Idempotency-Key per name and description).
test('an Admin sees the teams of the workspace and makes one: the slug is the API one', async ({
  page,
}) => {
  await signIn(page, accountOf('admin'));
  await page.goto('/settings/teams');
  await expect(page.getByRole('heading', { name: 'Team', exact: true })).toBeVisible();
  const list = page.getByRole('region', { name: 'Team của workspace' });
  await expect(list.getByRole('row')).toHaveCount(1 + TEAMS.length);
  await expect(list.getByRole('row', { name: /Sales B2B/ })).toContainText('Mặc định');
  await expect(list.getByRole('row', { name: /CSKH/ })).toContainText('Sau bán hàng, khiếu nại');
  await expectAccessible(page);

  const form = page.getByRole('form', { name: 'Tạo team' });
  await form.getByRole('button', { name: 'Tạo team' }).click();
  await expect(form.getByRole('alert')).toHaveText('Nhập tên team.');
  await form.getByLabel('Tên team').fill('  Đại lý miền Nam ');
  await form.getByLabel(/Mô tả/).fill('  ');
  const posted = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/v1/teams'));
  await form.getByRole('button', { name: 'Tạo team' }).click();
  const req = await posted;
  expect(req.postDataJSON()).toEqual({ workspaceId: 'ws-e2e', name: 'Đại lý miền Nam' });
  expect(req.headers()['idempotency-key']).toBeTruthy();
  await expect(form.getByRole('status')).toHaveText(
    'Đã tạo team Đại lý miền Nam (mã dai-ly-mien-nam).',
  );
  await expect(form.getByLabel('Tên team')).toHaveValue('');
  await expect(list.getByRole('row')).toHaveCount(2 + TEAMS.length);
  await expect(list.getByRole('row').nth(2)).toContainText('Đại lý miền Nam');
});

test('a Manager gets the forbidden page, as the menu', async ({ page }) => {
  await signIn(page, accountOf('manager'));
  await page.goto('/settings/teams');
  await expect(
    page.getByRole('heading', { name: 'Bạn không có quyền xem trang này.' }),
  ).toBeVisible();
});
