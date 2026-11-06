import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';

// #30 Platform (PR 30a, CEO 05/11, brief 79): the platform operator reads the health of the companies and the channel policies,
// two routes planned for S5 (#610) served here by page.route; "Phiên truy cập": e2e/platform-access.spec.ts. Any other role: 404.
type Answer = { json: unknown } | { status: number; contentType: string; body: string };
const json = (body: unknown): Answer => ({ json: body });
const problem = (status: number, code: string, traceId: string): Answer => ({
  status,
  contentType: 'application/problem+json',
  body: JSON.stringify({ status, code, traceId }),
});
const company = (n: number, soon: number, expired: number) => ({
  orgId: `0190f000-0000-7000-8000-00000000000${n}`,
  slug: `cong-ty-${n}`,
  name: `Công ty ${n}`,
  channels: { total: 2, tokenExpiringSoon: soon, tokenExpired: expired },
  aiCostMonthVnd: null,
});
const POLICY = {
  id: '0190f100-0000-7000-8000-000000000001',
  channelType: 'zalo_oa',
  messageClass: 'advisory',
  effectiveFrom: '2023-06-19T17:00:00Z',
  freeWindowSeconds: 172800,
  freeMessageQuota: 8,
  unitPriceVnd: null,
  outsideWindowAllowed: false,
  sourceUrl: 'https://oa.zalo.me/thong-bao',
  sourceDate: '2023-06-20',
  note: '',
};
const rows = (page: Page, region: string) =>
  page.getByRole('region', { name: region }).getByRole('table').getByRole('row');
const menuItem = (page: Page) =>
  page.getByRole('navigation', { name: 'Menu chính' }).getByRole('link', { name: 'Platform' });

/** The first page of the companies, or the second when a cursor is sent; the policies. */
async function serve(page: Page, health: Answer[], policies: Answer) {
  await page.route('**/v1/platform/tenants/health*', (r) =>
    r.fulfill(health[new URL(r.request().url()).searchParams.get('cursor') ? 1 : 0]),
  );
  await page.route('**/v1/channel-policies', (r) => r.fulfill(policies));
}

test('the operator reads the companies page by page, each once, then the channel policies', async ({
  page,
}) => {
  await serve(
    page,
    [
      json({ data: [company(1, 0, 0), company(2, 1, 0)], nextCursor: 'c2' }),
      json({ data: [company(2, 1, 0), company(3, 0, 2)], nextCursor: null }),
    ],
    json({
      data: [
        POLICY,
        { ...POLICY, id: 'p2', sourceUrl: 'javascript:alert(1)', unitPriceVnd: 1500, note: 'Tạm' },
      ],
    }),
  );
  await signIn(page, accountOf('platform_operator'));
  await expect(page).toHaveURL('/platform');
  await expect(page.getByRole('link', { name: 'Sức khỏe công ty' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(rows(page, 'Sức khỏe công ty').nth(0)).toHaveText(
    /^Công tyKênhToken hết hạn trong 24 giờToken đã hết hạnChi phí AI tháng$/,
  );
  await expect(rows(page, 'Sức khỏe công ty').nth(2)).toHaveText('Công ty 2 cong-ty-2210Chưa tính');
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Tải thêm' }).click();
  await expect(rows(page, 'Sức khỏe công ty')).toHaveCount(4); // header + 3 companies: "Công ty 2" once
  await expect(rows(page, 'Sức khỏe công ty').nth(3)).toHaveText('Công ty 3 cong-ty-3202Chưa tính');
  await expect(page.getByText('Đã hiện hết.')).toBeVisible();

  await page.getByRole('link', { name: 'Chính sách kênh' }).click();
  await expect(rows(page, 'Chính sách kênh').nth(1)).toHaveText(
    'Zalo OATư vấn48 giờ, 8 tinKhông được gửi—20/06/2023oa.zalo.me (20/06/2023)—Thêm phiên bản…',
  );
  await expect(page.getByRole('link', { name: 'oa.zalo.me' })).toHaveAttribute(
    'rel',
    'noopener noreferrer',
  );
  // Not an https URL: shown as text, never a link.
  await expect(rows(page, 'Chính sách kênh').nth(2)).toContainText(
    '1.500 đ/tin20/06/2023javascript:alert(1)',
  );
  await expect(page.getByRole('link', { name: /javascript/ })).toHaveCount(0);
  await expect(page.getByText('Không áp dụng AI ở màn này.')).toBeVisible();
  await expectAccessible(page);
});

test('a 404 is one line in its tab; an error says why, then nothing in force', async ({ page }) => {
  await serve(
    page,
    [problem(404, 'not_found', 'trace-404')],
    problem(500, 'internal_error', 'trace-500'),
  );
  await signIn(page, accountOf('platform_operator'));
  await expect(page.getByText('Sức khỏe công ty: chưa có trong bản hiện tại.')).toBeVisible();
  await page.goto('/platform?tab=access');
  await expect(page.getByText('Phiên truy cập: chưa có trong bản hiện tại.')).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('link', { name: 'Chính sách kênh' }).click();
  const alert = page.getByRole('region', { name: 'Chính sách kênh' }).getByRole('alert');
  await expect(alert).toContainText('Mã: trace-500');
  await expectAccessible(page);
  await page.unroute('**/v1/channel-policies');
  await page.route('**/v1/channel-policies', (r) => r.fulfill(json({ data: [] })));
  await alert.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByText('Chưa có chính sách kênh nào đang hiệu lực.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Làm mới' })).toBeVisible();
});

test('an Owner has no Platform: not in the menu, the 404 inside the frame', async ({ page }) => {
  await signIn(page, accountOf('owner'));
  await expect(menuItem(page)).toHaveCount(0);
  const res = await page.goto('/platform');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Không tìm thấy trang.' })).toBeVisible();
  // The same selector finds the item for the operator (#401).
  await signIn(page, accountOf('platform_operator'));
  await expect(menuItem(page)).toBeVisible();
});
