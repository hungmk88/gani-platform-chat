import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf, INBOX_DOWN_TRACE, MANY, MANY_PAGE, STUB_PAGE } from './stub-api';

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
