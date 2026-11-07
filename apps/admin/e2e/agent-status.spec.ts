import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';

// U82 (#626, planned S4; tầng 2): "Trạng thái của tôi" in the top bar, `GET/PUT /v1/me/agent-status`, answered here (the stub API
// does not serve it: 404, so the other tests see no picker).
const isStatus = (u: URL) => u.pathname === '/v1/me/agent-status';
const status = (s: string, reason: string | null = 'manual') => ({
  status: s,
  since: '2026-11-06T02:00:00Z',
  reason,
});

/** GET answers `first`; each PUT body is kept and answered by `put` (the status sent, by default). */
async function serve(
  page: Page,
  first: object,
  put: (n: number) => { status: number; json: object } | null = () => null,
) {
  const sent: unknown[] = [];
  await page.route(isStatus, (r) => {
    if (r.request().method() === 'GET') return r.fulfill({ json: first });
    const body = r.request().postDataJSON() as { status: string };
    sent.push(body);
    const answer = put(sent.length);
    return answer
      ? r.fulfill({ status: answer.status, json: answer.json })
      : r.fulfill({ json: status(body.status) });
  });
  return sent;
}
const picker = (page: Page) => page.getByRole('combobox', { name: /^Trạng thái của tôi/ });

test('an agent sets their own status: the choice waits for the server, one PUT with the status only', async ({
  page,
}) => {
  const sent = await serve(page, status('online'));
  await signIn(page, accountOf('sales'));
  await expect(picker(page)).toHaveValue('online');
  await expect(picker(page).getByRole('option')).toHaveText(['Online', 'Bận', 'Offline']);
  await expectAccessible(page);
  await picker(page).selectOption('busy');
  await expect(picker(page)).toHaveValue('busy');
  expect(sent).toEqual([{ status: 'busy' }]);
});

test('a refused change keeps the old status, says why with its trace, and "Thử lại" sends it again', async ({
  page,
}) => {
  const down = {
    status: 503,
    json: { status: 503, code: 'service_unavailable', traceId: 'trace-u82' },
  };
  const sent = await serve(page, status('online'), (n) => (n <= 2 ? down : null));
  await signIn(page, accountOf('support'));
  await picker(page).selectOption('offline');
  const alert = page.getByRole('banner').getByRole('alert');
  await expect(alert).toContainText('Mã: trace-u82');
  await expect(picker(page)).toHaveValue('online');
  await alert.getByRole('button', { name: 'Thử lại' }).click();
  await expect(picker(page)).toHaveValue('offline');
  await expect(alert).toHaveCount(0);
  expect(sent.at(-1)).toEqual({ status: 'offline' });
});

test('Offline after a lost connection is said under the top bar, with "Online"', async ({
  page,
}) => {
  const sent = await serve(page, status('offline', 'disconnected'));
  await signIn(page, accountOf('manager'));
  const strip = page.getByRole('status').filter({ hasText: 'Đã chuyển Offline do mất kết nối' });
  await expect(strip).toBeVisible();
  await expectAccessible(page);
  await strip.getByRole('button', { name: 'Online' }).click();
  await expect(strip).toHaveCount(0);
  await expect(picker(page)).toHaveValue('online');
  expect(sent).toEqual([{ status: 'online' }]);
});

test('no picker while the API does not serve it, nor for a role that holds no conversation', async ({
  page,
}) => {
  await signIn(page, accountOf('sales')); // the stub API answers 404
  await expect(page.getByRole('link', { name: /Hộp thư/ }).first()).toBeVisible();
  await expect(picker(page)).toHaveCount(0);
  await page.context().clearCookies();
  await serve(page, status('online'));
  await signIn(page, accountOf('viewer'));
  await expect(page.getByRole('banner')).toBeVisible();
  await expect(picker(page)).toHaveCount(0);
});
