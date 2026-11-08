import { expect, test, type Page, type Request } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';

// #21 Workspace, tab "Giờ làm việc", 2a-ii (CEO 03/11, brief 53): "Sửa giờ làm việc" opens the week in inputs, saved whole with a
// PUT of `/v1/workspaces/{id}/business-hours` (real API, #566); a week the API would refuse is never sent. Reading it: 2a-i.
const isHours = (u: URL) => /^\/v1\/workspaces\/[^/]+\/business-hours$/.test(u.pathname);
const rows = (page: Page) => page.getByRole('region', { name: 'Giờ làm việc' }).getByRole('row');
const edit = (page: Page) => page.getByRole('button', { name: 'Sửa giờ làm việc' });
const save = (page: Page) => page.getByRole('button', { name: 'Lưu giờ làm việc' });
const alert = (page: Page) => page.getByRole('main').getByRole('alert');
const puts = (page: Page) => {
  const sent: Request[] = [];
  page.on('request', (r) => {
    if (r.method() === 'PUT' && isHours(new URL(r.url()))) sent.push(r);
  });
  return sent;
};
const opening = async (page: Page, role: 'admin' | 'owner') => {
  await signIn(page, accountOf(role));
  await page.goto('/settings/workspace?tab=hours');
  await edit(page).click();
  await expect(page.getByLabel('Thứ 2 làm việc')).toBeFocused();
};

test('an Admin opens Saturday morning, moves the Monday break, closes Friday and saves the whole week', async ({
  page,
}) => {
  const sent = puts(page);
  await opening(page, 'admin');
  await expect(page.getByLabel('Thứ 2 mở cửa')).toHaveValue('08:00');
  await expect(page.getByLabel('Thứ 7 làm việc')).not.toBeChecked();
  await expect(page.getByLabel('Thứ 7 mở cửa')).toBeDisabled();
  await expect(save(page)).toBeDisabled();
  await expectAccessible(page);

  await page.getByLabel('Thứ 7 làm việc').check();
  await page.getByLabel('Thứ 7 mở cửa').fill('08:00');
  await page.getByLabel('Thứ 7 đóng cửa').fill('12:00');
  await page.getByLabel('Thứ 2 nghỉ giữa ca từ').fill('11:30');
  await page.getByLabel('Thứ 2 nghỉ giữa ca đến').fill('12:30');
  await page.getByLabel('Thứ 6 làm việc').uncheck();
  await expect(page.getByLabel('Thứ 6 mở cửa')).toBeDisabled();
  await save(page).click();
  await expect(page.getByRole('main').getByRole('status')).toHaveText('Đã lưu giờ làm việc.');
  await expect(edit(page)).toBeFocused();
  await expect(rows(page)).toHaveText([
    'NgàyLàm việcMở cửaĐóng cửaNghỉ giữa ca từNghỉ giữa ca đến',
    'Thứ 2Có08:0017:3011:3012:30',
    ...['Thứ 3', 'Thứ 4', 'Thứ 5'].map((d) => `${d}Có08:0017:3012:0013:00`),
    'Thứ 6Nghỉ————',
    'Thứ 7Có08:0012:00——',
    'Chủ nhậtNghỉ————',
  ]);
  await expect(page.getByText(/đang dùng tuần mặc định của hệ thống/)).toHaveCount(0);
  const none = { opensAt: null, closesAt: null, breakStartsAt: null, breakEndsAt: null };
  const day = (
    weekday: number,
    closesAt = '17:30',
    b: string | null = '12:00',
    e: string | null = '13:00',
  ) => ({ weekday, open: true, opensAt: '08:00', closesAt, breakStartsAt: b, breakEndsAt: e });
  expect(sent).toHaveLength(1);
  expect(sent[0]!.postDataJSON()).toEqual({
    week: [
      day(1, '17:30', '11:30', '12:30'),
      day(2),
      day(3),
      day(4),
      { weekday: 5, open: false, ...none },
      day(6, '12:00', null, null),
      { weekday: 7, open: false, ...none },
    ],
  });
  await expectAccessible(page);

  await page.reload();
  await expect(rows(page).nth(6)).toHaveText('Thứ 7Có08:0012:00——');
});

test('the three rules and their edges say what to fix and send nothing; a closed day drops what its inputs held', async ({
  page,
}) => {
  const sent = puts(page);
  await opening(page, 'owner');
  // Closing after opening, strictly.
  await page.getByLabel('Thứ 3 đóng cửa').fill('07:00');
  await save(page).click();
  await expect(alert(page)).toHaveText('Thứ 3: giờ đóng cửa phải sau giờ mở cửa.');
  await page.getByLabel('Thứ 3 đóng cửa').fill('08:00');
  await expect(alert(page)).toHaveCount(0);
  await save(page).click();
  await expect(alert(page)).toHaveText('Thứ 3: giờ đóng cửa phải sau giờ mở cửa.');
  await page.getByLabel('Thứ 3 đóng cửa').fill('18:00');
  // A break of both ends, strictly inside the day (08:00 and 17:30 themselves are outside); the Q7 default has one, so one end goes.
  await page.getByLabel('Thứ 4 nghỉ giữa ca đến').fill('');
  await page.getByLabel('Thứ 4 nghỉ giữa ca từ').fill('12:00');
  await save(page).click();
  await expect(alert(page)).toHaveText(
    'Thứ 4: nhập đủ hai giờ nghỉ giữa ca, hoặc để trống cả hai.',
  );
  for (const [from, to] of [
    ['08:00', '09:00'],
    ['17:00', '17:30'],
    ['13:00', '12:00'],
  ]) {
    await page.getByLabel('Thứ 4 nghỉ giữa ca từ').fill(from!);
    await page.getByLabel('Thứ 4 nghỉ giữa ca đến').fill(to!);
    await save(page).click();
    await expect(alert(page)).toHaveText('Thứ 4: giờ nghỉ giữa ca phải nằm trong giờ làm việc.');
  }
  await expectAccessible(page);
  // An open day has both hours; a closed one has none, whatever its inputs still hold.
  await page.getByLabel('Chủ nhật làm việc').check();
  await save(page).click();
  await expect(alert(page)).toHaveText('Thứ 4: giờ nghỉ giữa ca phải nằm trong giờ làm việc.');
  await page.getByLabel('Thứ 4 làm việc').uncheck();
  await save(page).click();
  await expect(alert(page)).toHaveText('Chủ nhật: nhập giờ mở cửa và giờ đóng cửa.');
  expect(sent).toHaveLength(0);
  await page.getByLabel('Chủ nhật làm việc').uncheck();
  await save(page).click();
  await expect(page.getByRole('main').getByRole('status')).toHaveText('Đã lưu giờ làm việc.');
  expect(sent).toHaveLength(1);
  expect((sent[0]!.postDataJSON() as { week: unknown[] }).week[2]).toEqual({
    weekday: 3,
    open: false,
    opensAt: null,
    closesAt: null,
    breakStartsAt: null,
    breakEndsAt: null,
  });
});

test('Hủy leaves the week as it was; a refused save keeps the edits and says why', async ({
  page,
}) => {
  const sent = puts(page);
  let refuse = true;
  await page.route(isHours, (r) =>
    r.request().method() === 'PUT' && refuse
      ? r.fulfill({
          status: 503,
          contentType: 'application/problem+json',
          body: JSON.stringify({ status: 503, code: 'service_unavailable', traceId: 'trace-put' }),
        })
      : r.fallback(),
  );
  await opening(page, 'admin');
  await page.getByLabel('Thứ 2 đóng cửa').fill('17:00');
  await page.getByRole('button', { name: 'Hủy' }).click();
  await expect(edit(page)).toBeFocused();
  await expect(rows(page).nth(1)).toHaveText('Thứ 2Có08:0017:3012:0013:00');
  expect(sent).toHaveLength(0);

  await edit(page).click();
  await page.getByLabel('Thứ 2 đóng cửa').fill('17:00');
  await save(page).click();
  await expect(alert(page)).toContainText('Mã: trace-put');
  await expect(page.getByLabel('Thứ 2 đóng cửa')).toHaveValue('17:00');
  // Axe in this state too (CEO brief 171 C).
  await expectAccessible(page);
  refuse = false;
  await save(page).click();
  await expect(page.getByRole('main').getByRole('status')).toHaveText('Đã lưu giờ làm việc.');
  await expect(rows(page).nth(1)).toHaveText('Thứ 2Có08:0017:0012:0013:00');
});
