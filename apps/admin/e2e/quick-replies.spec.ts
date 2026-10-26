import { expect, test } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';
import { QUICK_REPLIES } from './stub-quick-replies';

// #22 Mẫu trả lời nhanh (N163): the templates of the workspace being worked in, most used first, searched and filtered by tag.
test('a Manager sees the templates, most used first, and finds one by shortcut or tag', async ({
  page,
}) => {
  await signIn(page, accountOf('manager'));
  // Its only item, so the group of the menu is the link (shell.tsx).
  await page
    .getByRole('navigation', { name: 'Menu chính' })
    .getByRole('link', { name: 'Cài đặt' })
    .click();
  await expect(page).toHaveURL('/settings/quick-replies');
  const list = page.getByRole('region', { name: 'Mẫu của workspace' });
  const rows = list.getByRole('listitem');
  await expect(rows).toHaveCount(QUICK_REPLIES.length);
  await expect(rows.first()).toContainText('/chao');
  await expect(rows.first()).toContainText('Đã dùng 42 lần');
  await expect(rows.last()).toContainText('Chưa dùng lần nào');
  await expectAccessible(page);

  const asked = page.waitForRequest(
    (r) => r.url().includes('/v1/quick-replies?') && r.url().includes('q=gia'),
  );
  await list.getByLabel('Tìm theo phím tắt').fill(' GIA');
  await asked;
  await expect(rows).toHaveCount(2);
  await list.getByLabel('Tìm theo phím tắt').fill('');
  await expect(rows).toHaveCount(QUICK_REPLIES.length);

  await list.getByRole('button', { name: 'Lọc theo tag sỉ' }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('/gia-si');
  await list.getByRole('button', { name: 'Bỏ lọc tag “sỉ”' }).click();
  await expect(rows).toHaveCount(QUICK_REPLIES.length);

  await list.getByLabel('Tìm theo phím tắt').fill('khong-co');
  await expect(list).toContainText('Không có mẫu nào khớp.');
});

test('Sales use the templates in the Inbox only: the page is forbidden', async ({ page }) => {
  await signIn(page, accountOf('sales'));
  await page.goto('/settings/quick-replies');
  await expect(
    page.getByRole('heading', { name: 'Bạn không có quyền xem trang này.' }),
  ).toBeVisible();
});
