import { expect, test, type Page } from '@playwright/test';

import { EXPIRED, LOCKED, WRONG_BACKUP_CODE, WRONG_CODE } from '../src/two-factor';
import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf, BACKUP_CODES, TOTP } from './stub-api';

// #2 verify: the second step of sign-in for a person with 2FA on (Better Auth's twoFactorRedirect).
const form = (page: Page) => page.locator('form');

async function enter(page: Page, code: string) {
  await form(page).getByRole('textbox').fill(code);
  await page.getByRole('button', { name: 'Xác thực', exact: true }).click();
}

test('a code from the app: wrong, locked, then right lands on the page of the role', async ({
  page,
}) => {
  await signIn(page, accountOf('admin+2fa'));
  await expect(page).toHaveURL('/login/two-factor');
  await expectAccessible(page);

  await enter(page, TOTP.wrong);
  await expect(form(page).getByRole('alert')).toHaveText(WRONG_CODE);
  await expectAccessible(page);
  await enter(page, TOTP.locking);
  await expect(form(page).getByRole('alert')).toHaveText(LOCKED);

  await enter(page, TOTP.good);
  await expect(page).toHaveURL('/overview');
  // 2FA is on: the set-up page is not shown twice.
  await page.goto('/two-factor/setup');
  await expect(page).toHaveURL('/overview');
});

test('a backup code works once', async ({ page }) => {
  await signIn(page, accountOf('owner+2fa'));
  await page.getByRole('button', { name: 'Dùng mã dự phòng' }).click();
  await expect(page.getByLabel('Mã dự phòng (mỗi mã dùng 1 lần)')).toBeVisible();
  await expectAccessible(page);
  await enter(page, 'khong-phai-ma');
  await expect(form(page).getByRole('alert')).toHaveText(WRONG_BACKUP_CODE);
  await enter(page, BACKUP_CODES[0] ?? '');
  await expect(page).toHaveURL('/overview');
});

test('without a pending sign-in the code asks to sign in again', async ({ page }) => {
  await page.goto('/login/two-factor');
  await enter(page, TOTP.good);
  await expect(form(page).getByRole('alert')).toContainText(EXPIRED);
  await expectAccessible(page);
  await form(page).getByRole('link', { name: 'Về trang đăng nhập' }).click();
  await expect(page).toHaveURL('/login');
});
