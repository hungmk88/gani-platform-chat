import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';

// #30 PR 30b (CEO 05/11, brief 86, tầng 2): the platform operator adds a version of a channel policy, `PUT
// /v1/channel-policies/{id}` (planned S5, #610), served here by page.route with the list it rereads.
const POLICY = {
  id: '0190f100-0000-7000-8000-000000000001',
  channelType: 'zalo_oa',
  messageClass: 'advisory',
  effectiveFrom: '2023-06-19T17:00:00Z',
  freeWindowSeconds: 172800,
  freeMessageQuota: 8,
  unitPriceVnd: null,
  outsideWindowAllowed: false,
  sourceUrl: 'https://oa.zalo.me/thong-bao',
  sourceDate: '2023-06-20',
  note: 'Theo thông báo Zalo',
};

/** The list (counted), and the PUT: `refusal` once when given, else 200 with the version still in force. */
async function serve(page: Page, refusal?: { status: number; code: string; traceId: string }) {
  const sent: unknown[] = [];
  let reads = 0;
  await page.route(
    '**/v1/channel-policies',
    (r) => (reads++, r.fulfill({ json: { data: [POLICY] } })),
  );
  await page.route('**/v1/channel-policies/*', (r) => {
    if (r.request().method() !== 'PUT') return r.fallback();
    sent.push(r.request().postDataJSON());
    if (!refusal) return r.fulfill({ json: POLICY });
    return r.fulfill({
      status: refusal.status,
      contentType: 'application/problem+json',
      body: JSON.stringify(refusal),
    });
  });
  await signIn(page, accountOf('platform_operator'));
  await page.goto('/platform?tab=policies');
  await page.getByRole('button', { name: 'Thêm phiên bản cho Zalo OA · Tư vấn' }).click();
  const dialog = page.getByRole('dialog', { name: 'Thêm phiên bản: Zalo OA · Tư vấn' });
  return { sent, dialog, reads: () => reads };
}

test('the operator adds a version from a later day: every field is sent, the table keeps the one in force', async ({
  page,
}) => {
  const { sent, dialog, reads } = await serve(page);
  const day = dialog.getByLabel('Hiệu lực từ (bắt buộc)');
  await expect(day).toBeFocused();
  await expect(dialog.getByLabel(/^Khung miễn phí/)).toHaveValue('48');
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Lưu phiên bản' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Chọn ngày hiệu lực.');
  await day.fill('2023-06-20');
  await dialog.getByRole('button', { name: 'Lưu phiên bản' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'Ngày hiệu lực phải sau 20/06/2023, ngày của phiên bản đang dùng.',
  );
  expect(sent).toEqual([]);
  await day.fill('2030-01-01');
  await dialog.getByLabel(/^Giá một tin/).fill('1500');
  const before = reads();
  await dialog.getByRole('button', { name: 'Lưu phiên bản' }).click();
  await expect(dialog).toBeHidden();
  expect(sent).toEqual([
    {
      effectiveFrom: '2030-01-01T00:00:00+07:00',
      freeWindowSeconds: 172800,
      freeMessageQuota: 8,
      unitPriceVnd: 1500,
      outsideWindowAllowed: false,
      sourceUrl: 'https://oa.zalo.me/thong-bao',
      sourceDate: '2023-06-20',
      note: 'Theo thông báo Zalo',
    },
  ]);
  const status = page.getByRole('status');
  await expect(status).toHaveText(
    'Đã thêm phiên bản có hiệu lực từ 01/01/2030. Tới ngày đó bảng vẫn hiện phiên bản đang dùng. Đã ghi audit.',
  );
  await expect(status).toBeFocused();
  await expect.poll(reads).toBeGreaterThan(before);
  await expectAccessible(page);
});

test('a 422 invalid_effective_from says why with its trace, keeps the dialog and reads the list again', async ({
  page,
}) => {
  const { dialog, reads } = await serve(page, {
    status: 422,
    code: 'invalid_effective_from',
    traceId: 'trace-422',
  });
  await dialog.getByLabel('Hiệu lực từ (bắt buộc)').fill('2030-01-01');
  const before = reads();
  await dialog.getByRole('button', { name: 'Lưu phiên bản' }).click();
  await expect(dialog.getByRole('alert')).toContainText(
    'Ngày hiệu lực phải sau ngày của phiên bản đang dùng.',
  );
  await expect(dialog.getByRole('alert')).toContainText('Mã: trace-422');
  await expect(dialog).toBeVisible();
  await expect.poll(reads).toBeGreaterThan(before);
  await expectAccessible(page);
});
