import { expect, test, type Page } from '@playwright/test';

import type { Autonomy, Level } from '../src/autonomy/autonomy';
import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';

// #27 PR B (CEO 05/11, brief 61, tầng 3): "Hạ mức tự chủ" in two steps, no code to type; Owner or Admin (Phụ lục B). The level
// is served here as the planned `GET`/`PATCH /v1/workspaces/{id}/autonomy` would: L1 with L0 and L1 available (U29).
const L1: Autonomy = {
  level: 'L1',
  reason: 'Thử Knowledge Base tháng 11',
  changedBy: 'user-owner',
  changedAt: '2026-11-03T03:00:00.000Z',
  available: ['L0', 'L1'],
};

type Problem = { status: number; code: string; traceId: string };

/** The level at L1; a PATCH lowers it as the API would, or gets `refuse` (once) when given. The bodies sent are kept. */
async function serve(page: Page, refuse?: Problem, hold?: Promise<void>) {
  const sent: unknown[] = [];
  let level = L1;
  let refusal = refuse;
  await page.route('**/v1/workspaces/*/autonomy', async (r) => {
    if (r.request().method() !== 'PATCH') return r.fulfill({ json: level });
    const body = r.request().postDataJSON() as { level: Level; reason: string };
    sent.push(body);
    await hold;
    if (refusal) {
      const { status } = refusal;
      const problem = JSON.stringify(refusal);
      refusal = undefined;
      return r.fulfill({ status, contentType: 'application/problem+json', body: problem });
    }
    level = { ...body, changedBy: 'user-admin', changedAt: '2026-11-05T02:00:00.000Z', available: ['L0', 'L1'] };
    return r.fulfill({ json: level });
  });
  return sent;
}

const open = async (page: Page) => {
  await page.goto('/settings/autonomy');
  await page.getByRole('button', { name: 'Hạ mức…' }).click();
  return page.getByRole('dialog', { name: 'Hạ mức tự chủ — Workspace thử' });
};

test('an Admin lowers L1 to L0 in two steps; the block takes the answer and the button greys', async ({
  page,
}) => {
  const sent = await serve(page);
  await signIn(page, accountOf('admin'));
  await page.goto('/settings/autonomy');
  // L1 is of Đợt 1 (U29): no "(Đợt 2)" on it any more.
  await expect(page.getByText('L1 — AI trả lời khách chỉ từ Knowledge Base', { exact: true })).toBeVisible();
  const dialog = await open(page);
  await expect(dialog.getByRole('radio', { name: /^L0 — / })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: /^L0 — / })).toBeEnabled();
  await expect(dialog.getByRole('radio', { name: /^L1 — .*\(Mức hiện tại\)$/ })).toBeDisabled();
  await expect(dialog.getByRole('radio', { name: /\(Chờ Đợt 2\)$/ })).toHaveCount(4);
  for (const l of ['L2', 'L3', 'L4', 'L5'])
    await expect(dialog.getByRole('radio', { name: new RegExp(`^${l} — `) })).toBeDisabled();
  await expectAccessible(page);

  // No reason, no second step and nothing sent.
  await dialog.getByRole('button', { name: 'Tiếp tục' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Ghi lý do hạ mức (bắt buộc, ghi audit).');
  await dialog.getByLabel('Lý do (bắt buộc, ghi audit)').fill('  Khách phàn nàn bot  ');
  await dialog.getByRole('button', { name: 'Tiếp tục' }).click();
  await expect(dialog.getByRole('heading', { name: 'Xác nhận hạ mức' })).toBeFocused();
  await expect(dialog.getByText('Workspace thử: L1 → L0')).toBeVisible();
  await expect(dialog.getByText('Lý do: Khách phàn nàn bot')).toBeVisible();
  await expect(dialog.getByText('Nâng lại chỉ Owner làm được.')).toBeVisible();
  await expectAccessible(page);

  // Back keeps the level and the reason.
  await dialog.getByRole('button', { name: 'Quay lại' }).click();
  await expect(dialog.getByRole('radio', { name: /^L0 — / })).toBeFocused();
  await expect(dialog.getByLabel('Lý do (bắt buộc, ghi audit)')).toHaveValue('  Khách phàn nàn bot  ');
  expect(sent).toHaveLength(0);

  await dialog.getByRole('button', { name: 'Tiếp tục' }).click();
  await dialog.getByRole('button', { name: 'Hạ xuống L0' }).click();
  await expect(dialog).toBeHidden();
  expect(sent).toEqual([{ level: 'L0', reason: 'Khách phàn nàn bot' }]);
  await expect(page.getByText('L0 — Bot kịch bản, AI không trả lời khách', { exact: true })).toBeVisible();
  await expect(page.getByText('Bạn, 09:00 05/11/2026')).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Đã hạ về L0. Đã ghi audit.');
  await expect(page.getByRole('status')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Hạ mức…' })).toBeDisabled();
  await expectAccessible(page);
});

test('while lowering, nothing in the dialog can be pressed and Esc does not close it', async ({ page }) => {
  let release = () => {};
  const sent = await serve(page, undefined, new Promise<void>((done) => (release = done)));
  await signIn(page, accountOf('owner'));
  const dialog = await open(page);
  await dialog.getByLabel('Lý do (bắt buộc, ghi audit)').fill('Tạm dừng AI');
  await dialog.getByRole('button', { name: 'Tiếp tục' }).click();
  await dialog.getByRole('button', { name: 'Hạ xuống L0' }).click();
  const busy = dialog.getByRole('button', { name: 'Đang hạ mức…' });
  await expect(busy).toBeDisabled();
  await expect(busy).toHaveAttribute('aria-busy', 'true');
  await expect(dialog.getByRole('button', { name: 'Quay lại' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  release();
  await expect(dialog).toBeHidden();
  expect(sent).toHaveLength(1);
  await expect(page.getByRole('status')).toHaveText('Đã hạ về L0. Đã ghi audit.');
});

for (const [refusal, said] of [
  [{ status: 409, code: 'not_in_phase', traceId: 'trace-409' }, 'Mức này mở ở Đợt 2.'],
  [{ status: 403, code: 'forbidden', traceId: 'trace-403' }, 'Chỉ Owner hoặc Admin hạ được mức tự chủ.'],
  [
    { status: 500, code: 'internal_error', traceId: 'trace-500' },
    'Đã có lỗi, không phải do bạn. Nếu còn lỗi, gửi mã bên dưới cho Admin.',
  ],
] as const)
  test(`a ${refusal.status} ${refusal.code} says why in the dialog and keeps the level and the reason`, async ({
    page,
  }) => {
    const sent = await serve(page, refusal);
    await signIn(page, accountOf('admin'));
    const dialog = await open(page);
    await dialog.getByLabel('Lý do (bắt buộc, ghi audit)').fill('Khách phàn nàn bot');
    await dialog.getByRole('button', { name: 'Tiếp tục' }).click();
    await dialog.getByRole('button', { name: 'Hạ xuống L0' }).click();
    const alert = dialog.getByRole('alert');
    await expect(alert).toContainText(said);
    await expect(alert).toContainText(`Mã: ${refusal.traceId}`);
    await expect(page.getByText('L1 — AI trả lời khách chỉ từ Knowledge Base', { exact: true })).toBeVisible();
    await expectAccessible(page);
    await dialog.getByRole('button', { name: 'Quay lại' }).click();
    await expect(dialog.getByRole('radio', { name: /^L0 — / })).toBeChecked();
    await expect(dialog.getByLabel('Lý do (bắt buộc, ghi audit)')).toHaveValue('Khách phàn nàn bot');
    // Sent again from the same dialog, the API now lowers it.
    await dialog.getByRole('button', { name: 'Tiếp tục' }).click();
    await dialog.getByRole('button', { name: 'Hạ xuống L0' }).click();
    await expect(dialog).toBeHidden();
    expect(sent).toHaveLength(2);
  });
