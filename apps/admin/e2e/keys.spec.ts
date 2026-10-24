import { expect, test } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf, CONVERSATIONS } from './stub-api';

// #6 Hộp thư, the keyboard (prototype inbox.js "Bảng phím tắt"): J/K through the list as loaded, ? for the table of keys.
test('J and K move through the list as loaded, keeping the filters; ? shows the keys', async ({
  page,
}) => {
  await signIn(page, accountOf('manager'));
  await page.goto('/inbox?assignee=none');
  const rows = page.getByRole('region', { name: 'Danh sách hội thoại' }).getByRole('listitem');
  await expect(rows).toHaveCount(2);
  const [first, , , , fifth] = CONVERSATIONS;
  await page.keyboard.press('j');
  await expect(page).toHaveURL(`/inbox/${first!.id}?assignee=none`);
  await page.keyboard.press('j');
  await expect(page).toHaveURL(`/inbox/${fifth!.id}?assignee=none`);
  await page.keyboard.press('j');
  await expect(page).toHaveURL(`/inbox/${fifth!.id}?assignee=none`);
  await page.keyboard.press('k');
  await expect(page).toHaveURL(`/inbox/${first!.id}?assignee=none`);
  await page.keyboard.press('?');
  const keys = page.getByRole('dialog', { name: 'Bảng phím tắt' });
  await expect(keys.getByRole('row', { name: /J \/ K/ })).toBeVisible();
  await expectAccessible(page);
  await page.keyboard.press('Escape');
  await expect(keys).toBeHidden();
});
