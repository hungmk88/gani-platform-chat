import { expect, test, type Page, type Request, type Route } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf, CONVERSATIONS } from './stub-api';

// #6 Hộp thư, thêm ghi chú nội bộ (C6, N194; CEO brief 169 P1b): POST …/notes (and the GET), answered here by page.route. A lead
// writes on any conversation they see, Sales and Support on the one they hold. Adding is optimistic. Reading: inbox-notes.spec.ts.
const waiting = CONVERSATIONS[0]!; // HUMAN_WAITING_Q, nobody
const held = CONVERSATIONS[1]!; // HUMAN_ACTIVE, sales
const isNotes = (u: URL) => /^\/v1\/conversations\/[^/]+\/notes$/.test(u.pathname);
const notes = (page: Page) => page.getByRole('region', { name: 'Ghi chú nội bộ' });
const box = (page: Page) => notes(page).getByRole('textbox', { name: /Ghi chú mới/ });
const add = (page: Page) => notes(page).getByRole('button', { name: 'Thêm ghi chú' });
const note = (
  n: number,
  body: string,
  author: { id: string; name: string | null },
  kind = 'note',
) => ({
  id: `0190c000-0000-7000-8000-00000000000${n}`,
  conversationId: held.id,
  kind,
  author,
  body,
  createdAt: `2026-11-07T0${n}:05:00Z`,
});
const FIRST = {
  data: [
    note(3, 'Khách hẹn gọi lại chiều nay.', { id: 'user-manager', name: 'Hùng' }),
    note(
      2,
      'Khách muốn người phụ trách miền Nam.',
      { id: '0190f000-0000-7000-8000-00000000a1b2', name: null },
      'transfer_reason',
    ),
  ],
  nextCursor: 'p2',
};
const SECOND = {
  data: [note(1, '<b>Không phải HTML</b>', { id: 'user-sales', name: 'Bình' })],
  nextCursor: null,
};
const problem = (status: number, code: string) => ({
  status,
  contentType: 'application/problem+json',
  body: JSON.stringify({ status, code, traceId: `trace-${code}` }),
});

/** GET answers FIRST then SECOND by cursor; each POST is kept and answered by `answer(n, body)`. */
async function serve(
  page: Page,
  answer: (n: number, body: string) => Parameters<Route['fulfill']>[0],
) {
  const posts: Request[] = [];
  await page.route(isNotes, async (r) => {
    if (r.request().method() !== 'POST')
      return r.fulfill({
        json: new URL(r.request().url()).searchParams.get('cursor') ? SECOND : FIRST,
      });
    posts.push(r.request());
    const { body } = r.request().postDataJSON() as { body: string };
    return r.fulfill(answer(posts.length, body));
  });
  return posts;
}
const created = (body: string) => ({
  status: 201,
  json: { ...note(9, body, { id: 'user-sales', name: 'Bình' }), createdAt: '2026-11-07T09:30:00Z' },
});

test('sales reads the notes of the conversation they hold, newest first, and adds one: shown at once, then saved', async ({
  page,
}) => {
  let release = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const posts = await serve(page, (_, body) => created(body));
  await page.route(isNotes, async (r) => {
    if (r.request().method() === 'POST') await gate;
    return r.fallback();
  });
  await signIn(page, accountOf('sales'));
  await page.goto(`/inbox/${held.id}`);
  const items = notes(page).getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toHaveText('Hùng · 10:05 07/11/2026Khách hẹn gọi lại chiều nay.');
  await expect(items.nth(1)).toHaveText(
    '…a1b2 · 09:05 07/11/2026 · Lý do chuyểnKhách muốn người phụ trách miền Nam.',
  );
  await expect(items.nth(1).locator('abbr')).toHaveAttribute('title', 'Nhân viên chưa có tên');
  await notes(page).getByRole('button', { name: 'Tải ghi chú cũ hơn' }).click();
  await expect(items).toHaveCount(3);
  await expect(items.nth(2)).toHaveText('Bạn · 08:05 07/11/2026<b>Không phải HTML</b>');
  await expect(notes(page).getByRole('button', { name: 'Tải ghi chú cũ hơn' })).toHaveCount(0);

  // N goes to the box (not while typing elsewhere).
  await page.getByRole('heading', { name: 'Ghi chú nội bộ' }).click();
  await page.keyboard.press('n');
  await expect(box(page)).toBeFocused();
  await box(page).fill('  Đã gửi báo giá qua Zalo.  ');
  await box(page).press('Control+Enter');
  const mine = items.filter({ hasText: 'Đã gửi báo giá qua Zalo.' });
  await expect(mine).toContainText('Bạn ·');
  await expect(mine).toContainText('Đang lưu…');
  await expect(box(page)).toHaveValue('');
  await expect(items.first()).toContainText('Đã gửi báo giá qua Zalo.');
  release();
  await expect(mine).not.toContainText('Đang lưu…');
  await expect(mine).toHaveCount(1);
  expect(posts).toHaveLength(1);
  expect(posts[0]!.postDataJSON()).toEqual({ body: 'Đã gửi báo giá qua Zalo.' });
  expect(posts[0]!.headers()['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  await expectAccessible(page);
});

test('a refused note is taken back, the text returns, and sending it again keeps the key', async ({
  page,
}) => {
  const posts = await serve(page, (n, body) =>
    n === 1 ? problem(500, 'internal_error') : created(body),
  );
  await signIn(page, accountOf('sales'));
  await page.goto(`/inbox/${held.id}`);
  await expect(notes(page).getByRole('listitem')).toHaveCount(2);
  await box(page).fill('Gọi lại lúc 15:00');
  await add(page).click();
  await expect(notes(page).getByRole('alert')).toContainText('Mã: trace-internal_error');
  await expect(box(page)).toHaveValue('Gọi lại lúc 15:00');
  await expect(notes(page).getByRole('listitem')).toHaveCount(2);
  await add(page).click();
  await expect(notes(page).getByRole('listitem').first()).toContainText('Gọi lại lúc 15:00');
  await expect(notes(page).getByRole('alert')).toHaveCount(0);
  expect(posts.map((p) => p.headers()['idempotency-key'])).toEqual([
    posts[0]!.headers()['idempotency-key'],
    posts[0]!.headers()['idempotency-key'],
  ]);
});

test('nothing typed is not sent', async ({ page }) => {
  const posts = await serve(page, (_, body) => created(body));
  await signIn(page, accountOf('manager'));
  await page.goto(`/inbox/${held.id}`);
  await box(page).fill('   ');
  await add(page).click();
  await expect(notes(page).getByRole('alert')).toHaveText('Nhập nội dung ghi chú.');
  await expect(box(page)).toHaveAttribute('aria-invalid', 'true');
  expect(posts).toHaveLength(0);
});

test('a lead writes on a conversation someone else holds', async ({ page }) => {
  await serve(page, (_, body) => created(body));
  await signIn(page, accountOf('manager'));
  await page.goto(`/inbox/${held.id}`);
  await expect(notes(page).getByRole('listitem')).toHaveCount(2);
  await expect(box(page)).toBeVisible();
  // The same selectors as the case without the box below find it here (#401).
  await expect(notes(page).getByRole('form')).toHaveCount(1);
  await expect(page.locator('#note-box')).toHaveCount(1);
});

test('sales reads the notes of an unclaimed conversation but writes nothing there', async ({
  page,
}) => {
  await serve(page, (_, body) => created(body));
  await signIn(page, accountOf('sales'));
  await page.goto(`/inbox/${waiting.id}`);
  await expect(notes(page).getByRole('listitem')).toHaveCount(2);
  await expect(notes(page).getByRole('form')).toHaveCount(0);
  await page.getByRole('heading', { name: 'Ghi chú nội bộ' }).click();
  await page.keyboard.press('n');
  await expect(page.locator('#note-box')).toHaveCount(0);
});

// No longer holding it (403) or gone (404): the note is taken back, its text returns, and the conversation is read again (T3).
for (const [status, code] of [
  [403, 'forbidden'],
  [404, 'not_found'],
] as const) {
  test(`a note refused with ${status} gives its text back and reads the conversation again (E2E brief 184 T3)`, async ({
    page,
  }) => {
    await serve(page, () => problem(status, code));
    await signIn(page, accountOf('sales'));
    await page.goto(`/inbox/${held.id}`);
    await expect(notes(page).getByRole('listitem')).toHaveCount(2);
    let reads = 0;
    page.on('request', (r) => {
      if (r.method() === 'GET' && new URL(r.url()).pathname === `/v1/conversations/${held.id}`)
        reads++;
    });
    await box(page).fill('Gọi lại lúc 15:00');
    await add(page).click();
    await expect(notes(page).getByRole('alert')).toContainText(`Mã: trace-${code}`);
    await expect(box(page)).toHaveValue('Gọi lại lúc 15:00');
    await expect(notes(page).getByRole('listitem')).toHaveCount(2);
    await expect.poll(() => reads).toBeGreaterThan(0);
  });
}
