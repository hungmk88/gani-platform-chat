import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';

// #21 Workspace, tab "Giờ làm việc" (CEO 03/11, brief 52–53: PR 2a-i, read only): the week of the workspace chosen in the top
// bar, from `GET /v1/workspaces/{id}/business-hours` (real API, #566). Changing it is 2a-ii.
const tabs = (page: Page) => page.getByRole('navigation', { name: 'Phần workspace' });
const rows = (page: Page) => page.getByRole('region', { name: 'Giờ làm việc' }).getByRole('row');
const isHours = (u: URL) => /^\/v1\/workspaces\/[^/]+\/business-hours$/.test(u.pathname);
const problem = (status: number, code: string, traceId: string) => ({
  status,
  contentType: 'application/problem+json',
  body: JSON.stringify({ status, code, traceId }),
});
const HEAD = 'NgàyLàm việcMở cửaĐóng cửaNghỉ giữa ca từNghỉ giữa ca đến';
const none = { opensAt: null, closesAt: null, breakStartsAt: null, breakEndsAt: null };

test('an Admin opens the tab and reads the default week of the system, asking nothing but the GET', async ({
  page,
}) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (isHours(new URL(r.url()))) asked.push(r.method());
  });
  await signIn(page, accountOf('admin'));
  await page.goto('/settings/workspace');
  await expect(tabs(page).getByRole('link')).toHaveText(['Workspace', 'Giờ làm việc', 'Ngày nghỉ']);
  await tabs(page).getByRole('link', { name: 'Giờ làm việc' }).click();
  await expect(page).toHaveURL(/\?tab=hours$/);
  await expect(tabs(page).getByRole('link', { name: 'Giờ làm việc' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByText(/đang dùng tuần mặc định của hệ thống/)).toBeVisible();
  await expect(page.getByText('Múi giờ: Asia/Ho_Chi_Minh')).toBeVisible();
  const day = (d: string) => `${d}Có08:0017:3012:0013:00`; // Q7 default (#655, N209)
  await expect(rows(page)).toHaveText([
    HEAD,
    ...['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6'].map(day),
    'Thứ 7Nghỉ————',
    'Chủ nhậtNghỉ————',
  ]);
  await expect(page.getByText('Không áp dụng AI ở màn này.')).toBeVisible();
  await expectAccessible(page);
  expect(asked).toEqual(['GET']);
});

test('a week of its own reads by weekday, with its break, and without the default line', async ({
  page,
}) => {
  await page.route(isHours, (r) =>
    r.fulfill({
      json: {
        timezone: 'Asia/Bangkok',
        isDefault: false,
        week: [
          { weekday: 7, open: false, ...none },
          { weekday: 6, open: true, ...none, opensAt: '08:00', closesAt: '12:00' },
          ...[5, 4, 3, 2].map((weekday) => ({ weekday, open: false, ...none })),
          {
            weekday: 1,
            open: true,
            opensAt: '07:30',
            closesAt: '17:00',
            breakStartsAt: '11:30',
            breakEndsAt: '13:00',
          },
        ],
      },
    }),
  );
  await signIn(page, accountOf('owner'));
  await page.goto('/settings/workspace?tab=hours');
  await expect(rows(page)).toHaveText([
    HEAD,
    'Thứ 2Có07:3017:0011:3013:00',
    ...['Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6'].map((d) => `${d}Nghỉ————`),
    'Thứ 7Có08:0012:00——',
    'Chủ nhậtNghỉ————',
  ]);
  await expect(page.getByText('Múi giờ: Asia/Bangkok')).toBeVisible();
  await expect(page.getByText(/đang dùng tuần mặc định của hệ thống/)).toHaveCount(0);
});

test('the tab loading, then a failure with its trace and Thử lại, then the week; a 404 is the pending screen', async ({
  page,
}) => {
  let answer: 'slow' | 'down' | 'served' | 'missing' = 'slow';
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  await page.route(isHours, async (r) => {
    if (answer === 'slow') await held;
    if (answer === 'served') return r.fallback();
    if (answer === 'missing') return r.fulfill(problem(404, 'not_found', 'trace-404'));
    return r.fulfill(problem(503, 'service_unavailable', 'trace-hours'));
  });
  await signIn(page, accountOf('admin'));
  await page.goto('/settings/workspace?tab=hours');
  await expect(page.getByRole('main').getByRole('status')).toHaveText('Đang tải giờ làm việc…');
  await expectAccessible(page);
  answer = 'down';
  release();
  const alert = page.getByRole('main').getByRole('alert');
  await expect(alert).toContainText('Mã: trace-hours');
  await expectAccessible(page);
  answer = 'served';
  await alert.getByRole('button', { name: 'Thử lại' }).click();
  await expect(rows(page)).toHaveCount(8);
  await expect(alert).toHaveCount(0);

  answer = 'missing';
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Giờ làm việc: màn này chưa có trong bản hiện tại.' }),
  ).toBeVisible();
  await expect(tabs(page).getByRole('link', { name: 'Workspace' })).toBeVisible();
  await expect(rows(page)).toHaveCount(0);
  await expectAccessible(page);
});

test('a Manager gets the forbidden page on the tab too, and nothing is asked', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (isHours(new URL(r.url()))) asked.push(r.method());
  });
  await signIn(page, accountOf('manager'));
  await page.goto('/settings/workspace?tab=hours');
  await expect(
    page.getByRole('heading', { name: 'Bạn không có quyền xem trang này.' }),
  ).toBeVisible();
  await expect(tabs(page)).toHaveCount(0);
  expect(asked).toEqual([]);
});
