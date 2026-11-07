import { expect, test, type Page, type Request } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';
import { CUSTOMERS } from './stub-customers';

// "Tách khách" (J3 PR B2, tầng 3; CEO brief 153, 155): POST /v1/customers/{sourceId}/unmerge from a line of "Lịch sử gộp" not undone
// yet, Owner/Admin only, a checkbox confirms, one Idempotency-Key per dialog. History, suggestions and the unmerge answered here.
const AN = CUSTOMERS[0]!;
const SOURCE = '0190c100-0000-7000-8000-000000000061';
const entry = (unmergedAt: string | null) => ({
  id: '0190e000-0000-7000-8000-000000000001',
  sourceId: SOURCE,
  targetId: AN.id,
  mergedBy: { id: '0190f000-0000-7000-8000-0000000000a1', name: 'Lan' },
  mergedAt: '2026-11-07T07:05:00Z',
  unmergedAt,
  sourceName: 'An (Zalo cũ)',
});
const isMerges = (u: URL) => u.pathname === `/v1/customers/${AN.id}/merges`;
const isUnmerge = (u: URL) => u.pathname === `/v1/customers/${SOURCE}/unmerge`;
const dialog = (page: Page) => page.getByRole('dialog', { name: /^Tách “An \(Zalo cũ\)”/ });
const unmergeButton = (page: Page) => dialog(page).getByRole('button', { name: 'Tách khách' });
const problem = (status: number, code: string) => ({
  status,
  contentType: 'application/problem+json',
  body: JSON.stringify({ status, code, traceId: `trace-${code}` }),
});

/** The history answers one merge, undone once a POST succeeded; each POST is kept and answered by `answer(n)`. */
async function serve(page: Page, answer: (n: number) => { status: number; body?: string }) {
  const posts: Request[] = [];
  let undone = false;
  await page.route(isMerges, (r) =>
    r.fulfill({ json: { data: [entry(undone ? '2026-11-07T10:00:00Z' : null)] } }),
  );
  await page.route(isUnmerge, (r) => {
    posts.push(r.request());
    const a = answer(posts.length);
    undone ||= a.status === 200;
    return r.fulfill(
      a.status === 200 ? { json: { merge: entry('t'), source: AN, target: AN } } : a,
    );
  });
  await signIn(page, accountOf('owner'));
  await page.goto(`/customers/${AN.id}`);
  await page.getByRole('button', { name: /^Tách…/ }).click();
  await expect(dialog(page)).toBeVisible();
  return posts;
}

test('an Owner unmerges after ticking the box: one key kept by Thử lại, the history reads again', async ({
  page,
}) => {
  const reads: string[] = [];
  page.on('request', (r) => {
    const p = new URL(r.url()).pathname;
    if (r.method() === 'GET' && p.startsWith(`/v1/customers/${AN.id}`)) reads.push(p);
  });
  const posts = await serve(page, (n) =>
    n === 1 ? problem(500, 'internal_error') : { status: 200 },
  );
  await expect(dialog(page)).toContainText('Các dòng đã chuyển lúc gộp (14:05 07/11/2026)');
  await expect(dialog(page).getByRole('checkbox')).toBeFocused();
  await expect(unmergeButton(page)).toBeDisabled();
  await expectAccessible(page);
  await dialog(page).getByRole('checkbox').check();
  await unmergeButton(page).click();
  await expect(dialog(page).getByRole('alert')).toContainText('không tách hai lần');
  const before = reads.length;
  await dialog(page).getByRole('button', { name: 'Thử lại' }).click();
  await expect(dialog(page).getByRole('status')).toContainText('Đã tách “An (Zalo cũ)”.');
  await expect(
    dialog(page).getByRole('link', { name: 'Xem hồ sơ “An (Zalo cũ)”' }),
  ).toHaveAttribute('href', `/customers/${SOURCE}`);
  const keys = posts.map((p) => p.headers()['idempotency-key']);
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  const again = ['', '/merge-suggestions', '/merges'].map((p) => `/v1/customers/${AN.id}${p}`);
  await expect.poll(() => [...new Set(reads.slice(before))].sort()).toEqual(again);
  await dialog(page).getByRole('button', { name: 'Đóng' }).click();
  // The line is undone now: no "Tách…" left, the history says so, focus on its heading.
  const history = page.getByRole('region', { name: 'Lịch sử gộp' });
  await expect(history).toContainText('Đã tách 17:00 07/11/2026');
  await expect(page.getByRole('button', { name: /^Tách…/ })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Lịch sử gộp' })).toBeFocused();
});

test('its target merged in turn (409 target_merged): says to unmerge that first, only "Đóng" left', async ({
  page,
}) => {
  await serve(page, () => problem(409, 'target_merged'));
  await dialog(page).getByRole('checkbox').check();
  await unmergeButton(page).click();
  await expect(dialog(page).getByRole('alert')).toContainText(
    'Khách này đã được gộp tiếp vào khách khác. Tách lần gộp đó trước.',
  );
  await expect(unmergeButton(page)).toHaveCount(0);
  await expectAccessible(page);
});

test('already undone (409 not_merged): says so and reads the history again', async ({ page }) => {
  await serve(page, () => problem(409, 'not_merged'));
  let again = 0;
  page.on('request', (r) => {
    if (isMerges(new URL(r.url()))) again++;
  });
  await dialog(page).getByRole('checkbox').check();
  await unmergeButton(page).click();
  await expect(dialog(page).getByRole('alert')).toContainText('Lần gộp này đã được tách trước đó.');
  await expect.poll(() => again).toBeGreaterThan(0);
});
