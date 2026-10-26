# Handoff FE (Gói 2): phiên 26–27/10/2026

Đọc cùng `CLAUDE.md` (gốc) và `apps/admin/CLAUDE.md`, `apps/widget/CLAUDE.md` trước khi làm tiếp.

## 1. Đã xong (đã merge vào `main`)

| Mảng | PR |
|---|---|
| Hộp thư: `{{customer_name}}` (U37), tên khách trên dòng và đầu hội thoại (U30 phần có API) | #326, #343 |
| #7 Khách hàng: danh sách, tìm theo tên/SĐT/cả email (U48), SĐT che theo vai trò | #330, #348 |
| #8 Hồ sơ khách + Sửa hồ sơ (`PATCH /v1/customers/{id}`) | #331, #334 |
| #22 Xem trước mẫu đang soạn (U38) | #338 |
| Widget W1 (loader + Shadow DOM), W2 (form trước chat, hội thoại, gửi lại cùng Idempotency-Key, Kết thúc & xóa), W3 (đánh giá 1–5 sao, E2E + axe widget trong CI) | #327, #336, #340 |
| Docs: QUESTIONS U27/U28/U29/U35, L2–L5 disabled Đợt 1, U38 xong; spec M8 bản nháp 3; prototype khớp quyết định | #318, #319, #320, #322, #325, #328, #332, #342 |

## 2. Đang mở / chưa mở PR

| Việc | Nhánh | Trạng thái |
|---|---|---|
| #16 Tổng quan (5 thẻ, `GET /v1/overview` planned S5) | `feat/admin-overview` | **PR #347**. CI đỏ vì `planned.d.ts` cũ sau #344; đã merge main + sinh lại, push 27/10, chờ CI xanh rồi CĐT merge |
| #14 Ticket danh sách (`GET /v1/tickets` planned S4) | `feat/admin-tickets-list` | Đã push, **chưa mở PR** (dựng trên #347). Khi #347 merge: merge main vào nhánh, kiểm đủ, mở PR. 489 dòng, CEO đã cho giữ 1 PR |

## 3. Tình trạng API (27/10)

- **Đã có trên main:** khách hàng (`/v1/customers`, `/{id}`, PATCH, tìm email U48), `Conversation.customer`, `POST /v1/quick-replies/preview` (U38).
- **Chưa có:** U30 phần còn lại (`channel`, `lastMessagePreview`, `assignee`, lọc `channelId`/`q`), U31 (`GET /v1/conversations/{id}/assignees`), API widget `/v1/widget/*`.
- **Hợp đồng planned** (`docs/openapi/planned.json`, N167; chưa phục vụ): Ticket (S4), Tổng quan, feature flag, mức tự chủ (S5), P7, E20. FE sinh kiểu vào `apps/admin/src/api/planned.d.ts` bằng `pnpm --filter @gani/admin gen:api`; CI kiểm lệch. Backend sửa `planned.json` thì phải sinh lại (lỗi CI #347).

## 4. Quy ước đã chốt trong phiên

- Màn dựng theo hợp đồng planned: gọi API thật; **API trả 404 (chưa phục vụ) → hiện `PendingPage`** ("<mục>: màn này chưa có trong bản hiện tại."). Không dữ liệu giả trên production, không cờ môi trường (CEO 26/10).
- Dữ liệu giả chỉ trong E2E: API giả Node `apps/admin/e2e/stub-*.ts`, gọi qua `e2e/stub-routes.ts` (giữ `stub-api.ts` ≤ 500 dòng). Mỗi tình huống là một email (`+no-overview@`, `+no-tickets@` → 404). Repo không dùng MSW: API giả đã đóng vai trò đó cho Playwright; thêm MSW là hệ giả lập thứ hai, cần CEO duyệt trước.
- Widget: màn chỉ biết `Transport` (`apps/widget/src/transport.ts`); W2/W3 chạy `demoTransport` tới khi có API widget.
- PR > 400 dòng: hỏi CEO trước khi push (đến nay CEO đều chọn giữ 1 PR khi phần vượt chủ yếu là test).
- Giải xung đột: merge main (không rebase); không làm mất thay đổi của main ở file khác (ví dụ dòng U34 trong `apps/admin/CLAUDE.md`).

## 5. Việc tiếp theo

1. #347 xanh → CĐT merge → mở PR #14 từ `feat/admin-tickets-list`.
2. #15 Chi tiết ticket theo `planned.json`: `GET /v1/tickets/{id}` (kèm `events`, cũ trước), `PATCH` đổi trạng thái theo N167 (new → in_progress → waiting_customer ⇄ in_progress → done; done mở lại được; `cancelled` từ mọi trạng thái mở, chỉ Owner/Admin/Manager, là cuối), `version` cho xung đột; tạo ticket `POST /v1/tickets` (Owner/Admin/Manager/Sales/Support). Nhánh dựng từ `feat/admin-tickets-list`; 404 → `PendingPage`.
3. Khi Backend merge U30/U31 hoặc chuyển endpoint từ planned sang `openapi.json`: ưu tiên nối API (Hộp thư: kênh, đoạn trích, người phụ trách; Chuyển hội thoại).
4. Sau đó (chờ CEO duyệt): #27 Tự chủ + feature flag theo planned (L0–L1 bật, L2–L5 xám "Chờ Đợt 2"; cờ `ai.internal`, `ai.customer_reply` tắt Đợt 1, `channel.zalo`, `channel.webchat`), P7, E20.

## 6. Lệnh kiểm (trước mỗi push)

`pnpm install --frozen-lockfile` · `pnpm turbo run build --filter=@gani/worker^... --filter=@gani/api^...` · `pnpm lint` · `pnpm typecheck` · `pnpm format:check` · `pnpm --filter @gani/admin test` · `env -u NODE_ENV pnpm --filter @gani/admin build` · `cd apps/admin && CHROMIUM_PATH=/opt/pw-browsers/chromium env -u NODE_ENV pnpm exec playwright test` · widget: `pnpm --filter @gani/widget build && pnpm --filter @gani/widget e2e` · quét secret theo `CLAUDE.md`.
