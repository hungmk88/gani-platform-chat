import { expect, test, type Page } from '@playwright/test';

import { PRODUCTION_LOCK } from '../src/ai/settings';
import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { AI_SETTINGS } from './stub-ai-settings';
import { accountOf } from './stub-api';

// #26 B1a (CEO 01/11): E1/L1 turned on or off with PATCH …/ai-settings, that feature only, waiting for the server. The settings are
// read again right before each send; turning on is never sent in `production` (tier 3), turning off is.
const SETTINGS = '**/v1/workspaces/ws-e2e/ai-settings';
const E1 = 'Phân loại ý định và trích thông tin (E1)';
const L1 = 'Tóm tắt hội thoại (L1)';
const features = (page: Page) => page.getByRole('region', { name: 'Tính năng' });
const sent = (page: Page) => {
  const calls: { method: string; body: unknown }[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/v1/workspaces/ws-e2e/ai-settings'))
      calls.push({ method: r.method(), body: r.postDataJSON() as unknown });
  });
  return calls;
};
const open = async (page: Page, who: string) => {
  await signIn(page, accountOf(who));
  await page.goto('/settings/ai');
  await expect(features(page)).toBeVisible();
};

test('an Owner turns E1 off and L1 on, each sent alone after reading the settings again', async ({
  page,
}) => {
  const calls = sent(page);
  await open(page, 'owner');
  await expect(features(page).getByRole('button', { name: `Bật ${L1}` })).toHaveAttribute(
    'aria-disabled',
    'false',
  );
  await expect(page.getByText(PRODUCTION_LOCK)).toHaveCount(0);
  await expectAccessible(page);
  const before = calls.length;
  await features(page)
    .getByRole('button', { name: `Tắt ${E1}` })
    .click();
  await expect(features(page).getByRole('button', { name: `Bật ${E1}` })).toBeVisible();
  await features(page)
    .getByRole('button', { name: `Bật ${L1}` })
    .click();
  await expect(features(page).getByRole('button', { name: `Tắt ${L1}` })).toBeVisible();
  expect(calls.slice(before)).toEqual([
    { method: 'GET', body: null },
    { method: 'PATCH', body: { features: { e1: false } } },
    { method: 'GET', body: null },
    { method: 'PATCH', body: { features: { l1: true } } },
  ]);
  await expect(features(page)).toHaveText(new RegExp(`${E1.replace(/[()]/g, '\\$&')}Đang tắt`));
});

test('in production turning on is refused before anything is sent, with the reason; turning off still works', async ({
  page,
}) => {
  const calls = sent(page);
  await open(page, 'admin+ai-prod');
  const on = features(page).getByRole('button', { name: `Bật ${L1}` });
  await expect(on).toHaveAttribute('aria-disabled', 'true');
  await expect(on).toHaveAttribute('title', PRODUCTION_LOCK);
  await expect(on).toHaveAccessibleDescription(PRODUCTION_LOCK);
  await expect(features(page).getByText(PRODUCTION_LOCK)).toBeVisible();
  await expectAccessible(page);
  const before = calls.length;
  // Playwright waits for an aria-disabled button; force clicks it as assistive tech can: the handler must refuse.
  await on.click({ force: true });
  await expect(on).toBeVisible();
  expect(calls.length).toBe(before);
  await features(page)
    .getByRole('button', { name: `Tắt ${E1}` })
    .click();
  await expect(features(page).getByRole('button', { name: `Bật ${E1}` })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  expect(calls.slice(before).map((c) => c.method)).toEqual(['GET', 'PATCH']);
});

test('if the workspace went to production since the screen read it, turning on is not sent', async ({
  page,
}) => {
  let reads = 0;
  await page.route(SETTINGS, (r) =>
    r.request().method() === 'GET' && ++reads > 1
      ? r.fulfill({ json: { ...AI_SETTINGS, environment: 'production' } })
      : r.fallback(),
  );
  const calls = sent(page);
  await open(page, 'owner');
  await features(page)
    .getByRole('button', { name: `Bật ${L1}` })
    .click();
  await expect(features(page).getByRole('alert')).toHaveText(PRODUCTION_LOCK);
  await expect(page.getByRole('region', { name: 'Môi trường' })).toContainText('Chính thức');
  await expect(features(page).getByRole('button', { name: `Bật ${L1}` })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  expect(calls.filter((c) => c.method === 'PATCH')).toEqual([]);
});

test('a save that may not have reached the server says so and reads the settings again', async ({
  page,
}) => {
  await page.route(SETTINGS, (r) =>
    r.request().method() === 'PATCH'
      ? r.fulfill({
          status: 503,
          contentType: 'application/problem+json',
          body: JSON.stringify({ status: 503, code: 'service_unavailable', traceId: 'trace-b1' }),
        })
      : r.fallback(),
  );
  const calls = sent(page);
  await open(page, 'owner');
  const before = calls.length;
  await features(page)
    .getByRole('button', { name: `Tắt ${E1}` })
    .click();
  await expect(features(page).getByRole('alert')).toHaveText(
    'Chưa rõ đã lưu hay chưa. Màn đã đọc lại trạng thái hiện tại; bấm lại nếu cần.',
  );
  await expect.poll(() => calls.slice(before).at(-1)?.method).toBe('GET');
  await expect(features(page).getByRole('button', { name: `Tắt ${E1}` })).toBeEnabled();
});
