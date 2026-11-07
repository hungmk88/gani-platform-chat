import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';
import { ME_TEAMS } from './stub-u30';

// U83 (#626, brief 84 wireframe, brief 120): "Team" of the Inbox queue, `teamId` of GET /v1/conversations (the channels the team
// answers, N161): Sales/Support from their own teams (`Me.teams`, U84; `+teams` has CSKH, which answers the stub's channel, and
// Bán sỉ, none), Owner/Admin/Manager from GET /v1/teams of the workspace (the stub's CSKH and Sales B2B).
const list = (page: Page) =>
  page.getByRole('region', { name: 'Danh sách hội thoại' }).getByRole('listitem');
const team = (page: Page) => page.getByRole('combobox', { name: /^Team/ });
const asked = (page: Page) => {
  const ids: (string | null)[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname === '/v1/conversations') ids.push(u.searchParams.get('teamId'));
  });
  return ids;
};

test('an agent filters the queue by one of their teams; a team with nothing says so and the filter goes', async ({
  page,
}) => {
  const ids = asked(page);
  await signIn(page, accountOf('sales+teams'));
  await page.goto('/inbox');
  await expect(list(page).first()).toBeVisible();
  await expect(team(page).getByRole('option')).toHaveText(['Tất cả team', 'CSKH', 'Bán sỉ']);
  await team(page).selectOption({ label: 'CSKH' });
  await expect(page).toHaveURL(new RegExp(`[?&]team=${ME_TEAMS[0]!.id}`));
  await expect.poll(() => ids.at(-1)).toBe(ME_TEAMS[0]!.id);
  await expect(list(page).first()).toBeVisible();
  await expectAccessible(page);
  await team(page).selectOption({ label: 'Bán sỉ' });
  await expect(page.getByText('Không có hội thoại ở team này.')).toBeVisible();
  await page.getByRole('button', { name: 'Bỏ lọc team' }).click();
  await expect(page).not.toHaveURL(/team=/);
  await expect(list(page).first()).toBeVisible();
  await expect(team(page)).toHaveValue('');
});

test('an Owner picks among the teams of the workspace (GET /v1/teams), not only their own', async ({
  page,
}) => {
  await signIn(page, accountOf('owner'));
  await page.goto('/inbox');
  await expect(team(page).getByRole('option')).toHaveText(['Tất cả team', 'CSKH', 'Sales B2B']);
  await team(page).selectOption({ label: 'Sales B2B' });
  await expect(page.getByText('Không có hội thoại ở team này.')).toBeVisible();
  await expectAccessible(page);
});

test('without a team of their own, there is no team filter and no teamId is sent', async ({
  page,
}) => {
  const ids = asked(page);
  await signIn(page, accountOf('sales'));
  await expect(list(page).first()).toBeVisible();
  await expect(team(page)).toHaveCount(0);
  expect(ids.every((id) => id === null)).toBe(true);
});
