import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import {
  accountOf,
  CONVERSATIONS,
  HOSTILE,
  INBOX_DOWN_TRACE,
  MANY,
  MANY_PAGE,
  STUB_PAGE,
} from './stub-api';

// #6 Hộp thư, the list column (I1a), against the stub's six conversations of apps/admin/e2e/stub-api.ts.
const list = (page: Page) =>
  page.getByRole('region', { name: 'Danh sách hội thoại' }).getByRole('listitem');

test('sales sees their own and the unclaimed ones, by pages, in plain words', async ({ page }) => {
  await signIn(page, accountOf('sales'));
  await expect(page).toHaveURL('/inbox');
  await expect(page.getByRole('heading', { name: 'Hộp thư' })).toBeVisible();
  await expect(list(page)).toHaveCount(STUB_PAGE);
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Tải thêm' }).click();
  await expect(list(page)).toHaveCount(5); // not #4, held by the manager
  await expect(page.getByRole('button', { name: 'Tải thêm' })).toHaveCount(0);
  await expect(list(page).filter({ hasText: 'Tôi' })).toHaveCount(3);
  await expect(list(page).filter({ hasText: 'Ngoài giờ, bot đang giữ' })).toHaveCount(1);
  await expect(page.getByText(/HUMAN_|PENDING_|BOT_ACTIVE/)).toHaveCount(0);
});

test('the filters live in the URL and ask the API again', async ({ page }) => {
  await signIn(page, accountOf('manager'));
  await page.goto('/inbox');
  await page.getByRole('button', { name: 'Chưa ai nhận' }).click();
  await expect(page).toHaveURL('/inbox?assignee=none');
  await expect(list(page)).toHaveCount(2);
  await page.getByLabel('Trạng thái').selectOption({ label: 'Ngoài giờ, bot đang giữ' });
  await expect(page).toHaveURL('/inbox?assignee=none&state=hold');
  await expect(list(page)).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Chưa ai nhận' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(list(page)).toHaveCount(1);
  await expectAccessible(page);
});

test('an empty list has one sentence and one action', async ({ page }) => {
  await signIn(page, accountOf('support+inbox-empty'));
  await expect(page.getByText('Chưa có hội thoại nào giao cho bạn.')).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Xem hội thoại chưa ai nhận' }).click();
  await expect(page).toHaveURL('/inbox?assignee=none');
  await expect(page.getByText('Không có hội thoại khớp bộ lọc.')).toBeVisible();
  await page.getByRole('button', { name: 'Xóa bộ lọc' }).click();
  await expect(page).toHaveURL('/inbox');
});

test('owner with no conversation is sent to connect a channel', async ({ page }) => {
  await signIn(page, accountOf('owner+inbox-empty'));
  await page.goto('/inbox');
  await expect(page.getByText('Chưa có hội thoại.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Kết nối Zalo OA' })).toHaveAttribute(
    'href',
    '/settings/channels',
  );
});

test('an error of the list shows its trace and "Thử lại"', async ({ page }) => {
  await signIn(page, accountOf('sales+inbox-down'));
  const alert = page.getByRole('region', { name: 'Danh sách hội thoại' }).getByRole('alert');
  await expect(alert).toContainText('Đã có lỗi, không phải do bạn.');
  await expect(alert).toContainText(`Mã: ${INBOX_DOWN_TRACE}`);
  await expectAccessible(page);
  const asked = page.waitForRequest((r) => r.url().includes('/v1/conversations'));
  await alert.getByRole('button', { name: 'Thử lại' }).click();
  await asked;
});

test('a role that sees no conversation gets the forbidden page', async ({ page }) => {
  await signIn(page, accountOf('marketing'));
  await page.goto('/inbox');
  await expect(
    page.getByRole('heading', { name: 'Bạn không có quyền xem trang này.' }),
  ).toBeVisible();
});

test('600 conversations: only the rows near the screen are in the page, scrolling reaches the last', async ({
  page,
}) => {
  await signIn(page, accountOf('sales+many'));
  await page.goto('/inbox');
  const column = page.getByRole('region', { name: 'Danh sách hội thoại' });
  const more = column.getByRole('button', { name: 'Tải thêm' });
  for (let loaded = MANY_PAGE; loaded < MANY; loaded += MANY_PAGE) {
    await expect(column.locator(`li[aria-setsize="${loaded}"]`).first()).toBeAttached();
    // The rows are measured as they are drawn, so the button below them may still move: a click at its place can miss it.
    await more.dispatchEvent('click');
  }
  await expect(more).toHaveCount(0);
  // Each scroll draws rows of their real height, which changes the height of the page: scroll until the last row is there.
  const last = column.locator(`li[aria-posinset="${MANY}"]`);
  await expect(async () => {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(last).toBeVisible({ timeout: 500 });
  }).toPass();
  expect(await column.getByRole('listitem').count()).toBeLessThan(100);
  await expectAccessible(page);
});

// U30 (part, N165): the customer's name on each row and on the open conversation, with a link to the profile (#8).
test('each row names the customer, or says nobody has named them yet; the conversation links to the profile', async ({
  page,
}) => {
  await signIn(page, accountOf('manager'));
  await page.goto('/inbox');
  await expect(list(page).first()).toContainText('Nguyễn Văn An');
  await expect(list(page).filter({ hasText: 'Khách chưa có tên' })).toHaveCount(STUB_PAGE - 1);
  await list(page).first().getByRole('link').click();
  const view = page.getByRole('region', { name: 'Hội thoại', exact: true });
  await expect(view.getByText('Nguyễn Văn An')).toBeVisible();
  await view.getByRole('link', { name: 'Xem hồ sơ khách' }).click();
  await expect(page.getByRole('heading', { name: 'Nguyễn Văn An', level: 1 })).toBeVisible();
});

// U30 (N169, #373): the channel, the last message and who holds it, on the row and the open conversation.
test('a row shows the channel, the last message as plain text, and who holds it by name', async ({
  page,
}) => {
  await signIn(page, accountOf('owner'));
  await page.goto('/inbox');
  const held = list(page).filter({ hasText: 'Người thử sales' }).first();
  await expect(held).toContainText('Zalo OA · Zalo OA Gani');
  await expect(held).toContainText(HOSTILE); // characters, never markup (T2)
  expect(await page.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined();
  await expectAccessible(page);
  // A holder the API names with null (one who left, or never set a name): the end of their id, with words on hover.
  await page.goto(`/inbox/${CONVERSATIONS[3]!.id}`);
  const view = page.getByRole('region', { name: 'Hội thoại', exact: true });
  await expect(view.locator('abbr[title="Nhân viên chưa có tên"]')).toHaveText('…ager');
  await expect(view).toContainText('Zalo OA · Zalo OA Gani');
});

test('Sales see only themselves or nobody as holder: they read their own and unclaimed conversations only', async ({
  page,
}) => {
  await signIn(page, accountOf('sales'));
  await page.goto('/inbox');
  await expect(list(page).first()).toBeVisible();
  const holders = await list(page).locator('span.text-12').allInnerTexts();
  for (const h of holders) expect(h).toMatch(/(Tôi|Chưa ai nhận)$/);
  await page.goto(`/inbox/${CONVERSATIONS[1]!.id}`);
  await expect(page.getByText('Phụ trách: Tôi')).toBeVisible();
});
