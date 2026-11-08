import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';
import { TAGS } from './stub-customer-data';

// #7 Khách hàng, tag (J4, N190; CEO brief 169 P4): the Tag column and the filter by a tag of the company (`tagId`, hidden tags too,
// T-4). The stub's tags: Khách sỉ, Quán ăn, Thử nghiệm cũ (hidden); Lê Minh Châu carries Khách sỉ.
const rows = (page: Page) =>
  page.getByRole('region', { name: 'Danh sách khách' }).locator('tbody tr');
const filter = (page: Page) => page.getByRole('combobox', { name: /^Tag/ });

/** Keeps the `tagId` of every `GET /v1/customers` ('' for none). */
function asked(page: Page): string[] {
  const tagIds: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname === '/v1/customers') tagIds.push(u.searchParams.get('tagId') ?? '');
  });
  return tagIds;
}

test('an Owner reads the tags of each customer and keeps only those carrying one', async ({
  page,
}) => {
  const tagIds = asked(page);
  await signIn(page, accountOf('owner'));
  await page.goto('/customers');
  await expect(page.getByRole('columnheader', { name: 'Tag' })).toBeVisible();
  await expect(rows(page)).toHaveCount(3);
  await page.getByRole('button', { name: 'Tải thêm' }).click();
  await expect(rows(page).nth(3)).toContainText('Lê Minh Châu');
  await expect(rows(page).nth(3)).toContainText('Khách sỉ');
  // Every tag of the company, the hidden one too (a customer may still carry it).
  await expect(filter(page).locator('option')).toHaveText([
    'Mọi khách',
    'Khách sỉ',
    'Quán ăn',
    'Thử nghiệm cũ (đã ẩn)',
  ]);
  await expectAccessible(page);

  await filter(page).selectOption({ label: 'Khách sỉ' });
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Lê Minh Châu');
  expect(tagIds.at(-1)).toBe(TAGS[0]!.id);

  await filter(page).selectOption({ label: 'Thử nghiệm cũ (đã ẩn)' });
  await expect(page.getByText('Không có khách mang tag này.')).toBeVisible();
  await page.getByRole('button', { name: 'Bỏ lọc tag' }).click();
  await expect(filter(page)).toHaveValue('');
  // Back to the list without a tag, as read before: both pages from the cache.
  await expect(rows(page)).toHaveCount(4);
});

test('a Viewer filters by tag too (every role reads the tags)', async ({ page }) => {
  await signIn(page, accountOf('viewer'));
  await page.goto('/customers');
  await filter(page).selectOption({ label: 'Khách sỉ' });
  await expect(rows(page)).toHaveCount(1);
});

test('a company without tags gets no filter', async ({ page }) => {
  await page.route(
    (u) => u.pathname === '/v1/tags',
    (r) => r.fulfill({ json: { data: [] } }),
  );
  await signIn(page, accountOf('admin'));
  await page.goto('/customers');
  await expect(rows(page)).toHaveCount(3);
  await expect(filter(page)).toHaveCount(0);
});
