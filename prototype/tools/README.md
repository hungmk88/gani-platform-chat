# Kiểm tra prototype HTML (`prototype/dot1`)

Smoke test (Playwright) và kiểm tra trợ năng (axe-core) cho prototype. Thư mục này **không** thuộc workspace pnpm
và CI không chạy nó: chạy tay trước khi nộp hoặc trước khi mở PR sửa prototype.

## Chạy

```bash
cd prototype/tools
npm install
CHROMIUM_PATH=/đường/dẫn/chromium npm run smoke   # phần 1: 4 màn chính, khung app, 5 màn auth, trang hệ thống
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

Phần 2 (màn sprint sau, bàn phím ở ngăn kéo) và kiểm tra axe-core nằm ở PR kèm theo.

Phiên bản ghim: `playwright-core@1.56.1`, `axe-core@4.10.3`.
