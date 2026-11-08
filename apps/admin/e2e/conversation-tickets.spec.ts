import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf, CONVERSATIONS } from './stub-api';
import { TICKETS } from './stub-tickets';

// #6 Hộp thư, "Ticket của hội thoại" (U53, N170; CEO brief 171 B8): GET /v1/tickets?conversationId= of the open conversation,
// newest first, by cursor, read only. The stub's tickets come from no conversation, so it answers none; the list is answered here.
const held = CONVERSATIONS[1]!; // HUMAN_ACTIVE, sales
const isMine = (u: URL) =>
  u.pathname === '/v1/tickets' && u.searchParams.get('conversationId') === held.id;
const section = (page: Page) => page.getByRole('region', { name: 'Ticket của hội thoại' });
const from = (n: number) => ({ ...TICKETS[n]!, conversationId: held.id });

test('a Manager reads the tickets made from the conversation, then the next page; each opens #15', async ({
  page,
}) => {
  const cursors: string[] = [];
  await page.route(isMine, (r) => {
    const cursor = new URL(r.request().url()).searchParams.get('cursor');
    cursors.push(cursor ?? '');
    return r.fulfill({
      json: cursor
        ? { data: [from(2)], nextCursor: null }
        : { data: [from(0), from(1)], nextCursor: 'p2' },
    });
  });
  await signIn(page, accountOf('manager'));
  await page.goto(`/inbox/${held.id}`);
  const items = section(page).getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0).getByRole('link', { name: TICKETS[0]!.title })).toHaveAttribute(
    'href',
    `/tickets/${TICKETS[0]!.id}`,
  );
  // TICKETS[0]: new, urgent, nobody on it.
  await expect(items.nth(0)).toContainText('MớiƯu tiên: KhẩnPhụ trách: Chưa giao');
  await expectAccessible(page);
  await section(page).getByRole('button', { name: 'Tải thêm ticket' }).click();
  await expect(items).toHaveCount(3);
  await expect(section(page).getByRole('button', { name: 'Tải thêm ticket' })).toHaveCount(0);
  expect(cursors).toEqual(['', 'p2']);
});

test('none yet says so', async ({ page }) => {
  await signIn(page, accountOf('sales'));
  await page.goto(`/inbox/${held.id}`);
  await expect(section(page)).toContainText('Chưa có ticket nào cho hội thoại này.');
});

test('while they load it says so; a failure says why with its trace, and Thử lại reads again', async ({
  page,
}) => {
  let release = () => {};
  const gate = new Promise<void>((r) => (release = r));
  let n = 0;
  await page.route(isMine, async (r) => {
    if (++n === 1) {
      await gate;
      return r.fulfill({
        status: 500,
        contentType: 'application/problem+json',
        body: JSON.stringify({ status: 500, code: 'internal_error', traceId: 'trace-tickets' }),
      });
    }
    return r.fulfill({ json: { data: [from(0)], nextCursor: null } });
  });
  // A Manager reads every conversation (Support would see only theirs or the unclaimed ones, not this one).
  await signIn(page, accountOf('manager'));
  await page.goto(`/inbox/${held.id}`);
  await expect(section(page).getByRole('status')).toHaveText('Đang tải ticket…');
  release();
  await expect(section(page).getByRole('alert')).toContainText('Mã: trace-tickets');
  await section(page).getByRole('button', { name: 'Thử lại' }).click();
  await expect(section(page).getByRole('listitem')).toHaveCount(1);
  await expectAccessible(page);
});
