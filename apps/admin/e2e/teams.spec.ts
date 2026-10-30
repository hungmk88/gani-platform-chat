import { expect, test } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';
import { CHANNELS } from './stub-channels';
import { MEMBERS } from './stub-members';
import { TEAMS } from './stub-teams';

// #20 Team (N160): the teams of the workspace being worked in, making one (one Idempotency-Key per name and description),
// changing one, picking its people and its channels, ending one.
test('an Admin sees the teams of the workspace and makes one: the slug is the API one', async ({
  page,
}) => {
  await signIn(page, accountOf('admin'));
  await page.goto('/settings/teams');
  await expect(page.getByRole('heading', { name: 'Team', exact: true })).toBeVisible();
  const list = page.getByRole('region', { name: 'Team của workspace' });
  await expect(list.getByRole('row')).toHaveCount(1 + TEAMS.length);
  await expect(list.getByRole('row', { name: /Sales B2B/ })).toContainText('Mặc định');
  await expect(list.getByRole('row', { name: /CSKH/ })).toContainText('Sau bán hàng, khiếu nại');
  await expectAccessible(page);

  const form = page.getByRole('form', { name: 'Tạo team' });
  await form.getByRole('button', { name: 'Tạo team' }).click();
  await expect(form.getByRole('alert')).toHaveText('Nhập tên team.');
  await form.getByLabel('Tên team').fill('  Đại lý miền Nam ');
  await form.getByLabel(/Mô tả/).fill('  ');
  const posted = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/v1/teams'));
  await form.getByRole('button', { name: 'Tạo team' }).click();
  const req = await posted;
  expect(req.postDataJSON()).toEqual({ workspaceId: 'ws-e2e', name: 'Đại lý miền Nam' });
  expect(req.headers()['idempotency-key']).toBeTruthy();
  await expect(form.getByRole('status')).toHaveText(
    'Đã tạo team Đại lý miền Nam (mã dai-ly-mien-nam).',
  );
  await expect(form.getByLabel('Tên team')).toHaveValue('');
  await expect(list.getByRole('row')).toHaveCount(2 + TEAMS.length);
  await expect(list.getByRole('row').nth(2)).toContainText('Đại lý miền Nam');
});

test('an Owner changes a team, makes it the default, then ends the old default', async ({
  page,
}) => {
  await signIn(page, accountOf('owner'));
  await page.goto('/settings/teams');
  const list = page.getByRole('region', { name: 'Team của workspace' });
  await expect(list.getByRole('button', { name: 'Kết thúc team Sales B2B' })).toHaveCount(0); // the default stays

  await list.getByRole('button', { name: 'Sửa team CSKH' }).click();
  const dialog = page.getByRole('dialog', { name: /Sửa team/ });
  await dialog.getByLabel('Tên team').fill(' Chăm sóc khách ');
  await dialog.getByLabel(/Mô tả/).fill('  ');
  await dialog.getByLabel(/Team mặc định của workspace/).check();
  await expectAccessible(page);
  const patched = page.waitForRequest((r) => r.method() === 'PATCH');
  await dialog.getByRole('button', { name: 'Lưu' }).click();
  expect((await patched).postDataJSON()).toEqual({
    name: 'Chăm sóc khách',
    description: null,
    isDefault: true,
  });
  await expect(dialog).toBeHidden();
  await expect(list.getByRole('status')).toHaveText('Đã lưu team Chăm sóc khách.');
  await expect(list.getByRole('row', { name: /Chăm sóc khách/ })).toContainText('Mặc định');
  await expect(list.getByRole('row', { name: /Sales B2B/ })).not.toContainText('Mặc định');

  await list.getByRole('button', { name: 'Kết thúc team Sales B2B' }).click();
  const end = page.getByRole('dialog', { name: /Kết thúc team Sales B2B/ });
  await expect(end).toContainText('2 người rời team này.');
  await expectAccessible(page);
  const deleted = page.waitForRequest((r) => r.method() === 'DELETE');
  await end.getByRole('button', { name: 'Kết thúc team' }).click();
  expect((await deleted).url()).toMatch(new RegExp(`/v1/teams/${TEAMS[1]!.id}$`));
  await expect(end).toBeHidden();
  await expect(list.getByRole('status')).toHaveText('Đã kết thúc team Sales B2B.');
  await expect(list.getByRole('row')).toHaveCount(2);

  let sent = false;
  page.on('request', (r) => {
    if (r.method() === 'PATCH') sent = true;
  });
  await list.getByRole('button', { name: 'Sửa team Chăm sóc khách' }).click();
  await expect(dialog.getByLabel(/Team mặc định của workspace/)).toBeDisabled();
  await dialog.getByRole('button', { name: 'Lưu' }).click();
  await expect(dialog).toBeHidden();
  expect(sent).toBe(false); // nothing changed
});

test('an Admin picks the people of a team among those of its workspace; the whole list is sent', async ({
  page,
}) => {
  await signIn(page, accountOf('admin'));
  await page.goto('/settings/teams');
  const list = page.getByRole('region', { name: 'Team của workspace' });
  await list.getByRole('button', { name: 'Người của team CSKH' }).click();
  const dialog = page.getByRole('dialog', { name: /Người của team/ });
  // `ws-e2e` has the Owner and Sales only: the Admin, not in it, cannot be picked.
  await expect(dialog.getByRole('checkbox')).toHaveCount(2);
  await expect(dialog.getByRole('checkbox').first()).toBeFocused(); // the keyboard starts on the list, not on "Hủy"
  await expect(dialog.getByRole('checkbox', { name: /Người thử sales/ })).toBeChecked();
  const owner = dialog.getByRole('checkbox', { name: /Người thử owner/ });
  await expect(owner).not.toBeChecked();
  await owner.check();
  await expectAccessible(page);
  const put = page.waitForRequest((r) => r.method() === 'PUT');
  await dialog.getByRole('button', { name: 'Lưu người của team' }).click();
  const { memberIds } = (await put).postDataJSON() as { memberIds: string[] };
  expect(memberIds.sort()).toEqual([MEMBERS[0]!.id, MEMBERS[2]!.id].sort());
  await expect(dialog).toBeHidden();
  await expect(list.getByRole('status')).toHaveText('Đã lưu người của team CSKH (2 người).');
  await expect(list.getByRole('row', { name: /CSKH/ }).getByRole('cell').nth(2)).toHaveText('2');

  let sent = false;
  page.on('request', (r) => {
    if (r.method() === 'PUT') sent = true;
  });
  await list.getByRole('button', { name: 'Người của team CSKH' }).click();
  await expect(owner).toBeChecked();
  await dialog.getByRole('button', { name: 'Lưu người của team' }).click();
  await expect(dialog).toBeHidden();
  expect(sent).toBe(false); // nothing changed
});

test('an Admin gives a team its channels: one taken from the default team, one sent back to it', async ({
  page,
}) => {
  await signIn(page, accountOf('admin'));
  await page.goto('/settings/teams');
  const list = page.getByRole('region', { name: 'Team của workspace' });
  await expect(list.getByRole('button', { name: 'Kênh của team Sales B2B' })).toHaveCount(0); // the default team
  await list.getByRole('button', { name: 'Kênh của team CSKH' }).click();
  const dialog = page.getByRole('dialog', { name: /Kênh của team/ });
  await expect(dialog.getByRole('checkbox')).toHaveCount(CHANNELS.length);
  await expect(dialog.getByRole('checkbox').first()).toBeFocused(); // the keyboard starts on the list, not on "Hủy"
  const zalo = dialog.getByRole('checkbox', { name: /Zalo OA Gani/ });
  const fanpage = dialog.getByRole('checkbox', { name: /Gani Fanpage/ });
  await expect(zalo).toBeChecked();
  await expect(dialog.getByText('Kết nối sắp hết hạn')).toBeVisible();
  await expect(fanpage).not.toBeChecked();
  await expect(dialog.getByText('Đang kết nối · Đang do team mặc định trả lời')).toBeVisible();
  await zalo.uncheck();
  await fanpage.check();
  await expectAccessible(page);
  const put = page.waitForRequest((r) => r.method() === 'PUT');
  await dialog.getByRole('button', { name: 'Lưu kênh của team' }).click();
  expect((await put).postDataJSON()).toEqual({ channelIds: [CHANNELS[0]!.id] });
  await expect(dialog).toBeHidden();
  await expect(list.getByRole('status')).toHaveText('Đã lưu kênh của team CSKH (1 kênh).');

  await list.getByRole('button', { name: 'Kênh của team CSKH' }).click();
  await expect(fanpage).toBeChecked();
  await expect(zalo).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Hủy' }).click();
  await expect(dialog).toBeHidden();
});

test('a team that still answers a channel is not ended: the refusal says why', async ({ page }) => {
  await signIn(page, accountOf('admin'));
  await page.goto('/settings/teams');
  const list = page.getByRole('region', { name: 'Team của workspace' });
  await list.getByRole('button', { name: 'Kết thúc team CSKH' }).click(); // CSKH answers the Zalo OA
  const end = page.getByRole('dialog', { name: /Kết thúc team CSKH/ });
  await end.getByRole('button', { name: 'Kết thúc team' }).click();
  await expect(end.getByRole('alert')).toContainText('còn trả lời kênh');
  await expect(list.getByRole('row', { name: /CSKH/ })).toBeVisible();
});

test('a Manager reads only its own teams, with nothing to change (CEO, 26/10)', async ({
  page,
}) => {
  await signIn(page, accountOf('manager'));
  await page
    .getByRole('navigation', { name: 'Menu chính' })
    .getByRole('link', { name: 'Team' })
    .click();
  await expect(page).toHaveURL('/settings/teams');
  const list = page.getByRole('region', { name: 'Team của workspace' });
  await expect(list.getByRole('row')).toHaveCount(2); // the header and CSKH
  await expect(list.getByRole('row', { name: /CSKH/ })).toBeVisible();
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('main').getByRole('textbox')).toHaveCount(0);
  await expect(page.getByText('Bạn xem các team mình thuộc về.')).toBeVisible();
  await expectAccessible(page);
});

test('a Sales gets the forbidden page, as the menu', async ({ page }) => {
  await signIn(page, accountOf('sales'));
  await page.goto('/settings/teams');
  await expect(
    page.getByRole('heading', { name: 'Bạn không có quyền xem trang này.' }),
  ).toBeVisible();
});
