import { expect, test } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';

// T1 (Brief UI §2.6): changing the workspace drops the cache of the old one and closes its realtime connection; the inbox then asks
// the API for the new workspace only. `+multi` has two workspaces; every conversation of the stub is in the first.
test('T1: changing the workspace asks the new one, drops the old list and its realtime connection', async ({
  page,
}) => {
  await signIn(page, accountOf('sales+multi'));
  // Counted from here: the page of the role opened its own connection, which the browser drops on leaving without a close event.
  const sockets: { url: string; closed: boolean }[] = [];
  page.on('websocket', (ws) => {
    const s = { url: ws.url(), closed: false };
    sockets.push(s);
    ws.on('close', () => (s.closed = true));
  });
  const first = page.waitForRequest((r) => r.url().includes('/v1/conversations?'));
  await page.goto('/inbox');
  expect(new URL((await first).url()).searchParams.get('workspaceId')).toBe('ws-e2e');
  const list = page.getByRole('region', { name: 'Danh sách hội thoại' });
  await expect(list.getByRole('listitem').first()).toBeVisible();
  await expect.poll(() => sockets.length).toBeGreaterThan(0);
  await expectAccessible(page);

  const asked = page.waitForRequest(
    (r) => r.url().includes('/v1/conversations?') && r.url().includes('workspaceId=ws-e2e-2'),
  );
  await page.getByLabel('Workspace').selectOption({ label: 'Workspace hai' });
  await asked;
  await expect(list.getByRole('listitem')).toHaveCount(0);
  await expect.poll(() => sockets[0]?.closed).toBe(true);
  await expect(page.getByLabel('Workspace')).toHaveValue('ws-e2e-2');

  await page.reload(); // the choice is kept
  await expect(page.getByLabel('Workspace')).toHaveValue('ws-e2e-2');
});

test('one workspace only: its name, no choice', async ({ page }) => {
  await signIn(page, accountOf('sales'));
  await expect(page.getByRole('banner')).toContainText('Công ty thử · Workspace thử');
  await expect(page.getByLabel('Workspace')).toHaveCount(0);
});
