import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The widget as a customer uses it, on the test page with strong CSS (demo/index.html): it loads late, stays apart from the page,
// asks before the chat, shows what is typed as plain text, and ends with a rating then wipes this device. axe-core at each step.
// The widget API is not there yet: the chat runs on demoTransport (no network).

async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .include('[data-gani-widget]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
}

const chat = (page: Page) => page.getByRole('dialog', { name: 'Chat với Thương hiệu A' });

/** Opens the window and gets past the form with a name. */
async function startChat(page: Page) {
  await page.goto('/demo/index.html?brand=a');
  await page.getByRole('button', { name: 'Mở khung chat với Thương hiệu A' }).click();
  await chat(page).getByLabel('Tên của bạn').fill('Lan');
  await chat(page).getByRole('button', { name: 'Bắt đầu chat' }).click();
  await expect(chat(page).getByRole('textbox', { name: 'Tin nhắn' })).toBeFocused();
}

test('the bundle comes on the first click, apart from the page CSS both ways', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => asked.push(new URL(r.url()).pathname));
  await page.goto('/demo/index.html?brand=b');
  const launcher = page.getByRole('button', { name: 'Mở khung chat với Thương hiệu B' });
  await expect(launcher).toHaveCSS('background-color', 'rgb(124, 58, 237)');
  await expect(launcher).toHaveCSS('font-size', '16px');
  expect(asked).not.toContain('/dist/widget.js');
  await launcher.click();
  await expect(page.getByRole('dialog', { name: 'Chat với Thương hiệu B' })).toBeVisible();
  expect(asked).toContain('/dist/widget.js');
  await expect(page.locator('body > button')).toHaveCSS('background-color', 'rgb(255, 255, 0)');
  expect(asked.every((p) => p.startsWith('/demo/') || p.startsWith('/dist/'))).toBe(true);
});

test('the form needs a name, checks the phone, and never ticks the offers', async ({ page }) => {
  await page.goto('/demo/index.html?brand=a');
  await page.getByRole('button', { name: 'Mở khung chat với Thương hiệu A' }).click();
  const form = chat(page);
  await expect(form.getByLabel('Tên của bạn')).toBeFocused();
  await expect(form.getByLabel('Đồng ý nhận tin ưu đãi')).not.toBeChecked();
  await expect(form.getByRole('link', { name: 'Chính sách xử lý dữ liệu' })).toHaveAttribute(
    'href',
    'https://example.com/chinh-sach',
  );
  await expectAccessible(page);
  await form.getByRole('button', { name: 'Bắt đầu chat' }).click();
  await expect(form.getByRole('alert')).toHaveText('Nhập tên của bạn.');
  await form.getByLabel('Tên của bạn').fill('Lan');
  await form.getByLabel(/Số điện thoại/).fill('123');
  await form.getByRole('button', { name: 'Bắt đầu chat' }).click();
  await expect(form.getByRole('alert')).toContainText('Số điện thoại chưa đúng');
});

test('what is typed shows as plain text, never runs, and the chat stays when the window is folded', async ({
  page,
}) => {
  await startChat(page);
  const hostile = '<script>window.__x=1</script><img src=x onerror="window.__x=2">';
  const box = chat(page).getByRole('textbox', { name: 'Tin nhắn' });
  await box.fill(hostile);
  await box.press('Enter');
  const list = chat(page).getByRole('list', { name: 'Tin nhắn' });
  await expect(list).toHaveAttribute('aria-live', 'polite');
  await expect(list.getByText(hostile)).toBeVisible();
  await expect(list.getByText('Nhân viên sẽ trả lời', { exact: false })).toBeVisible();
  await expect(list.getByText('Đang gửi…')).toHaveCount(0);
  expect(await page.evaluate(() => (window as { __x?: number }).__x)).toBeUndefined();
  await expectAccessible(page);
  await chat(page).getByRole('button', { name: 'Thu gọn' }).click();
  await page.getByRole('button', { name: 'Mở khung chat với Thương hiệu A' }).click();
  await expect(list.getByText(hostile)).toBeVisible();
});

test('ending asks once, then a rating of 1 to 5 stars, then the device is wiped', async ({
  page,
}) => {
  await startChat(page);
  await chat(page).getByRole('textbox', { name: 'Tin nhắn' }).fill('Cho hỏi giá');
  await chat(page).getByRole('textbox', { name: 'Tin nhắn' }).press('Enter');
  await chat(page).getByRole('button', { name: 'Kết thúc & xóa trên máy này' }).click();
  await chat(page).getByRole('button', { name: 'Không' }).click();
  await expect(chat(page).getByText('Cho hỏi giá')).toBeVisible();
  await chat(page).getByRole('button', { name: 'Kết thúc & xóa trên máy này' }).click();
  await chat(page).getByRole('button', { name: 'Kết thúc', exact: true }).click();

  const rating = chat(page).getByRole('group', { name: 'Bạn thấy cuộc trò chuyện thế nào?' });
  await expect(rating.getByRole('radio')).toHaveCount(5);
  await expect(chat(page).getByRole('button', { name: 'Gửi đánh giá' })).toBeDisabled();
  await expectAccessible(page);
  await rating.getByRole('radio', { name: '4 sao' }).check();
  await chat(page).getByLabel('Góp ý (không bắt buộc)').fill('Trả lời nhanh');
  await chat(page).getByRole('button', { name: 'Gửi đánh giá' }).click();
  await expect(chat(page).getByRole('status')).toHaveText(
    'Cảm ơn bạn. Tin nhắn đã được xóa khỏi máy này.',
  );
  await expect(chat(page).getByText('Cho hỏi giá')).toHaveCount(0);
  await expect(chat(page).getByLabel('Tên của bạn')).toBeFocused();
});

test('the rating can be skipped; on a phone the window takes the whole screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await startChat(page);
  expect(await chat(page).boundingBox()).toEqual({ x: 0, y: 0, width: 375, height: 700 });
  await chat(page).getByRole('button', { name: 'Kết thúc & xóa trên máy này' }).click();
  await chat(page).getByRole('button', { name: 'Kết thúc', exact: true }).click();
  await chat(page).getByRole('button', { name: 'Bỏ qua' }).click();
  await expect(chat(page).getByLabel('Tên của bạn')).toBeVisible();
});
