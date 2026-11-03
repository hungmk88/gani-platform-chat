import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';

// #21 Workspace, tab "Ngày nghỉ" (CEO 03/11, brief 52–53: PR 2b-i, read only): the days off still to come of the workspace chosen
// in the top bar, from `GET /v1/workspaces/{id}/holidays` (real API, #570). Adding, changing, removing: 2b-ii.
const tabs = (page: Page) => page.getByRole('navigation', { name: 'Phần workspace' });
const rows = (page: Page) => page.getByRole('region', { name: 'Ngày nghỉ' }).getByRole('row');
const isHolidays = (u: URL) => /^\/v1\/workspaces\/[^/]+\/holidays$/.test(u.pathname);
const problem = (status: number, code: string, traceId: string) => ({
  status,
  contentType: 'application/problem+json',
  body: JSON.stringify({ status, code, traceId }),
});

test('an Admin opens the tab and reads the days off to come, by start, asking nothing but the GET', async ({
  page,
}) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (isHolidays(u)) asked.push(`${r.method()} ${u.search}`);
  });
  await signIn(page, accountOf('admin'));
  await page.goto('/settings/workspace?tab=hours');
  await tabs(page).getByRole('link', { name: 'Ngày nghỉ' }).click();
  await expect(page).toHaveURL(/\?tab=holidays$/);
  await expect(tabs(page).getByRole('link', { name: 'Ngày nghỉ' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  // By row, so a column of actions after these two (2b-ii) leaves the reading as it is.
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).nth(0)).toContainText('Ngày nghỉNgày');
  await expect(rows(page).nth(1)).toContainText('Tết Dương lịch01/01/2030');
  await expect(rows(page).nth(2)).toContainText('Tết Nguyên đán01/02/2030 – 07/02/2030');
  await expect(page.getByText('Không áp dụng AI ở màn này.')).toBeVisible();
  await expectAccessible(page);
  expect(asked).toEqual(['GET ']);
});

test('the tab loading, then a failure with its trace and Thử lại, then none to come with Làm mới; a 404 is the pending screen', async ({
  page,
}) => {
  let answer: 'slow' | 'down' | 'none' | 'served' | 'missing' = 'slow';
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  await page.route(isHolidays, async (r) => {
    if (answer === 'slow') await held;
    if (answer === 'none') return r.fulfill({ json: { data: [] } });
    if (answer === 'served') return r.fallback();
    if (answer === 'missing') return r.fulfill(problem(404, 'not_found', 'trace-404'));
    return r.fulfill(problem(503, 'service_unavailable', 'trace-holidays'));
  });
  await signIn(page, accountOf('owner'));
  await page.goto('/settings/workspace?tab=holidays');
  await expect(page.getByRole('main').getByRole('status')).toHaveText('Đang tải ngày nghỉ…');
  await expectAccessible(page);
  answer = 'down';
  release();
  const alert = page.getByRole('main').getByRole('alert');
  await expect(alert).toContainText('Mã: trace-holidays');
  await expectAccessible(page);
  answer = 'none';
  await alert.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByText('Workspace chưa có ngày nghỉ nào sắp tới.')).toBeVisible();
  await expect(rows(page)).toHaveCount(0);
  await expectAccessible(page);
  answer = 'served';
  await page.getByRole('button', { name: 'Làm mới' }).click();
  await expect(rows(page)).toHaveCount(3);

  answer = 'missing';
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Ngày nghỉ: màn này chưa có trong bản hiện tại.' }),
  ).toBeVisible();
  await expect(tabs(page).getByRole('link')).toHaveText(['Workspace', 'Giờ làm việc', 'Ngày nghỉ']);
  await expectAccessible(page);
});

test('a Manager gets the forbidden page on the tab too, and nothing is asked', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (isHolidays(new URL(r.url()))) asked.push(r.method());
  });
  await signIn(page, accountOf('manager'));
  await page.goto('/settings/workspace?tab=holidays');
  await expect(
    page.getByRole('heading', { name: 'Bạn không có quyền xem trang này.' }),
  ).toBeVisible();
  expect(asked).toEqual([]);
});
