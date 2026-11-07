import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf, CONVERSATIONS } from './stub-api';
import { TEAMS } from './stub-teams';

// U86 (realtime spec §3, planned S4): agent_status.changed and conversation.sla_changed, played by the stub's /agent
// (e2e/stub-agent.ts, levers `agent-status` and `sla`). Packets carry no version in `data`: the envelope's aggregateVersion orders
// them, and an older one is dropped. A later packet on another aggregate marks that the earlier one was handled (one socket, in order).
const held = CONVERSATIONS[1]!; // sales holds it
const other = CONVERSATIONS[0]!; // unclaimed, in the same list
const NOW = Date.parse('2026-11-07T03:00:00Z');
const at = (min: number) => new Date(NOW + min * 60_000).toISOString();

async function lever(page: Page, name: string, data: object) {
  const sid = (await page.context().cookies()).find((c) => c.name === 'e2e_session')?.value;
  await page.request.post(`http://localhost:3000/__e2e/${name}`, { data: { ...data, sid } });
}

/** Opens the held conversation (with the list beside it) once the socket follows it, so packets from now on arrive. */
async function open(page: Page, email: string) {
  const followed = new Promise<void>((done) =>
    page.on('websocket', (ws) =>
      ws.on('framesent', ({ payload }) => {
        if (/conversation\.subscribe|"resume"/.test(String(payload))) done();
      }),
    ),
  );
  await page.clock.setFixedTime(NOW);
  await signIn(page, email);
  await page.goto(`/inbox/${held.id}`);
  await followed;
}

const status = (s: string, reason: string | null = 'manual') => ({
  status: s,
  since: '2026-11-07T02:00:00Z',
  reason,
});

test("one's own status follows agent_status.changed; someone else's and an older packet leave it", async ({
  page,
}) => {
  await page.route(
    (u) => u.pathname === '/v1/me/agent-status',
    (r) => r.fulfill({ json: status('online') }),
  );
  await open(page, accountOf('sales+u86a'));
  const picker = page.getByRole('combobox', { name: /^Trạng thái của tôi/ });
  await expect(picker).toHaveValue('online');

  await lever(page, 'agent-status', { userId: 'user-sales', ...status('busy'), version: 2 });
  await expect(picker).toHaveValue('busy');

  // Someone else going offline, then an older packet of one's own: neither changes the top bar.
  await lever(page, 'agent-status', {
    userId: 'user-manager',
    ...status('offline', 'disconnected'),
    version: 5,
  });
  await lever(page, 'agent-status', {
    userId: 'user-sales',
    ...status('offline', 'disconnected'),
    version: 1,
  });
  await lever(page, 'sla', {
    conversationId: other.id,
    sla: { dueAt: at(10), pausedReason: null },
    version: 1,
  });
  await expect(page.getByRole('link', { name: /Còn 10 phút/ })).toBeVisible();
  await expect(picker).toHaveValue('busy');
  await expect(page.getByText('Đã chuyển Offline do mất kết nối.')).toHaveCount(0);

  // A newer one does: the line of a status lost with the connection shows.
  await lever(page, 'agent-status', {
    userId: 'user-sales',
    ...status('offline', 'disconnected'),
    version: 3,
  });
  await expect(page.getByText('Đã chuyển Offline do mất kết nối.')).toBeVisible();
  await expect(picker).toHaveValue('offline');
  await expectAccessible(page);
});

test('the SLA chip of a row follows conversation.sla_changed; an older packet is dropped', async ({
  page,
}) => {
  await open(page, accountOf('sales+u86b'));
  const row = page.getByRole('link').filter({ hasText: 'Còn 42 phút' });
  await expect(page.getByRole('link', { name: /Chưa có SLA/ }).first()).toBeVisible();

  await lever(page, 'sla', {
    conversationId: held.id,
    sla: { dueAt: at(42), pausedReason: null },
    version: 2,
  });
  await expect(row).toHaveCount(1);

  // Older (version 1), then a marker on another conversation: the held row keeps its 42 minutes.
  await lever(page, 'sla', {
    conversationId: held.id,
    sla: { dueAt: at(5), pausedReason: 'waiting_customer' },
    version: 1,
  });
  await lever(page, 'sla', {
    conversationId: other.id,
    sla: { dueAt: at(-3), pausedReason: null },
    version: 1,
  });
  await expect(page.getByRole('link', { name: /Quá hạn 3 phút/ })).toBeVisible();
  await expect(row).toHaveCount(1);
  await expect(page.getByRole('link', { name: /SLA tạm dừng · chờ khách/ })).toHaveCount(0);

  // Newer: paused outside the hours, and back to none.
  await lever(page, 'sla', {
    conversationId: held.id,
    sla: { dueAt: at(42), pausedReason: 'outside_hours' },
    version: 3,
  });
  await expect(page.getByRole('link', { name: /SLA tạm dừng · ngoài giờ/ })).toHaveCount(1);
  await expect(row).toHaveCount(0);
  await expectAccessible(page);
});

test('an open "Trạng thái team" reads the team again on agent_status.changed (U85 + U86)', async ({
  page,
}) => {
  const team = TEAMS[0]!;
  const lan = {
    userId: '0190f000-0000-7000-8000-0000000000a1',
    name: 'Lan',
    since: '2026-11-07T02:15:00Z',
    busyMinutesToday: 0,
  };
  const asked: string[] = [];
  await page.route(
    (u) => u.pathname === `/v1/teams/${team.id}/agent-status`,
    (r) => (
      asked.push(r.request().method()),
      r.fulfill({ json: { data: [{ ...lan, status: asked.length === 1 ? 'busy' : 'online' }] } })
    ),
  );
  // Connected once the server answered the namespace's CONNECT ("40/agent,").
  const connected = new Promise<void>((done) =>
    page.on('websocket', (ws) =>
      ws.on('framereceived', ({ payload }) => {
        if (String(payload).startsWith('40/agent,')) done();
      }),
    ),
  );
  await signIn(page, accountOf('manager+u86c'));
  await page.goto('/settings/teams');
  await connected;
  await page.getByRole('button', { name: `Trạng thái của team ${team.name}` }).click();
  const dialog = page.getByRole('dialog', { name: `Trạng thái team ${team.name}` });
  await expect(dialog.getByRole('row').nth(1)).toContainText('LanBận');
  await lever(page, 'agent-status', {
    userId: lan.userId,
    status: 'online',
    since: lan.since,
    reason: 'manual',
    version: 1,
  });
  await expect(dialog.getByRole('row').nth(1)).toContainText('LanOnline');
  expect(asked).toEqual(['GET', 'GET']);
});
