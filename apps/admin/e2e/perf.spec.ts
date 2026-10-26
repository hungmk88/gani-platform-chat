import { expect, test } from '@playwright/test';

import { signIn } from './sign-in';
import { accountOf, CONVERSATIONS } from './stub-api';

// The budgets of apps/admin/CLAUDE.md "Kiểm chứng", measured by the browser's own clock on the built admin against the stub API:
// they catch what the front end adds (bundles, renders, waterfalls), not the time of the real API.
const LOAD_BUDGET_MS = 2500;
const OPEN_P95_BUDGET_MS = 500;

/** The value under which 95% of the samples fall (nearest rank). */
const p95 = (samples: readonly number[]) =>
  [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1]!;

test('the inbox shows its main content in under 2.5 seconds', async ({ page }) => {
  await signIn(page, accountOf('manager'));
  await page.goto('/inbox');
  await expect(
    page.getByRole('region', { name: 'Danh sách hội thoại' }).getByRole('link').first(),
  ).toBeVisible();
  const ms = await page.evaluate(() => performance.now()); // since the navigation started
  test.info().annotations.push({ type: 'load ms', description: ms.toFixed(0) });
  expect(ms).toBeLessThan(LOAD_BUDGET_MS);
});

test('opening a conversation from the list takes under 500 ms at P95', async ({ page }) => {
  await signIn(page, accountOf('manager'));
  await page.goto('/inbox');
  const list = page.getByRole('region', { name: 'Danh sách hội thoại' });
  const view = page.getByRole('region', { name: 'Hội thoại', exact: true });
  // Three conversations of different states, so the heading of the view says which one is open.
  const order = [
    [CONVERSATIONS[1]!, 'Nhân viên đang xử lý'],
    [CONVERSATIONS[2]!, 'Chờ khách trả lời'],
    [CONVERSATIONS[0]!, 'Chờ nhân viên nhận'],
  ] as const;
  const samples: number[] = [];
  for (let i = 0; i < 21; i++) {
    const [c, heading] = order[i % order.length]!;
    const row = list.locator(`a[href^="/inbox/${c.id}"]`);
    const start = await page.evaluate(() => performance.now());
    await row.click();
    await expect(view.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(view.locator('[aria-busy="true"]')).toHaveCount(0); // its messages are there too
    samples.push((await page.evaluate(() => performance.now())) - start);
  }
  const ms = p95(samples);
  test.info().annotations.push({ type: 'open p95 ms', description: ms.toFixed(0) });
  expect(ms).toBeLessThan(OPEN_P95_BUDGET_MS);
});
