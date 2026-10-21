import { expect, test } from '@playwright/test';

import { navFor, ROLES } from '../src/nav';
import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';

// The frame of each role: exactly the links of navFor (Phụ lục B), nothing of another role, and axe.
for (const role of ROLES) {
  test(`the menu of ${role}`, async ({ page }) => {
    await signIn(page, accountOf(role));
    const menu = page.getByRole('navigation', { name: 'Menu chính' });
    await expect(menu).toBeVisible();
    const hrefs = navFor(role).flatMap((g) => g.items.map((i) => i.href));
    await expect(menu.getByRole('link')).toHaveCount(hrefs.length);
    for (const href of hrefs) await expect(menu.locator(`a[href="${href}"]`)).toHaveCount(1);
    await expect(menu.locator('a[aria-current="page"]')).toHaveCount(1);
    await expectAccessible(page);
  });
}

test('signing out ends the session and goes back to /login', async ({ page }) => {
  await signIn(page, accountOf('support'));
  await expect(page).toHaveURL('/inbox');
  await page.getByRole('button', { name: 'Đăng xuất' }).click();
  await expect(page).toHaveURL('/login');
  await page.goto('/inbox');
  await expect(page).toHaveURL('/login');
});
