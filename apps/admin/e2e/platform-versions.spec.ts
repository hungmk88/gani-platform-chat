import { expect, test, type Page, type Route } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';

// #30 U80 (brief B-U80, tầng 1): "Phiên bản" of a channel policy, every version read only, on the contract planned for S5 (#617)
// served here by page.route.
const POLICY = {
  id: '0190f100-0000-7000-8000-000000000001',
  channelType: 'zalo_oa',
  messageClass: 'advisory',
  effectiveFrom: '2023-06-19T17:00:00Z',
  freeWindowSeconds: 172800,
  freeMessageQuota: 8,
  unitPriceVnd: null,
  outsideWindowAllowed: false,
  sourceUrl: null,
  sourceDate: null,
  note: 'Theo thông báo Zalo',
};
const version = (v: object) => ({
  ...POLICY,
  effectiveTo: null,
  createdAt: '2026-11-05T03:00:00Z',
  ...v,
});
const VERSIONS = [
  version({
    id: 'v3',
    effectiveFrom: '2029-12-31T17:00:00Z',
    state: 'scheduled',
    createdBy: 'user-platform_operator',
  }),
  version({
    id: 'v2',
    effectiveTo: '2029-12-31T17:00:00Z',
    state: 'in_force',
    createdBy: '0190f000-0000-7000-8000-0000000000aa',
  }),
  version({
    id: 'v1',
    effectiveFrom: '2020-01-01T00:00:00Z',
    effectiveTo: POLICY.effectiveFrom,
    state: 'past',
    createdBy: null,
  }),
];
const problem = (status: number, code: string) => ({
  status,
  contentType: 'application/problem+json',
  body: JSON.stringify({ status, code, traceId: 'trace-u80' }),
});

/** The policies, and the versions answered by `answer` (each path kept); opens the dialog. */
async function open(page: Page, answer: (n: number) => Parameters<Route['fulfill']>[0]) {
  const asked: string[] = [];
  await page.route('**/v1/channel-policies', (r) => r.fulfill({ json: { data: [POLICY] } }));
  await page.route(
    (u) => u.pathname.endsWith('/versions'),
    (r) => (asked.push(new URL(r.request().url()).pathname), r.fulfill(answer(asked.length))),
  );
  await signIn(page, accountOf('platform_operator'));
  await page.goto('/platform?tab=policies');
  await page.getByRole('button', { name: 'Phiên bản của Zalo OA · Tư vấn' }).click();
  return { asked, dialog: page.getByRole('dialog', { name: 'Phiên bản chính sách kênh' }) };
}

test('"Phiên bản" lists every version, latest first, its state in words and who added it', async ({
  page,
}) => {
  const { asked, dialog } = await open(page, () => ({ json: { data: VERSIONS } }));
  await expect(dialog).toBeFocused(); // never on "Đóng"
  await expect(dialog.getByRole('table')).toBeVisible();
  const rows = dialog.getByRole('row');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toHaveText(/^Trạng tháiÁp dụng từĐếnNgười tạoTạo lúc$/);
  await expect(rows.nth(1)).toHaveText('Đã đặt lịch00:00 01/01/2030—Bạn10:00 05/11/2026');
  await expect(rows.nth(2)).toHaveText(
    'Đang áp dụng00:00 20/06/202300:00 01/01/2030Người khác10:00 05/11/2026',
  );
  await expect(rows.nth(3)).toHaveText(
    'Đã qua07:00 01/01/202000:00 20/06/2023Hệ thống10:00 05/11/2026',
  );
  await expect(dialog.getByText('Tới ngày đó bảng vẫn hiện phiên bản đang dùng.')).toBeVisible();
  expect(asked).toEqual(['/v1/channel-policies/zalo_oa/advisory/versions']);
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Đóng' }).click();
  await expect(dialog).toBeHidden();
});

test('an error says its trace and "Thử lại" reads again; an empty list says so', async ({
  page,
}) => {
  const { dialog } = await open(page, (n) =>
    n === 1 ? problem(500, 'internal_error') : { json: { data: [] } },
  );
  await expect(dialog.getByRole('alert')).toContainText('Mã: trace-u80');
  await dialog.getByRole('button', { name: 'Thử lại' }).click();
  await expect(dialog.getByText('Chưa có phiên bản.')).toBeVisible();
  await expect(dialog.getByText('Tới ngày đó bảng vẫn hiện phiên bản đang dùng.')).toHaveCount(0);
  await expectAccessible(page);
});

test('while the API has no versions route, the dialog says it is not there yet', async ({
  page,
}) => {
  const { dialog } = await open(page, () => problem(404, 'not_found'));
  await expect(dialog.getByText('Phiên bản: chưa có trong bản hiện tại.')).toBeVisible();
  await expect(dialog.getByRole('table')).toHaveCount(0);
});
