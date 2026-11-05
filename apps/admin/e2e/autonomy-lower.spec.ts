import { expect, test, type Locator, type Page } from '@playwright/test';

import type { Autonomy, Level } from '../src/autonomy/autonomy';
import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';

// #27 PR B (CEO 05/11, brief 61, tầng 3): "Hạ mức tự chủ" in two steps, no code to type; Owner or Admin (Phụ lục B). The level
// is served as the planned `GET`/`PATCH /v1/workspaces/{id}/autonomy` would: L1, with L0 and L1 available (U29).
type Problem = { status: number; code: string; traceId: string };
const AT_L1 = 'L1 — AI trả lời khách chỉ từ Knowledge Base';
const at = (
  level: Level,
  reason: string,
  changedBy: string,
  changedAt: string | null,
): Autonomy => ({ level, reason, changedBy, changedAt, available: ['L0', 'L1'] });

/** The level at L1; a PATCH (held until `hold`) lowers it as the API would, or gets `refusal` when given. Bodies sent are kept. */
async function serve(page: Page, refusal?: Problem, hold?: Promise<void>) {
  const sent: unknown[] = [];
  let level = at('L1', 'Thử KB', 'user-owner', null);
  await page.route('**/v1/workspaces/*/autonomy', async (r) => {
    if (r.request().method() !== 'PATCH') return r.fulfill({ json: level });
    const body = r.request().postDataJSON() as { level: Level; reason: string };
    sent.push(body);
    await hold;
    if (refusal)
      return r.fulfill({
        status: refusal.status,
        contentType: 'application/problem+json',
        body: JSON.stringify(refusal),
      });
    level = at(body.level, body.reason, 'user-admin', '2026-11-05T02:00:00.000Z');
    return r.fulfill({ json: level });
  });
  return sent;
}

/** Opens the dialog, writes `reason` and goes to the second step when given. */
async function open(page: Page, reason?: string) {
  await page.goto('/settings/autonomy');
  await page.getByRole('button', { name: 'Hạ mức…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Hạ mức tự chủ — Workspace thử' });
  if (reason !== undefined) {
    await reasonOf(dialog).fill(reason);
    await dialog.getByRole('button', { name: 'Tiếp tục' }).click();
  }
  return dialog;
}
const reasonOf = (dialog: Locator) => dialog.getByLabel('Lý do (bắt buộc, ghi audit)');
const lowerTo = (dialog: Locator) => dialog.getByRole('button', { name: 'Hạ xuống L0' }).click();

test('an Admin lowers L1 to L0 in two steps; the block takes the answer and the button greys', async ({
  page,
}) => {
  const sent = await serve(page);
  await signIn(page, accountOf('admin'));
  const dialog = await open(page);
  await expect(page.getByText(AT_L1, { exact: true })).toBeVisible(); // no "(Đợt 2)" on L1 (U29)
  await expect(dialog.getByRole('radio', { name: /^L0 — / })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: /^L1 — .*\(Mức hiện tại\)$/ })).toBeDisabled();
  await expect(dialog.getByRole('radio', { name: /\(Chờ Đợt 2\)$/ })).toHaveCount(4);
  await expect(dialog.getByRole('radio', { name: /^L5 — / })).toBeDisabled();
  await expectAccessible(page);

  // No reason: no second step, nothing sent.
  await dialog.getByRole('button', { name: 'Tiếp tục' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Ghi lý do hạ mức (bắt buộc, ghi audit).');
  await reasonOf(dialog).fill('  Khách phàn nàn bot  ');
  await dialog.getByRole('button', { name: 'Tiếp tục' }).click();
  await expect(dialog.getByRole('heading', { name: 'Xác nhận hạ mức' })).toBeFocused();
  await expect(dialog).toContainText(
    'Workspace thử: L1 → L0Lý do: Khách phàn nàn botNâng lại chỉ Owner làm được.',
  );
  await expectAccessible(page);

  // Back keeps the level and the reason.
  await dialog.getByRole('button', { name: 'Quay lại' }).click();
  await expect(dialog.getByRole('radio', { name: /^L0 — / })).toBeFocused();
  await expect(reasonOf(dialog)).toHaveValue('  Khách phàn nàn bot  ');
  expect(sent).toHaveLength(0);

  await dialog.getByRole('button', { name: 'Tiếp tục' }).click();
  await lowerTo(dialog);
  await expect(dialog).toBeHidden();
  expect(sent).toEqual([{ level: 'L0', reason: 'Khách phàn nàn bot' }]);
  await expect(
    page.getByText('L0 — Bot kịch bản, AI không trả lời khách', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Bạn, 09:00 05/11/2026')).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Đã hạ về L0. Đã ghi audit.');
  await expect(page.getByRole('status')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Hạ mức…' })).toBeDisabled();
  await expectAccessible(page);
});

test('while an Owner lowers it, nothing in the dialog can be pressed and Esc does not close it', async ({
  page,
}) => {
  let release = () => {};
  await serve(page, undefined, new Promise<void>((done) => (release = done)));
  await signIn(page, accountOf('owner'));
  const dialog = await open(page, 'Tạm dừng AI');
  await lowerTo(dialog);
  await expect(dialog.getByRole('button', { name: 'Đang hạ mức…' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Quay lại' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  release();
  await expect(page.getByRole('status')).toHaveText('Đã hạ về L0. Đã ghi audit.');
});

for (const [refusal, said] of [
  [{ status: 409, code: 'not_in_phase', traceId: 'trace-409' }, 'Mức này mở ở Đợt 2.'],
  [
    { status: 403, code: 'forbidden', traceId: 'trace-403' },
    'Chỉ Owner hoặc Admin hạ được mức tự chủ.',
  ],
  [{ status: 500, code: 'internal_error', traceId: 'trace-500' }, 'Đã có lỗi, không phải do bạn.'],
] as const)
  test(`a ${refusal.status} ${refusal.code} says why in the dialog and keeps the level and the reason`, async ({
    page,
  }) => {
    await serve(page, refusal);
    await signIn(page, accountOf('admin'));
    const dialog = await open(page, 'Khách phàn nàn bot');
    await lowerTo(dialog);
    await expect(dialog.getByRole('alert')).toContainText(`${said}`);
    await expect(dialog.getByRole('alert')).toContainText(`Mã: ${refusal.traceId}`);
    await expect(page.getByText(AT_L1, { exact: true })).toBeVisible();
    await expectAccessible(page);
    await dialog.getByRole('button', { name: 'Quay lại' }).click();
    await expect(dialog.getByRole('radio', { name: /^L0 — / })).toBeChecked();
    await expect(reasonOf(dialog)).toHaveValue('Khách phàn nàn bot');
  });
