import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf, CONVERSATIONS } from './stub-api';

// #6 Hộp thư: Nhận, Chờ khách, Đóng (I1c), each waiting for the server; the stub copies the conversations per session.
const waiting = CONVERSATIONS[0]!; // HUMAN_WAITING_Q, nobody
const held = CONVERSATIONS[1]!; // HUMAN_ACTIVE, sales
const view = (page: Page) => page.getByRole('region', { name: 'Hội thoại' });
const actions = (page: Page) =>
  view(page).getByRole('group', { name: 'Thao tác' }).getByRole('button');

test('claim from the queue, then the conversation is mine in the view and the list', async ({
  page,
}) => {
  await signIn(page, accountOf('sales'));
  await page.goto(`/inbox/${waiting.id}`);
  await expect(actions(page)).toHaveText(['Nhận']);
  const posted = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/claim'));
  await actions(page).first().click();
  expect((await posted).headers()['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  await expect(view(page).getByRole('heading', { name: 'Nhân viên đang xử lý' })).toBeVisible();
  await expect(view(page).getByText('Phụ trách: Tôi')).toBeVisible();
  await expect(actions(page)).toHaveText(['Chờ khách', 'Đóng']);
  await expect(
    page.getByRole('link', { name: /Nhân viên đang xử lý\s*Tôi/ }).first(),
  ).toBeVisible();
});

test('wait for the customer, then close with an outcome in one click of the dialog', async ({
  page,
}) => {
  await signIn(page, accountOf('sales'));
  await page.goto(`/inbox/${held.id}`);
  await actions(page).filter({ hasText: 'Chờ khách' }).click();
  await expect(view(page).getByRole('heading', { name: 'Chờ khách trả lời' })).toBeVisible();
  await expect(actions(page)).toHaveText(['Đóng']);
  await actions(page).click();
  const dialog = page.getByRole('dialog', { name: 'Đóng hội thoại — chọn kết quả' });
  await expect(dialog).toBeVisible();
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Đã xong' }).click();
  await expect(dialog).toBeHidden();
  await expect(view(page).getByRole('heading', { name: 'Đã đóng' })).toBeVisible();
  await expect(view(page).getByRole('group', { name: 'Thao tác' })).toHaveCount(0);
});

test('shortcuts: A claims, E opens the close dialog, Escape cancels it', async ({ page }) => {
  await signIn(page, accountOf('support'));
  await page.goto(`/inbox/${waiting.id}`);
  await expect(actions(page)).toHaveText(['Nhận']);
  await page.keyboard.press('a');
  await expect(view(page).getByText('Phụ trách: Tôi')).toBeVisible();
  await page.keyboard.press('e');
  const dialog = page.getByRole('dialog', { name: 'Đóng hội thoại — chọn kết quả' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(view(page).getByRole('heading', { name: 'Nhân viên đang xử lý' })).toBeVisible();
});

test('a lost claim says so and shows who holds it now', async ({ page }) => {
  await signIn(page, accountOf('sales+claimed'));
  await page.goto(`/inbox/${waiting.id}`);
  await actions(page).click();
  await expect(view(page).getByRole('alert')).toContainText('Hội thoại đã có người nhận.');
  await expect(view(page).getByText('Phụ trách: Người khác')).toBeVisible();
  await expect(view(page).getByRole('group', { name: 'Thao tác' })).toHaveCount(0);
  await expectAccessible(page);
});

test('a stale version is refused with its sentence and nothing changes', async ({ page }) => {
  await signIn(page, accountOf('manager+stale'));
  await page.goto(`/inbox/${held.id}`);
  await expect(actions(page)).toHaveText(['Chờ khách', 'Đóng']);
  await actions(page).filter({ hasText: 'Chờ khách' }).click();
  await expect(view(page).getByRole('alert')).toContainText(
    'Dữ liệu vừa được người khác thay đổi.',
  );
  await expect(view(page).getByRole('heading', { name: 'Nhân viên đang xử lý' })).toBeVisible();
});

test('an Owner assigns among the people of the workspace: a refusal is said, another pick works', async ({
  page,
}) => {
  await signIn(page, accountOf('owner'));
  await page.goto(`/inbox/${held.id}`);
  await page.getByRole('button', { name: 'Gán lại' }).click();
  const dialog = page.getByRole('dialog', { name: 'Gán lại hội thoại' });
  const pick = dialog.getByLabel('Người nhận');
  // The workspace has its Owner and Sales (the holder): the Admin of the company is not offered.
  await expect(pick.getByRole('option')).toHaveText(['Người thử owner (Owner)']);
  await expect(dialog).toContainText('Chỉ hiện người thuộc workspace của hội thoại.');
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Hủy' }).click();

  // Once in the workspace the Admin is offered; the stub still refuses them (422), as the API would for one it cannot take.
  await page.goto('/settings/workspace');
  await page.getByRole('button', { name: 'Người trong workspace Workspace thử' }).click();
  const people = page.getByRole('dialog', { name: /Người trong workspace/ });
  await people.getByRole('checkbox', { name: /Người thử admin/ }).check();
  await people.getByRole('button', { name: 'Lưu người trong workspace' }).click();
  await expect(people).toBeHidden();
  await page.goto(`/inbox/${held.id}`);
  await page.getByRole('button', { name: 'Gán lại' }).click();
  await expect(pick.getByRole('option')).toHaveText([
    'Người thử owner (Owner)',
    'Người thử admin (Admin)',
  ]);
  await pick.selectOption({ label: 'Người thử admin (Admin)' });
  await dialog.getByRole('button', { name: 'Gán', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Không chuyển được cho người này.');
  const posted = page.waitForRequest((r) => r.url().endsWith('/assign'));
  await pick.selectOption({ label: 'Người thử owner (Owner)' });
  await dialog.getByRole('button', { name: 'Gán', exact: true }).click();
  expect((await posted).postDataJSON()).toEqual({ version: 1, toUserId: 'user-owner' });
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Phụ trách: Tôi')).toBeVisible();
});

test('a Manager has no "Gán lại" until the list of recipients (U31)', async ({ page }) => {
  await signIn(page, accountOf('manager'));
  await page.goto(`/inbox/${held.id}`);
  await expect(page.getByText(/Phụ trách:/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Gán lại' })).toHaveCount(0);
});

test('an Admin sees who holds it by name, from the members', async ({ page }) => {
  await signIn(page, accountOf('admin'));
  await page.goto(`/inbox/${held.id}`);
  await expect(view(page).getByText('Phụ trách: Người thử sales')).toBeVisible();
});

test('a Manager, who cannot read the members, sees it in words (U30)', async ({ page }) => {
  await signIn(page, accountOf('manager'));
  await page.goto(`/inbox/${held.id}`);
  await expect(view(page).getByText('Phụ trách: Người khác')).toBeVisible();
});
