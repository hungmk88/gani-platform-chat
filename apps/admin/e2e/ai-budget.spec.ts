import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';

// #26 B1b (CEO 01/11): the monthly budget, PATCH …/ai-settings {monthlyBudgetUsd}, waiting for the server. 170 USD of 200 are spent
// (stub). At or under what was spent the internal AI stops now, 0 turns it off: the dialog and its button say so.
const SETTINGS = '**/v1/workspaces/ws-e2e/ai-settings';
const block = (page: Page) => page.getByRole('region', { name: 'Ngân sách tháng' });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Ngân sách tháng' });
// A label around its field: the field's name may hold its value (#401), so match the start.
const field = (page: Page) => dialog(page).getByRole('spinbutton', { name: /^Ngân sách tháng/ });
const calls = (page: Page) => {
  const seen: { method: string; body: unknown }[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/v1/workspaces/ws-e2e/ai-settings'))
      seen.push({ method: r.method(), body: r.postDataJSON() as unknown });
  });
  return seen;
};
const patches = (seen: { method: string; body: unknown }[]) =>
  seen.filter((c) => c.method === 'PATCH').map((c) => c.body);
const open = async (page: Page, who = 'owner') => {
  await signIn(page, accountOf(who));
  await page.goto('/settings/ai');
  await block(page).getByRole('button', { name: 'Sửa ngân sách' }).click();
  await expect(field(page)).toBeFocused();
};
const save = (page: Page, name: string | RegExp) =>
  dialog(page).getByRole('button', { name }).click();

test('an Owner raises the budget: only the budget is sent, the block shows the new share', async ({
  page,
}) => {
  const seen = calls(page);
  await open(page);
  await expect(field(page)).toHaveValue('200');
  await expect(dialog(page)).toContainText('Đã dùng tháng này: 170,00');
  await expectAccessible(page);
  await field(page).fill('500');
  await save(page, 'Lưu ngân sách');
  await expect(dialog(page)).toBeHidden();
  expect(patches(seen)).toEqual([{ monthlyBudgetUsd: 500 }]);
  await expect(block(page)).toContainText(/170,00.*\/ 500,00.*\(34 %\)/);
  await expect(block(page).getByText('Đã dùng từ 80 % ngân sách tháng.')).toHaveCount(0);
  await expect(block(page).getByRole('button', { name: 'Sửa ngân sách' })).toBeFocused();
});

test('what the API would refuse is said before sending; unchanged closes without a call', async ({
  page,
}) => {
  const seen = calls(page);
  await open(page, 'admin');
  for (const typed of ['-1', '1000000.5', '']) {
    await field(page).fill(typed);
    await save(page, 'Lưu ngân sách');
    await expect(dialog(page).getByRole('alert')).toHaveText(
      'Nhập số tiền từ 0 đến 1.000.000 USD.',
    );
  }
  await field(page).fill('200');
  await save(page, 'Lưu ngân sách');
  await expect(dialog(page)).toBeHidden();
  expect(patches(seen)).toEqual([]);
});

test('at 80 % the block warns; at or under what was spent the dialog says AI stops now', async ({
  page,
}) => {
  const seen = calls(page);
  await open(page);
  await field(page).fill('210');
  await expect(dialog(page).getByRole('status')).toHaveCount(0);
  await save(page, 'Lưu ngân sách');
  await expect(block(page)).toContainText('(80 %)');
  await expect(block(page).getByText('Đã dùng từ 80 % ngân sách tháng.')).toBeVisible();
  await block(page).getByRole('button', { name: 'Sửa ngân sách' }).click();
  await field(page).fill('150');
  await expect(dialog(page).getByRole('status')).toHaveText(
    /^Ngân sách mới \(150,00.*\) không lớn hơn số đã dùng tháng này \(170,00.*\): AI nội bộ sẽ dừng ngay tới 00:00 01\/12\/2026/,
  );
  await expectAccessible(page);
  await save(page, 'Lưu, AI nội bộ dừng ngay');
  await expect(dialog(page)).toBeHidden();
  await expect(block(page)).toContainText('(113 %)');
  await expect(
    block(page).getByText('Hết ngân sách tháng: AI nội bộ dừng, quay về kịch bản.'),
  ).toBeVisible();
  expect(patches(seen)).toEqual([{ monthlyBudgetUsd: 210 }, { monthlyBudgetUsd: 150 }]);
});

test('a budget of 0 turns the internal AI off, said in the dialog and on the block', async ({
  page,
}) => {
  await open(page);
  await field(page).fill('0');
  await expect(dialog(page).getByRole('status')).toHaveText('0 USD = AI nội bộ tắt hoàn toàn.');
  await save(page, 'Lưu, AI nội bộ dừng ngay');
  await expect(dialog(page)).toBeHidden();
  await expect(block(page).getByText('0 USD = AI nội bộ tắt hoàn toàn.')).toBeVisible();
  await expect(block(page)).not.toContainText('%');
});

test('with an empty workspace time zone the reset is in Viet Nam time, said so', async ({
  page,
}) => {
  await page.route('**/v1/workspaces', (r) =>
    r.fulfill({ json: { data: [{ id: 'ws-e2e', name: 'Workspace thử', timezone: '' }] } }),
  );
  await open(page);
  await expect(dialog(page)).toContainText('Đặt lại lúc 00:00 01/12/2026 (giờ Việt Nam).');
  await page.keyboard.press('Escape');
  await expect(block(page)).toContainText('00:00 01/12/2026 (giờ Việt Nam)');
  await expect(page.getByText(/múi giờ của workspace/)).toHaveCount(0);
});

test('a save that may not have reached the server says so, reads the budget again and stays open', async ({
  page,
}) => {
  await page.route(SETTINGS, (r) =>
    r.request().method() === 'PATCH'
      ? r.fulfill({
          status: 503,
          contentType: 'application/problem+json',
          body: JSON.stringify({ status: 503, code: 'service_unavailable', traceId: 'trace-b1b' }),
        })
      : r.fallback(),
  );
  const seen = calls(page);
  await open(page);
  await field(page).fill('300');
  const before = seen.length;
  await save(page, 'Lưu ngân sách');
  await expect(dialog(page).getByRole('alert')).toHaveText(
    'Chưa rõ đã lưu hay chưa. Màn đã đọc lại ngân sách hiện tại; lưu lại nếu cần.',
  );
  await expect(dialog(page)).toBeVisible();
  await expect.poll(() => seen.slice(before).at(-1)?.method).toBe('GET');
});
