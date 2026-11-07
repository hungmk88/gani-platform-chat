import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf, CONVERSATIONS } from './stub-api';

// #6 Hộp thư, ghi chú nội bộ (C6, N194; CEO brief 169 P1a): GET …/notes, answered here by page.route (the stub API answers none).
// Whoever sees the conversation reads them, newest first, by pages; Sales and Support their own and the unclaimed ones.
const waiting = CONVERSATIONS[0]!; // HUMAN_WAITING_Q, nobody
const held = CONVERSATIONS[1]!; // HUMAN_ACTIVE, sales
const isNotes = (u: URL) => /^\/v1\/conversations\/[^/]+\/notes$/.test(u.pathname);
const notes = (page: Page) => page.getByRole('region', { name: 'Ghi chú nội bộ' });
const more = (page: Page) => notes(page).getByRole('button', { name: 'Tải ghi chú cũ hơn' });
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

/** Answers FIRST, then SECOND for its cursor; keeps the path of every page asked. */
async function serve(page: Page) {
  const asked: string[] = [];
  await page.route(isNotes, (r) => {
    const u = new URL(r.request().url());
    asked.push(`${u.pathname}${u.search}`);
    return r.fulfill({ json: u.searchParams.get('cursor') ? SECOND : FIRST });
  });
  return asked;
}

test('sales reads the notes of the conversation they hold, newest first, then the older page', async ({
  page,
}) => {
  const asked = await serve(page);
  await signIn(page, accountOf('sales'));
  await page.goto(`/inbox/${held.id}`);
  const items = notes(page).getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toHaveText('Hùng · 10:05 07/11/2026Khách hẹn gọi lại chiều nay.');
  await expect(items.nth(1)).toHaveText(
    '…a1b2 · 09:05 07/11/2026 · Lý do chuyểnKhách muốn người phụ trách miền Nam.',
  );
  await expect(items.nth(1).locator('abbr')).toHaveAttribute('title', 'Nhân viên chưa có tên');
  await expectAccessible(page);
  await more(page).click();
  await expect(items).toHaveCount(3);
  // Their own note says "Bạn"; what was written is shown as these characters, never as HTML.
  await expect(items.nth(2)).toHaveText('Bạn · 08:05 07/11/2026<b>Không phải HTML</b>');
  await expect(more(page)).toHaveCount(0);
  expect(asked).toEqual([
    `/v1/conversations/${held.id}/notes`,
    `/v1/conversations/${held.id}/notes?cursor=p2`,
  ]);
});

for (const [role, c] of [
  ['sales', waiting],
  ['manager', held],
] as const)
  test(`a ${role} reads the notes of a conversation they do not hold`, async ({ page }) => {
    await serve(page);
    await signIn(page, accountOf(role));
    await page.goto(`/inbox/${c.id}`);
    await expect(notes(page).getByRole('listitem')).toHaveCount(2);
    await expect(notes(page)).toContainText('Chỉ nhân viên thấy, khách không thấy.');
  });

test('none yet says so; a failure to read says why with its trace, and Thử lại reads again', async ({
  page,
}) => {
  let n = 0;
  await page.route(isNotes, (r) =>
    ++n === 1
      ? r.fulfill({
          status: 500,
          contentType: 'application/problem+json',
          body: JSON.stringify({ status: 500, code: 'internal_error', traceId: 'trace-notes' }),
        })
      : r.fulfill({ json: { data: [], nextCursor: null } }),
  );
  await signIn(page, accountOf('sales'));
  await page.goto(`/inbox/${held.id}`);
  await expect(notes(page).getByRole('alert')).toContainText('Mã: trace-notes');
  await notes(page).getByRole('button', { name: 'Thử lại' }).click();
  await expect(notes(page)).toContainText('Chưa có ghi chú nào.');
  await expectAccessible(page);
});

test('while the notes load it says so', async ({ page }) => {
  let release = () => {};
  const gate = new Promise<void>((r) => (release = r));
  await page.route(isNotes, async (r) => {
    await gate;
    await r.fulfill({ json: FIRST });
  });
  await signIn(page, accountOf('sales'));
  await page.goto(`/inbox/${held.id}`);
  await expect(notes(page).getByRole('status')).toHaveText('Đang tải ghi chú…');
  release();
  await expect(notes(page).getByRole('listitem')).toHaveCount(2);
});
