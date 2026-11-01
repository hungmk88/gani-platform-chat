import { expect, test, type Page } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';
import { BOT_FLOWS } from './stub-bot-flows';

// #17 Bot (D1a3a, CEO 01/11: Đợt 1, read only): the flows of the workspace, real API, Owner, Admin, Manager. The detail is part A2.
const LIST = '**/v1/bot-flows?*';
const rows = (page: Page) => page.getByRole('main').getByRole('table').getByRole('row');
const open = async (page: Page, who = 'owner') => {
  await signIn(page, accountOf(who));
  await page.goto('/bots');
  await expect(page.getByRole('heading', { name: 'Bot', level: 1 })).toBeVisible();
};

test('an Owner reads the flows of the workspace, last changed first, and nothing writes', async ({
  page,
}) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/v1/bot-flows')) asked.push(`${r.method()} ${new URL(r.url()).search}`);
  });
  await open(page);
  await expect(rows(page)).toHaveText([
    'FlowTrạng tháiĐã xuất bảnCập nhật',
    'Chào khách mớiĐang chạyPhiên bản 310:00 31/10/2026',
    'Ngoài giờTạm dừngPhiên bản 116:00 28/10/2026',
    'Hỏi giá sỉNháp, chưa xuất bảnChưa xuất bản08:00 27/10/2026',
  ]);
  expect(asked).toEqual(['GET ?workspaceId=ws-e2e']);
  await expect(page.getByRole('link', { name: 'Chào khách mới' })).toHaveAttribute(
    'href',
    `/bots/${BOT_FLOWS[0]!.id}`,
  );
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0);
  await expect(
    page.getByText('Chỉ xem: không tạo, sửa hay xuất bản flow ở màn này.'),
  ).toBeVisible();
  await expect(page.getByText(/flow đổi gần nhất/)).toHaveCount(0);
  await expectAccessible(page);
});

test('loading, then a failure with its trace and Thử lại, then no flow with Làm mới', async ({
  page,
}) => {
  let answer: 'slow' | 'down' | 'empty' = 'slow';
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  await page.route(LIST, async (r) => {
    if (answer === 'slow') await held;
    if (answer === 'empty') return r.fulfill({ json: { data: [] } });
    return r.fulfill({
      status: 503,
      contentType: 'application/problem+json',
      body: JSON.stringify({ status: 503, code: 'service_unavailable', traceId: 'trace-bots' }),
    });
  });
  await signIn(page, accountOf('owner'));
  await page.goto('/bots');
  await expect(page.getByRole('main').getByRole('status')).toHaveText('Đang tải danh sách flow…');
  answer = 'down';
  release();
  const alert = page.getByRole('main').getByRole('alert');
  await expect(alert).toContainText('Mã: trace-bots');
  answer = 'empty';
  await alert.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByText('Workspace chưa có flow nào.')).toBeVisible();
  await expect(page.getByRole('main').getByRole('button')).toHaveText(['Làm mới']);
  await expectAccessible(page);
});

test('a full list says only the last changed are shown; a 404 is the screen not there yet', async ({
  page,
}) => {
  let full = true;
  const many = Array.from({ length: 200 }, (_, n) => ({ ...BOT_FLOWS[0]!, id: `flow-${n}` }));
  await page.route(LIST, (r) =>
    full
      ? r.fulfill({ json: { data: many } })
      : r.fulfill({
          status: 404,
          contentType: 'application/problem+json',
          body: JSON.stringify({ status: 404, code: 'not_found', traceId: 'trace-404' }),
        }),
  );
  await open(page);
  await expect(rows(page)).toHaveCount(201);
  await expect(page.getByText(/flow đổi gần nhất/)).toHaveText('Đang hiện 200 flow đổi gần nhất.');
  full = false;
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Bot: màn này chưa có trong bản hiện tại.' }),
  ).toBeVisible();
});

test('a Manager reads the list too; Sales has no such screen, the 404 inside the frame', async ({
  page,
}) => {
  await open(page, 'manager');
  await expect(rows(page)).toHaveCount(4);
  await signIn(page, accountOf('sales'));
  const res = await page.goto('/bots');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Không tìm thấy trang.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bot', level: 1 })).toHaveCount(0);
});
