import { expect, test, type Page, type Route } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';
import { LOST_REASON, STAGES } from './stub-leads';

// #12 Pipeline lead (CEO 02/11, brief 29–30: 12a, read only) on the contract planned for S4 (docs/openapi/planned.json, #544):
// the steps from `GET /v1/workspaces/{id}/pipeline`, the leads from `GET /v1/leads` by cursor; the steps as columns, then Thắng
// and Thua. Every role of the company reads it.
const board = (page: Page) => page.getByRole('region', { name: 'Các bước của pipeline' });
const column = (page: Page, title: string) =>
  board(page).getByRole('region', { name: new RegExp(`^${title.replace(/[()]/g, '\\$&')} \\(`) });
const isLeads = (u: URL) => u.pathname === '/v1/leads';
const isPipeline = (u: URL) => u.pathname === '/v1/workspaces/ws-e2e/pipeline';
const leadsRoute = (page: Page, answer: (r: Route) => Promise<void>) => page.route(isLeads, answer);
const open = async (page: Page, who = 'owner') => {
  await signIn(page, accountOf(who));
  await page.goto('/leads');
  await expect(page.getByRole('heading', { name: 'Pipeline lead', level: 1 })).toBeVisible();
};

test('an Owner reads the steps the API gives, then Thắng and Thua, page by page, and nothing writes', async ({
  page,
}) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (isLeads(u) || isPipeline(u)) asked.push(`${r.method()} ${u.pathname}${u.search}`);
  });
  await open(page);
  await expect(board(page).getByRole('heading', { level: 2 })).toHaveText([
    ...STAGES.map((s, n) => `${s.name} (${[2, 1, 1, 0, 0, 1][n]})`),
    'Thắng (0)',
    'Thua (0)',
  ]);
  const first = column(page, STAGES[0]!.name);
  await expect(first.getByRole('heading', { level: 3 })).toHaveText([
    'Báo giá phở khô',
    'Hỏi giá sỉ',
  ]);
  await expect(first.getByRole('listitem').nth(1)).toContainText('Phụ trách: Chưa giao');
  await expect(column(page, STAGES[2]!.name)).toContainText('Khách: Khách chưa có tên');
  await expect(first.getByRole('listitem').first()).toContainText(
    `Báo giá phở khôKhách: Quán Phở Hà NộiPhụ trách: Người thử sales${STAGES[0]!.name}Đang chạyCập nhật 10:00 28/10/2026`,
  );
  await page.getByRole('button', { name: 'Tải thêm' }).click();
  await expect(column(page, 'Thắng')).toContainText('Khách: Nhà hàng Đông Á');
  await expect(column(page, 'Thắng')).toContainText(`${STAGES[5]!.name}Thắng`);
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0);
  expect(asked.sort()).toEqual([
    'GET /v1/leads?workspaceId=ws-e2e&limit=100',
    'GET /v1/leads?workspaceId=ws-e2e&limit=100&cursor=5',
    'GET /v1/workspaces/ws-e2e/pipeline',
  ]);
  await expect(page.getByText('Chỉ xem: không tạo lead, không chuyển bước')).toBeVisible();
  await expectAccessible(page);
});

test('a lost lead says why on focus and on hover, the reason the API gives', async ({ page }) => {
  await open(page, 'manager');
  await page.getByRole('button', { name: 'Tải thêm' }).click();
  const lost = column(page, 'Thua');
  await expect(lost).toContainText('Thực đơn chay');
  const badge = lost.getByText('Thua', { exact: true });
  const tip = lost.getByRole('tooltip');
  await expect(tip).toBeHidden();
  await badge.focus();
  await expect(tip).toBeVisible();
  await expect(tip).toHaveText(`Lý do: ${LOST_REASON}`);
  await expect(badge).toHaveAccessibleDescription(`Lý do: ${LOST_REASON}`);
  await expectAccessible(page);
  await page.getByRole('heading', { name: 'Pipeline lead' }).click();
  await expect(tip).toBeHidden();
  await badge.hover();
  await expect(tip).toBeVisible();
});

test('loading, then a failure with its trace and Thử lại, then no lead with Làm mới', async ({
  page,
}) => {
  let answer: 'slow' | 'down' | 'empty' = 'slow';
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  await leadsRoute(page, async (r) => {
    if (answer === 'slow') await held;
    if (answer === 'empty') return r.fulfill({ json: { data: [], nextCursor: null } });
    return r.fulfill({
      status: 503,
      contentType: 'application/problem+json',
      body: JSON.stringify({ status: 503, code: 'service_unavailable', traceId: 'trace-leads' }),
    });
  });
  await signIn(page, accountOf('owner'));
  await page.goto('/leads');
  await expect(page.getByRole('main').getByRole('status')).toHaveText('Đang tải pipeline…');
  answer = 'down';
  release();
  const alert = page.getByRole('main').getByRole('alert');
  await expect(alert).toContainText('Mã: trace-leads');
  await expectAccessible(page);
  answer = 'empty';
  await alert.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByText('Workspace chưa có lead nào.')).toBeVisible();
  await expect(page.getByRole('main').getByRole('button')).toHaveText(['Làm mới']);
  await expectAccessible(page);
});

test('a 404 of the leads or of the pipeline is the screen not there yet', async ({ page }) => {
  const notServed = (r: Route) =>
    r.fulfill({
      status: 404,
      contentType: 'application/problem+json',
      body: JSON.stringify({ status: 404, code: 'not_found', traceId: 'trace-404' }),
    });
  const pending = page.getByRole('heading', { name: 'Lead: màn này chưa có trong bản hiện tại.' });
  await leadsRoute(page, notServed);
  await signIn(page, accountOf('admin'));
  await page.goto('/leads');
  await expect(pending).toBeVisible();
  await page.unroute(isLeads);
  await page.route(isPipeline, notServed);
  await page.reload();
  await expect(pending).toBeVisible();
  await expect(board(page)).toHaveCount(0);
});

test('a Viewer reads the board too; a platform operator has no such screen: the 404 inside the frame', async ({
  page,
}) => {
  await open(page, 'viewer');
  await expect(board(page).getByRole('heading', { level: 2 })).toHaveCount(8);
  await signIn(page, accountOf('platform_operator'));
  const res = await page.goto('/leads');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Không tìm thấy trang.' })).toBeVisible();
});

// Edge cases (CEO 02/11, brief 36 (2)): a later page that fails, the pipeline that fails, a step the pipeline no longer lists.
const down = (traceId: string) => ({
  status: 503,
  contentType: 'application/problem+json',
  body: JSON.stringify({ status: 503, code: 'service_unavailable', traceId }),
});

test('"Tải thêm" that fails keeps the board read, says so under it and asks the same page again', async ({
  page,
}) => {
  let fail = true;
  await leadsRoute(page, (r) =>
    fail && new URL(r.request().url()).searchParams.get('cursor')
      ? r.fulfill(down('trace-page-2'))
      : r.fallback(),
  );
  await open(page);
  await page.getByRole('button', { name: 'Tải thêm' }).click();
  const alert = page.getByRole('main').getByRole('alert');
  await expect(alert).toContainText('Mã: trace-page-2');
  await expect(board(page).getByRole('heading', { level: 2 })).toHaveCount(8);
  await expect(column(page, 'Thắng')).toContainText('Chưa có lead');
  await expect(page.getByRole('button', { name: 'Tải thêm' })).toHaveCount(0);
  await expectAccessible(page);
  fail = false;
  await alert.getByRole('button', { name: 'Thử lại' }).click();
  await expect(column(page, 'Thắng')).toContainText('Khách: Nhà hàng Đông Á');
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
});

test('a failure of the pipeline, not a 404, says so with its trace and Thử lại', async ({
  page,
}) => {
  let fail = true;
  await page.route(isPipeline, (r) => (fail ? r.fulfill(down('trace-pipeline')) : r.fallback()));
  await signIn(page, accountOf('owner'));
  await page.goto('/leads');
  const alert = page.getByRole('main').getByRole('alert');
  await expect(alert).toContainText('Mã: trace-pipeline');
  await expect(board(page)).toHaveCount(0);
  await expectAccessible(page);
  fail = false;
  await alert.getByRole('button', { name: 'Thử lại' }).click();
  await expect(board(page).getByRole('heading', { level: 2 })).toHaveCount(8);
});

test('open leads at a step the pipeline no longer lists keep a column; the board takes the keyboard', async ({
  page,
}) => {
  await page.route(isPipeline, (r) =>
    r.fulfill({ json: { data: STAGES.slice(1), lostReasons: [LOST_REASON] } }),
  );
  await open(page);
  const gone = column(page, 'Bước không còn trong pipeline');
  await expect(gone.getByRole('heading', { level: 3 })).toHaveText([
    'Báo giá phở khô',
    'Hỏi giá sỉ',
  ]);
  await board(page).focus();
  await expect(board(page)).toBeFocused();
  await expectAccessible(page);
});
