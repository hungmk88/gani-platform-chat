import { expect, test, type Page, type Request } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';
import { REQUEST_PAGES } from './stub-privacy';

// #23 Dữ liệu khách PR B2 (CEO 30/10, 31/10): the dialog that carries out an erase (POST …/execute) as approved: type
// XOA-<6 last characters> (ends trimmed, case not counted), never Enter, one Idempotency-Key per opening kept by every "Thử lại",
// nothing sent again by itself, focus on the field then on the outcome, never "erased" unless the API said so.
const CODE = 'XOA-000001'; // the pending erase of Trần Bình in e2e/stub-privacy.ts
const opener = (page: Page) => page.getByRole('button', { name: 'Xóa dữ liệu của Trần Bình' });
const dialog = (page: Page) => page.getByRole('dialog', { name: /Xóa vĩnh viễn dữ liệu/ });
const field = (page: Page) => dialog(page).getByRole('textbox', { name: /để xác nhận/ });
const eraseButton = (page: Page) => dialog(page).getByRole('button', { name: 'Xóa vĩnh viễn' });
const rows = (page: Page) =>
  page.getByRole('region', { name: 'Yêu cầu dữ liệu cá nhân' }).getByRole('table').getByRole('row');
const executions = (page: Page) => {
  const sent: Request[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/execute')) sent.push(r);
  });
  return sent;
};
const problem = (status: number, code: string) => ({
  status,
  contentType: 'application/problem+json',
  body: JSON.stringify({ status, code, traceId: `trace-${status}` }),
});

async function openErase(page: Page, who = 'owner') {
  await signIn(page, accountOf(who));
  await page.goto('/settings/customer-data');
  await opener(page).click();
  await expect(dialog(page)).toBeVisible();
}

test('the erase dialog opens on the field, the button stays locked until the code matches', async ({
  page,
}) => {
  const sent = executions(page);
  await openErase(page);
  await expect(field(page)).toBeFocused();
  await expect(dialog(page)).toContainText('Không hoàn tác được.');
  await expect(dialog(page).locator('code', { hasText: CODE }).first()).toHaveClass(/font-mono/);
  await expect(dialog(page).getByRole('button', { name: /Sao chép/ })).toHaveCount(0);
  await expect(eraseButton(page)).toBeDisabled();
  await expectAccessible(page);
  for (const wrong of ['XOA 000001', 'XOA000001', 'XOA-00000', 'XOA - 000001']) {
    await field(page).fill(wrong);
    await expect(eraseButton(page)).toBeDisabled();
  }
  await expect(dialog(page).getByText('Chưa khớp.')).toBeVisible();
  await field(page).fill('  xoa-000001 '); // point (a): ends trimmed, case not counted
  await expect(eraseButton(page)).toBeEnabled();
  await expect(dialog(page).getByText('Chưa khớp.')).toHaveCount(0);
  await field(page).press('Enter');
  await expect(dialog(page)).toBeVisible();
  expect(sent).toHaveLength(0);
  await field(page).press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await expect(opener(page)).toBeFocused();
});

test('erasing sends once, holds while the server works, then shows the figures of the API', async ({
  page,
}) => {
  const sent = executions(page);
  let release: () => void = () => undefined;
  const held = new Promise<void>((r) => (release = r));
  await page.route('**/execute', async (r) => {
    await held;
    await r.fallback();
  });
  await openErase(page);
  await field(page).fill(CODE);
  await eraseButton(page).dblclick();
  await expect(dialog(page).getByRole('button', { name: 'Đang xóa…' })).toBeDisabled();
  await expect(dialog(page).getByRole('button', { name: 'Hủy' })).toBeDisabled();
  await expect(dialog(page).getByText('Đang xóa, không đóng trang.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeVisible();
  release();
  const status = dialog(page).getByRole('status');
  await expect(status).toContainText('Đã thực hiện yêu cầu xóa.');
  await expect(status).toContainText('Định danh kênh đã xóa: 1');
  await expect(status).toContainText('Tin đã xóa nội dung: 37');
  expect(sent).toHaveLength(1);
  const close = dialog(page).getByRole('button', { name: 'Đóng' });
  await expect(close).toBeFocused();
  await expectAccessible(page);
  await close.click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(rows(page).nth(1)).toHaveText(/^Trần BìnhXóa dữ liệuĐã thực hiện/);
  await expect(opener(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Yêu cầu dữ liệu cá nhân' })).toBeFocused();
});

for (const [status, code, sentence] of [
  [
    409,
    'request_not_pending',
    'Yêu cầu này đã được thực hiện trước đó. Danh sách đã được tải lại.',
  ],
  [404, 'not_found', 'Không còn yêu cầu này.'],
  [403, 'forbidden', 'Bạn không có quyền làm việc này.'],
] as const)
  test(`a ${status} says why, never "erased", and leaves only Đóng`, async ({ page }) => {
    await page.route('**/execute', (r) => r.fulfill(problem(status, code)));
    await openErase(page, 'admin');
    await field(page).fill(CODE);
    await eraseButton(page).click();
    const alert = dialog(page).getByRole('alert');
    await expect(alert).toContainText(sentence);
    await expect(alert).toContainText(`Mã: trace-${status}`);
    await expect(alert).toBeFocused();
    await expect(dialog(page).getByText(/Đã thực hiện|Đã xóa/)).toHaveCount(0);
    await expect(dialog(page).getByRole('button', { name: /Xóa vĩnh viễn|Thử lại/ })).toHaveCount(
      0,
    );
    await expect(dialog(page).getByRole('button', { name: 'Đóng' })).toBeEnabled();
    await expectAccessible(page);
  });

test('a 503 is not known to have erased: nothing is sent by itself, Thử lại keeps the key of the opening', async ({
  page,
}) => {
  const keys: (string | undefined)[] = [];
  let failing = true;
  await page.route('**/execute', (r) => {
    keys.push(r.request().headers()['idempotency-key']);
    return failing ? r.fulfill(problem(503, 'service_unavailable')) : r.fallback();
  });
  await openErase(page);
  await field(page).fill(CODE);
  await eraseButton(page).click();
  const alert = dialog(page).getByRole('alert');
  await expect(alert).toContainText(
    'Chưa rõ đã xóa hay chưa. Bấm Thử lại: an toàn, không xóa hai lần.',
  );
  await expect(alert).toBeFocused();
  expect(keys).toHaveLength(1); // retry: false, the client did not ask again by itself
  await dialog(page).getByRole('button', { name: 'Thử lại' }).click();
  await expect.poll(() => keys.length).toBe(2);
  await expect(alert).toBeFocused();
  // Closed and opened again: a new key.
  await dialog(page).getByRole('button', { name: 'Hủy' }).click();
  await expect(opener(page)).toBeFocused();
  await opener(page).click();
  await field(page).fill(CODE);
  failing = false;
  await eraseButton(page).click();
  await expect(dialog(page).getByRole('status')).toContainText('Đã thực hiện yêu cầu xóa.');
  expect(keys).toHaveLength(3);
  expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[0]);
});

test('a customer without a name is named by the request; the reason stays plain text', async ({
  page,
}) => {
  const [first] = REQUEST_PAGES;
  const reason = '<img src=x onerror="window.__erased=1">Xin xóa\nDòng hai';
  const data = first.data.map((r, i) =>
    i === 0 ? { ...r, customer: { ...r.customer, displayName: null }, reason } : r,
  );
  await page.route('**/v1/privacy-requests?limit=50', (r) =>
    r.fulfill({ json: { ...first, data } }),
  );
  await signIn(page, accountOf('owner'));
  await page.goto('/settings/customer-data');
  const unnamed = 'khách chưa có tên (yêu cầu 000001)';
  await page.getByRole('button', { name: `Xóa dữ liệu của ${unnamed}` }).click();
  await expect(
    page.getByRole('dialog', { name: `Xóa vĩnh viễn dữ liệu của ${unnamed}` }),
  ).toBeVisible();
  const said = dialog(page).getByRole('region', { name: 'Lý do' });
  await expect(said).toHaveText(reason);
  await expect(said.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => (window as { __erased?: number }).__erased)).toBeUndefined();
  await expectAccessible(page);
});
