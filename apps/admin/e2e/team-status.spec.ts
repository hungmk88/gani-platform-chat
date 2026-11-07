import { expect, test, type Page, type Route } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';
import { TEAMS } from './stub-teams';

// #20 U85 (U42, brief 122, tầng 1): "Trạng thái" of a team, each member who holds conversations, read only, on the contract planned
// for S4 (#626) served here by page.route.
const CSKH = TEAMS[0]!;
const STATUS = [
  {
    userId: '0190f000-0000-7000-8000-0000000000a1',
    name: 'Lan',
    status: 'busy',
    since: '2026-11-07T02:15:00Z',
    busyMinutesToday: 125,
  },
  {
    userId: '0190f000-0000-7000-8000-0000000000a2',
    name: null,
    status: 'offline',
    since: '2026-11-06T10:30:00Z',
    busyMinutesToday: 0,
  },
];
const problem = (status: number, code: string) => ({
  status,
  contentType: 'application/problem+json',
  body: JSON.stringify({ status, code, traceId: 'trace-u85' }),
});

/** The team's status answered by `answer` (each path kept); signs in as `role` and opens the dialog of CSKH. */
async function open(
  page: Page,
  role: 'owner' | 'manager',
  answer: (n: number) => Parameters<Route['fulfill']>[0],
) {
  const asked: string[] = [];
  await page.route(
    (u) => u.pathname.endsWith('/agent-status') && u.pathname.includes('/v1/teams/'),
    (r) => (asked.push(new URL(r.request().url()).pathname), r.fulfill(answer(asked.length))),
  );
  await signIn(page, accountOf(role));
  await page.goto('/settings/teams');
  await page.getByRole('button', { name: `Trạng thái của team ${CSKH.name}` }).click();
  return { asked, dialog: page.getByRole('dialog', { name: `Trạng thái team ${CSKH.name}` }) };
}

test('"Trạng thái" lists the members by name, their status in words and the minutes busy today', async ({
  page,
}) => {
  const { asked, dialog } = await open(page, 'owner', () => ({ json: { data: STATUS } }));
  await expect(dialog).toBeFocused(); // never on "Đóng"
  const rows = dialog.getByRole('row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveText('NgườiTrạng tháiTừ lúcBận hôm nay');
  await expect(rows.nth(1)).toHaveText('LanBận09:15 07/11/20262 giờ 5 phút');
  await expect(rows.nth(2)).toHaveText('Chưa có tênOffline17:30 06/11/20260 phút');
  expect(asked).toEqual([`/v1/teams/${CSKH.id}/agent-status`]);
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Đóng' }).click();
  await expect(dialog).toBeHidden();
});

test('a Manager opens the status of its team, its only button; an error says its trace and "Thử lại" reads again', async ({
  page,
}) => {
  const { dialog } = await open(page, 'manager', (n) =>
    n === 1 ? problem(500, 'internal_error') : { json: { data: [] } },
  );
  await expect(dialog.getByRole('alert')).toContainText('Mã: trace-u85');
  await dialog.getByRole('button', { name: 'Thử lại' }).click();
  await expect(dialog.getByText('Team chưa có người giữ hội thoại.')).toBeVisible();
  await expectAccessible(page);
});

test('while the API has no status route, the dialog says it is not there yet', async ({ page }) => {
  const { dialog } = await open(page, 'owner', () => problem(404, 'not_found'));
  await expect(dialog.getByText('Trạng thái team: chưa có trong bản hiện tại.')).toBeVisible();
  await expect(dialog.getByRole('table')).toHaveCount(0);
});
