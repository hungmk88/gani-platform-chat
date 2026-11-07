import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf, CONVERSATIONS } from './stub-api';
import { TAGS } from './stub-customer-data';

// #6 Hộp thư, lọc theo tag của khách (N195; CEO brief 169 P4): `tag` on the URL → `tagId` of GET /v1/conversations, from the
// company's tags (the stub's GET /v1/tags: Khách sỉ, Quán ăn, Thử nghiệm cũ hidden). None of the stub's conversations has a tagged
// customer, so a tag finds none there; the one that finds a conversation is answered here.
const list = (page: Page) =>
  page.getByRole('region', { name: 'Danh sách hội thoại' }).getByRole('listitem');
const tag = (page: Page) => page.getByRole('combobox', { name: /^Tag/ });
const asked = (page: Page) => {
  const ids: (string | null)[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname === '/v1/conversations') ids.push(u.searchParams.get('tagId'));
  });
  return ids;
};

test('sales filters the queue by a tag of the customer; none with it says so and "Xóa bộ lọc" lets it go', async ({
  page,
}) => {
  const ids = asked(page);
  await page.route(
    (u) => u.pathname === '/v1/conversations' && u.searchParams.get('tagId') === TAGS[1]!.id,
    (r) => r.fulfill({ json: { data: [CONVERSATIONS[0]], nextCursor: null } }),
  );
  await signIn(page, accountOf('sales'));
  await page.goto('/inbox');
  await expect(list(page).first()).toBeVisible();
  await expect(tag(page).getByRole('option')).toHaveText([
    'Mọi tag',
    'Khách sỉ',
    'Quán ăn',
    'Thử nghiệm cũ (đã ẩn)',
  ]);
  await tag(page).selectOption({ label: 'Quán ăn' });
  await expect(page).toHaveURL(new RegExp(`[?&]tag=${TAGS[1]!.id}`));
  await expect.poll(() => ids.at(-1)).toBe(TAGS[1]!.id);
  await expect(list(page)).toHaveCount(1);
  await expectAccessible(page);
  await tag(page).selectOption({ label: 'Thử nghiệm cũ (đã ẩn)' });
  await expect(page.getByText('Không có hội thoại khớp bộ lọc.')).toBeVisible();
  await page.getByRole('button', { name: 'Xóa bộ lọc' }).click();
  await expect(page).not.toHaveURL(/tag=/);
  await expect(tag(page)).toHaveValue('');
  // The list without a tag again (from the cache: no request needed).
  await expect(list(page).first()).toBeVisible();
});

test('a tag of the URL no longer listed still filters, and says so', async ({ page }) => {
  const gone = '0190e500-0000-7000-8000-0000000000ff';
  const ids = asked(page);
  await signIn(page, accountOf('manager'));
  await page.goto(`/inbox?tag=${gone}`);
  await expect(tag(page).locator('option:checked')).toHaveText('Tag không còn trong danh sách');
  await expect.poll(() => ids.at(-1)).toBe(gone);
});

test('a company without tags gets no tag filter and sends no tagId', async ({ page }) => {
  const ids = asked(page);
  await page.route(
    (u) => u.pathname === '/v1/tags',
    (r) => r.fulfill({ json: { data: [] } }),
  );
  await signIn(page, accountOf('owner'));
  await page.goto('/inbox');
  await expect(list(page).first()).toBeVisible();
  await expect(tag(page)).toHaveCount(0);
  expect(ids.every((x) => x === null)).toBe(true);
});
