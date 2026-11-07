import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';
import { CUSTOMERS } from './stub-customers';

// #8 Hồ sơ khách, gộp khách chỉ đọc (J3, CEO brief 153 PR A): "Khách có thể trùng" (merge-suggestions, Owner/Admin/Manager, N204)
// and "Lịch sử gộp" (merges, Owner/Admin, N206), answered here by page.route; the stub API answers none of either.
const AN = CUSTOMERS[0]!;
const isSuggestions = (u: URL) => u.pathname === `/v1/customers/${AN.id}/merge-suggestions`;
const isMerges = (u: URL) => u.pathname === `/v1/customers/${AN.id}/merges`;
const twin = (n: number, displayName: string | null, phone: string, email: string | null) => ({
  ...AN,
  id: `0190c100-0000-7000-8000-0000000000${n}`,
  displayName,
  phone,
  email,
});
const SUGGESTIONS = {
  data: [
    {
      customer: twin(51, 'An Nguyễn', '+84900000001', 'an@example.test'),
      reasons: ['phone', 'email'],
    },
    { customer: twin(52, null, '+84900000001', null), reasons: ['phone'] },
  ],
};
const MERGES = {
  data: [
    {
      id: '0190e000-0000-7000-8000-000000000001',
      sourceId: '0190c100-0000-7000-8000-000000000061',
      targetId: AN.id,
      mergedBy: { id: '0190f000-0000-7000-8000-0000000000a1', name: 'Lan' },
      mergedAt: '2026-11-07T07:05:00Z',
      unmergedAt: null,
      sourceName: 'An (Zalo cũ)',
    },
    {
      id: '0190e000-0000-7000-8000-000000000002',
      sourceId: '0190c100-0000-7000-8000-000000000062',
      targetId: AN.id,
      mergedBy: { id: '0190f000-0000-7000-8000-00000000a1b2', name: null },
      mergedAt: '2026-11-05T02:12:00Z',
      unmergedAt: '2026-11-06T03:00:00Z',
      sourceName: null,
    },
  ],
};
const section = (page: Page, name: string) => page.getByRole('region', { name });

/** Keeps every path of the merges the browser asks for. */
function asked(page: Page): string[] {
  const paths: string[] = [];
  page.on('request', (r) => {
    const p = new URL(r.url()).pathname;
    if (/\/merge-suggestions$|\/merges$/.test(p)) paths.push(p);
  });
  return paths;
}

test('an Owner reads the customers that may be the same one, and the merges into this one', async ({
  page,
}) => {
  await page.route(isSuggestions, (r) => r.fulfill({ json: SUGGESTIONS }));
  await page.route(isMerges, (r) => r.fulfill({ json: MERGES }));
  await signIn(page, accountOf('owner'));
  await page.goto(`/customers/${AN.id}`);

  const twins = section(page, 'Khách có thể trùng').getByRole('listitem');
  await expect(twins).toHaveCount(2);
  await expect(twins.nth(0)).toContainText(
    'An Nguyễn0900 000 001an@example.testTrùng SĐTTrùng email',
  );
  await expect(twins.nth(1)).toContainText('Khách chưa có tên0900 000 001Trùng SĐT');
  await expect(twins.nth(0).getByRole('link', { name: 'Xem hồ sơ An Nguyễn' })).toHaveAttribute(
    'href',
    '/customers/0190c100-0000-7000-8000-000000000051',
  );

  const merges = section(page, 'Lịch sử gộp').getByRole('listitem');
  await expect(merges).toHaveCount(2);
  await expect(merges.nth(0)).toHaveText(
    '“An (Zalo cũ)” gộp vào khách này · 14:05 07/11/2026Người gộp: LanTách… An (Zalo cũ)',
  );
  await expect(merges.nth(1)).toHaveText(
    '“Khách chưa có tên” gộp vào khách này · 09:12 05/11/2026Người gộp: …a1b2 · Đã tách 10:00 06/11/2026',
  );
  await expect(merges.nth(1).locator('abbr')).toHaveAttribute('title', 'Nhân viên chưa có tên');
  // An Owner may merge each (PR B1) and unmerge only the merge not undone yet (PR B2).
  await expect(
    section(page, 'Khách có thể trùng').getByRole('button', { name: /^Gộp…/ }),
  ).toHaveCount(2);
  await expect(page.getByRole('button', { name: /^Tách…/ })).toHaveCount(1);
  await expect(page.getByText('Không áp dụng AI ở màn này.')).toBeVisible();
  await expectAccessible(page);
});

test('a Manager sees the suggestions but not the history, and never asks for it', async ({
  page,
}) => {
  const paths = asked(page);
  await page.route(isSuggestions, (r) => r.fulfill({ json: SUGGESTIONS }));
  await signIn(page, accountOf('manager'));
  await page.goto(`/customers/${AN.id}`);
  await expect(section(page, 'Khách có thể trùng').getByRole('listitem')).toHaveCount(2);
  await expect(section(page, 'Lịch sử gộp')).toHaveCount(0);
  // Stricter than the API (N204 lets a Manager merge): no "Gộp…" (CEO brief 153 item 13, 155 item 3).
  await expect(page.getByRole('button', { name: /^Gộp…/ })).toHaveCount(0);
  expect(paths).toEqual([`/v1/customers/${AN.id}/merge-suggestions`]);
});

for (const role of ['sales', 'viewer'] as const)
  test(`a ${role} sees neither and asks for neither`, async ({ page }) => {
    const paths = asked(page);
    await signIn(page, accountOf(role));
    await page.goto(`/customers/${AN.id}`);
    await expect(page.getByRole('region', { name: 'Định danh' })).toBeVisible();
    await expect(section(page, 'Khách có thể trùng')).toHaveCount(0);
    await expect(section(page, 'Lịch sử gộp')).toHaveCount(0);
    expect(paths).toEqual([]);
  });

test('none to show says so in both', async ({ page }) => {
  await signIn(page, accountOf('admin'));
  await page.goto(`/customers/${AN.id}`);
  await expect(section(page, 'Khách có thể trùng')).toContainText(
    'Không thấy khách nào trùng SĐT hoặc email.',
  );
  await expect(section(page, 'Lịch sử gộp')).toContainText('Chưa có lần gộp nào vào khách này.');
  await expectAccessible(page);
});

test('while it loads it says so; a failure says why with its trace, and Thử lại reads again', async ({
  page,
}) => {
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  let n = 0;
  await page.route(isSuggestions, async (r) => {
    await held;
    await r.fulfill({ json: SUGGESTIONS });
  });
  await page.route(isMerges, (r) =>
    ++n === 1
      ? r.fulfill({
          status: 500,
          contentType: 'application/problem+json',
          body: JSON.stringify({ status: 500, code: 'internal_error', traceId: 'trace-merges' }),
        })
      : r.fulfill({ json: MERGES }),
  );
  await signIn(page, accountOf('owner'));
  await page.goto(`/customers/${AN.id}`);
  await expect(section(page, 'Khách có thể trùng').getByRole('status')).toHaveText(
    'Đang tìm khách có thể trùng…',
  );
  const history = section(page, 'Lịch sử gộp');
  await expect(history.getByRole('alert')).toContainText('Mã: trace-merges');
  await history.getByRole('button', { name: 'Thử lại' }).click();
  await expect(history.getByRole('listitem')).toHaveCount(2);
  release();
  await expect(section(page, 'Khách có thể trùng').getByRole('listitem')).toHaveCount(2);
});
