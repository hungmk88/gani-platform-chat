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

// The three other states of the screen (CEO 05/11, brief 87 mục 10), the list answered by page.route: loading (held), an error
// with its trace and "Thử lại", then no channel at all.
test('the channels while they load, when they fail (trace, Thử lại), then when there are none', async ({
  page,
}) => {
  let calls = 0;
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  await page.route(
    (url) => url.pathname === '/v1/channels',
    async (r) => {
      if (calls++ > 0) return r.fulfill({ json: { data: [] } });
      await held;
      return r.fulfill({
        status: 500,
        contentType: 'application/problem+json',
        body: JSON.stringify({ status: 500, code: 'internal_error', traceId: 'trace-500' }),
      });
    },
  );
  await signIn(page, accountOf('admin'));
  await page.goto('/settings/channels');
  await expect(page.getByText('Đang tải kênh…')).toBeVisible();
  await expectAccessible(page);
  release();
  const alert = page.getByRole('alert').filter({ hasText: 'Thử lại' });
  await expect(alert).toContainText('Mã: trace-500');
  await expectAccessible(page);
  await alert.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByText('Workspace này chưa có kênh nào được kết nối.')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Kênh của workspace' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible();
  await expectAccessible(page);
});
