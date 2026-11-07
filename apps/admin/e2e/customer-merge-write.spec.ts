import { expect, test, type Page, type Request } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';
import { CUSTOMERS } from './stub-customers';

// "Gộp khách" (J3 PR B1, tầng 3; CEO brief 153, 155): POST /v1/customers/merge from a suggestion of #8, Owner/Admin only, typed GOP,
// one Idempotency-Key per dialog, no self-merge. The suggestions and the merge are answered here (page.route).
const AN = CUSTOMERS[0]!;
const TWIN = {
  ...AN,
  id: '0190c100-0000-7000-8000-000000000051',
  displayName: 'An Nguyễn',
  email: 'an2@example.test',
};
const isSuggestions = (u: URL) => u.pathname === `/v1/customers/${AN.id}/merge-suggestions`;
const isMerge = (u: URL) => u.pathname === '/v1/customers/merge';
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Gộp khách' });
const mergeButton = (page: Page) => dialog(page).getByRole('button', { name: 'Gộp khách' });

/** The suggestions answer `twin`; each POST of the merge is kept and answered by `answer(n)`. */
async function serve(
  page: Page,
  answer: (n: number) => Parameters<import('@playwright/test').Route['fulfill']>[0],
  twin: typeof AN = TWIN,
) {
  const posts: Request[] = [];
  await page.route(isSuggestions, (r) =>
    r.fulfill({ json: { data: [{ customer: twin, reasons: ['phone'] }] } }),
  );
  await page.route(isMerge, (r) => (posts.push(r.request()), r.fulfill(answer(posts.length))));
  return posts;
}
const merged = (target: typeof AN) => ({
  json: { merge: { id: 'm1', sourceId: 's', targetId: target.id, mergedAt: 't' }, target },
});
const problem = (status: number, code: string) => ({
  status,
  contentType: 'application/problem+json',
  body: JSON.stringify({ status, code, traceId: `trace-${code}` }),
});
async function open(page: Page, role: 'owner' | 'admin' = 'owner') {
  await signIn(page, accountOf(role));
  await page.goto(`/customers/${AN.id}`);
  await page.getByRole('button', { name: /^Gộp…/ }).click();
  await expect(dialog(page)).toBeVisible();
}

test('an Owner merges the suggested twin into this customer: GOP unlocks, one POST, the profile reads again', async ({
  page,
}) => {
  const posts = await serve(page, (n) => (n === 1 ? problem(500, 'internal_error') : merged(AN)));
  const reads: string[] = [];
  page.on('request', (r) => {
    const p = new URL(r.url()).pathname;
    if (r.method() === 'GET' && p.startsWith(`/v1/customers/${AN.id}`)) reads.push(p);
  });
  await open(page);
  // Kept by default: the one being viewed; the preview fills only what it lacks.
  await expect(dialog(page).getByRole('radio', { name: 'Nguyễn Văn An (đang xem)' })).toBeChecked();
  await expect(dialog(page).getByRole('row', { name: /^Email/ })).toHaveText(
    'Emailan@example.testan2@example.testan@example.test',
  );
  await expect(dialog(page).getByRole('textbox')).toBeFocused();
  await expectAccessible(page);

  await expect(mergeButton(page)).toBeDisabled();
  await dialog(page).getByRole('textbox').fill('go');
  await expect(mergeButton(page)).toBeDisabled();
  await dialog(page).getByRole('textbox').fill(' gop ');
  await mergeButton(page).click();
  // A failure says it is safe to try again, with the same key.
  await expect(dialog(page).getByRole('alert')).toContainText('không gộp hai lần');
  await expect(dialog(page).getByRole('alert')).toBeFocused();
  const before = reads.length;
  await dialog(page).getByRole('button', { name: 'Thử lại' }).click();
  await expect(dialog(page).getByRole('status')).toHaveText(
    'Đã gộp "An Nguyễn" vào "Nguyễn Văn An".',
  );
  expect(posts).toHaveLength(2);
  expect(posts.map((p) => p.postDataJSON() as unknown)).toEqual([
    { sourceId: TWIN.id, targetId: AN.id },
    { sourceId: TWIN.id, targetId: AN.id },
  ]);
  const keys = posts.map((p) => p.headers()['idempotency-key']);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  // Read again after the merge: the profile, its suggestions (and, for an Owner, its merges).
  const again = ['', '/merge-suggestions', '/merges'].map((p) => `/v1/customers/${AN.id}${p}`);
  await expect.poll(() => [...new Set(reads.slice(before))].sort()).toEqual(again);
  await dialog(page).getByRole('button', { name: 'Đóng' }).click();
  await expect(page).toHaveURL(`/customers/${AN.id}`);
  await expect(page.getByRole('button', { name: /^Gộp…/ })).toBeFocused();
});

test('keeping the twin merges this one away: after closing, its profile opens', async ({
  page,
}) => {
  const posts = await serve(page, () => merged(TWIN));
  await page.route(
    (u) => u.pathname === `/v1/customers/${TWIN.id}`,
    (r) => r.fulfill({ json: TWIN }),
  );
  await open(page, 'admin');
  await dialog(page).getByRole('radio', { name: 'An Nguyễn' }).check();
  await dialog(page).getByRole('textbox').fill('GOP');
  await mergeButton(page).click();
  await expect(dialog(page).getByRole('status')).toContainText('Đã gộp');
  expect(posts[0]?.postDataJSON()).toEqual({ sourceId: AN.id, targetId: TWIN.id });
  await dialog(page).getByRole('button', { name: 'Đóng' }).click();
  await expect(page).toHaveURL(`/customers/${TWIN.id}`);
  await expect(page.getByRole('heading', { name: 'An Nguyễn', level: 1 })).toBeVisible();
});

test('the same customer on both sides is refused before sending (CEO brief 155 item 6)', async ({
  page,
}) => {
  const posts = await serve(page, () => merged(AN), AN);
  await open(page);
  await expect(dialog(page).getByRole('alert')).toHaveText('Phải chọn hai khách khác nhau.');
  await dialog(page).getByRole('textbox').fill('GOP');
  await expect(mergeButton(page)).toBeDisabled();
  await mergeButton(page).click({ force: true });
  expect(posts).toHaveLength(0);
});

test('a customer gone meanwhile (404) leaves only "Đóng" and reads the suggestions again', async ({
  page,
}) => {
  await serve(page, () => problem(404, 'not_found'));
  await open(page);
  let again = 0;
  page.on('request', (r) => {
    if (isSuggestions(new URL(r.url()))) again++;
  });
  await dialog(page).getByRole('textbox').fill('gop');
  await mergeButton(page).click();
  await expect(dialog(page).getByRole('alert')).toContainText(
    'Một trong hai khách không còn (đã gộp hoặc đã xóa).',
  );
  await expect(dialog(page).getByRole('alert')).toContainText('Mã: trace-not_found');
  await expect(mergeButton(page)).toHaveCount(0);
  await expect.poll(() => again).toBeGreaterThan(0);
  await expectAccessible(page);
});
