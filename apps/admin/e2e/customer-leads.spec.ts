import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';
import { CUSTOMERS } from './stub-customers';

// #8 Hồ sơ khách, lead của khách (N188; CEO brief 169 P3): GET /v1/leads?customerId= across the session's workspaces, answered here
// (the stub's leads belong to other customers, so it answers none for these). Support never asks (T-2).
const AN = CUSTOMERS[0]!;
const isLeads = (u: URL) =>
  u.pathname === '/v1/leads' && u.searchParams.get('customerId') === AN.id;
const section = (page: Page) => page.getByRole('region', { name: 'Lead của khách' });
const lead = (
  n: number,
  title: string,
  status: 'open' | 'won' | 'lost',
  owner: { id: string; name: string | null } | null,
) => ({
  id: `0190d500-0000-7000-8000-00000000000${n}`,
  workspaceId: 'ws-e2e',
  title,
  customer: { id: AN.id, displayName: AN.displayName },
  conversationId: null,
  stage: { id: `0190d600-0000-7000-8000-00000000000${n}`, name: 'Báo giá (chờ Q9, dữ liệu tạm)' },
  status,
  owner,
  createdBy: 'user-sales',
  lostReason: status === 'lost' ? 'Khác (chờ Q9)' : null,
  closedAt: status === 'open' ? null : '2026-11-06T03:00:00Z',
  score: null,
  version: 1,
  createdAt: '2026-11-01T03:00:00Z',
  updatedAt: `2026-11-0${n}T03:00:00Z`,
});

test('a Manager reads the leads of the customer, then the next page; each opens its detail', async ({
  page,
}) => {
  const asked: string[] = [];
  await page.route(isLeads, (r) => {
    const cursor = new URL(r.request().url()).searchParams.get('cursor');
    asked.push(cursor ?? '');
    return r.fulfill({
      json: cursor
        ? { data: [lead(3, 'Đơn Tết 2027', 'lost', null)], nextCursor: null }
        : {
            data: [
              lead(5, 'Báo giá phở khô 200 thùng', 'open', { id: 'user-sales', name: 'Bình' }),
              lead(4, 'Đại lý quận 7', 'won', { id: 'user-x', name: null }),
            ],
            nextCursor: 'p2',
          },
    });
  });
  await signIn(page, accountOf('manager'));
  await page.goto(`/customers/${AN.id}`);
  const items = section(page).getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toHaveText(
    'Báo giá phở khô 200 thùngBáo giá (chờ Q9, dữ liệu tạm)Đang chạyPhụ trách: BìnhCập nhật 10:00 05/11/2026',
  );
  await expect(items.nth(1)).toContainText('ThắngPhụ trách: Chưa có tên');
  await expect(
    items.nth(0).getByRole('link', { name: 'Báo giá phở khô 200 thùng' }),
  ).toHaveAttribute('href', '/leads/0190d500-0000-7000-8000-000000000005');
  await expectAccessible(page);
  await section(page).getByRole('button', { name: 'Tải thêm lead' }).click();
  await expect(items).toHaveCount(3);
  await expect(items.nth(2)).toContainText('ThuaPhụ trách: Chưa giao');
  expect(asked).toEqual(['', 'p2']);
});

test('Support neither sees nor asks for the leads (T-2)', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === '/v1/leads') asked.push(r.url());
  });
  await signIn(page, accountOf('support'));
  await page.goto(`/customers/${AN.id}`);
  await expect(page.getByRole('region', { name: 'Định danh' })).toBeVisible();
  await expect(section(page)).toHaveCount(0);
  expect(asked).toEqual([]);
});

test('none yet says so; a failure says why with its trace, and Thử lại reads again', async ({
  page,
}) => {
  let n = 0;
  await page.route(isLeads, (r) =>
    ++n === 1
      ? r.fulfill({
          status: 500,
          contentType: 'application/problem+json',
          body: JSON.stringify({ status: 500, code: 'internal_error', traceId: 'trace-leads' }),
        })
      : r.fulfill({ json: { data: [], nextCursor: null } }),
  );
  await signIn(page, accountOf('sales'));
  await page.goto(`/customers/${AN.id}`);
  await expect(section(page).getByRole('alert')).toContainText('Mã: trace-leads');
  await section(page).getByRole('button', { name: 'Thử lại' }).click();
  await expect(section(page)).toContainText('Khách chưa có lead nào.');
});
