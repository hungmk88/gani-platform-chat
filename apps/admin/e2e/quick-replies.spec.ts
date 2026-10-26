import { expect, test } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';
import { QUICK_REPLIES } from './stub-quick-replies';

// #22 Mẫu trả lời nhanh (N163): the templates of the workspace being worked in, most used first, searched and filtered by tag;
// making one, checked like the API, with one Idempotency-Key; changing one (only what changed) and removing one.
test('a Manager sees the templates, most used first, and finds one by shortcut or tag', async ({
  page,
}) => {
  await signIn(page, accountOf('manager'));
  await page
    .getByRole('navigation', { name: 'Menu chính' })
    .getByRole('link', { name: 'Mẫu trả lời nhanh' })
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

test('a Manager changes a template, only what changed is sent, then removes another', async ({
  page,
}) => {
  await signIn(page, accountOf('manager'));
  await page.goto('/settings/quick-replies');
  const list = page.getByRole('region', { name: 'Mẫu của workspace' });
  await list.getByRole('button', { name: 'Sửa mẫu /gia-si' }).click();
  const dialog = page.getByRole('dialog', { name: 'Sửa mẫu /gia-si' });
  await expect(dialog.getByLabel('Phím tắt')).toHaveValue('gia-si');
  await expect(dialog.getByLabel(/^Tag/)).toHaveValue('báo giá, sỉ');
  await dialog.getByLabel('Phím tắt').fill('chao');
  await dialog.getByRole('button', { name: 'Lưu' }).click();
  await expect(dialog.getByRole('alert')).toContainText('phím tắt /chao');
  await dialog.getByLabel('Phím tắt').fill('gia-si');
  await dialog.getByLabel(/^Tag/).fill('báo giá');
  await expectAccessible(page);
  const patched = page.waitForRequest((r) => r.method() === 'PATCH');
  await dialog.getByRole('button', { name: 'Lưu' }).click();
  expect((await patched).postDataJSON()).toEqual({ tags: ['báo giá'] });
  await expect(dialog).toBeHidden();
  await expect(list.getByRole('status')).toHaveText('Đã lưu mẫu /gia-si.');
  await expect(list.getByRole('button', { name: 'Lọc theo tag sỉ' })).toHaveCount(0);

  await list.getByRole('button', { name: 'Xóa mẫu /giao-hang' }).click();
  const end = page.getByRole('dialog', { name: 'Xóa mẫu /giao-hang?' });
  await expectAccessible(page);
  const deleted = page.waitForRequest((r) => r.method() === 'DELETE');
  await end.getByRole('button', { name: 'Xóa mẫu' }).click();
  expect((await deleted).url()).toMatch(new RegExp(`/v1/quick-replies/${QUICK_REPLIES[2]!.id}$`));
  await expect(end).toBeHidden();
  await expect(list.getByRole('status')).toHaveText('Đã xóa mẫu /giao-hang.');
  await expect(list.getByRole('listitem')).toHaveCount(QUICK_REPLIES.length - 1);
});

test('a template is seen with sample values; a variable with no value is said in words', async ({
  page,
}) => {
  await signIn(page, accountOf('admin'));
  await page.goto('/settings/quick-replies');
  const list = page.getByRole('region', { name: 'Mẫu của workspace' });
  const posted = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/preview'));
  await list.getByRole('button', { name: 'Xem trước mẫu /chao' }).click();
  expect((await posted).url()).toMatch(
    new RegExp(`/v1/quick-replies/${QUICK_REPLIES[0]!.id}/preview$`),
  );
  const chao = page.getByRole('dialog', { name: 'Xem trước mẫu /chao' });
  await expect(
    chao.getByText('Chào Nguyễn Văn A, em là Người thử admin của Công ty thử.'),
  ).toBeVisible();
  await expect(chao.getByRole('listitem')).toHaveCount(0);
  await chao.getByRole('button', { name: 'Đóng' }).click();
  await expect(chao).toBeHidden();

  await list.getByRole('button', { name: 'Xem trước mẫu /gia-si' }).click();
  const giaSi = page.getByRole('dialog', { name: 'Xem trước mẫu /gia-si' });
  await expect(giaSi.getByText('gọi {{company_phone}} để được báo giá')).toBeVisible();
  await expect(giaSi.getByRole('listitem')).toHaveText([
    /SĐT công ty: workspace chưa đặt SĐT liên hệ/,
  ]);
  await expectAccessible(page);
});

// U38: the text being written is seen with sample values before it is saved (`POST /v1/quick-replies/preview`, writes nothing).
test('a text not saved yet is seen with sample values, from the form and from the change dialog', async ({
  page,
}) => {
  await signIn(page, accountOf('manager'));
  await page.goto('/settings/quick-replies');
  const form = page.getByRole('form', { name: 'Tạo mẫu' });
  const preview = form.getByRole('button', { name: 'Xem trước' });
  await expect(preview).toBeDisabled();
  await form.getByLabel('Nội dung').fill('Chào {{customer_name}}, gọi {{company_phone}} nhé.');
  const posted = page.waitForRequest((r) => r.url().endsWith('/v1/quick-replies/preview'));
  await preview.click();
  expect((await posted).postDataJSON()).toEqual({
    workspaceId: 'ws-e2e',
    body: 'Chào {{customer_name}}, gọi {{company_phone}} nhé.',
  });
  const seen = page.getByRole('dialog', { name: 'Xem trước mẫu đang soạn' });
  await expect(seen.getByText('Chào Nguyễn Văn A, gọi {{company_phone}} nhé.')).toBeVisible();
  await expect(seen.getByRole('listitem')).toHaveText([/SĐT công ty/]);
  await expectAccessible(page);
  await seen.getByRole('button', { name: 'Đóng' }).click();
  await expect(seen).toBeHidden();
  await expect(
    page.getByRole('region', { name: 'Mẫu của workspace' }).getByRole('listitem'),
  ).toHaveCount(QUICK_REPLIES.length);

  await form.getByLabel('Nội dung').fill('Chào {{la}}');
  await preview.click();
  await expect(seen.getByRole('alert')).toContainText('Máy chủ không nhận mẫu này');
  await seen.getByRole('button', { name: 'Đóng' }).click();

  const list = page.getByRole('region', { name: 'Mẫu của workspace' });
  await list.getByRole('button', { name: 'Sửa mẫu /chao' }).click();
  const edit = page.getByRole('dialog', { name: 'Sửa mẫu /chao' });
  await edit.getByLabel('Nội dung').fill('Dạ {{agent_name}} nghe ạ.');
  await edit.getByRole('button', { name: 'Xem trước' }).click();
  await expect(seen.getByText('Dạ Người thử manager nghe ạ.')).toBeVisible();
  await seen.getByRole('button', { name: 'Đóng' }).click();
  await expect(seen).toBeHidden();
  await expect(edit).toBeVisible();
});

test('Sales use the templates in the Inbox only: the page is forbidden', async ({ page }) => {
  await signIn(page, accountOf('sales'));
  await page.goto('/settings/quick-replies');
  await expect(
    page.getByRole('heading', { name: 'Bạn không có quyền xem trang này.' }),
  ).toBeVisible();
});
