import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';

// #392 Hộp thư, "Kênh" (`channelId` of GET /v1/conversations; its list from GET /v1/conversations/channels, U56 #398). Every
// conversation of the stub came in by one Zalo OA, so a test that needs two channels answers the channel list itself.
const list = (page: Page) =>
  page.getByRole('region', { name: 'Danh sách hội thoại' }).getByRole('listitem');
const channel = (page: Page) => page.getByRole('combobox', { name: /^Kênh/ });
const ZALO = '0190c000-0000-7000-8000-0000000000c3';
const FANPAGE = '0190c000-0000-7000-8000-0000000000c1';
const GONE = '0190c000-0000-7000-8000-00000000dead';
const TWO = {
  data: [
    { id: FANPAGE, type: 'facebook', displayName: 'Gani Fanpage', status: 'connected' },
    { id: ZALO, type: 'zalo_oa', displayName: 'Zalo OA Gani', status: 'token_expiring' },
  ],
};
const asked = (page: Page) => {
  const ids: (string | null)[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname === '/v1/conversations') ids.push(u.searchParams.get('channelId'));
  });
  return ids;
};

test('an Owner filters by a channel; the URL keeps it and the API is asked for that channel only', async ({
  page,
}) => {
  await page.route('**/v1/conversations/channels*', (r) => r.fulfill({ json: TWO }));
  const ids = asked(page);
  await signIn(page, accountOf('owner'));
  await page.goto('/inbox');
  await expect(channel(page).getByRole('option')).toHaveText([
    'Tất cả kênh',
    'Gani Fanpage · Facebook',
    'Zalo OA Gani · Zalo OA · Kết nối sắp hết hạn',
  ]);
  await channel(page).selectOption(ZALO);
  await expect(page).toHaveURL(new RegExp(`[?&]channel=${ZALO}`));
  await expect(list(page).first()).toBeVisible();
  await expect.poll(() => ids.at(-1)).toBe(ZALO);
  await expectAccessible(page);
  await page.reload();
  await expect(channel(page)).toHaveValue(ZALO);
  await channel(page).selectOption(FANPAGE);
  await expect(page.getByText('Không có hội thoại khớp bộ lọc.')).toBeVisible();
});

// Which channels a person gets is the API's (#398, its own tests): here only what the screen does with a list of one.
test('a Sales offered one channel gets no filter, and never sends channelId', async ({ page }) => {
  const ids = asked(page);
  await signIn(page, accountOf('sales'));
  await expect(list(page).first()).toBeVisible();
  await expect(channel(page)).toHaveCount(0);
  expect(ids.every((id) => id === null)).toBe(true);
});

test('a channel of the URL no longer offered still filters, says so, and the filter can be cleared', async ({
  page,
}) => {
  await signIn(page, accountOf('support'));
  await page.goto(`/inbox?channel=${GONE}`);
  await expect(channel(page)).toHaveValue(GONE);
  await expect(channel(page).getByRole('option', { selected: true })).toHaveText(
    'Kênh không còn trong danh sách',
  );
  await expect(page.getByText('Không có hội thoại khớp bộ lọc.')).toBeVisible();
  await expect(
    page.getByText(/Kênh đang lọc không còn trong danh sách: kênh đã bị gỡ/),
  ).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Xóa bộ lọc' }).click();
  await expect(page).toHaveURL('/inbox');
  await expect(list(page).first()).toBeVisible();
});

test('when the channel list cannot be read, a filter of the URL is still said, with "Bỏ lọc"', async ({
  page,
}) => {
  await page.route('**/v1/conversations/channels*', (r) =>
    r.fulfill({
      status: 500,
      json: { code: 'internal_error', status: 500, title: 'x', type: 'about:blank' },
    }),
  );
  await signIn(page, accountOf('manager'));
  await page.goto(`/inbox?channel=${ZALO}`);
  await expect(page.getByText('Đang lọc theo một kênh ·')).toBeVisible();
  await expect(list(page).first()).toBeVisible();
  await page.getByRole('button', { name: 'Bỏ lọc' }).click();
  await expect(page).toHaveURL('/inbox');
  await expect(page.getByText('Đang lọc theo một kênh ·')).toHaveCount(0);
});
