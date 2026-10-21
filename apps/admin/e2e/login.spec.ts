import { expect, test } from '@playwright/test';

import { TOO_MANY_REQUESTS, UNAVAILABLE, WRONG_CREDENTIALS } from '../src/auth';
import { homeFor, type Role } from '../src/nav';
import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf, DOWN, GOOD, NO_ME, NO_ME_TRACE, THROTTLED } from './stub-api';

test('the sign-in page passes axe', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible();
  await expectAccessible(page);
});

test('a signed-out person is sent to /login', async ({ page }) => {
  await page.goto('/overview');
  await expect(page).toHaveURL('/login');
});

// One sentence for a wrong password and a locked account: the API answers both with the same 401.
for (const [name, email, password, message] of [
  ['a wrong password', accountOf('sales'), 'sai-mat-khau', WRONG_CREDENTIALS],
  ['an unknown email', accountOf('nobody'), GOOD, WRONG_CREDENTIALS],
  ['the rate limit (429)', THROTTLED, GOOD, TOO_MANY_REQUESTS],
  ['an API that is down', DOWN, GOOD, UNAVAILABLE],
] as const) {
  test(`${name} shows one sentence and keeps the form`, async ({ page }) => {
    await signIn(page, email, password);
    // Scoped to the form: Next.js keeps an empty route announcer with role=alert on every page.
    await expect(page.locator('form').getByRole('alert')).toHaveText(message);
    await expect(page).toHaveURL('/login');
    await expect(page.getByRole('button', { name: 'Đăng nhập' })).toBeEnabled();
    await expectAccessible(page);
  });
}

for (const role of ['owner', 'sales', 'platform_operator'] as const satisfies readonly Role[]) {
  test(`${role} lands on the page of the role, inside the frame`, async ({ page }) => {
    await signIn(page, accountOf(role));
    await expect(page).toHaveURL(homeFor(role));
    await expect(page.getByRole('navigation', { name: 'Menu chính' })).toBeVisible();
    await expect(page.getByText(`Người thử ${role}`)).toBeVisible();
    await expectAccessible(page);
  });
}

test('when GET /v1/me fails the shell shows the error page with the trace', async ({ page }) => {
  await signIn(page, NO_ME);
  await expect(page.getByRole('heading', { name: 'Đã có lỗi.' })).toBeVisible();
  await expect(page.getByText(`Mã: ${NO_ME_TRACE}`)).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Menu chính' })).toHaveCount(0);
  await expectAccessible(page);
});
