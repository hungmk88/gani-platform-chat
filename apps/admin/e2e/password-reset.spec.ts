import { expect, test } from '@playwright/test';

import { expectAccessible } from './axe';
import { NOT_AN_EMAIL, RESETS } from './stub-links';

const NEXT = 'matkhau-moi-456';
const open = (token: string) => `/reset-password#token=${token}`;

// "Quên mật khẩu" (PR7, N162): one answer whether the address has an account or not; the link's token lives in memory only.
test('from the sign-in page, a forgotten password asks for a link; the answer never says if the address exists', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Quên mật khẩu?' }).click();
  await expect(page.getByRole('heading', { name: 'Quên mật khẩu' })).toBeVisible();
  await page.getByLabel('Email đăng nhập').fill(NOT_AN_EMAIL);
  await page.getByRole('button', { name: 'Gửi link đặt lại' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Email chưa đúng dạng.');
  await page.getByLabel('Email đăng nhập').fill('  Ai-Do@Example.test ');
  const sent = page.waitForRequest((r) => r.url().endsWith('/api/auth/password/forgot'));
  await page.getByRole('button', { name: 'Gửi link đặt lại' }).click();
  expect((await sent).postDataJSON()).toEqual({ email: 'ai-do@example.test' });
  await expect(page.getByRole('status')).toContainText('Nếu email này có tài khoản');
  await expectAccessible(page);
});

test('a link sets a new password once: the rule first, the token out of the address bar, then sign in again', async ({
  page,
}) => {
  await page.goto(open(RESETS.good));
  await expect(page.getByRole('heading', { name: 'Đặt mật khẩu mới' })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  await expectAccessible(page);
  const password = page.getByLabel(/^Mật khẩu mới/);
  const again = page.getByLabel('Nhập lại mật khẩu');
  const save = page.getByRole('button', { name: 'Đặt mật khẩu mới' });
  await password.fill('aaaaaaaaaaaa');
  await again.fill('aaaaaaaaaaaa');
  await save.click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    'Mật khẩu cần ít nhất 12 ký tự, có chữ và số.',
  );
  await password.fill(NEXT);
  await again.fill(`${NEXT}x`);
  await save.click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    'Hai lần nhập mật khẩu chưa khớp.',
  );
  await again.fill(NEXT);
  const reset = page.waitForRequest((r) => r.url().endsWith('/api/auth/password/reset'));
  await save.click();
  expect((await reset).postDataJSON()).toEqual({ token: RESETS.good, password: NEXT });
  await expect(page.getByRole('heading', { name: 'Đã đặt mật khẩu mới' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Đến trang đăng nhập' })).toHaveAttribute(
    'href',
    '/login',
  );

  await page.goto('about:blank'); // a new load: only the fragment would differ
  await page.goto(open(RESETS.good)); // used once already
  await page.getByLabel(/^Mật khẩu mới/).fill(NEXT);
  await page.getByLabel('Nhập lại mật khẩu').fill(NEXT);
  await page.getByRole('button', { name: 'Đặt mật khẩu mới' }).click();
  await expect(
    page.getByRole('heading', { name: 'Link không hợp lệ hoặc đã hết hạn.' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Xin link mới' })).toHaveAttribute(
    'href',
    '/forgot-password',
  );
});

test('a link without a token is refused at once; too many tries asks to wait', async ({ page }) => {
  await page.goto('/reset-password');
  await expect(
    page.getByRole('heading', { name: 'Link không hợp lệ hoặc đã hết hạn.' }),
  ).toBeVisible();
  await page.goto('about:blank');
  await page.goto(open(RESETS.throttled));
  await page.getByLabel(/^Mật khẩu mới/).fill(NEXT);
  await page.getByLabel('Nhập lại mật khẩu').fill(NEXT);
  await page.getByRole('button', { name: 'Đặt mật khẩu mới' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    'Thử quá nhiều lần. Đợi 1 phút rồi thử lại.',
  );
});
