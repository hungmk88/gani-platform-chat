import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// Accessibility of every step of W1–W3 (CEO brief 189, 190 B): axe-core (WCAG 2.0–2.2 A/AA) in each state, and the accessibility
// tree Chromium builds for it (`toMatchAriaSnapshot`, the roles, names and live regions a screen reader reads). This is not a test
// with NVDA or VoiceOver (none runs here): those are checked by a person before the S5 acceptance
// (docs/ui/widget-a11y-08-11-2026.md).

async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .include('[data-gani-widget]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
}

const launcher = (page: Page) =>
  page.getByRole('button', { name: 'Mở khung chat với Thương hiệu A' });
const chat = (page: Page) => page.getByRole('dialog', { name: 'Chat với Thương hiệu A' });
const host = (page: Page) => page.locator('[data-gani-widget]');

test('W1–W2: the closed button, the form and its two refusals are read with their names', async ({
  page,
}) => {
  await page.goto('/demo/index.html?brand=a');
  await expect(host(page)).toMatchAriaSnapshot(`- button "Mở khung chat với Thương hiệu A"`);
  await expectAccessible(page);

  await launcher(page).click();
  await expect(chat(page).getByLabel('Tên của bạn')).toBeFocused();
  await expect(host(page)).toMatchAriaSnapshot(`
    - dialog "Chat với Thương hiệu A":
      - banner:
        - heading "Thương hiệu A" [level=2]
        - button "Thu gọn"
      - textbox "Tên của bạn"
      - textbox "Số điện thoại (không bắt buộc)"
      - checkbox "Đồng ý nhận tin ưu đãi"
      - paragraph:
        - link "Chính sách xử lý dữ liệu"
      - button "Bắt đầu chat"
    - button "Đóng khung chat" [expanded]
  `);

  await chat(page).getByRole('button', { name: 'Bắt đầu chat' }).click();
  await expect(chat(page).getByRole('alert')).toHaveText('Nhập tên của bạn.');
  await expectAccessible(page);
  await chat(page).getByLabel('Tên của bạn').fill('Lan');
  await chat(page)
    .getByLabel(/Số điện thoại/)
    .fill('123');
  await chat(page).getByRole('button', { name: 'Bắt đầu chat' }).click();
  await expect(chat(page).getByRole('alert')).toContainText('Số điện thoại chưa đúng');
  await expectAccessible(page);
});

test('W2: the chat names who wrote each line, in a polite live list; asking to end is accessible', async ({
  page,
}) => {
  await page.goto('/demo/index.html?brand=a');
  await launcher(page).click();
  await chat(page).getByLabel('Tên của bạn').fill('Lan');
  await chat(page).getByRole('button', { name: 'Bắt đầu chat' }).click();
  const box = chat(page).getByRole('textbox', { name: 'Tin nhắn' });
  await expect(box).toBeFocused();
  await expectAccessible(page);

  await box.fill('Cho hỏi giá');
  await box.press('Enter');
  const list = chat(page).getByRole('list', { name: 'Tin nhắn' });
  await expect(list).toHaveAttribute('aria-live', 'polite');
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(chat(page)).toMatchAriaSnapshot(`
    - list "Tin nhắn":
      - listitem:
        - text: "Bạn:"
        - paragraph: Cho hỏi giá
      - listitem:
        - text: "Nhân viên:"
        - paragraph: /Nhân viên sẽ trả lời/
    - textbox "Tin nhắn"
    - button "Gửi" [disabled]
  `);
  await expect(box).toBeFocused();
  await expectAccessible(page);

  await chat(page).getByRole('button', { name: 'Kết thúc & xóa trên máy này' }).click();
  await expect(chat(page).getByRole('button', { name: 'Kết thúc', exact: true })).toBeVisible();
  await expectAccessible(page);
});

test('W3: the rating is one named group of five stars; folding and Esc give the focus back to the button', async ({
  page,
}) => {
  await page.goto('/demo/index.html?brand=a');
  await launcher(page).click();
  await chat(page).getByLabel('Tên của bạn').fill('Lan');
  await chat(page).getByRole('button', { name: 'Bắt đầu chat' }).click();
  await chat(page).getByRole('button', { name: 'Kết thúc & xóa trên máy này' }).click();
  await chat(page).getByRole('button', { name: 'Kết thúc', exact: true }).click();
  await expect(chat(page)).toMatchAriaSnapshot(`
    - group "Bạn thấy cuộc trò chuyện thế nào?":
      - radio "1 sao"
      - radio "2 sao"
      - radio "3 sao"
      - radio "4 sao"
      - radio "5 sao"
    - textbox "Góp ý (không bắt buộc)"
    - button "Gửi đánh giá" [disabled]
    - button "Bỏ qua"
  `);
  await expect(chat(page).getByRole('radio', { name: '1 sao' })).toBeFocused();
  await chat(page).getByRole('radio', { name: '4 sao' }).check();
  await expectAccessible(page);
  await chat(page).getByRole('button', { name: 'Gửi đánh giá' }).click();
  await expect(chat(page).getByRole('status')).toHaveText(
    'Cảm ơn bạn. Tin nhắn đã được xóa khỏi máy này.',
  );
  await expect(chat(page).getByLabel('Tên của bạn')).toBeFocused();
  await expectAccessible(page);

  await chat(page).getByRole('button', { name: 'Thu gọn' }).click();
  await expect(launcher(page)).toBeFocused();
  await launcher(page).click();
  await expect(chat(page).getByLabel('Tên của bạn')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(chat(page)).toHaveCount(0);
  await expect(launcher(page)).toBeFocused();
  await expect(launcher(page)).toHaveAttribute('aria-expanded', 'false');
});
