import { expect, test } from '@playwright/test';

import { WRONG_CODE } from '../src/two-factor';
import { WRONG_PASSWORD } from '../src/two-factor-setup';
import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf, BACKUP_CODES, GOOD, TOTP } from './stub-api';

// #2 enrol (spec M8 §3.8): a role that must have 2FA is sent here first, and the app opens once it is on.
test('password, QR and code, then the 10 backup codes once', async ({ page }) => {
  await signIn(page, accountOf('owner+setup'));
  await expect(page).toHaveURL('/two-factor/setup');
  await expect(
    page.getByText('Vai trò của bạn bắt buộc xác thực 2 lớp.', { exact: false }),
  ).toBeVisible();
  await expectAccessible(page);

  await page.getByLabel('Mật khẩu').fill('sai-mat-khau');
  await page.getByRole('button', { name: 'Tiếp tục' }).click();
  await expect(page.locator('form').getByRole('alert')).toHaveText(WRONG_PASSWORD);
  await page.getByLabel('Mật khẩu').fill(GOOD);
  await page.getByRole('button', { name: 'Tiếp tục' }).click();

  await expect(
    page.getByRole('img', { name: 'Mã QR để thêm tài khoản vào ứng dụng xác thực' }),
  ).toBeVisible();
  await expect(page.getByText('JBSW Y3DP EHPK 3PXP')).toBeVisible();
  await expectAccessible(page);
  await page.getByLabel('Mã 6 số trong ứng dụng').fill(TOTP.wrong);
  await page.getByRole('button', { name: 'Xác nhận' }).click();
  await expect(page.locator('form').getByRole('alert')).toHaveText(WRONG_CODE);
  await page.getByLabel('Mã 6 số trong ứng dụng').fill(TOTP.good);
  await page.getByRole('button', { name: 'Xác nhận' }).click();

  await expect(page.getByRole('listitem')).toHaveText(BACKUP_CODES);
  const finish = page.getByRole('button', { name: 'Xong' });
  await expect(finish).toBeDisabled();
  await expectAccessible(page);
  await page.getByLabel('Tôi đã lưu 10 mã dự phòng ở nơi an toàn').check();
  await finish.click();
  await expect(page).toHaveURL('/overview');
  await expect(page.getByRole('navigation', { name: 'Menu chính' })).toBeVisible();
});

test('GET /v1/me refusing with two_factor_setup_required sends to the set-up (N93)', async ({
  page,
}) => {
  await signIn(page, accountOf('sales+gate'));
  await expect(page).toHaveURL('/two-factor/setup');
  await expect(page.getByLabel('Mật khẩu')).toBeVisible();
});
