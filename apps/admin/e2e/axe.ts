import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** WCAG 2.1 A/AA with axe-core on the page as it is now: no violation (apps/admin/CLAUDE.md "Kiểm chứng"). */
export async function expectAccessible(page: Page) {
  // Next.js streams the <title> of the metadata after the body: checked too early, axe sees an empty title (document-title, seen on
  // #216, #237, #264). Wait for the title the page has, then check everything.
  await expect(page).toHaveTitle(/\S/);
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
  ).toEqual([]);
}
