import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** WCAG 2.1 A/AA with axe-core on the page as it is now: no violation (apps/admin/CLAUDE.md "Kiểm chứng"). */
export async function expectAccessible(page: Page) {
  // Next streams the metadata: the <title> can come just after the content, so a page judged too early has none (document-title).
  await expect(page).toHaveTitle(/\S/);
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
  ).toEqual([]);
}
