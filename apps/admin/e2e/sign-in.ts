import type { Page } from '@playwright/test';

import { GOOD } from './stub-api';

/** #1 Đăng nhập as a person does it: the form of /login, then wherever the admin sends them. */
export async function signIn(page: Page, email: string, password = GOOD) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu').fill(password);
  // Wait for the answer: a test that goes elsewhere right after must not race the session cookie.
  const answered = page.waitForResponse('**/api/auth/sign-in/email');
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  if (!(await answered).ok()) return; // a refusal keeps the form
  // Signed in, the form sends the browser on (to "/", then the page of the role, or to the code): a test that goes elsewhere
  // before that is over has its own navigation aborted (net::ERR_ABORTED), which a busy machine makes common.
  await page.waitForURL((url) => url.pathname !== '/login');
  await page.waitForLoadState('networkidle');
}
