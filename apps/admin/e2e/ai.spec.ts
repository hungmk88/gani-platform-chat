import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';

// #26 AI nội bộ, Đợt 1 only E20 (CEO 30/10): the prompt versions from GET /v1/ai/prompts (planned S5), read only, for Owner and
// Admin for now (U66). Environment, features and budget are one line, not blocks. A Viewer's 404 is in system-pages.spec.ts.
const LATER = 'Môi trường, tính năng và ngân sách AI chưa có trong bản hiện tại.';
const rows = (page: Page) => page.getByRole('table').getByRole('row');

const answer = (page: Page, status: number, body: unknown) =>
  page.route('**/v1/ai/prompts', (route) =>
    route.fulfill({
      status,
      contentType: status === 200 ? 'application/json' : 'application/problem+json',
      body: JSON.stringify(body),
    }),
  );

test('an Owner reads the prompt versions, with nothing to change them', async ({ page }) => {
  await signIn(page, accountOf('owner'));
  await page.goto('/settings/ai');
  await expect(page.getByRole('heading', { name: 'AI nội bộ', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Phiên bản prompt' })).toBeVisible();
  await expect(rows(page)).toHaveCount(4);
  await expect(rows(page).nth(1)).toHaveText(/sales\.reply3Đang dùng00:30 30\/10\/2026Nguyễn An/);
  await expect(rows(page).nth(2)).toContainText('Không dùng');
  await expect(rows(page).nth(3)).toHaveText(/support\.reply1Không dùngChưa duyệt—/);
  await expect(page.getByText('Đang dùng', { exact: true })).toHaveCount(1);
  await expect(page.getByText(LATER, { exact: true })).toBeVisible();
  // Read only, and none of the prototype's blocks for environment, features or budget.
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('main').getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByText(/sắp có|đang phát triển/i)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Môi trường|Tính năng|Ngân sách/ })).toHaveCount(
    0,
  );
  await expectAccessible(page);
});

test('an Admin reads them too', async ({ page }) => {
  await signIn(page, accountOf('admin'));
  await page.goto('/settings/ai');
  await expect(rows(page)).toHaveCount(4);
  await expect(page.getByText(LATER, { exact: true })).toBeVisible();
});

test('a Manager has no such screen: the 404 inside the frame', async ({ page }) => {
  await signIn(page, accountOf('manager'));
  const res = await page.goto('/settings/ai');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Không tìm thấy trang.' })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
});

test('no version yet says so with one action', async ({ page }) => {
  await answer(page, 200, { data: [] });
  await signIn(page, accountOf('owner'));
  await page.goto('/settings/ai');
  await expect(page.getByText('Chưa có phiên bản prompt nào được ghi nhận.')).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.getByText(LATER, { exact: true })).toBeVisible();
  const asked = page.waitForRequest((r) => r.url().endsWith('/v1/ai/prompts'));
  await page.getByRole('button', { name: 'Làm mới' }).click();
  await asked;
  await expectAccessible(page);
});

test('versions that fail say why, with the trace and Thử lại', async ({ page }) => {
  let failing = true;
  await page.route('**/v1/ai/prompts', (route) =>
    failing
      ? route.fulfill({
          status: 503,
          contentType: 'application/problem+json',
          body: JSON.stringify({ status: 503, code: 'service_unavailable', traceId: 'trace-ai' }),
        })
      : route.fallback(),
  );
  await signIn(page, accountOf('admin'));
  await page.goto('/settings/ai');
  const alert = page.getByRole('main').getByRole('alert');
  await expect(alert).toContainText('Mã: trace-ai');
  await expect(page.getByRole('table')).toHaveCount(0);
  failing = false;
  await alert.getByRole('button', { name: 'Thử lại' }).click();
  await expect(rows(page)).toHaveCount(4);
  await expect(alert).toHaveCount(0);
});

test('while the API has no prompt route, the screen says it is not there, never a made-up list', async ({
  page,
}) => {
  await answer(page, 404, { status: 404, code: 'not_found', traceId: 'trace-ai-404' });
  await signIn(page, accountOf('owner'));
  await page.goto('/settings/ai');
  await expect(
    page.getByRole('heading', { name: 'AI nội bộ: màn này chưa có trong bản hiện tại.' }),
  ).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.getByText(/đã lưu/i)).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Mở Hộp thư' })).toHaveAttribute('href', '/inbox');
  await expectAccessible(page);
});
