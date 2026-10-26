import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf, CONVERSATIONS } from './stub-api';
import { QUICK_REPLIES } from './stub-quick-replies';

// #6 Hộp thư: quick replies in the reply box (C7c, N163). "/" opens the templates of the conversation's workspace, a picked one
// comes in with the names the Inbox knows, the variables left get a field, a {{…}} left is never sent, a sent template counts one use.
const held = CONVERSATIONS[1]!; // HUMAN_ACTIVE, sales
const [chao, giaSi, giaoHang] = QUICK_REPLIES;
const box = (page: Page) => page.getByRole('textbox', { name: /Soạn tin trả lời/ });
const picker = (page: Page) => page.getByRole('listbox', { name: 'Mẫu trả lời nhanh' });
const form = (page: Page) => page.getByRole('form', { name: 'Trả lời khách' });
const posted = (page: Page, end: string) =>
  page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith(end));

test('"/" lists the templates, the start of a shortcut narrows them, the keys pick one and its use is counted', async ({
  page,
}) => {
  await signIn(page, accountOf('sales'));
  await page.goto(`/inbox/${held.id}`);
  await box(page).fill('/');
  await expect(picker(page).getByRole('option')).toHaveCount(3);
  await expect(picker(page).getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await expectAccessible(page);
  await box(page).pressSequentially('gi');
  await expect(picker(page).getByRole('option')).toHaveText([/^\/gia-si/, /^\/giao-hang/]);
  await box(page).press('ArrowDown');
  await expect(box(page)).toHaveAttribute(
    'aria-activedescendant',
    `composer-template-${giaoHang!.id}`,
  );
  await box(page).press('Enter');
  await expect(box(page)).toHaveValue(giaoHang!.body);
  await expect(picker(page)).toHaveCount(0);
  const message = posted(page, '/messages');
  const used = posted(page, `/v1/quick-replies/${giaoHang!.id}/used`);
  await box(page).press('Control+Enter');
  expect((await message).postDataJSON()).toEqual({ text: giaoHang!.body });
  await used;
  await expect(box(page)).toHaveValue('');
});

test('the names the Inbox knows are filled, a variable left asks for a field and is never sent as {{…}}', async ({
  page,
}) => {
  await signIn(page, accountOf('sales'));
  await page.goto(`/inbox/${held.id}`);
  await box(page).fill('/ch');
  await picker(page)
    .getByRole('option', { name: /^\/chao/ })
    .click();
  await expect(box(page)).toHaveValue(
    'Chào {{customer_name}}, em là Người thử sales của Công ty thử.\nEm hỗ trợ được gì ạ?',
  );
  await expect(box(page)).toBeFocused();
  let sent = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/messages')) sent += 1;
  });
  await box(page).press('Control+Enter');
  await expect(form(page).getByRole('alert')).toHaveText('Điền Tên khách trước khi gửi.');
  await expectAccessible(page);
  await form(page).getByRole('textbox', { name: 'Tên khách' }).fill(' chị Lan ');
  const message = posted(page, '/messages');
  const used = posted(page, `/v1/quick-replies/${chao!.id}/used`);
  await form(page).getByRole('button', { name: 'Gửi' }).click();
  expect((await message).postDataJSON()).toEqual({
    text: 'Chào chị Lan, em là Người thử sales của Công ty thử.\nEm hỗ trợ được gì ạ?',
  });
  await used;
  expect(sent).toBe(1);
});

test('Esc closes the list, a text typed by hand counts no use, and 422 unresolved_variable is said', async ({
  page,
}) => {
  await signIn(page, accountOf('manager'));
  await page.goto(`/inbox/${held.id}`);
  await box(page).fill('/gia');
  await expect(picker(page).getByRole('option', { name: /^\/gia-si/ })).toBeVisible();
  await box(page).press('Escape');
  await expect(picker(page)).toHaveCount(0);
  await expect(box(page)).toHaveValue('/gia');
  await box(page).fill('/khong-co');
  await expect(form(page).getByRole('status')).toHaveText(
    'Không có mẫu nào bắt đầu bằng /khong-co. Esc để viết tiếp.',
  );
  await page.route('**/messages', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 422,
          contentType: 'application/problem+json',
          body: JSON.stringify({
            status: 422,
            code: 'unresolved_variable',
            traceId: 'trace-e2e-var',
          }),
        })
      : route.fallback(),
  );
  const counted: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/used')) counted.push(r.url());
  });
  await box(page).fill(`Dạ ${giaSi!.shortcut} ạ`);
  await box(page).press('Control+Enter');
  const alert = form(page).getByRole('alert');
  await expect(alert).toContainText('Tin còn biến {{…}} chưa điền.');
  await expect(alert).toContainText('Mã: trace-e2e-var');
  await expect(box(page)).toHaveValue(`Dạ ${giaSi!.shortcut} ạ`);
  expect(counted).toEqual([]);
});

test('Sales get the contact number of the workspace from /v1/me, so {{company_phone}} comes filled (U37, N164)', async ({
  page,
}) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/v1/workspaces')) asked.push(r.url());
  });
  await signIn(page, accountOf('sales'));
  await page.goto(`/inbox/${held.id}`);
  await box(page).fill('/gia-');
  await picker(page)
    .getByRole('option', { name: /^\/gia-si/ })
    .click();
  await expect(box(page)).toHaveValue(giaSi!.body.replace('{{company_phone}}', '028 3812 3456'));
  await expect(form(page).getByRole('group')).toHaveCount(0);
  expect(asked).toEqual([]);
});
