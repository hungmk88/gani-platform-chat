import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';

// U81 (#626, brief 116): the SLA chip of each row and the filter `sla` of GET /v1/conversations, from the API only (no threshold
// of the FE). The list is answered here; the browser's clock is fixed so the minutes are known.
const NOW = Date.parse('2026-11-06T03:00:00Z');
const at = (min: number) => new Date(NOW + min * 60_000).toISOString();
const row = (n: number, state: string, sla: unknown) => ({
  id: `0190a000-0000-7000-8000-00000000010${n}`,
  workspaceId: 'ws-e2e',
  state,
  afterHoursHold: false,
  assignedUserId: null,
  version: 1,
  outcome: state === 'CLOSED' ? 'resolved' : null,
  closedAt: state === 'CLOSED' ? at(-120) : null,
  lastMessageAt: at(-n),
  lastCustomerMessageAt: null,
  createdAt: at(-600),
  customer: { id: `0190d000-0000-7000-8000-00000000010${n}`, displayName: `Khách ${n}` },
  lastMessagePreview: null,
  channel: null,
  assignee: null,
  sla,
});
const ROWS = [
  row(1, 'HUMAN_WAITING_Q', { dueAt: at(42), pausedReason: null }),
  row(2, 'HUMAN_ACTIVE', { dueAt: at(-6), pausedReason: null }),
  row(3, 'PENDING_CUSTOMER', { dueAt: at(-30), pausedReason: 'waiting_customer' }),
  row(4, 'HUMAN_WAITING_Q', { dueAt: at(5), pausedReason: 'outside_hours' }),
  row(5, 'HUMAN_ACTIVE', null),
  row(6, 'CLOSED', null),
];

/** The list: every row, or none when `sla` is asked (as the API until Q7); each `sla` asked is kept. */
async function serve(page: Page) {
  const asked: (string | null)[] = [];
  await page.clock.setFixedTime(NOW);
  await page.route(
    (u) => u.pathname === '/v1/conversations',
    (r) => {
      const sla = new URL(r.request().url()).searchParams.get('sla');
      asked.push(sla);
      return r.fulfill({ json: { data: sla ? [] : ROWS, nextCursor: null } });
    },
  );
  await signIn(page, accountOf('owner'));
  await page.goto('/inbox');
  return asked;
}
const items = (page: Page) =>
  page.getByRole('region', { name: 'Danh sách hội thoại' }).getByRole('listitem');

test('each row says its SLA from dueAt: left, past, paused with why, none; a closed one says nothing', async ({
  page,
}) => {
  await serve(page);
  await expect(items(page)).toHaveCount(6);
  await expect(items(page).nth(0)).toContainText('Chờ nhân viên nhậnCòn 42 phút');
  await expect(items(page).nth(1)).toContainText('Nhân viên đang xử lýQuá hạn 6 phút');
  await expect(items(page).nth(2)).toContainText('SLA tạm dừng · chờ khách');
  await expect(items(page).nth(3)).toContainText('SLA tạm dừng · ngoài giờ');
  await expect(items(page).nth(4)).toContainText('Chưa có SLA');
  await expect(items(page).nth(5)).toContainText('Đã đóng');
  await expect(items(page).nth(5)).not.toContainText(/SLA|Còn|Quá hạn/);
  await expect(page.getByText(/Quá hạn \d+ phút/)).toHaveCount(1);
  await expectAccessible(page);
});

test('the SLA filter asks the API (never computed here); none matching says so and clears', async ({
  page,
}) => {
  const asked = await serve(page);
  const sla = page.getByRole('combobox', { name: /^SLA/ });
  await expect(sla.getByRole('option')).toHaveText(['Tất cả', 'Sắp quá hạn', 'Quá hạn']);
  await sla.selectOption('due_soon');
  await expect(page).toHaveURL(/[?&]sla=due_soon/);
  await expect.poll(() => asked.at(-1)).toBe('due_soon');
  await expect(page.getByText('Không có hội thoại khớp bộ lọc.')).toBeVisible();
  await page.getByRole('button', { name: 'Xóa bộ lọc' }).click();
  await expect(items(page)).toHaveCount(6);
  expect(asked.at(-1)).toBeNull();
  await expectAccessible(page);
});
