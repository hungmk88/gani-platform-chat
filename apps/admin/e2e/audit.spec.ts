import { expect, test, type Page } from '@playwright/test';

import { addDays, dayText, defaultWindow, vnDay } from '../src/audit/audit';
import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';
import { AUDIT_NOW, OTHER } from './stub-audit';

// #28 Audit log (CEO 31/10), real API (N174): the last 7 days of Viet Nam unless other days are chosen, the filters in the URL,
// pages by cursor. The stub's rows are dated back from AUDIT_NOW, the browser's fixed clock; page 1 is 3 rows, page 2 repeats one.
const rows = (page: Page) => page.getByRole('main').getByRole('table').getByRole('row');
const asked = (page: Page) => {
  const seen: URLSearchParams[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/v1/audit-logs')) seen.push(new URL(r.url()).searchParams);
  });
  return seen;
};
// A fixed time, not the machine's clock: the browser's clock is set to the stub's AUDIT_NOW before anything runs.
const NOW = new Date(AUDIT_NOW);
const week = () => defaultWindow(NOW);
const open = async (page: Page, who = 'owner', query = '') => {
  await page.clock.setFixedTime(NOW);
  await signIn(page, accountOf(who));
  await page.goto(`/settings/audit${query}`);
  await expect(page.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible();
};

test('an Owner reads the last 7 days: who, what, on what, the detail as plain text', async ({
  page,
}) => {
  const seen = asked(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  const { from, to } = week();
  await expect(
    page.getByText(`Đang xem từ ${dayText(from)} đến ${dayText(to)} (giờ Việt Nam)`),
  ).toBeVisible();
  // The server renders no days (its clock is not the browser's): the page hydrates without React #418 (01/11).
  const html = await (await page.request.get('/settings/audit')).text();
  expect([html.includes('Đang tải khoảng thời gian…'), html.includes('Đang xem từ')]).toEqual([
    true,
    false,
  ]);
  expect(errors).toEqual([]);
  await expect(rows(page)).toHaveCount(4);
  await expect(rows(page).nth(0)).toHaveText('Thời điểmNgười thực hiệnHành độngĐối tượngChi tiết');
  await expect(rows(page).nth(1)).toContainText(
    'Bạnmember.role_changedmember …00000101from: sales',
  );
  const other = rows(page).nth(2).getByRole('button', { name: 'Người dùng …9abcdef0' });
  await expect(other.locator('abbr')).toHaveAttribute('title', OTHER);
  // Never HTML: the tag is shown as typed.
  await expect(page.getByText('reason: <b>Khách mất máy</b>')).toBeVisible();
  await expect(page.getByRole('main').locator('table b')).toHaveCount(0);
  await expect(rows(page).nth(3)).toContainText('Hệ thốngworkspace.updated');
  await expect(rows(page).nth(3).getByRole('button')).toHaveCount(0);
  expect(seen[0]?.get('from')).toBe(new Date(`${from}T00:00:00+07:00`).toISOString());
  expect(seen[0]?.get('to')).toBe(new Date(`${addDays(to, 1)}T00:00:00+07:00`).toISOString());
  expect(seen[0]?.get('limit')).toBe('50');
  await expect(page.getByRole('button', { name: 'Bỏ lọc' })).toHaveCount(0);
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Tải thêm' }).click();
  await expect(rows(page)).toHaveCount(6);
  await expect(rows(page).nth(4).locator('code')).toHaveText(['team.created', 'team', '["a","b"]']);
  await expect(page.getByText('Đã hiện hết.')).toBeVisible();
});

test('a person is filtered by a click on them or by "Tôi"; "Bỏ lọc" shows everyone again', async ({
  page,
}) => {
  const seen = asked(page);
  await open(page);
  await rows(page).nth(2).getByRole('button', { name: 'Người dùng …9abcdef0' }).click();
  await expect(page).toHaveURL(`/settings/audit?actor=${OTHER}`);
  await expect(rows(page)).toHaveCount(3);
  await expect(page.getByText('Đang xem việc của Người dùng …9abcdef0')).toBeVisible();
  expect(seen.at(-1)?.get('actorUserId')).toBe(OTHER);
  await page.getByRole('button', { name: 'Tôi' }).click();
  await expect(page).toHaveURL('/settings/audit?actor=user-owner');
  await expect(page.getByRole('button', { name: 'Tôi' })).toHaveAttribute('aria-pressed', 'true');
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).getByRole('button', { name: 'Bạn' })).toHaveCount(2);
  await expect(page.getByText('Bỏ lọc sẽ đưa về 7 ngày gần nhất.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Bỏ lọc' }).click();
  await expect(page).toHaveURL('/settings/audit');
  await expect(rows(page)).toHaveCount(4);
});

test('what the API would refuse is said before asking; good filters go to the URL', async ({
  page,
}) => {
  const seen = asked(page);
  await open(page);
  await expect(rows(page)).toHaveCount(4);
  const before = seen.length;
  // A label around its field: the field's name may hold its value (#401), so match the start.
  const field = (name: string) => page.getByLabel(new RegExp(`^${name}`));
  await field('Hành động').fill('Team.Created');
  await page.getByRole('button', { name: 'Lọc', exact: true }).click();
  const alert = page.getByRole('main').getByRole('alert');
  await expect(alert).toHaveText(/^Hành động viết dạng <vật>\.<động từ>/);
  await field('Hành động').fill('team.created');
  await field('Từ ngày').fill(addDays(vnDay(NOW), 1));
  await page.getByRole('button', { name: 'Lọc', exact: true }).click();
  await expect(alert).toHaveText('Ngày bắt đầu phải trước hoặc trùng ngày kết thúc.');
  expect(seen.length).toBe(before);
  const from = addDays(vnDay(NOW), -10);
  await field('Từ ngày').fill(from);
  await page.getByRole('button', { name: 'Lọc', exact: true }).click();
  await expect(page).toHaveURL(`/settings/audit?action=team.created&from=${from}&to=${week().to}`);
  await expect(rows(page)).toHaveCount(2);
  expect(seen.at(-1)?.get('action')).toBe('team.created');
  await expect(page.getByText(`Đang xem từ ${dayText(from)} đến`)).toBeVisible();
  await expect(page.getByText('Bỏ lọc sẽ đưa về 7 ngày gần nhất.')).toBeVisible();
  await page.getByRole('button', { name: 'Bỏ lọc' }).click();
  await expect(page).toHaveURL('/settings/audit');
  await expect(field('Hành động')).toHaveValue('');
  await expect(field('Từ ngày')).toHaveValue(week().from);
  await expect(page.getByText('Bỏ lọc sẽ đưa về 7 ngày gần nhất.')).toHaveCount(0);
});

test('a URL the API would refuse is read as the 7 days, nothing sent on', async ({ page }) => {
  const seen = asked(page);
  await open(page, 'admin', '?actor=nobody&action=Bad&target=Team&from=2026-02-30&to=2026-03-01');
  await expect(rows(page)).toHaveCount(4);
  expect([...(seen[0]?.keys() ?? [])].sort()).toEqual(['from', 'limit', 'to']);
  await expect(page.getByText(`Đang xem từ ${dayText(week().from)}`)).toBeVisible();
});

test('no row says so with one action; a failure gives the trace and Thử lại', async ({ page }) => {
  let answer: 'empty' | 'down' | 'stub' = 'empty';
  await page.route('**/v1/audit-logs?*', (r) =>
    answer === 'empty'
      ? r.fulfill({ json: { data: [], nextCursor: null } })
      : answer === 'down'
        ? r.fulfill({
            status: 503,
            contentType: 'application/problem+json',
            body: JSON.stringify({
              status: 503,
              code: 'service_unavailable',
              traceId: 'trace-audit',
            }),
          })
        : r.fallback(),
  );
  await open(page);
  await expect(page.getByText('Chưa có hoạt động nào trong 7 ngày gần nhất.')).toBeVisible();
  await expect(page.getByRole('main').getByRole('table')).toHaveCount(0);
  await expectAccessible(page);
  answer = 'down';
  await page.getByRole('button', { name: 'Làm mới' }).click();
  const alert = page.getByRole('main').getByRole('alert');
  await expect(alert).toContainText('Mã: trace-audit');
  answer = 'stub';
  await alert.getByRole('button', { name: 'Thử lại' }).click();
  await expect(rows(page)).toHaveCount(4);
  await page.getByLabel(/^Hành động/).fill('nothing.here');
  await page.getByRole('button', { name: 'Lọc', exact: true }).click();
  await expect(page.getByText('Không có hoạt động nào khớp bộ lọc.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bỏ lọc' })).toHaveCount(2);
});

test('a Manager has no such screen: the 404 inside the frame', async ({ page }) => {
  await signIn(page, accountOf('manager'));
  const res = await page.goto('/settings/audit');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Không tìm thấy trang.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Audit log' })).toHaveCount(0);
});
