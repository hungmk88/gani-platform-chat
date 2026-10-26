import { expect, test } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';
import { QUICK_REPLIES } from './stub-quick-replies';

// #22 Mẫu trả lời nhanh (N163): the templates of the workspace being worked in, most used first, searched and filtered by tag;
// making one, checked like the API, with one Idempotency-Key.
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

test('an Admin makes a template with a variable and tags; a wrong one is said before sending, a taken shortcut after', async ({
  page,
}) => {
  await signIn(page, accountOf('admin'));
  await page.goto('/settings/quick-replies');
  const form = page.getByRole('form', { name: 'Tạo mẫu' });
  const list = page.getByRole('region', { name: 'Mẫu của workspace' });
  const shortcut = form.getByLabel(/^Phím tắt/);
  const body = form.getByLabel('Nội dung');
  let sent = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/v1/quick-replies')) sent += 1;
  });

  await shortcut.fill('Cam on!');
  await body.fill('Cảm ơn');
  await form.getByRole('button', { name: 'Tạo mẫu' }).click();
  await expect(form.getByRole('alert')).toContainText('Phím tắt gồm chữ thường không dấu');
  await shortcut.fill('cam-on');
  await body.fill('Cảm ơn {{ten_khach}}');
  await form.getByRole('button', { name: 'Tạo mẫu' }).click();
  await expect(form.getByRole('alert')).toContainText('Biến không dùng được: {{ten_khach}}');
  expect(sent).toBe(0);

  await body.fill('Cảm ơn ');
  await form
    .getByRole('group', { name: 'Chèn biến' })
    .getByRole('button', { name: 'Tên khách' })
    .click();
  await expect(body).toHaveValue('Cảm ơn {{customer_name}}');
  await form.getByLabel(/^Tag/).fill(' cảm ơn, kết thúc ,cảm ơn,');
  await expectAccessible(page);
  const posted = page.waitForRequest((r) => r.method() === 'POST');
  await form.getByRole('button', { name: 'Tạo mẫu' }).click();
  const req = await posted;
  expect(req.postDataJSON()).toEqual({
    workspaceId: 'ws-e2e',
    shortcut: 'cam-on',
    body: 'Cảm ơn {{customer_name}}',
    tags: ['cảm ơn', 'kết thúc'],
  });
  expect(req.headers()['idempotency-key']).toBeTruthy();
  await expect(form.getByRole('status')).toHaveText('Đã tạo mẫu /cam-on.');
  await expect(shortcut).toHaveValue('');
  await expect(list.getByRole('listitem')).toHaveCount(QUICK_REPLIES.length + 1);
  await expect(list.getByRole('listitem').last()).toContainText('/cam-on');

  await shortcut.fill('chao');
  await body.fill('Xin chào');
  await form.getByRole('button', { name: 'Tạo mẫu' }).click();
  await expect(form.getByRole('alert')).toContainText('đã có mẫu khác dùng phím tắt /chao');
});

test('Sales use the templates in the Inbox only: the page is forbidden', async ({ page }) => {
  await signIn(page, accountOf('sales'));
  await page.goto('/settings/quick-replies');
  await expect(
    page.getByRole('heading', { name: 'Bạn không có quyền xem trang này.' }),
  ).toBeVisible();
});
