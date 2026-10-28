import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf, CONVERSATIONS } from './stub-api';

// #6 Hộp thư: Nhận, Chờ khách, Đóng (I1c), each waiting for the server; the stub copies the conversations per session.
const waiting = CONVERSATIONS[0]!; // HUMAN_WAITING_Q, nobody
const held = CONVERSATIONS[1]!; // HUMAN_ACTIVE, sales
const view = (page: Page) => page.getByRole('region', { name: 'Hội thoại', exact: true });
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
    page.getByRole('link', { name: /Nhân viên đang xử lý.* Tôi\b/ }).first(),
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
  // The 409 gives the winner's id only: its last 4 characters, never a name the Sales may not read (U30).
  await expect(view(page).getByText('Phụ trách: …ager')).toBeVisible();
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

test('an Owner assigns among those U31 lists: a refusal is said, another pick works', async ({
  page,
}) => {
  await signIn(page, accountOf('owner'));
  await page.goto(`/inbox/${held.id}`);
  await page.getByRole('button', { name: 'Gán lại' }).click();
  const dialog = page.getByRole('dialog', { name: 'Gán lại hội thoại' });
  const pick = dialog.getByLabel('Người nhận');
  // U31 (#363): the workspace has its Owner and Sales (the holder), so only the Owner, with team and load.
  await expect(pick.getByRole('option')).toHaveText([
    'Người thử owner · Owner · Sales B2B · đang giữ 0/5',
  ]);
  await expect(dialog.getByLabel('Tìm người')).toHaveCount(0); // a short list needs no search
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
    'Người thử admin · Admin · đang giữ 0/5',
    'Người thử owner · Owner · Sales B2B · đang giữ 0/5',
  ]);
  await pick.selectOption({ label: 'Người thử admin · Admin · đang giữ 0/5' });
  await dialog.getByRole('button', { name: 'Gán', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Không giao được cho người này.');
  const posted = page.waitForRequest((r) => r.url().endsWith('/assign'));
  await pick.selectOption({ label: 'Người thử owner · Owner · Sales B2B · đang giữ 0/5' });
  await dialog.getByRole('button', { name: 'Gán', exact: true }).click();
  expect((await posted).postDataJSON()).toEqual({ version: 1, toUserId: 'user-owner' });
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Phụ trách: Tôi')).toBeVisible();
});

test('a Manager assigns from U31; a conversation changed meanwhile says so and reads it again', async ({
  page,
}) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/v1/members')) asked.push(r.url());
  });
  await signIn(page, accountOf('manager+stale'));
  await page.goto(`/inbox/${held.id}`);
  await page.getByRole('button', { name: 'Gán lại' }).click();
  const dialog = page.getByRole('dialog', { name: 'Gán lại hội thoại' });
  await expect(dialog.getByLabel('Người nhận').getByRole('option')).toHaveText([
    'Người thử owner · Owner · Sales B2B · đang giữ 0/5',
  ]);
  const reread = page.waitForRequest((r) => r.url().endsWith(`/v1/conversations/${held.id}`));
  await dialog.getByRole('button', { name: 'Gán', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('vừa được người khác thay đổi');
  await expect(dialog.getByRole('alert')).toContainText('Đã tải lại');
  await reread;
  await expect(dialog).toBeVisible(); // the dialog stays open to try again with what was read
  expect(asked).toEqual([]); // a Manager never reads the members (N153)
});

test('Admin and Manager see who holds it by name, from the conversation (U30), never from the members', async ({
  page,
}) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/v1/members')) asked.push(r.url());
  });
  for (const who of ['admin', 'manager']) {
    await signIn(page, accountOf(who));
    await page.goto(`/inbox/${held.id}`);
    await expect(view(page).getByText('Phụ trách: Người thử sales')).toBeVisible();
  }
  expect(asked).toEqual([]);
});

test('a long list of recipients can be searched by name, role or team, without accents', async ({
  page,
}) => {
  await signIn(page, accountOf('owner'));
  await page.goto(`/inbox/${CONVERSATIONS[3]!.id}`); // the stub gives this one a crowd of recipients
  await page.getByRole('button', { name: 'Gán lại' }).click();
  const dialog = page.getByRole('dialog', { name: 'Gán lại hội thoại' });
  const pick = dialog.getByLabel('Người nhận');
  await expect(pick.getByRole('option')).toHaveCount(10); // Owner, Sales and the crowd of 8
  await dialog.getByLabel('Tìm người').fill('duc');
  await expect(pick.getByRole('option')).toHaveText(['Nhân viên Đức · Support · đang giữ 0/5']);
  await dialog.getByLabel('Tìm người').fill('không ai');
  await expect(dialog).toContainText('Không ai khớp "không ai".');
  await expectAccessible(page);
});
