import { expect, test, type Page, type Request } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';

// #21 Workspace, tab "Ngày nghỉ", 2b-ii (CEO 03/11, brief 52–53): adding carries an Idempotency-Key, changing sends only what
// changed, removing asks once more; 422 holiday_overlap and holiday_in_past say what to do. Real API (#570, #571). Reading: 2b-i.
const isHolidays = (u: URL) => /^\/v1\/workspaces\/[^/]+\/holidays(\/[^/]+)?$/.test(u.pathname);
const rows = (page: Page) => page.getByRole('region', { name: 'Ngày nghỉ' }).getByRole('row');
const dialog = (page: Page) => page.getByRole('dialog');
const writes = (page: Page) => {
  const sent: Request[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' && isHolidays(new URL(r.url()))) sent.push(r);
  });
  return sent;
};
const fill = async (page: Page, name: string, from: string, to: string) => {
  await dialog(page).getByLabel('Tên ngày nghỉ').fill(name);
  await dialog(page).getByLabel('Từ ngày').fill(from);
  await dialog(page)
    .getByLabel(/^Đến ngày/)
    .fill(to);
};
const opening = async (page: Page, role: 'admin' | 'owner') => {
  await signIn(page, accountOf(role));
  await page.goto('/settings/workspace?tab=holidays');
  await expect(rows(page)).toHaveCount(3);
};

test('an Admin adds a day off with a key, changes only the end of another, and removes one after asking', async ({
  page,
}) => {
  const sent = writes(page);
  await opening(page, 'admin');
  await expect(rows(page)).toHaveText([
    'Ngày nghỉNgàyThao tác',
    'Tết Dương lịch01/01/2030SửaXóa',
    'Tết Nguyên đán01/02/2030 – 07/02/2030SửaXóa',
  ]);
  await page.getByRole('button', { name: 'Thêm ngày nghỉ' }).click();
  await fill(page, '  Giỗ Tổ Hùng Vương ', '2030-04-12', '2030-04-12');
  await expectAccessible(page);
  await dialog(page).getByRole('button', { name: 'Thêm ngày nghỉ' }).click();
  await expect(page.getByRole('status')).toHaveText('Đã thêm ngày nghỉ Giỗ Tổ Hùng Vương.');
  expect(sent[0]!.method()).toBe('POST');
  expect(sent[0]!.headers()['idempotency-key']).toBeTruthy();
  expect(sent[0]!.postDataJSON()).toEqual({
    name: 'Giỗ Tổ Hùng Vương',
    startsOn: '2030-04-12',
    endsOn: '2030-04-12',
  });
  await expect(rows(page).nth(3)).toHaveText('Giỗ Tổ Hùng Vương12/04/2030SửaXóa');

  await page.getByRole('button', { name: 'Sửa ngày nghỉ Tết Nguyên đán' }).click();
  await dialog(page).getByRole('button', { name: 'Lưu ngày nghỉ' }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(sent).toHaveLength(1);
  await page.getByRole('button', { name: 'Sửa ngày nghỉ Tết Nguyên đán' }).click();
  await dialog(page)
    .getByLabel(/^Đến ngày/)
    .fill('2030-02-08');
  await dialog(page).getByRole('button', { name: 'Lưu ngày nghỉ' }).click();
  await expect(page.getByRole('status')).toHaveText('Đã sửa ngày nghỉ Tết Nguyên đán.');
  expect(sent[1]!.method()).toBe('PATCH');
  expect(sent[1]!.postDataJSON()).toEqual({ endsOn: '2030-02-08' });
  await expect(rows(page).nth(2)).toHaveText('Tết Nguyên đán01/02/2030 – 08/02/2030SửaXóa');

  await page.getByRole('button', { name: 'Xóa ngày nghỉ Tết Dương lịch' }).click();
  await expect(dialog(page)).toContainText(
    '01/01/2030 thành ngày làm việc theo giờ làm việc của workspace.',
  );
  await expectAccessible(page);
  await dialog(page).getByRole('button', { name: 'Hủy' }).click();
  expect(sent).toHaveLength(2);
  await page.getByRole('button', { name: 'Xóa ngày nghỉ Tết Dương lịch' }).click();
  await dialog(page).getByRole('button', { name: 'Xóa ngày nghỉ' }).click();
  await expect(page.getByRole('status')).toHaveText('Đã xóa ngày nghỉ Tết Dương lịch.');
  expect(sent[2]!.method()).toBe('DELETE');
  await expect(rows(page)).toHaveCount(3);
});

test('overlapping and past days off say what to do and keep the form; the same day off keeps its key', async ({
  page,
}) => {
  const sent = writes(page);
  await opening(page, 'owner');
  await page.getByRole('button', { name: 'Thêm ngày nghỉ' }).click();
  const alert = dialog(page).getByRole('alert');
  const add = dialog(page).getByRole('button', { name: 'Thêm ngày nghỉ' });
  await add.click();
  await expect(alert).toHaveText('Nhập tên ngày nghỉ.');
  await fill(page, 'Nghỉ bù', '2030-02-10', '2030-02-09');
  await add.click();
  await expect(alert).toHaveText('Ngày kết thúc phải từ ngày bắt đầu trở đi.');
  expect(sent).toHaveLength(0);

  await fill(page, 'Nghỉ bù', '2030-02-06', '2030-02-09');
  await add.click();
  await expect(alert).toContainText(
    'Ngày nghỉ này trùng với một ngày nghỉ khác của workspace. Đổi ngày, hoặc sửa ngày nghỉ đang có.',
  );
  await expect(alert).toContainText('Mã: trace-e2e-422');
  await expect(dialog(page).getByLabel('Tên ngày nghỉ')).toHaveValue('Nghỉ bù');
  await expectAccessible(page);
  await add.click();
  await expect(alert).toContainText('trùng với một ngày nghỉ khác');
  expect(sent[1]!.headers()['idempotency-key']).toBe(sent[0]!.headers()['idempotency-key']);

  await fill(page, 'Nghỉ bù', '2020-01-02', '2020-01-02');
  await add.click();
  await expect(alert).toContainText(
    'Ngày nghỉ đã qua không thêm, sửa hay xóa được. Chọn ngày từ hôm nay trở đi.',
  );
  expect(sent[2]!.headers()['idempotency-key']).not.toBe(sent[0]!.headers()['idempotency-key']);

  // Changing an existing one onto the dates of another is refused the same way.
  await dialog(page).getByRole('button', { name: 'Hủy' }).click();
  await page.getByRole('button', { name: 'Sửa ngày nghỉ Tết Dương lịch' }).click();
  await dialog(page)
    .getByLabel(/^Đến ngày/)
    .fill('2030-02-02');
  await dialog(page).getByRole('button', { name: 'Lưu ngày nghỉ' }).click();
  await expect(alert).toContainText('trùng với một ngày nghỉ khác');
  expect(sent[3]!.postDataJSON()).toEqual({ endsOn: '2030-02-02' });
  await dialog(page).getByRole('button', { name: 'Hủy' }).click();
  await expect(rows(page).nth(1)).toHaveText('Tết Dương lịch01/01/2030SửaXóa');
});
