import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';
import { TICKETS, TICKETS_PAGE } from './stub-tickets';

// #14 Ticket (U27, N167): the tickets of the workspace from GET /v1/tickets (planned S4), newest first, by pages, filtered by status
// and assignee; Sales see the ones they made; while the API has no such route (404) the screen says it is not there yet.
const rows = (page: Page) => page.getByRole('region', { name: 'Ticket' }).getByRole('row');

test('a Manager opens Ticket from the menu and reads the tickets in plain words, by pages', async ({
  page,
}) => {
  await signIn(page, accountOf('manager'));
  await page
    .getByRole('navigation', { name: 'Menu chính' })
    .getByRole('link', { name: 'Ticket', exact: true })
    .click();
  await expect(page).toHaveURL('/tickets');
  await expect(rows(page)).toHaveCount(TICKETS_PAGE + 1);
  const first = rows(page).nth(1);
  await expect(first).toContainText('Đổi lịch giao hàng');
  await expect(first).toContainText('Nguyễn Văn An');
  await expect(first).toContainText('Mới');
  await expect(first).toContainText('Khẩn');
  await expect(first).toContainText('Chưa giao');
  await expect(first).toContainText('Chưa có SLA');
  await expect(rows(page).nth(3)).toContainText('Tạm dừng: chờ khách');
  await expect(page.getByText(/in_progress|waiting_customer/)).toHaveCount(0);
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Tải thêm' }).click();
  await expect(rows(page)).toHaveCount(TICKETS.length + 1);
});

test('the filters ask the API again, and a filter that finds nothing can be cleared', async ({
  page,
}) => {
  await signIn(page, accountOf('support'));
  await page.goto('/tickets');
  const asked = page.waitForRequest((r) => r.url().includes('status=in_progress'));
  await page.getByLabel('Trạng thái').selectOption('in_progress');
  await asked;
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).nth(1)).toContainText('Bổ sung hóa đơn tháng 9');
  await page.getByLabel('Trạng thái').selectOption('cancelled');
  await expect(page.getByText('Không có ticket khớp bộ lọc.')).toBeVisible();
  await page.getByRole('button', { name: 'Xóa bộ lọc' }).click();
  await page.getByLabel('Phụ trách').selectOption('me');
  await expect(rows(page)).toHaveCount(3);
});

test('a Sales sees the tickets they made; a Viewer has no Ticket', async ({ page }) => {
  await signIn(page, accountOf('sales'));
  await page.goto('/tickets');
  await expect(rows(page)).toHaveCount(3);
  await signIn(page, accountOf('viewer'));
  await page.goto('/tickets');
  await expect(
    page.getByRole('heading', { name: 'Bạn không có quyền xem trang này.' }),
  ).toBeVisible();
});

test('while the API has no tickets yet (404), the screen says it is not there', async ({
  page,
}) => {
  await signIn(page, accountOf('support+no-tickets'));
  await page.goto('/tickets');
  await expect(
    page.getByRole('heading', { name: 'Ticket: màn này chưa có trong bản hiện tại.' }),
  ).toBeVisible();
  await expectAccessible(page);
});
