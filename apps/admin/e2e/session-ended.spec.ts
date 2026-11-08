import { expect, test } from '@playwright/test';

import { signIn } from './sign-in';
import { accountOf } from './stub-api';

// A session that ends while the person works (P9 unauthorized, N93; E2E brief 178 T2): the API answers 401 and the admin goes to
// /login, from a read (QueryCache) as from a write that checks it (`redirectFor`, here "Tạo ticket").
const ended = {
  status: 401,
  contentType: 'application/problem+json',
  body: JSON.stringify({ status: 401, code: 'unauthorized', traceId: 'trace-ended' }),
};

test('a read answered 401 in the middle of the work goes to /login', async ({ page }) => {
  let over = false;
  await page.route(
    (u) => u.pathname === '/v1/customers',
    (r) => (over ? r.fulfill(ended) : r.fallback()),
  );
  await signIn(page, accountOf('manager'));
  await page.goto('/customers');
  const search = page.getByLabel('Tìm khách');
  await expect(search).toBeVisible();
  over = true;
  await search.fill('bình');
  await expect(page).toHaveURL('/login');
  await expect(page.getByRole('heading', { name: 'Đăng nhập', level: 1 })).toBeVisible();
});

test('a write answered 401 goes to /login', async ({ page }) => {
  await page.route(
    (u) => u.pathname === '/v1/tickets',
    (r) => (r.request().method() === 'POST' ? r.fulfill(ended) : r.fallback()),
  );
  await signIn(page, accountOf('owner'));
  await page.goto('/tickets');
  await page.getByRole('button', { name: 'Tạo ticket' }).click();
  const dialog = page.getByRole('dialog', { name: 'Tạo ticket' });
  await dialog.getByLabel('Tiêu đề').fill('Giao bù đơn thiếu');
  await dialog.getByRole('button', { name: 'Tạo ticket' }).click();
  await expect(page).toHaveURL('/login');
  await expect(page.getByRole('heading', { name: 'Đăng nhập', level: 1 })).toBeVisible();
});
