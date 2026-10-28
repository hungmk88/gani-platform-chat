import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf, CONVERSATIONS } from './stub-api';

// #376 "Chuyển" (T15): the dialog it shares with "Gán lại", its list from U31 (purpose=transfer), T to open it; a Sales/Support
// who hands their conversation on goes back to the list, saying to whom.
const waiting = CONVERSATIONS[0]!; // HUMAN_WAITING_Q, nobody
const held = CONVERSATIONS[1]!; // HUMAN_ACTIVE, sales
const view = (page: Page) => page.getByRole('region', { name: 'Hội thoại', exact: true });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Chuyển hội thoại' });

test('a Manager transfers a held conversation and stays on it, with the new holder by name', async ({
  page,
}) => {
  await signIn(page, accountOf('manager'));
  await page.goto(`/inbox/${held.id}`);
  const posted = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/transfer'));
  await view(page).getByRole('button', { name: 'Chuyển' }).click();
  await expect(dialog(page).getByLabel('Người nhận').getByRole('option')).toHaveText([
    'Người thử owner · Owner · Sales B2B · đang giữ 0/5',
  ]);
  await expectAccessible(page);
  await dialog(page).getByRole('button', { name: 'Chuyển', exact: true }).click();
  const req = await posted;
  expect(req.postDataJSON()).toEqual({ version: 1, toUserId: 'user-owner' });
  expect(req.headers()['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  await expect(dialog(page)).toBeHidden();
  await expect(page).toHaveURL(`/inbox/${held.id}`);
  await expect(view(page).getByText('Phụ trách: Người thử owner')).toBeVisible();
});

test('a Sales opens "Chuyển" with T, hands their conversation to a teammate and is back on the list', async ({
  page,
}) => {
  await signIn(page, accountOf('sales'));
  await page.goto(`/inbox/${held.id}`);
  await expect(view(page).getByRole('button', { name: 'Chuyển' })).toBeVisible();
  await page.keyboard.press('t');
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Chuyển', exact: true }).click();
  await expect(page).toHaveURL('/inbox');
  const notice = page.getByRole('region', { name: 'Danh sách hội thoại' }).getByRole('status');
  await expect(notice).toHaveText(/Đã chuyển hội thoại cho Người thử owner\./);
  await expectAccessible(page);
  await notice.getByRole('button', { name: 'Đóng' }).click();
  await expect(notice).toHaveCount(0);
});

test('a conversation changed meanwhile says so, is read again, and only then can be sent', async ({
  page,
}) => {
  await signIn(page, accountOf('manager+stale'));
  await page.goto(`/inbox/${held.id}`);
  await view(page).getByRole('button', { name: 'Chuyển' }).click();
  const reread = page.waitForResponse((r) => r.url().endsWith(`/v1/conversations/${held.id}`));
  await dialog(page).getByRole('button', { name: 'Chuyển', exact: true }).click();
  await expect(dialog(page).getByRole('alert')).toContainText('vừa được người khác thay đổi');
  await reread;
  await expect(dialog(page).getByRole('button', { name: 'Chuyển', exact: true })).toBeEnabled();
});

test('a conversation still in the queue has "Nhận" and "Gán lại", not "Chuyển"', async ({
  page,
}) => {
  await signIn(page, accountOf('manager'));
  await page.goto(`/inbox/${waiting.id}`);
  await expect(view(page).getByRole('button', { name: 'Gán lại' })).toBeVisible();
  await expect(view(page).getByRole('button', { name: 'Chuyển' })).toHaveCount(0);
  await page.keyboard.press('t');
  await expect(dialog(page)).toHaveCount(0);
});
