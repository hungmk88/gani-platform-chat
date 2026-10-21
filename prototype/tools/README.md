# Kiểm tra prototype HTML (`prototype/dot1`)

Smoke test (Playwright) và kiểm tra trợ năng (axe-core) cho prototype. Thư mục này **không** thuộc workspace pnpm
và CI không chạy nó: chạy tay trước khi nộp hoặc trước khi mở PR sửa prototype.

## Chạy

```bash
cd prototype/tools
npm install
CHROMIUM_PATH=/đường/dẫn/chromium npm run smoke   # phần 1 rồi phần 2
CHROMIUM_PATH=/đường/dẫn/chromium npm run axe     # WCAG 2.1 A/AA trên các màn chính
```

- `CHROMIUM_PATH`: Chromium có sẵn trên máy. Bỏ trống thì `playwright-core` dùng bản nó tìm được
  (cần `npx playwright-core install chromium` một lần).
- `SHOTS_DIR=/thư/mục`: chụp ảnh các màn chính vào thư mục này (không bắt buộc).
- `PROTOTYPE_DIR`: mặc định `../dot1`.

Thoát `0` khi mọi kiểm tra đạt; thoát `1` và in danh sách `FAIL …` khi có kiểm tra hỏng hoặc trang có lỗi
(`pageerror`, `console.error`). Theo `CLAUDE.md`, báo exit code thật, không nối `| tail` hay `| grep`.

## Nội dung

| File | Kiểm tra |
|---|---|
| `lib.mjs` | Mở trang, bắt lỗi trang, `check`, chụp ảnh, mở mọi trạng thái × 8 vai trò |
| `smoke-core.mjs` | Phụ lục C v3 dòng 0–9: luồng chính, quyền theo Phụ lục B, T2 (chuỗi `<script>` hiện dạng chữ), trạng thái bắt buộc |
| `smoke-screens.mjs` | Các sửa lỗi sau phần 1, phần bổ sung theo Phụ lục C (#3, #13, SLA tạm dừng, "Không áp dụng"), màn sprint sau (#14–#16, #24, #25, #27, #28, #30), bàn phím ở ngăn kéo |
| `axe.mjs` | axe-core, WCAG 2.1 A/AA, trên các màn và trạng thái chính; thoát 1 nếu có vi phạm |

Phiên bản ghim: `playwright-core@1.56.1`, `axe-core@4.10.3`.
