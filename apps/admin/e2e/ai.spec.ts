import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { AI_SETTINGS } from './stub-ai-settings';
import { accountOf } from './stub-api';

// #26 AI nội bộ: the prompt versions from GET /v1/ai/prompts (E20, CEO 30/10) and, part A (CEO 01/11), the environment, E1/L1
// and the budget from GET /v1/workspaces/{id}/ai-settings (U61); both planned S5, read only, Owner and Admin (U66). Each part has
// its own states: a 404 of ai-settings keeps one line, the prompts stay. A Viewer's 404 is in system-pages.spec.ts.
const LATER = 'Môi trường, tính năng và ngân sách AI chưa có trong bản hiện tại.';
const block = (page: Page, name: string) => page.getByRole('region', { name });
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
  await expect(block(page, 'Môi trường')).toHaveText(/Đang chạy ởThử nghiệm \(staging\)/);
  await expect(block(page, 'Tính năng')).toHaveText(
    /Phân loại ý định và trích thông tin \(E1\)Đang bậtTóm tắt hội thoại \(L1\)Đang tắt/,
  );
  // 85 % spent: BudgetGuard warns from 80 %; the month starts again in the workspace's zone (#21).
  await expect(block(page, 'Ngân sách tháng')).toContainText(/170,00.*\/ 200,00.*\(85 %\)/);
  await expect(block(page, 'Ngân sách tháng')).toContainText('Đã dùng từ 80 % ngân sách tháng.');
  await expect(block(page, 'Ngân sách tháng')).toContainText(
    '00:00 01/12/2026 (múi giờ của workspace: Asia/Ho_Chi_Minh)',
  );
  await expect(page.getByText(LATER, { exact: true })).toHaveCount(0);
  // Read only (B1 and B2 write).
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('main').getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByText(/sắp có|đang phát triển/i)).toHaveCount(0);
  await expectAccessible(page);
});

test("a spent budget says AI stops; without the zone of the workspace the time is said to be Viet Nam's", async ({
  page,
}) => {
  await page.route('**/v1/workspaces/ws-e2e/ai-settings', (r) =>
    r.fulfill({ json: { ...AI_SETTINGS, usedThisMonthUsd: 200, environment: 'production' } }),
  );
  await page.route('**/v1/workspaces', (r) =>
    r.fulfill({
      status: 503,
      contentType: 'application/problem+json',
      body: JSON.stringify({ status: 503, code: 'service_unavailable', traceId: 'trace-ws' }),
    }),
  );
  await signIn(page, accountOf('owner'));
  await page.goto('/settings/ai');
  await expect(block(page, 'Môi trường')).toContainText('Chính thức (production)');
  await expect(block(page, 'Ngân sách tháng')).toContainText(
    'Hết ngân sách tháng: AI nội bộ dừng, quay về kịch bản.',
  );
  await expect(block(page, 'Ngân sách tháng')).toContainText('00:00 01/12/2026 (giờ Việt Nam)');
  await expect(page.getByText(/múi giờ của workspace/)).toHaveCount(0);
  await expectAccessible(page);
});

test('while the API has no ai-settings route, one line says so and the prompts stay', async ({
  page,
}) => {
  await page.route('**/v1/workspaces/ws-e2e/ai-settings', (r) =>
    r.fulfill({
      status: 404,
      contentType: 'application/problem+json',
      body: JSON.stringify({ status: 404, code: 'not_found', traceId: 'trace-ai-settings-404' }),
    }),
  );
  await signIn(page, accountOf('admin'));
  await page.goto('/settings/ai');
  await expect(rows(page)).toHaveCount(4);
  await expect(page.getByText(LATER, { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Môi trường|Tính năng|Ngân sách/ })).toHaveCount(
    0,
  );
});

test('ai-settings that fail say why, with the trace and Thử lại; the prompts stay', async ({
  page,
}) => {
  let failing = true;
  await page.route('**/v1/workspaces/ws-e2e/ai-settings', (r) =>
    failing
      ? r.fulfill({
          status: 503,
          contentType: 'application/problem+json',
          body: JSON.stringify({ status: 503, code: 'service_unavailable', traceId: 'trace-set' }),
        })
      : r.fallback(),
  );
  await signIn(page, accountOf('owner'));
  await page.goto('/settings/ai');
  const alert = page.getByRole('main').getByRole('alert');
  await expect(alert).toContainText('Mã: trace-set');
  await expect(rows(page)).toHaveCount(4);
  failing = false;
  await alert.getByRole('button', { name: 'Thử lại' }).click();
  await expect(block(page, 'Môi trường')).toBeVisible();
  await expect(alert).toHaveCount(0);
});

test('an Admin reads them too', async ({ page }) => {
  await signIn(page, accountOf('admin'));
  await page.goto('/settings/ai');
  await expect(rows(page)).toHaveCount(4);
  await expect(block(page, 'Tính năng')).toBeVisible();
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
  await expect(block(page, 'Môi trường')).toBeVisible();
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
