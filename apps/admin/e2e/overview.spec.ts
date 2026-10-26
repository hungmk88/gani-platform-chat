import { expect, test } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';

// #16 Tổng quan (U29, N167): the five cards of the workspace being worked in from GET /v1/overview (planned S5); Sales and Support
// see their own four; a figure not there yet says why. The 404 of an API without the route is in system-pages.spec.ts.
const cards = (page: import('@playwright/test').Page) =>
  page.getByRole('region', { name: 'Tổng quan' }).getByRole('listitem');

test('a Manager lands on the five cards of the workspace and reads them again', async ({
  page,
}) => {
  await signIn(page, accountOf('manager'));
  await expect(page).toHaveURL('/overview');
  await expect(page.getByRole('heading', { name: 'Tổng quan', level: 1 })).toBeVisible();
  await expect(cards(page)).toHaveCount(5);
  await expect(cards(page).nth(0)).toContainText('Hội thoại đang mở12');
  await expect(cards(page).nth(1)).toContainText('Chờ nhân viên nhận3');
  await expect(cards(page).nth(2)).toContainText('3 phút 40 giây');
  await expect(cards(page).nth(3)).toContainText('Chưa tính');
  await expect(cards(page).nth(4)).toContainText('4 / 7');
  await expect(page.getByText('Cập nhật lúc 10:05')).toBeVisible();
  await expectAccessible(page);
  const asked = page.waitForRequest((r) => r.url().includes('/v1/overview?workspaceId=ws-e2e'));
  await page.getByRole('button', { name: 'Làm mới' }).click();
  await asked;
});

test('a Sales sees their own four figures, without the agent card', async ({ page }) => {
  await signIn(page, accountOf('sales'));
  await page.goto('/overview');
  await expect(page.getByRole('heading', { name: 'Tổng quan của tôi', level: 1 })).toBeVisible();
  await expect(cards(page)).toHaveCount(4);
  await expect(cards(page).nth(0)).toContainText('Hội thoại tôi đang giữ2');
  await expect(page.getByText('Nhân viên trực tuyến')).toHaveCount(0);
});

test('figures that fail say why, with the trace and Thử lại', async ({ page }) => {
  let failing = true;
  await page.route('**/v1/overview?*', (route) =>
    failing
      ? route.fulfill({
          status: 503,
          contentType: 'application/problem+json',
          body: JSON.stringify({
            status: 503,
            code: 'service_unavailable',
            traceId: 'trace-overview',
          }),
        })
      : route.fallback(),
  );
  await signIn(page, accountOf('admin'));
  await page.goto('/overview');
  const alert = page.getByRole('main').getByRole('alert');
  await expect(alert).toContainText('Mã: trace-overview');
  failing = false;
  await alert.getByRole('button', { name: 'Thử lại' }).click();
  await expect(cards(page)).toHaveCount(5);
});
