import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf, CONVERSATIONS, STUB_PAGE } from './stub-api';

// #6 Hộp thư: the reply box (I2, N146). Sending is optimistic: the message shows at once, the API's answer replaces it.
const waiting = CONVERSATIONS[0]!; // HUMAN_WAITING_Q, nobody
const held = CONVERSATIONS[1]!; // HUMAN_ACTIVE, sales
const view = (page: Page) => page.getByRole('region', { name: 'Hội thoại' });
const box = (page: Page) => page.getByRole('textbox', { name: /Soạn tin trả lời/ });
const claim = (page: Page) =>
  view(page)
    .getByRole('group', { name: 'Thao tác' })
    .getByRole('button', { name: 'Nhận', exact: true });
const messages = (page: Page) => view(page).getByRole('list', { name: 'Tin nhắn' });

test('sales answers the conversation they hold: shown at once, then waiting to be sent', async ({
  page,
}) => {
  await signIn(page, accountOf('sales'));
  await page.goto(`/inbox/${held.id}`);
  let release = () => {};
  const gate = new Promise<void>((r) => (release = r));
  await page.route('**/messages', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await gate;
    return route.fallback();
  });
  await box(page).fill('  Dạ em gửi báo giá trong hôm nay ạ.  ');
  const posted = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/messages'));
  await box(page).press('Control+Enter');
  const request = await posted;
  expect(request.headers()['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  expect(request.postDataJSON()).toEqual({ text: 'Dạ em gửi báo giá trong hôm nay ạ.' });
  const mine = messages(page)
    .getByRole('listitem')
    .filter({ hasText: 'Dạ em gửi báo giá trong hôm nay ạ.' });
  await expect(mine).toContainText('Đang gửi…');
  await expect(box(page)).toHaveValue('');
  release();
  await expect(mine).toContainText('Chờ gửi');
  await expect(mine).toHaveCount(1);
  await expectAccessible(page);
});

test('a closed channel window keeps the draft and says why; nothing is added', async ({ page }) => {
  await signIn(page, accountOf('sales+window'));
  await page.goto(`/inbox/${held.id}`);
  // The first page of the stub's messages (STUB_PAGE): wait for it, a count read before it loads would be 0.
  const shown = messages(page).getByRole('listitem');
  await expect(shown).toHaveCount(STUB_PAGE);
  await box(page).fill('Anh ơi còn cần hàng không ạ?');
  await page.getByRole('button', { name: 'Gửi' }).click();
  const alert = page.getByRole('form', { name: 'Trả lời khách' }).getByRole('alert');
  await expect(alert).toContainText('Đã hết khung gửi tin của kênh');
  await expect(alert).toContainText('Đã quá thời hạn trả lời miễn phí');
  await expect(alert).toContainText('Mã: trace-e2e-window');
  await expect(box(page)).toHaveValue('Anh ơi còn cần hàng không ạ?');
  await expect(shown).toHaveCount(STUB_PAGE);
});

test('an empty text is not sent, and R goes to the box', async ({ page }) => {
  await signIn(page, accountOf('manager'));
  await page.goto(`/inbox/${held.id}`);
  await page.locator('body').press('r');
  await expect(box(page)).toBeFocused();
  await box(page).fill('   ');
  await page.getByRole('button', { name: 'Gửi' }).click();
  await expect(page.getByText('Nhập nội dung tin.')).toBeVisible();
});

test('no box before the conversation is claimed; it comes with the claim', async ({ page }) => {
  await signIn(page, accountOf('sales'));
  await page.goto(`/inbox/${waiting.id}`);
  await expect(claim(page)).toBeVisible();
  await expect(page.getByRole('form', { name: 'Trả lời khách' })).toHaveCount(0);
  await claim(page).click();
  await expect(box(page)).toBeVisible();
});
