import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';
import { LEADS, LOST_REASON, STAGES } from './stub-leads';

// #13a Chi tiết lead (CEO 02/11, brief 36, 44–45, read only) on the contract planned for S4 (#544): one lead from
// `GET /v1/leads/{id}` with its history, oldest first; who did a thing is "Bạn", "Người khác" or "Hệ thống".
const screen = (page: Page) => page.getByRole('region', { name: 'Chi tiết lead' });
const fact = (page: Page, term: string) => screen(page).locator(`dt:text-is("${term}") + dd`);
const history = (page: Page) => screen(page).getByRole('list');
const lost = LEADS[6]!;

test('a Manager opens a lost lead from the board and reads it, its history in words', async ({
  page,
}) => {
  await signIn(page, accountOf('manager'));
  await page.goto('/leads');
  await page.getByRole('button', { name: 'Tải thêm' }).click(); // the lost lead is on the second page
  await page.getByRole('link', { name: lost.title }).click();
  await expect(page).toHaveURL(`/leads/${lost.id}`);
  await expect(screen(page).getByRole('heading', { level: 1 })).toHaveText(lost.title);
  await expect(fact(page, 'Khách').getByRole('link', { name: 'Quán Chay An Lạc' })).toBeVisible();
  await expect(fact(page, 'Phụ trách')).toHaveText('Người thử manager');
  await expect(fact(page, 'Bước')).toHaveText(STAGES[3]!.name);
  await expect(fact(page, 'Trạng thái')).toHaveText('Thua');
  await expect(fact(page, 'Lý do Thua')).toHaveText(LOST_REASON);
  await expect(history(page).getByRole('listitem')).toHaveCount(3);
  await expect(history(page).getByRole('listitem').nth(0)).toContainText(
    `Người khác tạo lead ở ${STAGES[0]!.name}`,
  );
  await expect(history(page).getByRole('listitem').nth(1)).toContainText(
    `Bạn chuyển từ ${STAGES[0]!.name} sang ${STAGES[3]!.name}`,
  );
  await expect(history(page).getByRole('listitem').nth(2)).toContainText('Bạn đánh dấu Thua');
  await expect(screen(page).getByRole('button')).toHaveCount(0);
  await expectAccessible(page);
});

test('Sales reads "Bạn" for what they did; an open lead has no reason; one not found says so', async ({
  page,
}) => {
  await signIn(page, accountOf('sales'));
  await page.goto(`/leads/${LEADS[0]!.id}`);
  await expect(history(page)).toContainText(`Bạn tạo lead ở ${STAGES[0]!.name}`);
  await expect(fact(page, 'Trạng thái')).toHaveText('Đang chạy');
  await expect(fact(page, 'Lý do Thua')).toHaveCount(0);
  await page.goto('/leads/khong-co');
  await expect(page.getByRole('heading', { name: 'Không tìm thấy lead' })).toBeVisible();
  await expectAccessible(page);
});

test('a failure of the lead says so with its trace, and Thử lại reads it again', async ({
  page,
}) => {
  let fail = true;
  await page.route(`**/v1/leads/${lost.id}`, (r) =>
    fail
      ? r.fulfill({
          status: 503,
          contentType: 'application/problem+json',
          body: JSON.stringify({ status: 503, code: 'service_unavailable', traceId: 'trace-lead' }),
        })
      : r.fallback(),
  );
  await signIn(page, accountOf('owner'));
  await page.goto(`/leads/${lost.id}`);
  const alert = screen(page).getByRole('alert');
  await expect(alert).toContainText('Mã: trace-lead');
  await expectAccessible(page);
  fail = false;
  await alert.getByRole('button', { name: 'Thử lại' }).click();
  await expect(screen(page).getByRole('heading', { level: 1 })).toHaveText(lost.title);
});
