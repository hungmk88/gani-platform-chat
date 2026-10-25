import { expect, test } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';
import { CHANNELS } from './stub-channels';

// #24 Kênh (N161): the channels of the workspace being worked in, read only, the status in words and the team that answers each.
test('an Admin sees the channels of the workspace: type, status in words, the team that answers', async ({
  page,
}) => {
  await signIn(page, accountOf('admin'));
  await page.goto('/settings/channels');
  await expect(page.getByRole('heading', { name: 'Kênh', exact: true })).toBeVisible();
  const table = page.getByRole('table', { name: 'Kênh của workspace' });
  await expect(table.getByRole('row')).toHaveCount(1 + CHANNELS.length);
  await expect(table.getByRole('row', { name: /Zalo OA Gani/ })).toHaveText(
    /Zalo OA Gani\s*Zalo OA\s*Kết nối sắp hết hạn\s*CSKH/,
  );
  await expect(table.getByRole('row', { name: /Website/ })).toHaveText(
    /Website\s*Webchat\s*Mất kết nối\s*Team mặc định/,
  );
  await expect(table.getByRole('row', { name: /Gani Fanpage/ })).toContainText('Đang kết nối');
  await expectAccessible(page);
});

test('a Manager gets the forbidden page, as the menu', async ({ page }) => {
  await signIn(page, accountOf('manager'));
  await page.goto('/settings/channels');
  await expect(
    page.getByRole('heading', { name: 'Bạn không có quyền xem trang này.' }),
  ).toBeVisible();
});
