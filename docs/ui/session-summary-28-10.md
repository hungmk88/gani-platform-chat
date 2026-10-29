# Handoff FE (Gói 2): phiên 27–28/10/2026 (giờ UTC; 29/10 giờ Việt Nam)

Nạp cho phiên mới, đọc theo thứ tự: `CLAUDE.md` (gốc) → `apps/admin/CLAUDE.md` → file này → `QUESTIONS.md` (U52–U59).
Phiên trước: `docs/ui/session-summary-27-10.md`. Người giao việc: CEO (xưng "anh", FE xưng "em", trả lời tiếng Việt).

## 1. Đã merge vào `main` trong phiên (FE)

| PR         | Nội dung                                                                                                        | Issue |
| ---------- | --------------------------------------------------------------------------------------------------------------- | ----- |
| #374       | Hộp thư: kênh, đoạn trích tin cuối, tên người giữ (U30)                                                         | #373  |
| #377       | Chuyển hội thoại (T15) + phím T, hộp thoại chung với Gán lại; Sales/Support chuyển xong về `/inbox` kèm câu báo | #376  |
| #382, #384 | Chọn khách trong hộp thoại Tạo ticket; E2E "Gõ thêm để thu hẹp"                                                 | #359  |
| #388, #389 | Test đồng bộ nút hội thoại với API (`rules-sync.test.ts`), `tsconfig.build.json`, `pnpm build:e2e-check`        | #378  |
| #391       | Người nhận: "đang xử lý n/max · chờ khách m" (thư BE #387)                                                      | —     |
| #394       | Hộp thư tìm khách bằng `q` (#390 của BE)                                                                        | —     |
| #396, #397 | Câu báo lỗi không hứa điều màn không làm; "Đang tải lại"; CLAUDE.md theo thực tế; U57, U58                      | —     |
| #399       | Test đồng bộ quyền A1–A6 (`permissions-sync.test.ts`); U59                                                      | #378  |
| #401       | Hộp thư lọc theo kênh (U56 qua BE #398)                                                                         | #392  |

**Đang mở:** #403 (tiếp #401: câu "Kênh đang lọc không còn trong danh sách…", quy tắc bộ chọn E2E trong CLAUDE.md), HEAD `6095045`.
BE trong phiên: #379 backfill đoạn trích, #380 U54/U55, #383/#387 thư FE, #385 đếm tải theo trạng thái, #390 lọc `channelId`/`q`, #393 tên khách NFC, #395 đóng U30, #398 kênh cho ô lọc (U56), #400/#402 docs business.

## 2. Quy ước làm việc (CEO chốt, bắt buộc)

- **Plan trước, code sau:** mọi việc trình phương án ngắn, CEO duyệt rồi mới code. Kiểm hợp đồng thật (OpenAPI, mã controller) trước khi trình, không đoán.
- **Quy ước merge (5 lần merge thiếu commit: #365, #369, #382, #388, #396):**
  - Chỉ báo **"sẵn sàng merge"** khi: đã push hết, **HEAD của PR trên GitHub** (`gh api repos/hungmk88/gani-platform-chat/pulls/N --jq .head.sha`) khớp `git ls-remote` của nhánh, CI xanh **6/6 job** trên đúng HEAD đó (từ 28/10, CEO xác nhận: #406 thêm job `docker images (build, size, run, scan)`; trước đó 5/5), job `admin (e2e, axe)` chạy thật (bước `pnpm --filter "@gani/admin..." build` success, annotation cache), `mergeable_state` clean.
  - Hai phía cùng kiểm: CEO kiểm HEAD trước khi merge; CEO không merge PR mà em đang được yêu cầu push thêm. Em báo "HEAD đổi" thì CEO **không merge**; CEO chỉ merge khi nhận "Sẵn sàng merge" **kèm mã HEAD** (CEO xác nhận 28/10, sau #408 merge trước khi CI trên HEAD mới xong).
  - Push thêm commit vào PR đang chờ → báo ngay **"HEAD đổi, chưa merge được"**. Kiểm `merged` trước khi push; PR đã merge → **nhánh mới từ `origin/main`**, cherry-pick, PR "tiếp #N" (không dồn vào PR đã merge).
- **Không merge/approve PR, không xóa nhánh** (trừ khi CEO nói rõ cho một PR cụ thể).
- PR ≤ 400 dòng là mục tiêu; vượt thì hỏi trước. Commit nhỏ theo cụm logic, Conventional Commits, dòng cuối `Co-Authored-By: Claude <noreply@anthropic.com>`.
- **Mỗi màn một issue** (từ #15(b)). Chỗ chưa chốt → `QUESTIONS.md` (U…), gửi "BE (Gói 1)"; repo không có tài khoản GitHub riêng của BE, không `@` ai.
- **Không sửa file của BE** (ví dụ `permissions.ts`): giải thích đặt ở file FE sở hữu.
- **Check-in 2 tiếng** (routine `trig_0166oTCY4DnispQZhH9Va6sa`): main, API mới, PR mở, lệnh kiểm + exit code. Kẹt thì báo ngay, không đợi check-in.
- Báo cáo luôn có bảng lệnh + exit code thật; không pipe che exit code.

## 3. Quy ước kỹ thuật mới

- **Trước khi push:** bộ kiểm đầy đủ (mục 9) + `pnpm build:e2e-check` (build admin như job E2E: chỉ phụ thuộc của admin, tạm dời `dist/` gói khác).
- **gen:api ở máy** chỉ so `schema.d.ts` và `planned.d.ts` như `ci.yml:55`; so cả `src/api` báo lệch giả khi đang sửa `errors.ts`.
- **Test đồng bộ với luật API** (`src/inbox/rules-sync.test.ts`, `src/permissions-sync.test.ts`): import tương đối mã nguồn API (`permissions.ts`, `*.permissions.ts`, `packages/domain` `TRANSITIONS`), không chép tay luật; vai trò `satisfies Record<OrgRole, true>`; đầu file ghi hai loại đỏ (import → sửa đường dẫn + đọc `git log --follow -p`; phép so → sửa FE, không sửa test). Thêm file nguồn mới thì: `apps/admin/turbo.json` (`inputs` của `test` và `typecheck`), `apps/admin/tsconfig.build.json` (loại test khỏi `next build`). Chứng minh bằng đột biến (sửa thử luật API → đỏ → hoàn lại), ghi kết quả vào PR.
- **API giả E2E:** không sửa dữ liệu dùng chung; test cần dữ liệu riêng thì `page.route` trả dữ liệu cho riêng test đó. `stub-api.ts` ≤ 500 dòng (hiện 455).
- **Bộ chọn E2E:** nhãn bọc `<select>` → `getByRole('combobox', { name: /^…/ })`, không `getByLabel(…, { exact: true })`. Mỗi assertion phủ định (`toHaveCount(0)`) phải có bản khẳng định cùng bộ chọn.
- Câu báo không hứa điều màn không làm; tải lại bất đồng bộ thì nói "Đang tải lại", không "Đã tải lại".

## 4. Câu báo lỗi (`apps/admin/src/api/errors.ts`, 24 mã + `conflict`)

| Mã                                               | Câu hiện tại                                                                                          | Lý do                                                     |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `validation_failed` (action `show`, bỏ `fields`) | "Dữ liệu chưa hợp lệ, kiểm tra lại."                                                                  | API 400 chỉ có `detail` chữ tự do, không danh sách trường |
| 409 lạ → `conflict` (action `show`)              | "Dữ liệu vừa thay đổi. Tải lại trang rồi thử lại."                                                    | Không phải màn nào cũng tải lại                           |
| `version_conflict`                               | "Dữ liệu vừa được người khác thay đổi. Đang tải lại, kiểm tra rồi làm lại."                           | Câu hiện trước, đọc lại chạy sau                          |
| `invalid_transition`                             | "Trạng thái vừa đổi nên không làm được thao tác này. Đang tải lại, kiểm tra rồi làm lại."             | Chung hội thoại + ticket                                  |
| `invalid_assignee`                               | "Không giao được cho người này. Chọn người khác."                                                     | Chung Gán lại/Chuyển/ticket                               |
| `conversation_not_active`                        | "Không trả lời được: hội thoại chưa có người nhận hoặc đã đóng. Đang tải lại hội thoại."              |                                                           |
| `channel_window_closed`                          | "Kênh không cho gửi tin lúc này. Tin chưa gửi, nội dung vẫn ở ô soạn." + lý do                        | Đợt 1 không có ZNS/task                                   |
| Ticket: khách không còn thấy (404)               | "Khách này không còn thấy được. Đã bỏ chọn, chọn khách khác hoặc để trống."                           | CEO 28/10                                                 |
| Ô lọc kênh, kênh của URL không còn (#403)        | "Kênh đang lọc không còn trong danh sách: kênh đã bị gỡ, hoặc bạn không còn hội thoại nào ở kênh đó…" | Đúng hai lý do của #398                                   |

Chưa sửa, chờ BE: `channel_unavailable` "Tin được giữ lại để gửi sau" (U57); trang bảo trì "Tin khách gửi tới vẫn được lưu" (U58).

## 5. Trạng thái câu hỏi

| Mã       | Trạng thái                                                                                    |
| -------- | --------------------------------------------------------------------------------------------- |
| U52      | Đã trả lời (N170): người nhận ticket Owner/Admin/Manager/Support                              |
| U53      | Đã nhận (N170): `conversationId` trong planned `GET /v1/tickets`; FE chưa làm (#375)          |
| U54      | CEO chốt 28/10: lý do Chuyển thêm cùng ghi chú nội bộ `/notes`; trước đó không có ô lý do     |
| U55      | CEO chốt 28/10: không chặn gán tay/chuyển kể cả sau S4; "đã đầy" chỉ cảnh báo                 |
| U56      | **Đã trả lời: #398**, `GET /v1/conversations/channels` (mọi người đọc Hộp thư); FE làm ở #401 |
| U57      | Mở, gửi BE: `channel_unavailable` có thật "giữ tin lại" không                                 |
| U58      | Mở, gửi BE: trang bảo trì "tin khách vẫn được lưu" có đúng không                              |
| U59      | Mở, gửi BE: export `ANSWERABLE` (`send-message.controller.ts`) để A1 kiểm cả trạng thái       |
| U26, U47 | Mở (quản lý kênh; tag)                                                                        |

## 6. Việc chờ, có điều kiện kích hoạt (không "khi rảnh")

| Mã  | Điều kiện (kiểm được trên repo)                                               | Việc FE                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K1  | `/v1/tickets*` chuyển từ `docs/openapi/planned.json` sang `openapi.json` (S4) | (1) `gen:api`, import `src/tickets/*` từ `../api/schema`; **so planned với thật, trình CEO trước khi code**; (2) CEO quyết bỏ `PendingPage` khi 404; (3) test đồng bộ ticket như #378: `HANDLES` (U52), `mayReadTickets`, `mayChangeTickets`, `movesFor`/`NEXT`, `picksAssignee` (BE không export → câu hỏi U mới); (4) `stub-tickets.ts` theo schema thật; (5) rà câu lỗi ticket; (6) "Ticket của hội thoại này" (U53, #375) |
| K2  | Endpoint người nhận cấp workspace có trong `openapi.json`                     | Ô "Người nhận" giai đoạn 2 (#375): mọi vai trò tạo ticket, bỏ `/v1/members`, sửa CLAUDE.md "hai giai đoạn"; test vai trò trả về khớp U52                                                                                                                                                                                                                                                                                      |
| K3  | `/v1/overview` vào `openapi.json` (S5)                                        | Test đồng bộ `scope` theo vai trò; quyết định `PendingPage` như K1(2)                                                                                                                                                                                                                                                                                                                                                         |
| K4  | U59 trả lời                                                                   | Thêm phần trạng thái vào A1 của `permissions-sync.test.ts`                                                                                                                                                                                                                                                                                                                                                                    |
| K5  | U57/U58 trả lời                                                               | Sửa hoặc giữ hai câu                                                                                                                                                                                                                                                                                                                                                                                                          |
| K6  | `permissions-sync.test.ts` A3 đỏ (S4 nới đọc theo team)                       | Xét lại việc tự về `/inbox` sau Chuyển và `holderOf` **trước**, không sửa test cho xanh                                                                                                                                                                                                                                                                                                                                       |

Đã ghi trên GitHub: comment #375 (điều kiện S4/S5 + endpoint người nhận phải khớp U52). Đề xuất chờ CEO duyệt: thêm vào prompt check-in "so `planned.json` với `openapi.json`, báo endpoint đã chuyển" để K1–K3 tự hiện.

## 7. Tiến độ (ước tính của FE, 28/10, cơ sở ghi rõ)

| Phần                                                                                                                            | Đã xong                                                                                                                               | Tỷ lệ                      |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Mục menu Đợt 1 có màn thật (18 mục: Hộp thư, Khách hàng, Lead, Ticket, Bot, Tổng quan, 10 mục Cài đặt, Platform, Hồ sơ cá nhân) | 10: Hộp thư, Khách hàng (+ hồ sơ), Ticket (+ chi tiết, tạo), Tổng quan, Workspace, Thành viên, Team, Kênh, Mẫu trả lời, Hồ sơ cá nhân | **≈ 56%**                  |
| Trong đó chạy trên API thật (không phải planned)                                                                                | 8/10 (Ticket chờ S4, Tổng quan chờ S5)                                                                                                |                            |
| Luồng ngoài khung: đăng nhập, 2FA, nhận lời mời, quên mật khẩu, trang hệ thống                                                  | đủ                                                                                                                                    | **100%**                   |
| Widget W1–W3                                                                                                                    | xong, chạy `demoTransport` chờ API `/v1/widget/*`                                                                                     | **100% FE, 0% nối API**    |
| Hộp thư (I1a–c, I2, realtime, U30, U31, Chuyển, Gán lại, tìm, lọc kênh)                                                         | đủ phần có API; còn ghi chú nội bộ, tag, SLA (chờ API)                                                                                | **≈ 85%**                  |
| 8 mục chưa có màn                                                                                                               | Lead, Bot, Dữ liệu khách, AI nội bộ, Tự chủ & feature flag, Audit log, Bảo mật, Platform                                              | đa số chờ API (S5, U26, …) |

**Toàn bộ FE Đợt 1 (Gói 2): ≈ 60%** (trọng số theo mục menu, Hộp thư nặng gấp đôi). Phần còn lại phần lớn bị chặn bởi API chưa có; phần FE làm được ngay hiện chủ yếu là chuẩn bị S4 (mục 6).

## 8. Đang chạy

- Routine check-in 2 tiếng: `trig_0166oTCY4DnispQZhH9Va6sa`.
- Tự kiểm PR #403: `trig_01NUYPNrcFiBQCdidDdgK1tW` (hủy khi #403 merge).

## 9. Lệnh kiểm (trước mỗi push)

`pnpm install --frozen-lockfile` · `pnpm turbo run build --filter=@gani/worker^... --filter=@gani/api^...` · `pnpm --filter @gani/admin gen:api && git diff --exit-code -- apps/admin/src/api/schema.d.ts apps/admin/src/api/planned.d.ts` · `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm format:check` · `env -u NODE_ENV pnpm --filter @gani/admin build` · `pnpm build:e2e-check` · `cd apps/admin && CHROMIUM_PATH=/opt/pw-browsers/chromium env -u NODE_ENV pnpm exec playwright test` (155 test) · quét secret theo `CLAUDE.md`.
