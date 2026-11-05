import { expect, test, type Locator, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';

// #29 PR B1 (CEO 05/11, brief 61, tầng 2): "Mở sự cố" with a title, one of the four severities and an active Owner or Admin who
// handles it; no description, no alerts. `POST /v1/security-incidents` is served here by page.route as planned (Idempotency-Key).
type Sent = { body: unknown; key: string | undefined };
type Problem = { status: number; code: string; traceId: string };

/** Answers the POST with `refusal` once when given, then 201; what was sent is kept. */
async function serve(page: Page, refusal?: Problem) {
  const sent: Sent[] = [];
  let refuse = refusal;
  await page.route('**/v1/security-incidents', async (r) => {
    if (r.request().method() !== 'POST') return r.fallback();
    sent.push({ body: r.request().postDataJSON(), key: r.request().headers()['idempotency-key'] });
    if (refuse) {
      const { status } = refuse;
      const body = JSON.stringify(refuse);
      refuse = undefined;
      return r.fulfill({ status, contentType: 'application/problem+json', body });
    }
    return r.fulfill({ status: 201, json: { id: 'i-new' } });
  });
  return sent;
}

async function open(page: Page) {
  await page.goto('/settings/security');
  await page.getByRole('button', { name: 'Mở sự cố' }).click();
  return page.getByRole('dialog', { name: 'Mở sự cố bảo mật' });
}
const handler = (d: Locator) => d.getByRole('combobox', { name: /^Người xử lý/ });
const fill = async (d: Locator, title: string, severity?: string) => {
  await d.getByLabel('Tên sự cố (bắt buộc)').fill(title);
  if (severity) await d.getByRole('radio', { name: severity }).check();
};
const submit = (d: Locator) => d.getByRole('button', { name: 'Mở sự cố' }).click();

test('an Admin opens an incident: checked like the API, then the open list is read again', async ({
  page,
}) => {
  const sent = await serve(page);
  await signIn(page, accountOf('admin'));
  const dialog = await open(page);
  await expect(dialog.getByLabel('Tên sự cố (bắt buộc)')).toBeFocused();
  await expect(dialog.getByRole('radio')).toHaveCount(4);
  for (const s of ['Thấp', 'Trung bình', 'Cao', 'Nghiêm trọng'])
    await expect(dialog.getByRole('radio', { name: s })).toBeVisible();
  // Oneself first; only the active Owner and Admin (not Sales, a suspended Support or an expired invitation).
  await expect(handler(dialog)).toHaveValue('user-admin');
  await expect(handler(dialog).getByRole('option')).toHaveText([
    'Người thử admin · Admin',
    'Người thử owner · Owner',
  ]);
  await expect(dialog.getByRole('textbox')).toHaveCount(1); // no description (brief 61)
  await expectAccessible(page);

  await submit(dialog);
  await expect(dialog.getByRole('alert')).toHaveText('Ghi tên sự cố.');
  await fill(dialog, 'Khách 0912345678 bị lộ mật khẩu');
  await submit(dialog);
  await expect(dialog.getByRole('alert')).toContainText('Bỏ SĐT, email khỏi tên sự cố');
  await fill(dialog, '  Lộ mật khẩu tài khoản Sales  ');
  await submit(dialog);
  await expect(dialog.getByRole('alert')).toHaveText('Chọn mức độ.');
  expect(sent).toHaveLength(0);

  await dialog.getByRole('radio', { name: 'Cao' }).check();
  await handler(dialog).selectOption('user-owner');
  const reread = page.waitForRequest((r) => r.url().includes('/v1/security-incidents?status=open'));
  await submit(dialog);
  await expect(dialog).toBeHidden();
  await reread;
  expect(sent).toHaveLength(1);
  expect(sent[0]?.body).toEqual({
    title: 'Lộ mật khẩu tài khoản Sales',
    severity: 'high',
    handlerUserId: 'user-owner',
  });
  expect(sent[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.getByRole('status')).toHaveText('Đã mở sự cố. Đã ghi audit.');
  await expect(page.getByRole('status')).toBeFocused();
  await expectAccessible(page);
});

test('a 422 invalid_handler says why and reads the handlers again; the same content keeps its key', async ({
  page,
}) => {
  const sent = await serve(page, { status: 422, code: 'invalid_handler', traceId: 'trace-422' });
  await signIn(page, accountOf('owner'));
  const dialog = await open(page);
  await fill(dialog, 'Chữ ký webhook sai', 'Nghiêm trọng');
  const reread = page.waitForRequest((r) => r.url().includes('/v1/members'));
  await submit(dialog);
  const alert = dialog.getByRole('alert');
  await expect(alert).toContainText('Người xử lý phải là Owner hoặc Admin đang hoạt động.');
  await expect(alert).toContainText('Mã: trace-422');
  await reread;
  await expectAccessible(page);
  await submit(dialog);
  await expect(dialog).toBeHidden();
  expect(sent).toHaveLength(2);
  expect(sent[1]?.key).toBe(sent[0]?.key);
});

test('while the handlers load nothing can be sent; when they fail, the dialog says so with Thử lại', async ({
  page,
}) => {
  let release = () => {};
  const held = new Promise<void>((done) => (release = done));
  let failing = true;
  await page.route('**/v1/members?*', async (r) => {
    await held;
    if (!failing) return r.fallback();
    failing = false;
    return r.fulfill({
      status: 500,
      contentType: 'application/problem+json',
      body: JSON.stringify({ status: 500, code: 'internal_error', traceId: 'trace-members' }),
    });
  });
  await signIn(page, accountOf('admin'));
  const dialog = await open(page);
  await expect(handler(dialog)).toBeDisabled();
  await expect(handler(dialog)).toHaveAttribute('aria-busy', 'true');
  await expect(dialog.getByRole('button', { name: 'Mở sự cố' })).toBeDisabled();
  release();
  const alert = dialog.getByRole('alert');
  await expect(alert).toContainText('Không tải được danh sách người xử lý.');
  await expect(alert).toContainText('Mã: trace-members');
  await expectAccessible(page);
  await alert.getByRole('button', { name: 'Thử lại' }).click();
  await expect(handler(dialog)).toHaveValue('user-admin');
  await expect(dialog.getByRole('button', { name: 'Mở sự cố' })).toBeEnabled();
});
