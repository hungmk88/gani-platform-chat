import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';
import { TICKETS } from './stub-tickets';

// #15 Chi tiết ticket (U27, N167): one ticket from GET /v1/tickets/{id} (real API since K1c-2, #540) with its history, and its status moved by
// PATCH {status, version} along the moves of N167; cancelling is Owner/Admin/Manager only and asks again; Sales only read.
const screen = (page: Page) => page.getByRole('region', { name: 'Chi tiết ticket' });
const history = (page: Page) => screen(page).getByRole('list').last();
const holder = (page: Page) => screen(page).locator('dt:text-is("Phụ trách") + dd');

test('a Manager opens a ticket from the list, starts it, waits for the customer, then cancels it', async ({
  page,
}) => {
  await signIn(page, accountOf('manager'));
  await page.goto('/tickets');
  await page.getByRole('link', { name: 'Đổi lịch giao hàng' }).click();
  await expect(page).toHaveURL(`/tickets/${TICKETS[0]!.id}`);
  await expect(screen(page).getByRole('heading', { level: 1 })).toHaveText('Đổi lịch giao hàng');
  await expect(screen(page)).toContainText('Khẩn');
  await expect(screen(page).getByRole('link', { name: 'Nguyễn Văn An' })).toBeVisible();
  await expect(history(page)).toContainText('Người khác tạo ticket');
  await expectAccessible(page);

  await screen(page).getByRole('button', { name: 'Bắt đầu xử lý' }).click();
  await expect(screen(page).getByRole('status')).toHaveText('Đã chuyển sang Đang xử lý.');
  await expect(history(page)).toContainText('Bạn chuyển từ Mới sang Đang xử lý');
  await screen(page).getByRole('button', { name: 'Chờ khách' }).click();
  await expect(history(page)).toContainText('Bạn chuyển từ Đang xử lý sang Chờ khách');
  await expect(screen(page).getByRole('button', { name: 'Tiếp tục xử lý' })).toBeVisible();

  await screen(page).getByRole('button', { name: 'Hủy ticket' }).click();
  const dialog = page.getByRole('dialog', { name: 'Hủy ticket này?' });
  await expect(dialog).toBeVisible();
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Hủy ticket' }).click();
  await expect(screen(page).getByRole('status')).toHaveText('Đã chuyển sang Đã hủy.');
  await expect(screen(page).getByRole('button')).toHaveCount(0);
  await page.getByRole('link', { name: 'Về danh sách ticket' }).click();
  await expect(page.getByRole('row').nth(1)).toContainText('Đã hủy');
});

test('Support reopens a done ticket but cannot cancel; Sales only read', async ({ page }) => {
  await signIn(page, accountOf('support'));
  await page.goto(`/tickets/${TICKETS[3]!.id}`);
  await expect(screen(page).getByRole('button')).toHaveText(['Mở lại']);
  await screen(page).getByRole('button', { name: 'Mở lại' }).click();
  await expect(screen(page).getByRole('status')).toHaveText('Đã chuyển sang Đang xử lý.');
  await expect(screen(page).getByRole('button')).toHaveText(['Chờ khách', 'Đã xong']);

  await signIn(page, accountOf('sales'));
  await page.goto(`/tickets/${TICKETS[1]!.id}`);
  await expect(screen(page).getByRole('heading', { level: 1 })).toHaveText(
    'Bổ sung hóa đơn tháng 9',
  );
  await expect(screen(page).getByRole('button')).toHaveCount(0);
});

test('a ticket changed by someone else is read again; one not found says so', async ({ page }) => {
  await signIn(page, accountOf('manager+stale'));
  await page.goto(`/tickets/${TICKETS[1]!.id}`);
  await screen(page).getByRole('button', { name: 'Chờ khách' }).click();
  await expect(screen(page).getByRole('alert')).toContainText(
    'vừa được người khác thay đổi. Đang tải lại',
  );
  await expect(screen(page).getByRole('alert')).toContainText('trace-e2e-409');
  await page.goto('/tickets/khong-co');
  await expect(page.getByRole('heading', { name: 'Không tìm thấy ticket' })).toBeVisible();
  await expectAccessible(page);
});

test('who handles it is said as in the list: nobody "Chưa giao", a person without a name by the end of the id (#540)', async ({
  page,
}) => {
  const id = '0190c300-0000-7000-8000-00000000abcd';
  await page.route(`**/v1/tickets/${TICKETS[1]!.id}`, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    const ticket = (await response.json()) as Record<string, unknown>;
    return route.fulfill({ response, json: { ...ticket, assignee: { id, name: null } } });
  });
  await signIn(page, accountOf('manager'));
  await page.goto(`/tickets/${TICKETS[0]!.id}`);
  await expect(holder(page)).toHaveText('Chưa giao');
  await page.goto(`/tickets/${TICKETS[1]!.id}`);
  await expect(holder(page).getByTitle('Nhân viên chưa có tên')).toHaveText('…abcd');
  await expect(holder(page)).not.toHaveText('Chưa giao');
  await expectAccessible(page);
});

test('"Không hủy" sends nothing; waiting, going on and done each move it (E2E brief 184 T3)', async ({
  page,
}) => {
  const patches: unknown[] = [];
  page.on('request', (r) => {
    if (r.method() === 'PATCH') patches.push(r.postDataJSON());
  });
  await signIn(page, accountOf('manager'));
  await page.goto(`/tickets/${TICKETS[1]!.id}`);
  await screen(page).getByRole('button', { name: 'Hủy ticket' }).click();
  const dialog = page.getByRole('dialog', { name: 'Hủy ticket này?' });
  await dialog.getByRole('button', { name: 'Không hủy' }).click();
  await expect(dialog).toBeHidden();
  expect(patches).toHaveLength(0);
  await screen(page).getByRole('button', { name: 'Chờ khách' }).click();
  await screen(page).getByRole('button', { name: 'Tiếp tục xử lý' }).click();
  await expect(screen(page).getByRole('status')).toHaveText('Đã chuyển sang Đang xử lý.');
  await screen(page).getByRole('button', { name: 'Đã xong' }).click();
  await expect(screen(page).getByRole('status')).toHaveText('Đã chuyển sang Đã xong.');
  await expect(history(page)).toContainText('Bạn chuyển từ Đang xử lý sang Đã xong');
  expect(patches.map((p) => (p as { status: string }).status)).toEqual([
    'waiting_customer',
    'in_progress',
    'done',
  ]);
});

test('a move refused with 409 invalid_transition says the state moved and reads the ticket again (E2E brief 184 T3)', async ({
  page,
}) => {
  await signIn(page, accountOf('manager'));
  await page.goto(`/tickets/${TICKETS[1]!.id}`);
  await expect(screen(page).getByRole('button', { name: 'Chờ khách' })).toBeVisible();
  await page.route(
    (u) => u.pathname === `/v1/tickets/${TICKETS[1]!.id}`,
    (r) =>
      r.request().method() === 'PATCH'
        ? r.fulfill({
            status: 409,
            contentType: 'application/problem+json',
            body: JSON.stringify({ status: 409, code: 'invalid_transition', traceId: 'trace-it' }),
          })
        : r.fallback(),
  );
  let reads = 0;
  page.on('request', (r) => {
    if (r.method() === 'GET' && new URL(r.url()).pathname === `/v1/tickets/${TICKETS[1]!.id}`)
      reads++;
  });
  await screen(page).getByRole('button', { name: 'Chờ khách' }).click();
  await expect(screen(page).getByRole('alert')).toContainText('Trạng thái vừa đổi');
  await expect(screen(page).getByRole('alert')).toContainText('trace-it');
  await expect.poll(() => reads).toBeGreaterThan(0);
});
