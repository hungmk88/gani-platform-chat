# Tổng kết phiên FE — 01/11 → 02/11/2026

Người soạn: FE (Claude, phiên `session_015SNdqeCQvNjK6rFoqzt5Su`) · Chốt lúc: 02/11/2026 khoảng 08:55 UTC.
Mọi mốc giờ là UTC, lấy từ commit squash (luật CEO). `main` lúc chốt: **`33fb511`** (#530). Đưa vào repo theo brief CEO 02/11
(Session ID `session_015SNdqeCQvNjK6rFoqzt5Su`) mục 3, để không mất khi container khởi động lại.

## 1. Trạng thái lúc chốt

| Việc | Trạng thái |
|---|---|
| Branch protection `main` | `strict` bật, `enforce_admins` bật, 9 required check gồm `docker images`: không đổi cả phiên |
| PR FE đang mở | Chỉ PR docs đưa file này vào repo |
| 12a Pipeline lead (#12) | Code xong, kiểm local xanh; nhánh backup `feat/leads-12a-board` HEAD `4a9b367` (brief 32), **chưa mở PR**; chặn tới khi BE xác nhận hình dạng Lead |
| Hạn BE xác nhận hình dạng Lead | 08:00 UTC 03/11 (brief 31); lần kiểm hẹn 07:50 UTC 03/11 (`trig_016M5XujGNbDRuP56TadGUkq`) |
| Brief gửi BE `2810-02112026-BE-BRIEF-01` | CEO đã ký và gửi; BE chưa trả lời (`planned.json` chưa có `/v1/leads`) |
| U77 (Bot flows, câu hỏi cho BE) | Vẫn mở |
| PR BE đang theo dõi (kênh 2b) | Không có (#530 đã merge) |
| Lần kiểm 2 giờ | `trig_01Br6sSpPXw9Xej9KzBakxUt`, phút 06 mỗi 2 giờ; nội dung cập nhật theo brief 31 |

## 2. PR merge trong phiên

### 2.1 PR của FE

| PR | Nội dung | Merge (squash) | CI trước / sau merge |
|---|---|---|---|
| #512 | #17 Bot, danh sách flow chỉ đọc (A1) | 01/11 13:53:23 · `5aa652a` | 9/9 / 9/9 |
| #514 | #17 Bot, chi tiết flow chỉ đọc (A2) | 01/11 14:19:32 · `6356b02` | 9/9 / 9/9 |
| #516 | #17 Bot, các bước dạng danh sách (B), 414 dòng (CEO chấp nhận) | 01/11 14:46:47 · `803d0bd` | 9/9 / 9/9 |
| #517 | Docs: tầng 1 code tự push/merge, bỏ docker local, trần 500 | 01/11 15:06:05 · `a7c66e9` | 8 + skip / 9/9 |
| #519 | Docs: tiến độ 01/11, bảng 58 mã | 01/11 17:36:30 · `5ebfa49` | 8 + skip / 9/9 |
| #520 | Docs: check-in 3 kênh, PR theo template | 02/11 04:51:58 · `6c32e3f` | 8 + skip / 9/9 |
| #523 | Docs: đồng hồ heads-up vào `CLAUDE.md` gốc; B1 sau #521–#525 và điều kiện "có"; handoff | 02/11 07:20:28 · `c909d29` | 8 + skip (HEAD `b44a7ff`) / 9/9 (run 41405676004); diff HEAD vs squash rỗng |

#523: Update branch đúng một lần (brief 28), bỏ điều kiện chờ U77 (brief 28).

### 2.2 PR của BE (FE chỉ theo dõi, không comment)

| PR | Nội dung | Merge (squash) | Ghi chú |
|---|---|---|---|
| #521 | O1: lease, lần thử kế tiếp `message_deliveries` | 05:05:28 · `878ec01` | Tầng 2, heads-up 04:30:06; dẫn tới luật đồng hồ heads-up |
| #522 | O2a: kho outbound worker | 05:13:02 · `17962d6` | Tầng 1 code, auto-merge sau 9/9 |
| #524 | O2b: job gửi + `ChannelSender` | 05:20:21 · `f810f0b` | Kênh 2b bỏ lỡ (mở-merge giữa hai lần kiểm) |
| #525 | O2c: nối worker, tắt tới O3 | 05:37:05 · `c0a843c` | CI lần đầu đỏ coverage, BE thêm test rồi mới merge |
| #526 | D1d-1: `simulate` trong `bot-runtime` | 06:11:49 · `8d87e70` | +375/−50, phần vượt là test bắt buộc |
| #527 | D1d-2: `POST /v1/bot-flows/{id}/dry-run` | 06:33:48 · `96d397b` | CI lần đầu đỏ lint, sửa rồi 9/9; FE biết muộn (07:13) |
| #528 | N187, cập nhật U63 trong `QUESTIONS.md` | 08:04:39 · `43c7822` | Heads-up 06:56:51 hủy, heads-up lần 2 07:33:59 sau CI xanh trên `51c0565`; merge sau 30 phút 40 giây: đúng luật |
| #529 | Tiến độ của BE, file riêng `progress-20261102.md` | 08:10:59 · `fae3f2a` | Tầng 1 docs; CI trên `3310a77` 8 + skip |
| #530 | K1a: bảng `tickets`, `ticket_events` | 08:48:28 · `33fb511` | Tầng 2; CI 9/9 thật trên `237a153` (xong 08:16:09), heads-up 08:17:44, merge sau 30 phút 44 giây: đúng luật; không đổi hợp đồng FE dùng |

Tất cả trong luật; không có PR merge không qua tín hiệu, không có `hold`, branch protection không đổi.

## 3. Brief CEO trong phiên (tóm tắt quyết định)

| Brief | Quyết định chính |
|---|---|
| 15–17 | Chờ U77, không mở code mới. Check-in 3 kênh: kênh 1 webhook tạm đóng; kênh 2 kiểm 2 giờ; kênh 2b `subscribe_pr_activity` cho PR BE (chỉ theo dõi); kênh 3 CEO ping. 30 phút chỉ khi có việc mở thật. PR theo template từ #520 |
| 19–20 | Đồng hồ heads-up 30 phút (a) comment đã đăng, (b) 9 job xanh thật, (c) `clean`; push thêm thì về 0; không tính "30 phút từ lúc comment" tách khỏi điều kiện. Mở #523 draft |
| (ghi nhớ) | Kênh 2b bù bằng đọc 10 commit gần nhất trên `main` mỗi lần kiểm 2 giờ. B1 chỉ đổi khi tin thật ra Zalo |
| 24 | C20, D15 giữ "chưa xác định", không chặn. Q1 CEO lo với pháp lý, B2 (#26 production) giữ hoãn. Soạn brief gửi BE đề nghị hợp đồng planned Lead và tag/trường tùy chỉnh |
| 25 | Ký brief gửi BE `2810-02112026-BE-BRIEF-01`: Lead trước 10/11 (cùng mốc N172), tag + trường tùy chỉnh trước 16/11 |
| 26 | Mục dry-run của S4 giữ 0 tới khi endpoint vào `openapi.json` trên `main`; màn Bot giữ chỉ đọc, không nút chạy thử |
| 27 | FE không nhận được (CEO xác nhận bị cắt khi soạn) |
| 28 | Merge #523 ngay (bỏ chờ U77). Dựng 3 màn trên hợp đồng nháp: #12, #13, #23; chỉ route có trong P9 và `endpoint-M8.md`; route chưa có thì ghi rõ |
| 29 | #12: bước pipeline và lý do Thua đọc từ API, không ghi cứng; Thắng/Thua là cột phụ; 12a chỉ đọc trước, 12b ghi sau; hoãn 12c tạo lead |
| 30 | Chọn B (tách 2 PR); theo hình dạng Lead của BE nhưng phải BE xác nhận bằng văn bản trước khi push; đường bước: `/v1/workspaces/{id}/pipeline`, bỏ `/v1/leads/stages` |
| 31 | Tách 2 PR, PR 1 trước rồi PR 2. D2/S4 cập nhật ở lần đo đầy đủ tiếp theo. Review chéo qua handoff, không comment GitHub. Hạn BE 24 giờ |
| 32 | Push nhánh 12a lên remote làm backup, không mở PR |
| 02/11 (Session ID `session_015SNdqeCQvNjK6rFoqzt5Su`) | Giữ 12a chưa mở PR tới khi BE xác nhận. Duyệt: PR 1 mở từ nhánh mới trỏ `2d3c055`; PR 1 merge rồi Update branch `feat/leads-12a-board`, mở PR 2. Mở PR docs đưa file tổng kết này vào repo. Chuẩn bị phương án #13a, #23 trên hợp đồng nháp |

Brief bị từ chối (đúng luật): một "brief gửi BE dev" lọt vào phiên FE (không `[GỬI FE]`, không Session ID, không chữ ký A); một brief có `[GỬI FE]` nhưng thiếu Session ID và chữ ký (CEO gửi lại thành brief 31).

## 4. Luật và cách làm mới trong phiên

- **Đồng hồ heads-up 30 phút** (ký A 02/11): đã vào `CLAUDE.md` gốc qua #523.
- **B1 Zalo gửi/nhận chỉ "có" khi đủ đồng thời:** (a) O3 có adapter Zalo thật, `createChannelSenders` trả ít nhất một sender;
  (b) `OUTBOUND_ENABLED=1` không bị từ chối; (c) bằng chứng tin thật ra Zalo. O2d, O2e… không đổi B1.
- **PR docs:** 8 success + `docker images` skipped, hoặc `docker images` chạy thật cũng đạt. PR code: 9/9 thật, `docker images` không skip.
- **Kênh 2b:** che PR đã biết mở; PR mở-merge giữa hai lần kiểm (#524, #525, #526, #527) bù bằng đọc 10 commit trên `main`.
- **Review chéo:** BE sửa U-series hoặc file FE phụ trách → FE ghi handoff (PR, mục, đúng/sai), CEO quyết ping BE. Lần đầu: U63 trong #528, đúng, không ping.
- **Đối chiếu tiến độ BE:** FE đọc, đối chiếu, báo CEO; không sửa bảng của BE; BE không sửa bảng của FE.
- **Brief hợp lệ:** phải có `[GỬI FE]` + Session ID + "Người ký: A (CEO)"; thiếu một trong ba thì từ chối, kể cả nội dung có vẻ đúng.

## 5. 12a Pipeline lead (#12) — chi tiết

**Nhánh:** `feat/leads-12a-board` (nền `c909d29`), push 02/11 làm backup, không CI, không PR.

| Commit | Sẽ là | Nội dung | Dòng |
|---|---|---|---|
| `2d3c055` | PR 1 | `src/leads/leads.ts` (kiểu Lead viết tay theo brief BE 02/11), `leads.test.ts`, `e2e/stub-leads.ts`, `e2e/stub-routes.ts`, `docs/ui/lead-shape-from-be.md`, handoff review chéo | +284/−2 |
| `4a9b367` | PR 2 | `app/(app)/leads/page.tsx`, `src/leads/lead-board.tsx`, `e2e/leads.spec.ts`, `e2e/system-pages.spec.ts`, `apps/admin/CLAUDE.md` | +368 |

**Màn:** Kanban chỉ đọc, mọi vai trò của công ty; các bước theo thứ tự API (`GET /v1/workspaces/{id}/pipeline`), rồi cột phụ
Thắng, Thua; thẻ có `title`, khách, phụ trách, nhãn bước, nhãn trạng thái; lý do Thua hiện khi hover/focus (tooltip,
`aria-describedby`); "Tải thêm" theo cursor; 404 → `PendingPage`; đang tải, lỗi (mã + Thử lại), trống (Làm mới). Không có tên
bước hay lý do Thua trong mã; API giả trả "chờ Q9, dữ liệu tạm".

**Kiểm local (lần cuối, trước brief 31):**

| Lệnh | Exit | Ghi chú |
|---|---|---|
| `pnpm lint` (root) | 0 | |
| `pnpm --filter @gani/admin typecheck` | 0 | |
| `pnpm --filter @gani/admin test` | 0 | 53 file, 323 test |
| `pnpm format:check` | 0 | |
| `pnpm build:e2e-check` | 0 | |
| E2E admin toàn bộ | 0 | 234/234 |

**Chờ BE xác nhận 7 giả định** trong `docs/ui/lead-shape-from-be.md`: kiểu trường; trường có thể `null`; giá trị `status`
(`open`/`won`/`lost`); `stage` của lead đã đóng; câu trả lời `GET /v1/leads` (`{data, nextCursor}`); câu trả lời `/pipeline`
(`{data: [{id, name}]}`); quyền đọc.

**Cách mở PR khi BE xác nhận (CEO duyệt 02/11):** PR 1 mở từ một nhánh mới trỏ `2d3c055`; PR 1 merge rồi Update branch
`feat/leads-12a-board` và mở PR 2 (`4a9b367`). Chỉ push và mở PR sau khi CEO gửi văn bản xác nhận của BE.

**Sau 12a:** #13a chi tiết lead chỉ đọc (cần `GET /v1/leads/{id}` và lịch sử, chưa có trong P9), rồi #23 tag + trường tùy chỉnh
(`endpoint-M8.md`). 12b (ghi), 12c (tạo lead) hoãn tới hợp đồng thật.

## 6. Tiến độ

| Mẫu số | FE 01/11 (`803d0bd`) | BE 02/11 (`fae3f2a`, file riêng #529) |
|---|---|---|
| A. Tính năng Đợt 1 (58 mã) | 21,5/58 ≈ 37 % | 22/58 ≈ 38 % (D2 lên "có") |
| B. Deliverable S1–S5 (29) | 16/29 ≈ 55 % | 17/29 ≈ 59 % (S4 dry-run 0 → 1) |
| C. Màn FE (30) | 17/30 ≈ 57 % | không đo |
| D. Cả hợp đồng (135 mã) | 21,5/135 ≈ 16 % | 22/135 ≈ 16 % |

FE đối chiếu: cách chấm khớp, chỉ khác ngày đo. D2/S4 trong bảng FE cập nhật ở lần đo đầy đủ tiếp theo, sau 12a (brief 31).
Đường găng: B1 (gửi tin ra Zalo) chờ O3 + Q6. FE thiếu việc vì 7 màn chưa có hợp đồng; 3 màn (#12, #13, #23) đang làm trên hợp đồng nháp.

## 7. Câu hỏi và việc đang chờ

| Mục | Ai | Ghi chú |
|---|---|---|
| Xác nhận hình dạng Lead (7 giả định) | BE qua CEO | Hạn 08:00 UTC 03/11 |
| Hợp đồng planned Lead / tag + trường tùy chỉnh | BE | Hạn 10/11 / 16/11 (brief BE 01) |
| U77 Bot flows (mô tả, `inactive`, trần 200) | BE | Không chặn |
| Q1 pháp lý AI production | CEO + pháp lý | Chưa có mốc; B2 #26 hoãn |
| Q2, Q6, Q7/Q8, Q9 | CEO | Q9: tên 6 bước, lý do Thua |
| U47 (tag cấp nào, ẩn tag), U62 (hợp đồng Lead) | BE | |
| U60, U62, U64–U76 | BE | |
| C-01 (HIGH, sơ đồ proxy N112), E-01, F-01, G-01 | — | Theo `00-summary.md`, chưa kiểm lại |

## 8. Sự cố và ghi chú quy trình

- **Brief lẫn:** brief "BE dev" lọt vào phiên FE; FE từ chối (thiếu `[GỬI FE]`, Session ID, chữ ký). Brief 30 ghi nhầm nguồn A/B/C
  (thực ra là phương án tách PR của báo cáo 12a FE); CEO xác nhận ở brief 31.
- **Hook dừng phiên vs `CLAUDE.md`:** hook đòi commit/push trong lúc luật "vượt trần báo trước khi push"; FE giữ luật, cất `git stash`,
  báo CEO; brief 32 chốt push nhánh backup không mở PR.
- **CI bị hủy:** push `1245657` khi CI `5c40094` đang chạy (`cancel-in-progress: true`) → run trên `5c40094` bị hủy, CI trên HEAD mới thay thế.
- **Đính chính số liệu:** HEAD `main` 02/11 là `f810f0b` (#524), không phải `17962d6`; mốc 10/11 là N172 (hạn CEO trả lời Q1, Q2, Q7),
  không phải hạn S4 (S4 = 28/12, P21 dòng 908); #529 merge 08:10:59 theo commit squash (GitHub ghi `merged_at` 08:11:00).
- **Môi trường:** container có thể khởi động lại; việc dở phải lên remote (brief 32). Docker Hub 429 ở local nên không chạy job
  `docker images` local (luật 01/11). Sau #527 phải `pnpm install` lại vì API thêm phụ thuộc `@gani/bot-runtime`.

## 9. File đã xuất cho CEO (02/11, từ `main` `fae3f2a`)

`CLAUDE.md` gốc và 9 `CLAUDE.md` thư mục con (`apps/admin`, `apps/api`, `apps/widget`, `apps/worker`, `evals`, `infra`,
`packages/ai-core`, `packages/db`, `prompts`); `docs/brief-backend-core-v1.0.md` (Brief hiện hành; hồ sơ gốc và phụ lục thắng khi
mâu thuẫn); `docs/implementation-brief.md` (v0.4, đã thay thế, giữ làm lịch sử); `docs/reviews/00-summary.md`; `QUESTIONS.md`.
`apps/admin/CLAUDE.md` trên `main` chưa có mục "Pipeline lead (#12)": mục đó ở commit `4a9b367` của nhánh 12a.
