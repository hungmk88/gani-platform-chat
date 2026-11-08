import { expect, test, type Page, type Request } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf, CONVERSATIONS } from './stub-api';

// "Chuyển" with a reason (N199, `TransferBody.reason?`; CEO brief 170 A): optional, ≤ 500, blank sends no `reason`; the API keeps it
// as an internal note of the conversation, so the notes are read again. "Gán lại" takes no reason (the API answers 400).
const held = CONVERSATIONS[1]!; // HUMAN_ACTIVE, sales
const view = (page: Page) => page.getByRole('region', { name: 'Hội thoại', exact: true });
const dialog = (page: Page, name = 'Chuyển hội thoại') => page.getByRole('dialog', { name });
const reason = (page: Page) => dialog(page).getByRole('textbox', { name: /^Lý do/ });
const send = (page: Page) => dialog(page).getByRole('button', { name: 'Chuyển', exact: true });

/** Keeps every POST …/transfer, and counts the GETs of the notes. */
function watch(page: Page) {
  const posts: Request[] = [];
  const notes = { reads: 0 };
  page.on('request', (r) => {
    const p = new URL(r.url()).pathname;
    if (r.method() === 'POST' && p.endsWith('/transfer')) posts.push(r);
    if (r.method() === 'GET' && p === `/v1/conversations/${held.id}/notes`) notes.reads++;
  });
  return { posts, notes };
}

test('a Manager hands the conversation on with a reason: sent trimmed, and the notes are read again', async ({
  page,
}) => {
  const { posts, notes } = watch(page);
  await signIn(page, accountOf('manager'));
  await page.goto(`/inbox/${held.id}`);
  await view(page).getByRole('button', { name: 'Chuyển' }).click();
  await expect(reason(page)).toHaveValue('');
  await expectAccessible(page);
  await reason(page).fill('  Khách cần người phụ trách miền Nam.  ');
  await expect.poll(() => notes.reads).toBeGreaterThan(0);
  const before = notes.reads;
  await send(page).click();
  await expect(dialog(page)).toBeHidden();
  expect(posts.map((p) => p.postDataJSON() as unknown)).toEqual([
    { version: 1, toUserId: 'user-owner', reason: 'Khách cần người phụ trách miền Nam.' },
  ]);
  await expect.poll(() => notes.reads).toBeGreaterThan(before);
});

test('a reason too long is said and nothing is sent; blank spaces send no reason', async ({
  page,
}) => {
  const { posts } = watch(page);
  await signIn(page, accountOf('manager'));
  await page.goto(`/inbox/${held.id}`);
  await view(page).getByRole('button', { name: 'Chuyển' }).click();
  await reason(page).fill('a'.repeat(501));
  await send(page).click();
  await expect(dialog(page).getByRole('alert')).toHaveText('Lý do dài quá 500 ký tự.');
  await expect(reason(page)).toHaveAttribute('aria-invalid', 'true');
  expect(posts).toHaveLength(0);
  await reason(page).fill('   ');
  await send(page).click();
  await expect(dialog(page)).toBeHidden();
  expect(posts.map((p) => p.postDataJSON() as unknown)).toEqual([
    { version: 1, toUserId: 'user-owner' },
  ]);
});

test('sending again after a failure keeps the key for the same reason, a new reason gets a new key', async ({
  page,
}) => {
  let n = 0;
  await page.route(
    (u) => u.pathname === `/v1/conversations/${held.id}/transfer`,
    (r) =>
      ++n < 3
        ? r.fulfill({
            status: 500,
            contentType: 'application/problem+json',
            body: JSON.stringify({
              status: 500,
              code: 'internal_error',
              traceId: 'trace-transfer',
            }),
          })
        : r.fallback(),
  );
  const { posts } = watch(page);
  await signIn(page, accountOf('manager'));
  await page.goto(`/inbox/${held.id}`);
  await view(page).getByRole('button', { name: 'Chuyển' }).click();
  await reason(page).fill('Khách hỏi giá sỉ.');
  await send(page).click();
  await expect(dialog(page).getByRole('alert')).toContainText('Mã: trace-transfer');
  await send(page).click();
  await expect.poll(() => posts.length).toBe(2);
  await reason(page).fill('Khách hỏi giá sỉ, cần Sales B2B.');
  await send(page).click();
  await expect(dialog(page)).toBeHidden();
  const keys = posts.map((p) => p.headers()['idempotency-key']);
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[0]);
});

test('"Gán lại" has no reason; "Chuyển" has one (the same selector finds it)', async ({ page }) => {
  await signIn(page, accountOf('manager'));
  await page.goto(`/inbox/${held.id}`);
  await view(page).getByRole('button', { name: 'Gán lại' }).click();
  await expect(dialog(page, 'Gán lại hội thoại')).toBeVisible();
  await expect(
    dialog(page, 'Gán lại hội thoại').getByRole('textbox', { name: /^Lý do/ }),
  ).toHaveCount(0);
  await dialog(page, 'Gán lại hội thoại').getByRole('button', { name: 'Hủy' }).click();
  await view(page).getByRole('button', { name: 'Chuyển' }).click();
  await expect(reason(page)).toHaveCount(1);
});
