import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf, CONVERSATIONS, HOSTILE } from './stub-api';

// #358 "Tạo ticket" from the open conversation: the conversation and its customer go with the ticket, the title starts from
// what the customer last wrote (newest page only, plain text), the assignee field is the two stages of #357, and a closed
// conversation keeps the button on purpose.
const view = (page: Page) => page.getByRole('region', { name: 'Hội thoại', exact: true });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Tạo ticket' });
const posted = (page: Page) =>
  page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/v1/tickets'));

test("a Sales makes a ticket from the conversation they hold, its title from the customer's last words", async ({
  page,
}) => {
  await signIn(page, accountOf('sales'));
  const c = CONVERSATIONS[1]!;
  await page.goto(`/inbox/${c.id}`);
  await view(page).getByRole('button', { name: 'Tạo ticket' }).click();
  await expect(dialog(page)).toContainText('Từ hội thoại với Khách chưa có tên');
  // The customer's last text, as characters: nothing in it runs (T2).
  await expect(dialog(page).getByLabel('Tiêu đề')).toHaveValue(HOSTILE);
  await expect(dialog(page).getByLabel('Người nhận')).toHaveCount(0);
  await expectAccessible(page);
  const request = posted(page);
  await dialog(page).getByRole('button', { name: 'Tạo ticket' }).click();
  const body = (await request).postDataJSON() as Record<string, unknown>;
  expect(body['conversationId']).toBe(c.id);
  expect(body['workspaceId']).toBe(c.workspaceId);
  expect('customerId' in body).toBe(false); // no customer yet: left out, never null
  const screen = page.getByRole('region', { name: 'Chi tiết ticket' });
  await expect(screen.getByRole('heading', { level: 1 })).toHaveText(HOSTILE);
  await expect(screen).toContainText('Không gắn khách');
  await expect(screen.getByRole('link', { name: 'Mở trong Hộp thư' })).toHaveAttribute(
    'href',
    `/inbox/${c.id}`,
  );
  expect(await page.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined();
  // A closed conversation keeps the button: a ticket is often what is left once it is over.
  await page.goto(`/inbox/${CONVERSATIONS[5]!.id}`);
  await expect(view(page).getByRole('button', { name: 'Tạo ticket' })).toBeVisible();
});

test('an Owner makes one for a named customer, picks who gets it, and the title waits to be typed', async ({
  page,
}) => {
  await signIn(page, accountOf('owner'));
  const c = CONVERSATIONS[0]!;
  await page.goto(`/inbox/${c.id}`);
  await view(page).getByRole('button', { name: 'Tạo ticket' }).click();
  await expect(dialog(page)).toContainText('Từ hội thoại với Nguyễn Văn An');
  await expect(dialog(page).getByLabel('Tiêu đề')).toHaveValue(''); // no text from the customer on the newest page
  await dialog(page).getByLabel('Tiêu đề').fill('Khách cần đổi lịch giao');
  await dialog(page).getByLabel('Người nhận').selectOption('user-owner');
  const request = posted(page);
  await dialog(page).getByRole('button', { name: 'Tạo ticket' }).click();
  const body = (await request).postDataJSON() as Record<string, unknown>;
  expect(body['customerId']).toBe(c.customer!.id);
  expect(body['conversationId']).toBe(c.id);
  const screen = page.getByRole('region', { name: 'Chi tiết ticket' });
  await expect(screen.getByRole('link', { name: 'Nguyễn Văn An' })).toBeVisible();
  await expect(screen).toContainText('Người thử owner');
});

test('a 404 from the conversation says the conversation or its customer is gone, and keeps the form', async ({
  page,
}) => {
  // The conversation was handed to someone else while the Sales wrote: the API answers 404 (this test only, page.route).
  await page.route('**/v1/tickets', (r) =>
    r.request().method() === 'POST'
      ? r.fulfill({
          status: 404,
          contentType: 'application/problem+json',
          body: JSON.stringify({ status: 404, code: 'not_found', traceId: 'trace-gone' }),
        })
      : r.fallback(),
  );
  const generic = (page: Page) =>
    dialog(page).getByText('Không tìm thấy. Có thể đã bị xóa hoặc thuộc công ty khác.');
  await signIn(page, accountOf('sales'));
  // From the list with no customer, a 404 keeps the sentence of the API: the selector below finds it when it is there.
  await page.goto('/tickets');
  await page.getByRole('button', { name: 'Tạo ticket' }).click();
  await dialog(page).getByLabel('Tiêu đề').fill('Khách hỏi lại đơn');
  await dialog(page).getByRole('button', { name: 'Tạo ticket' }).click();
  await expect(generic(page)).toBeVisible();

  await page.goto(`/inbox/${CONVERSATIONS[1]!.id}`);
  await view(page).getByRole('button', { name: 'Tạo ticket' }).click();
  await dialog(page).getByRole('button', { name: 'Tạo ticket' }).click();
  const alert = dialog(page).getByRole('alert');
  await expect(alert).toContainText(
    'Không tạo được: hội thoại hoặc khách của hội thoại không còn thấy được (có thể đã chuyển cho người khác). Ticket chưa tạo, nội dung vẫn ở đây.',
  );
  await expect(alert).toContainText('trace-gone');
  await expect(generic(page)).toHaveCount(0);
  // Nothing is dropped, the dialog stays open: the person closes it.
  await expect(dialog(page).getByLabel('Tiêu đề')).toHaveValue(HOSTILE);
  await expect(dialog(page)).toContainText('Từ hội thoại với Khách chưa có tên');
  await expectAccessible(page);
});
