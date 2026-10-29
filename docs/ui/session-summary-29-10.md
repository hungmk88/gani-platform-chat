# Handoff FE (Gói 2): phiên 28–29/10/2026 (giờ UTC)

Nạp cho phiên mới, đọc theo thứ tự: `CLAUDE.md` (gốc) → `apps/admin/CLAUDE.md` → file này → `QUESTIONS.md` (U57–U60).
Phiên trước: `docs/ui/session-summary-28-10.md` (mục 2–4, 9 vẫn đúng, trừ chỗ file này sửa). Người giao việc: CEO (xưng "anh",
FE xưng "em", trả lời tiếng Việt).

## 1. Đã merge vào `main` trong phiên

| PR   | Nội dung                                                                                                   | Ghi chú                       |
| ---- | ---------------------------------------------------------------------------------------------------------- | ----------------------------- |
| #405 | U60 vào `QUESTIONS.md`: xin BE đặt luật ticket ở file export được                                          | Điều kiện test đồng bộ ticket |
| #408 | Tạo ticket từ hội thoại bị 404 → câu riêng `CONVERSATION_GONE` (`goneOf`), giữ form, không bỏ liên kết     | CEO chọn phương án (a)        |
| #411 | Focus ban đầu của Gán lại/Chuyển: hộp thoại khi đang tải, rồi ô "Tìm người" hoặc "Người nhận", không "Hủy" | Sau rà soát a11y 29/10        |

BE trong phiên: #406 Docker image (thêm job CI `docker`), #407 và #410 docs business (rủi ro Đợt 1), #409 khung Terraform (thêm
job CI `terraform`). `main` cuối phiên: `2032f93`. Không còn PR FE mở.

## 2. Quy ước sửa/thêm trong phiên (CEO chốt)

- **"Sẵn sàng merge"** chỉ khi đủ cả 5 điều kiện:
  - đã push hết;
  - HEAD của PR trên GitHub khớp `git ls-remote` của nhánh;
  - **TẤT CẢ job CI xanh trên đúng HEAD đó**, đếm theo `.github/workflows/ci.yml` của `main`. Không dùng con số cứng (CEO 29/10).
    Hiện 7/7: lint/typecheck/test, admin (e2e, axe), database, queue, dependency audit/secret scan, docker images, terraform;
  - job `admin (e2e, axe)` chạy thật (bước `pnpm --filter "@gani/admin..." build` success);
  - `mergeable_state` clean.
- **CEO chỉ merge khi nhận "Sẵn sàng merge" kèm mã HEAD.** Em báo "HEAD đổi" thì CEO không merge (CEO xác nhận 28/10, sau khi
  #408 merge lúc CI trên HEAD mới chưa xong).
- **Merge kiểu squash:** commit trên `main` có mã khác HEAD của PR. Kiểm lại bằng `git diff <HEAD PR> <commit main> -- <file của PR>`
  (rỗng là đúng).
- **CI của `main` có `cancel-in-progress`:** lần chạy của một commit có thể "cancelled" khi PR sau merge ngay. Xem lần chạy kế
  tiếp có chứa commit đó (`git merge-base --is-ancestor`).
- **Nhánh làm việc** `claude/cool-carson-fp5o6t` dùng lại cho mỗi PR. GitHub xóa nhánh khi PR merge. PR mới: làm lại từ
  `origin/main` mới nhất (`git checkout -B … origin/main`), rồi **push thường**. Push kiểu `--force-with-lease` bị từ chối.
- **Check-in 2 tiếng:** `trig_01Br6sSpPXw9Xej9KzBakxUt`, phút 06 mỗi 2 giờ UTC, chạy vào phiên `session_015SNdqeCQvNjK6rFoqzt5Su`.
  Prompt đã có so `planned.json` với `openapi.json` (K1–K3), U57–U60, A3 (K6). Lịch cũ `trig_0166oTCY4DnispQZhH9Va6sa` đã
  **tắt** (bắn vào phiên cũ, prompt lỗi thời). Phiên mới thì lập lịch mới cho chính nó, tắt lịch này.

## 3. Quy ước kỹ thuật mới

- **Chứng minh test bắt được lỗi** trước khi push. Bỏ phần sửa → build lại → test mới phải đỏ → hoàn lại → xanh. Ghi kết quả vào PR.
- **Hộp thoại tải dữ liệu sau khi mở** (`showModal()` lúc danh sách còn đang tải): trình duyệt đặt focus vào phần tử bấm được
  đầu tiên, thường là "Hủy". Cách làm của #411 (`src/inbox/assign-action.tsx`):
  - `<dialog tabIndex={-1}>`; lúc đang tải, focus vào chính hộp thoại;
  - đọc xong thì focus vào ô tìm (nếu có), không thì vào danh sách;
  - một `useEffect` theo `isSuccess`.
  - E2E: giữ API lại bằng `page.route` (promise "gate"), kiểm `toBeFocused` lúc đang tải và sau khi thả.
- **Spec đo tạm** (bundle, focus): đặt ở `apps/admin/e2e/` để Playwright chạy, **không commit**, xóa cùng `test-results/` sau
  khi đo.
- 404 của `POST /v1/tickets` có 3 nguồn (workspace, khách, hội thoại); API không nói nguồn nào. `goneOf` (`ticket-create.ts`)
  chọn câu theo đường mở hộp thoại.

## 4. Rà soát 29/10 (không phụ thuộc API)

**Bundle** (bản build + API giả, tắt cache, Owner):

- `/login` 495 KB JS chưa nén (khung React/Next); các màn 565–649 KB. Toàn bộ 36 chunk: 1.003 KB thô, 329 KB gzip.
- Mỗi thư viện chỉ nạp ở màn cần nó: `uqr` chỉ màn cài 2FA, `react-virtual` chỉ Hộp thư, chunk có `Intl.Segmenter` chỉ màn hội thoại.
- Không có thư viện test trong bản production. Kết quả "axe" là báo nhầm (`lowMaxes`); "playwright" chỉ là đường dẫn thư mục pnpm trong một chuỗi.
- `socket.io-client` (14 KB gzip) nạp ở mọi trang của khung app, đúng thiết kế. Chỉ Marketing/Viewer không dùng; không tách.

**Focus bàn phím:**

- Gán lại, Chuyển, Tạo ticket: không lọt focus ra trang phía sau. Mỗi vòng có một nhịp ra thanh trình duyệt (`<dialog>` gốc,
  không vi phạm WCAG).
- Esc, Hủy/Đóng: focus về lại nút đã mở hộp thoại.
- Lỗi focus vào "Hủy" đã sửa ở #411.
- Mở Chuyển bằng phím T rồi Esc: focus về phần thân trang. Chấp nhận được, vì phím tắt vẫn chạy.

## 5. Trạng thái câu hỏi

| Mã  | Trạng thái                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------- |
| U57 | Mở, đã gửi BE: `channel_unavailable` có thật "giữ tin lại" không                                                    |
| U58 | Mở, đã gửi BE: trang bảo trì "tin khách vẫn được lưu" có đúng không                                                 |
| U59 | Mở, đã gửi BE: export `ANSWERABLE` để test ô trả lời kiểm cả trạng thái                                             |
| U60 | Mở, đã gửi BE (#405): luật ticket ở file export được. `apps/api/src/modules/tickets/` mới có `schemas` và `openapi` |

CEO trực tiếp đôn đốc BE về U48, Spec M8 (hạn 30/10) và U57–U60.

## 6. Việc chờ, có điều kiện kích hoạt

| Mã           | Điều kiện (kiểm được trên repo)                             | Việc FE                                                                                                                                                                                                                                                                                 |
| ------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K1           | `/v1/tickets*` có trong `openapi.json`                      | (1) So planned với thật, **trình CEO trước khi code**. (2) `gen:api`, đổi import `planned` → `schema` ở `tickets.ts`, `ticket-detail.ts`, `ticket-create.ts` (`overview.ts` giữ tới S5); sửa `stub-tickets.ts`; rà mã lỗi. (3) Chốt `PendingPage` (`ticket-list.tsx:46-47`; đề xuất bỏ) |
| K1-d         | Sau K1                                                      | "Ticket của hội thoại này (n)" (U53, #375)                                                                                                                                                                                                                                              |
| Test đồng bộ | Sau K1 **và** U60 có trả lời                                | Như #378: `HANDLES`, `mayReadTickets`, `mayChangeTickets`, `movesFor`/`NEXT`; import mã API, không chép tay. S4 lên mà chưa export → câu hỏi mới. `picksAssignee` không thuộc test này                                                                                                  |
| K2           | `/v1/workspaces/{id}/assignees` có trong `openapi.json`     | Ô "Người nhận" giai đoạn 2 cho 5 vai trò, bỏ `/v1/members`; kiểm vai trò trả về khớp U52                                                                                                                                                                                                |
| K3           | `/v1/overview` có trong `openapi.json` (S5)                 | Test đồng bộ `scope` theo vai trò; quyết định `PendingPage`                                                                                                                                                                                                                             |
| K4, K5       | U59; U57/U58 có trả lời                                     | Thêm phần trạng thái vào A1; sửa hoặc giữ hai câu báo                                                                                                                                                                                                                                   |
| K6           | A3 của `permissions-sync.test.ts` đỏ (S4 nới đọc theo team) | Xét lại `holderOf` và việc tự về `/inbox` sau Chuyển **trước**, không sửa test cho xanh                                                                                                                                                                                                 |

Mã lỗi ticket cần rà khi K1 lên (theo planned):

- 400 `validation_failed`, gồm cả POST thiếu `Idempotency-Key`.
- 403: Marketing/Viewer; Sales đọc ticket không phải của mình; PATCH của Sales; Support xin hủy.
- 404: POST có 3 nguồn; đã có câu riêng cho trường hợp mở từ hội thoại (#408).
- 409: `idempotency_in_progress`; `version_conflict` / `invalid_transition`.
- 422: `invalid_assignee`, `idempotency_key_reused`.

## 7. Đang làm

- **Rà focus ban đầu ở 3 hộp thoại quản trị** (CEO duyệt 29/10): Người trong workspace (`workspaces/members-dialog.tsx`), Người
  của team (`teams/team-members-dialog.tsx`), Kênh của team (`teams/team-channels-dialog.tsx`). Cả ba tải danh sách sau khi mở.
  Đo trước, có lỗi thì gộp một PR theo cách #411.

## 8. Lệnh kiểm

Như mục 9 của `session-summary-28-10.md`. Playwright admin hiện **157 test**.
