import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf, CONVERSATIONS } from './stub-api';

// #6 Hộp thư in real time (I1b-2): the stub's Socket.IO /agent plays the worker (apps/admin/e2e/stub-api.ts, /__e2e/*).
const held = CONVERSATIONS[1]!;
/** Acts on this browser's own session of the stub (its cookie), so tests running side by side stay apart. */
async function lever(page: Page, name: string, data: object = {}) {
  const sid = (await page.context().cookies()).find((c) => c.name === 'e2e_session')?.value;
  await page.request.post(`http://localhost:3000/__e2e/${name}`, { data: { ...data, sid } });
}

/** Opens the held conversation and resolves once the browser has asked the socket to follow it. */
async function open(page: Page, email: string, sent: string[] = []) {
  const followed = new Promise<void>((done) =>
    page.on('websocket', (ws) =>
      ws.on('framesent', ({ payload }) => {
        sent.push(String(payload));
        if (/conversation\.subscribe|"resume"/.test(String(payload))) done();
      }),
    ),
  );
  await signIn(page, email);
  await page.goto(`/inbox/${held.id}`);
  await expect(page.getByRole('list', { name: 'Tin nhắn' }).getByRole('listitem')).toHaveCount(3);
  await followed;
}

test('a new message and a change of state show without reloading', async ({ page }) => {
  const email = accountOf('manager+live1');
  await open(page, email);
  await lever(page, 'message', { conversationId: held.id, body: 'Khách vừa nhắn thêm.' });
  await expect(page.getByText('Khách vừa nhắn thêm.')).toBeVisible();
  await lever(page, 'state', { conversationId: held.id, to: 'PENDING_CUSTOMER' });
  const view = page.getByRole('region', { name: 'Hội thoại' });
  await expect(view.getByRole('heading', { name: 'Chờ khách trả lời' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Chờ khách trả lời/ }).first()).toBeVisible();
});

test('after a dropped connection, resume brings the message sent meanwhile', async ({ page }) => {
  const email = accountOf('manager+live2');
  await open(page, email);
  await lever(page, 'drop');
  await lever(page, 'message', { conversationId: held.id, body: 'Gửi lúc mất kết nối.' });
  await expect(page.getByText('Gửi lúc mất kết nối.')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Đã nối lại.')).toBeVisible();
  await expectAccessible(page);
});

test('T3: the browser never names a room, only the conversation it opened', async ({ page }) => {
  const sent: string[] = [];
  await open(page, accountOf('sales+live3'), sent);
  // Open another row inside the app: leaving the conversation unsubscribes from it.
  await page
    .getByRole('link', { name: /Chờ khách trả lời/ })
    .first()
    .click();
  await expect.poll(() => sent.some((f) => f.includes('conversation.unsubscribe'))).toBe(true);
  const events = sent.flatMap((f) => [...f.matchAll(/^\d+\/agent,\d*\["([^"]+)",(\{[^}]*\})/g)]);
  expect(events.map((m) => m[1])).toContain('conversation.unsubscribe');
  for (const [, name, args] of events) {
    expect(['conversation.subscribe', 'conversation.unsubscribe', 'resume']).toContain(name);
    expect(Object.keys(JSON.parse(args ?? '{}') as object).sort()).toEqual(
      name === 'resume' ? ['conversationId', 'lastSequenceNumber'] : ['conversationId'],
    );
  }
  expect(sent.join('\n')).not.toMatch(/conv:|ws:|user:|org:|"room"/);
});

test('a session ended by the server goes back to sign-in', async ({ page }) => {
  const email = accountOf('sales+live4');
  await open(page, email);
  await lever(page, 'end');
  await expect(page).toHaveURL('/login');
});
