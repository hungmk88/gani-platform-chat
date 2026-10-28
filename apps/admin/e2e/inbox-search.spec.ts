import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';

// #390 Hộp thư, "Tìm khách" (`q` of GET /v1/conversations, U30 part 2): by the stub's customers (conversation #1 is with
// Nguyễn Văn An, +84900000001), as the API searches them (U48). The search sits on the URL; an empty one is never sent.
const list = (page: Page) =>
  page.getByRole('region', { name: 'Danh sách hội thoại' }).getByRole('listitem');
const box = (page: Page) => page.getByLabel('Tìm khách');

test('an Owner finds a conversation by the customer’s name, then by the start of the phone; the URL keeps it', async ({
  page,
}) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === '/v1/conversations') asked.push(r.url());
  });
  await signIn(page, accountOf('owner'));
  await page.goto('/inbox');
  await expect(box(page)).toHaveAttribute('placeholder', 'Tên, email hoặc từ 3 số đầu SĐT');
  await box(page).fill('van an');
  await expect(list(page)).toHaveCount(1);
  await expect(list(page)).toContainText('Nguyễn Văn An');
  await expect(page).toHaveURL(/[?&]q=van\+an/);
  await expectAccessible(page);

  await box(page).fill('090');
  await expect(page).toHaveURL(/[?&]q=090/);
  await expect(list(page)).toHaveCount(1);
  await page.reload();
  await expect(box(page)).toHaveValue('090');
  await expect(list(page)).toContainText('Nguyễn Văn An');
  expect(asked.every((u) => new URL(u).searchParams.get('q') !== '')).toBe(true);
});

test('1 or 2 digits are said to search the name; nothing found offers to drop the search, which sends no q', async ({
  page,
}) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === '/v1/conversations') asked.push(r.url());
  });
  await signIn(page, accountOf('owner'));
  await page.goto('/inbox');
  await box(page).fill('09');
  await expect(
    page.getByText('Gõ từ 3 số để tìm theo SĐT; 1–2 số đang tìm theo tên.'),
  ).toBeVisible();
  await expect(page.getByText('Không có hội thoại khớp "09".')).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Bỏ tìm' }).click();
  await expect(box(page)).toHaveValue('');
  await expect(page).toHaveURL('/inbox');
  await expect(list(page).first()).toBeVisible();
  await box(page).fill('   ');
  await expect(list(page).first()).toBeVisible();
  expect(asked.map((u) => new URL(u).searchParams.get('q'))).not.toContain('');
  expect(asked.map((u) => new URL(u).searchParams.get('q'))).not.toContain('   ');
});
