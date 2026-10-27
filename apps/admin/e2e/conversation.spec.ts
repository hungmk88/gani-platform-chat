import { expect, test } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf, CONVERSATIONS, HOSTILE } from './stub-api';

// #6 Hộp thư, the open conversation (I1b), against conversation #2 of the stub (held by sales, five messages).
const held = CONVERSATIONS[1]!;

test('a row opens its conversation beside the list, keeping the filter', async ({ page }) => {
  await signIn(page, accountOf('sales'));
  await page.goto('/inbox?assignee=me');
  await expect(page.getByText('Chọn một hội thoại trong danh sách để xem.')).toBeVisible();
  await page.getByRole('link', { name: /Nhân viên đang xử lý/ }).click();
  await expect(page).toHaveURL(`/inbox/${held.id}?assignee=me`);
  await expect(page.getByRole('link', { name: /Nhân viên đang xử lý/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const view = page.getByRole('region', { name: 'Hội thoại', exact: true });
  await expect(view.getByRole('heading', { name: 'Nhân viên đang xử lý' })).toBeVisible();
  await expect(view.getByText('Phụ trách: Tôi')).toBeVisible();
  await expectAccessible(page);
});

test('messages read in the order they were sent, older ones on demand', async ({ page }) => {
  await signIn(page, accountOf('sales'));
  await page.goto(`/inbox/${held.id}`);
  const messages = page.getByRole('list', { name: 'Tin nhắn' }).getByRole('listitem');
  await expect(messages).toHaveCount(3);
  await page.getByRole('button', { name: 'Tải tin cũ hơn' }).click();
  await expect(messages).toHaveCount(5);
  await expect(page.getByRole('button', { name: 'Tải tin cũ hơn' })).toHaveCount(0);
  const senders = await messages.evaluateAll((items) =>
    items.map((i) => i.textContent?.split(' · ')[0]),
  );
  expect(senders).toEqual(['Khách', 'Bot', 'Tôi', 'Khách', 'Khách']);
  await expect(messages.nth(3)).toContainText('Gửi lúc 02:05, tới sau.');
});

test('T2: what a customer sends is shown as text and runs nothing', async ({ page }) => {
  await signIn(page, accountOf('manager'));
  await page.goto(`/inbox/${held.id}`);
  // In the messages, and on the list row as its last message (U30): both as these characters.
  await expect(
    page.getByRole('list', { name: 'Tin nhắn' }).getByText(HOSTILE, { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Danh sách hội thoại' })).toContainText(HOSTILE);
  expect(await page.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined();
  await expect(
    page.locator('section[aria-label*="ội thoại"] img, section[aria-label*="ội thoại"] strong'),
  ).toHaveCount(0);
  await expectAccessible(page);
});

test('a conversation one may not see is not found, like one that does not exist', async ({
  page,
}) => {
  await signIn(page, accountOf('sales'));
  for (const id of [CONVERSATIONS[3]!.id, '0190a000-0000-7000-8000-000000000099']) {
    await page.goto(`/inbox/${id}`);
    await expect(page.getByText('Không tìm thấy hội thoại.', { exact: false })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Về danh sách' })).toHaveAttribute(
      'href',
      '/inbox',
    );
  }
});
