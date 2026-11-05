import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';

// #29 PR B2 (CEO 05/11, brief 61, 70, tầng 3): "Giao lại…" and "Đóng…" on an open incident, `PATCH /v1/security-incidents/{id}`
// served here by page.route as planned: `{status: "closed"}` (a closed one stays closed) or `{handlerUserId}`.
type Problem = { status: number; code: string; traceId: string };
const FIRST = 'Đăng nhập sai liên tục vào tài khoản Admin';
const SECOND = 'Chữ ký webhook Zalo sai nhiều lần';

/** Answers the PATCH with `refusal` once when given, then 200; what was sent is kept with the id it went to. */
async function serve(page: Page, refusal?: Problem) {
  const sent: { id: string | undefined; body: unknown }[] = [];
  let refuse = refusal;
  await page.route('**/v1/security-incidents/*', async (r) => {
    if (r.request().method() !== 'PATCH') return r.fallback();
    sent.push({
      id: new URL(r.request().url()).pathname.split('/').pop(),
      body: r.request().postDataJSON(),
    });
    if (!refuse) return r.fulfill({ json: {} });
    const { status } = refuse;
    const body = JSON.stringify(refuse);
    refuse = undefined;
    return r.fulfill({ status, contentType: 'application/problem+json', body });
  });
  return sent;
}

test('an Admin closes an open incident after one more look; the list is read again', async ({
  page,
}) => {
  const sent = await serve(page);
  await signIn(page, accountOf('admin'));
  await page.goto('/settings/security');
  await page.getByRole('button', { name: `Đóng sự cố ${FIRST}` }).click();
  const dialog = page.getByRole('dialog', { name: `Đóng sự cố “${FIRST}”` });
  await expect(dialog).toBeFocused(); // never on "Đóng sự cố" or "Hủy"
  await expect(dialog).toContainText('Sự cố đã đóng không mở lại được.');
  await expectAccessible(page);
  const reread = page.waitForRequest((r) => r.url().includes('/v1/security-incidents?status=open'));
  await dialog.getByRole('button', { name: 'Đóng sự cố' }).click();
  await expect(dialog).toBeHidden();
  await reread;
  expect(sent).toEqual([
    { id: '0190e000-0000-7000-8000-000000000001', body: { status: 'closed' } },
  ]);
  await expect(page.getByRole('status')).toHaveText('Đã đóng sự cố. Đã ghi audit.');
  await expect(page.getByRole('status')).toBeFocused();
  await expectAccessible(page);
});

test('an Owner hands an incident to another active Owner or Admin', async ({ page }) => {
  const sent = await serve(page);
  await signIn(page, accountOf('owner'));
  await page.goto('/settings/security');
  await page.getByRole('button', { name: `Giao lại sự cố ${SECOND}` }).click();
  const dialog = page.getByRole('dialog', { name: `Giao lại sự cố “${SECOND}”` });
  await expect(dialog).toContainText('Người xử lý hiện tại: Trần Bình');
  const handler = dialog.getByRole('combobox', { name: /^Người xử lý/ });
  await expect(handler).toBeFocused();
  await expect(handler.getByRole('option')).toHaveText([
    'Người thử admin · Admin',
    'Người thử owner · Owner',
  ]);
  await expectAccessible(page);
  await handler.selectOption('user-owner');
  await dialog.getByRole('button', { name: 'Giao' }).click();
  await expect(dialog).toBeHidden();
  expect(sent).toEqual([
    { id: '0190e000-0000-7000-8000-000000000002', body: { handlerUserId: 'user-owner' } },
  ]);
  await expect(page.getByRole('status')).toHaveText('Đã giao lại sự cố. Đã ghi audit.');
});

for (const [refusal, button, said, reread] of [
  [
    { status: 409, code: 'incident_closed', traceId: 'trace-409' },
    `Đóng sự cố ${FIRST}`,
    'Sự cố này đã đóng. Đang tải lại danh sách.',
    '/v1/security-incidents?status=open',
  ],
  [
    { status: 422, code: 'invalid_handler', traceId: 'trace-422' },
    `Giao lại sự cố ${SECOND}`,
    'Người xử lý phải là Owner hoặc Admin đang hoạt động.',
    '/v1/members',
  ],
] as const)
  test(`a ${refusal.status} ${refusal.code} says why, keeps the dialog and reads again what changed`, async ({
    page,
  }) => {
    await serve(page, refusal);
    await signIn(page, accountOf('admin'));
    await page.goto('/settings/security');
    await page.getByRole('button', { name: button }).click();
    const dialog = page.getByRole('dialog');
    const again = page.waitForRequest((r) => r.url().includes(reread));
    await dialog.getByRole('button', { name: /^(Đóng sự cố|Giao)$/ }).click();
    await expect(dialog.getByRole('alert')).toContainText(said);
    await expect(dialog.getByRole('alert')).toContainText(`Mã: ${refusal.traceId}`);
    await again;
    await expect(dialog).toBeVisible();
    await expectAccessible(page);
  });
