import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';

// #30 "Phiên truy cập" (U79, brief A-U79, tầng 1; PR U79a, U79b): the operator's sessions, opening one and ending one early,
// on the contract planned for S5 (#617) served here by page.route.
const COMPANY = { orgId: '0190f000-0000-7000-8000-000000000001', slug: 'gani', name: 'Gani Foods' };
const health = (c: typeof COMPANY) => ({
  ...c,
  channels: { total: 1, tokenExpiringSoon: 0, tokenExpired: 0 },
  aiCostMonthVnd: null,
});
const RUNNING = {
  id: '0190f200-0000-7000-8000-000000000001',
  orgId: COMPANY.orgId,
  orgName: COMPANY.name,
  operatorUserId: 'user-platform_operator',
  reason: 'Hỗ trợ lỗi kênh Zalo theo yêu cầu #128',
  startedAt: '2030-01-01T03:00:00Z',
  expiresAt: '2030-01-01T04:00:00Z',
  endedAt: null,
  endReason: null,
};
const ENDED = { ...RUNNING, id: 'ended', endedAt: '2030-01-01T03:20:00Z', endReason: 'manual' };

/** The companies, the sessions (each query kept) and the two POSTs (each path, key and body kept). */
async function serve(page: Page) {
  const asked: string[] = [];
  const posts: { path: string; key: string | undefined; body: unknown }[] = [];
  const other = { ...COMPANY, orgId: '0190f000-0000-7000-8000-000000000002', name: 'The Smile' };
  await page.route(
    (u) => u.pathname === '/v1/platform/tenants/health',
    (r) => r.fulfill({ json: { data: [health(COMPANY), health(other)], nextCursor: null } }),
  );
  await page.route(
    (u) => u.pathname.startsWith('/v1/platform/access-sessions'),
    (r) => {
      const url = new URL(r.request().url());
      if (r.request().method() === 'GET') {
        asked.push(url.search);
        return r.fulfill({ json: { data: [RUNNING, ENDED], nextCursor: null } });
      }
      const body: unknown = r.request().postDataJSON();
      posts.push({ path: url.pathname, key: r.request().headers()['idempotency-key'], body });
      if (url.pathname.endsWith('/end'))
        return r.fulfill({ json: { ...RUNNING, endedAt: RUNNING.startedAt, endReason: 'manual' } });
      const opened = { id: 'new', orgId: COMPANY.orgId, startedAt: RUNNING.startedAt };
      return r.fulfill({ status: 201, json: { ...opened, expiresAt: RUNNING.expiresAt } });
    },
  );
  await signIn(page, accountOf('platform_operator'));
  await page.goto('/platform?tab=access');
  return { asked, posts };
}
const rows = (page: Page) =>
  page.getByRole('region', { name: 'Phiên truy cập' }).getByRole('table').getByRole('row');

test('the operator reads their own sessions, only the running ones by default, by company or all', async ({
  page,
}) => {
  const { asked } = await serve(page);
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).nth(0)).toHaveText(/^Công tyLý doBắt đầuTrạng tháiThao tác$/);
  await expect(rows(page).nth(1)).toHaveText(
    /Gani FoodsHỗ trợ lỗi kênh Zalo.*Còn hiệu lực tới 11:00 01\/01\/2030Kết thúc sớm…/,
  );
  await expect(rows(page).nth(2)).toHaveText(/Đã kết thúc lúc 10:20 01\/01\/2030—$/);
  expect(asked[0]).toBe('?limit=50&active=true');
  await page.getByRole('combobox', { name: /^Công ty/ }).selectOption({ label: 'The Smile' });
  await page.getByRole('checkbox', { name: 'Chỉ phiên còn hiệu lực' }).uncheck();
  await expect
    .poll(() => asked.at(-1))
    .toBe('?limit=50&orgId=0190f000-0000-7000-8000-000000000002');
  await expectAccessible(page);
});

test('"Kết thúc sớm…" asks again, ends the session and reads the list again', async ({ page }) => {
  const { asked, posts } = await serve(page);
  await page.getByRole('button', { name: 'Kết thúc sớm phiên ở Gani Foods' }).click();
  const dialog = page.getByRole('dialog', { name: 'Kết thúc sớm phiên truy cập' });
  await expect(dialog).toBeFocused(); // never on "Kết thúc phiên" or "Hủy"
  await expectAccessible(page);
  const reads = asked.length;
  await dialog.getByRole('button', { name: 'Kết thúc phiên' }).click();
  await expect(dialog).toBeHidden();
  expect(posts.map((p) => p.path)).toEqual([`/v1/platform/access-sessions/${RUNNING.id}/end`]);
  await expect(page.getByRole('status')).toHaveText(
    'Đã kết thúc phiên ở Gani Foods. Đã ghi audit.',
  );
  await expect.poll(() => asked.length).toBeGreaterThan(reads);
});

test('"Tạo phiên" asks a company and a reason of 10 characters or more, then opens 60 minutes', async ({
  page,
}) => {
  const { asked, posts } = await serve(page);
  await page.getByRole('button', { name: 'Tạo phiên' }).click();
  const dialog = page.getByRole('dialog', { name: 'Tạo phiên truy cập' });
  await expect(dialog).toBeFocused(); // never on "Hủy"
  await expectAccessible(page);
  const reason = dialog.getByRole('textbox', { name: /^Lý do/ });
  await reason.fill('ngắn');
  await dialog.getByRole('button', { name: 'Mở phiên 60 phút' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(/^Ghi lý do cụ thể \(ít nhất 10 ký tự\)/);
  expect(posts).toEqual([]);
  await dialog.getByRole('combobox', { name: /^Công ty/ }).selectOption({ label: 'Gani Foods' });
  await reason.fill('  Hỗ trợ yêu cầu #131  ');
  const reads = asked.length;
  await dialog.getByRole('button', { name: 'Mở phiên 60 phút' }).click();
  await expect(dialog).toBeHidden();
  expect(posts).toEqual([
    {
      path: '/v1/platform/access-sessions',
      key: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown as string,
      body: { orgId: COMPANY.orgId, reason: 'Hỗ trợ yêu cầu #131' },
    },
  ]);
  await expect(page.getByRole('status')).toHaveText(
    'Đã mở phiên 60 phút ở Gani Foods, tới 11:00 01/01/2030. Đã ghi audit.',
  );
  await expect(page.getByRole('status')).toBeFocused();
  await expect.poll(() => asked.length).toBeGreaterThan(reads);
});

// E2E brief 178 T2: the failures of opening and ending, answered once here, then the stub above.
const problem = (status: number, code: string) => ({
  status,
  contentType: 'application/problem+json',
  body: JSON.stringify({ status, code, traceId: `trace-${code}` }),
});
const isCreate = (u: URL) => u.pathname === '/v1/platform/access-sessions';

test('a lost answer to "Tạo phiên" is sent again with the same key, once opened', async ({
  page,
}) => {
  const { posts } = await serve(page);
  const keys: (string | undefined)[] = [];
  await page.route(isCreate, (r) => {
    if (r.request().method() !== 'POST') return r.fallback();
    keys.push(r.request().headers()['idempotency-key']);
    return keys.length === 1 ? r.fulfill(problem(500, 'internal_error')) : r.fallback();
  });
  await page.getByRole('button', { name: 'Tạo phiên' }).click();
  const dialog = page.getByRole('dialog', { name: 'Tạo phiên truy cập' });
  await dialog.getByRole('textbox', { name: /^Lý do/ }).fill('Hỗ trợ yêu cầu #131');
  await dialog.getByRole('button', { name: 'Mở phiên 60 phút' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Mã: trace-internal_error');
  await dialog.getByRole('button', { name: 'Mở phiên 60 phút' }).click();
  await expect(dialog).toBeHidden();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
  expect(keys[1]).toBe(keys[0]);
  expect(posts).toHaveLength(1);
});

test('a company gone (404) when opening says so and reads the companies again', async ({
  page,
}) => {
  await serve(page);
  await page.route(isCreate, (r) =>
    r.request().method() === 'POST' ? r.fulfill(problem(404, 'not_found')) : r.fallback(),
  );
  let companies = 0;
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === '/v1/platform/tenants/health') companies++;
  });
  await page.getByRole('button', { name: 'Tạo phiên' }).click();
  const dialog = page.getByRole('dialog', { name: 'Tạo phiên truy cập' });
  await dialog.getByRole('textbox', { name: /^Lý do/ }).fill('Hỗ trợ yêu cầu #131');
  await dialog.getByRole('button', { name: 'Mở phiên 60 phút' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Mã: trace-not_found');
  await expect(dialog).toBeVisible();
  await expect.poll(() => companies).toBeGreaterThan(0);
});

test('a session already over (404) when ending early says so and reads the sessions again', async ({
  page,
}) => {
  const { asked } = await serve(page);
  await page.route(
    (u) => u.pathname.endsWith('/end'),
    (r) => r.fulfill(problem(404, 'not_found')),
  );
  await page.getByRole('button', { name: 'Kết thúc sớm phiên ở Gani Foods' }).click();
  const dialog = page.getByRole('dialog', { name: 'Kết thúc sớm phiên truy cập' });
  const reads = asked.length;
  await dialog.getByRole('button', { name: 'Kết thúc phiên' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Mã: trace-not_found');
  await expect.poll(() => asked.length).toBeGreaterThan(reads);
});

test('"Tải thêm" reads the next page of sessions by its cursor (E2E brief 194 C)', async ({
  page,
}) => {
  const OLDER = { ...ENDED, id: 'older', reason: 'Kiểm tra cấu hình kênh theo yêu cầu #90' };
  const cursors: (string | null)[] = [];
  await serve(page);
  // Registered after the stub of serve(), so it answers first; the page is read again with it.
  await page.route(
    (u) => u.pathname === '/v1/platform/access-sessions',
    (r) => {
      if (r.request().method() !== 'GET') return r.fallback();
      const cursor = new URL(r.request().url()).searchParams.get('cursor');
      cursors.push(cursor);
      return r.fulfill({
        json: cursor ? { data: [OLDER], nextCursor: null } : { data: [RUNNING], nextCursor: 'p2' },
      });
    },
  );
  await page.reload();
  await expect(rows(page)).toHaveCount(2); // the header and RUNNING
  await page.getByRole('button', { name: 'Tải thêm' }).click();
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).nth(2)).toContainText('Kiểm tra cấu hình kênh theo yêu cầu #90');
  await expect(page.getByRole('button', { name: 'Tải thêm' })).toHaveCount(0);
  expect(cursors.filter(Boolean)).toEqual(['p2']);
});
