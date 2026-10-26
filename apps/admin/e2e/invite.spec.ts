import { expect, test } from '@playwright/test';

import { homeFor } from '../src/nav';
import { INVALID, MISMATCH, TOO_MANY, WEAK } from '../src/invite';
import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { INVITES } from './stub-links';

// #4 Nhận lời mời (N151): the link of the email, one step, then the page of the role (or the set-up of 2FA).
const PASSWORD = 'mat khau moi 2026';
const open = (token: string) => `/invite#token=${token}`;

test('a new person sets a password and lands on the page of the role; the token leaves the address bar', async ({
  page,
}) => {
  await page.goto(open(INVITES.sales.token));
  await expect(page.getByRole('heading', { name: 'Bạn được mời tham gia' })).toBeVisible();
  await expect(page.getByText(INVITES.sales.invitedEmail)).toBeVisible();
  await expect(page.getByText('Sales', { exact: true })).toBeVisible();
  expect(page.url()).not.toContain('token');
  await expectAccessible(page);

  const submit = page.getByRole('button', { name: 'Đặt mật khẩu và tham gia' });
  await page.getByLabel('Mật khẩu mới', { exact: false }).fill('ngan1');
  await page.getByLabel('Nhập lại mật khẩu').fill('ngan1');
  await submit.click();
  await expect(page.locator('form').getByRole('alert')).toHaveText(WEAK);
  await page.getByLabel('Mật khẩu mới', { exact: false }).fill(PASSWORD);
  await page.getByLabel('Nhập lại mật khẩu').fill(`${PASSWORD}x`);
  await submit.click();
  await expect(page.locator('form').getByRole('alert')).toHaveText(MISMATCH);
  await expectAccessible(page);

  await page.getByLabel('Họ tên', { exact: false }).fill('Lan');
  await page.getByLabel('Nhập lại mật khẩu').fill(PASSWORD);
  await submit.click();
  await expect(page).toHaveURL(homeFor('sales'));
});

test('an Owner is told about 2FA and sent to set it up once joined', async ({ page }) => {
  await page.goto(open(INVITES.owner.token));
  await expect(page.getByText('bắt buộc xác thực 2 lớp', { exact: false })).toBeVisible();
  await page.getByLabel('Mật khẩu mới', { exact: false }).fill(PASSWORD);
  await page.getByLabel('Nhập lại mật khẩu').fill(PASSWORD);
  await page.getByRole('button', { name: 'Đặt mật khẩu và tham gia' }).click();
  await expect(page).toHaveURL('/two-factor/setup');
});

test('a signed-in person only joins, without a password', async ({ page }) => {
  await signIn(page, INVITES.sales.invitedEmail);
  await page.goto(open(INVITES.sales.token));
  await expect(page.getByText('Bạn đang đăng nhập', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Nhập lại mật khẩu')).toHaveCount(0);
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Tham gia' }).click();
  await expect(page).toHaveURL(homeFor('sales'));
});

for (const [name, url] of [
  ['a refused token', open('e2e-invite-unknown-00000000000')],
  ['a link without a token', '/invite'],
] as const) {
  test(`${name} gets the one sentence and the way to sign in`, async ({ page }) => {
    await page.goto(url);
    await expect(page.getByRole('heading', { name: INVALID })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Đến trang đăng nhập' })).toHaveAttribute(
      'href',
      '/login',
    );
    await expectAccessible(page);
  });
}

test('too many tries asks to wait', async ({ page }) => {
  await page.goto(open(INVITES.throttled.token));
  await expect(page.getByRole('alert').filter({ hasText: TOO_MANY })).toBeVisible();
  await expectAccessible(page);
});
