# Handoff FE (Gói 2): phiên 28–30/10/2026 (giờ UTC)

Nạp cho phiên mới, đọc theo thứ tự: `CLAUDE.md` (gốc) → `apps/admin/CLAUDE.md` → file này → `QUESTIONS.md` (U57–U60).
Phiên trước: `docs/ui/session-summary-28-10.md` (mục 2–4, 9 vẫn đúng, trừ chỗ file này sửa). Người giao việc: CEO (xưng "anh",
FE xưng "em", trả lời tiếng Việt). Cập nhật lần cuối: 30/10, `main` ở `14509e9`.

## 1. Đã merge vào `main` trong phiên

| PR   | Nội dung                                                                                                       | Ghi chú                        |
| ---- | -------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| #405 | U60 vào `QUESTIONS.md`: xin BE đặt luật ticket ở file export được                                              | Điều kiện test đồng bộ ticket  |
| #408 | Tạo ticket từ hội thoại bị 404 → câu riêng `CONVERSATION_GONE` (`goneOf`), giữ form, không bỏ liên kết         | CEO chọn phương án (a)         |
| #411 | Focus ban đầu của Gán lại/Chuyển: hộp thoại khi đang tải, rồi ô "Tìm người" hoặc "Người nhận", không "Hủy"     | Sau rà soát a11y 29/10         |
| #412 | Handoff này (bản 29/10); quy ước "tất cả job CI xanh" và "chỉ merge khi có Sẵn sàng merge kèm HEAD"            | Tài liệu                       |
| #413 | Focus ban đầu của Người trong workspace, Người của team, Kênh của team: hộp thoại khi đang tải, rồi ô chọn đầu | Cùng cách #411, đo trước 29/10 |

BE trong phiên:

- #406 Docker image (thêm job CI `docker`); #409 khung Terraform (thêm job CI `terraform`).
- #407, #410 docs business (rủi ro Đợt 1).
- **#414 (30/10): trả lời U57, U58, U59.** `ANSWERABLE` dời sang `permissions.ts` và export. Kích hoạt K4, K5 (mục 6).

Không còn PR FE mở. Nhánh làm việc trùng `main`.

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
- **Phiên bị khởi động lại** (29–30/10 xảy ra nhiều lần): lệnh đang chờ phê duyệt bị hủy, việc đã kiểm xong nhưng chưa
  commit/push nằm lại ở máy. Kiểm xong thì commit và push ngay trong cùng lượt; mỗi lần khởi động lại, việc đầu tiên là
  `git status` để xem còn gì chưa đẩy. #413 code xong 29/10 nhưng đến 30/10 mới push được vì lý do này.
- **Check-in 2 tiếng:** `trig_01Br6sSpPXw9Xej9KzBakxUt`, phút 06 mỗi 2 giờ UTC, chạy vào phiên `session_015SNdqeCQvNjK6rFoqzt5Su`.
  Prompt có: so `planned.json` với `openapi.json` (K1–K3), U57–U60, A3 (K6), điều kiện "Sẵn sàng merge" ở trên. Lịch cũ
  `trig_0166oTCY4DnispQZhH9Va6sa` đã **tắt**. Phiên mới thì lập lịch mới cho chính nó, tắt lịch này.

## 3. Quy ước kỹ thuật mới

- **Chứng minh test bắt được lỗi** trước khi push. Bỏ phần sửa → build lại → test mới phải đỏ → hoàn lại → xanh. Ghi kết quả vào PR.
- **Hộp thoại đọc dữ liệu sau khi mở** (`showModal()` lúc còn đang tải): trình duyệt đặt focus vào phần tử bấm được đầu tiên,
  thường là "Hủy". Quy tắc chung đã ghi ở `apps/admin/CLAUDE.md` (Nguyên tắc thẩm mỹ):
  - `<dialog tabIndex={-1}>`; lúc đang tải, focus vào chính hộp thoại;
  - đọc xong thì focus vào ô tìm (nếu có), không thì vào danh sách (ô chọn đầu tiên với danh sách checkbox);
  - lỗi hoặc danh sách trống: focus giữ ở hộp thoại;
  - mỗi hộp thoại một `useEffect` theo trạng thái tải. **Không** gom thành hook chung: `react-hooks/exhaustive-deps` sẽ đòi đưa
    các ref vào phụ thuộc, effect chạy lại mỗi lần render và giật focus;
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

| Hộp thoại                                  | Trước                              | Sau               |
| ------------------------------------------ | ---------------------------------- | ----------------- |
| Gán lại, Chuyển                            | "Hủy" khi đang tải                 | Đã sửa (#411)     |
| Người trong workspace, Người/Kênh của team | "Hủy" khi mở **và cả sau khi tải** | Đã sửa (#413)     |
| Tạo ticket (từ danh sách và từ hội thoại)  | "Tiêu đề" (đúng)                   | Không phải sửa    |
| Các hộp thoại khác                         | Không đọc dữ liệu lúc mở           | Không mắc lỗi này |

- Không hộp thoại nào để focus lọt ra trang phía sau. Mỗi vòng Tab có một nhịp ra thanh trình duyệt (`<dialog>` gốc, không vi
  phạm WCAG). Esc, Hủy/Đóng: focus về lại nút đã mở hộp thoại.
- Mở Chuyển bằng phím T rồi Esc: focus về phần thân trang. Chấp nhận được, vì phím tắt vẫn chạy.

## 5. Trạng thái câu hỏi

| Mã  | Trạng thái                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U57 | **BE trả lời (#414):** API không trả `channel_unavailable` ở đường nào; gửi tin là bất đồng bộ, tin nằm "Chờ gửi" tới khi có outbound worker (8b). Khi có 8b: thử lại có giới hạn, hết lượt thì `failed`. Còn chờ lead BE chốt (khi làm 8b) `POST …/messages` có trả 502 không. |
| U58 | **BE trả lời (#414):** câu hiện tại sai. Chưa có chế độ bảo trì; webhook chạy cùng tiến trình API. Bỏ vế "Tin khách gửi tới vẫn được lưu". Chờ lead BE quyết khi làm bảo trì (Brief dòng 859).                                                                                  |
| U59 | **Xong (#414):** `ANSWERABLE` (`HUMAN_ACTIVE`, `PENDING_CUSTOMER`) export từ `apps/api/src/modules/conversations/permissions.ts`.                                                                                                                                               |
| U60 | Mở, đã gửi BE (#405): luật ticket ở file export được. `apps/api/src/modules/tickets/` mới có `schemas` và `openapi`.                                                                                                                                                            |

## 6. Việc đã kích hoạt (CEO duyệt 30/10)

- **K5 (PR 2, làm trước):** trang bảo trì bỏ vế "Tin khách gửi tới vẫn được lưu" (U58); câu `channel_unavailable` theo U57,
  **CEO chọn bản (a)**: "Kênh đang lỗi. Tin đã được lưu, hệ thống sẽ thử gửi lại. Nếu không gửi được, tin sẽ chuyển sang trạng
  thái thất bại." (phải nói rõ hệ quả cuối; bản ngắn chỉ dùng khi chỗ hiển thị quá chật và có đường xem giải thích đầy đủ).
  Handoff này đi cùng PR.
- **K4 (PR 1, làm sau):** A1 của `permissions-sync.test.ts` import `ANSWERABLE` từ `permissions.ts`, so `canReply` với
  `mayAct(…, 'send_message') && ANSWERABLE.has(state)` trên mọi vai trò × trạng thái × người giữ; khoảng 20–30 dòng, có đột biến.
  `permissions.ts` đã có trong `inputs` của turbo.
- Mỗi PR: nhánh mới từ `origin/main` mới nhất, push thường, chỉ merge khi CI xanh hết và có "Sẵn sàng merge" kèm HEAD.

## 7. Việc chờ, có điều kiện kích hoạt

| Mã           | Điều kiện (kiểm được trên repo)                             | Việc FE                                                                                                                                                                                                                                                                                 |
| ------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K1           | `/v1/tickets*` có trong `openapi.json`                      | (1) So planned với thật, **trình CEO trước khi code**. (2) `gen:api`, đổi import `planned` → `schema` ở `tickets.ts`, `ticket-detail.ts`, `ticket-create.ts` (`overview.ts` giữ tới S5); sửa `stub-tickets.ts`; rà mã lỗi. (3) Chốt `PendingPage` (`ticket-list.tsx:46-47`; đề xuất bỏ) |
| K1-d         | Sau K1                                                      | "Ticket của hội thoại này (n)" (U53, #375)                                                                                                                                                                                                                                              |
| Test đồng bộ | Sau K1 **và** U60 có trả lời                                | Như #378: `HANDLES`, `mayReadTickets`, `mayChangeTickets`, `movesFor`/`NEXT`; import mã API, không chép tay. S4 lên mà chưa export → câu hỏi mới. `picksAssignee` không thuộc test này                                                                                                  |
| K2           | `/v1/workspaces/{id}/assignees` có trong `openapi.json`     | Ô "Người nhận" giai đoạn 2 cho 5 vai trò, bỏ `/v1/members`; kiểm vai trò trả về khớp U52                                                                                                                                                                                                |
| K3           | `/v1/overview` có trong `openapi.json` (S5)                 | Test đồng bộ `scope` theo vai trò; quyết định `PendingPage`                                                                                                                                                                                                                             |
| K5-b         | BE làm outbound worker 8b, hoặc chế độ bảo trì (Brief 859)  | Xem lại câu `channel_unavailable` nếu `POST …/messages` trả 502; xem lại câu trang bảo trì nếu webhook nằm ngoài cổng bảo trì                                                                                                                                                           |
| K6           | A3 của `permissions-sync.test.ts` đỏ (S4 nới đọc theo team) | Xét lại `holderOf` và việc tự về `/inbox` sau Chuyển **trước**, không sửa test cho xanh                                                                                                                                                                                                 |

Mã lỗi ticket cần rà khi K1 lên (theo planned):

- 400 `validation_failed`, gồm cả POST thiếu `Idempotency-Key`.
- 403: Marketing/Viewer; Sales đọc ticket không phải của mình; PATCH của Sales; Support xin hủy.
- 404: POST có 3 nguồn; đã có câu riêng cho trường hợp mở từ hội thoại (#408).
- 409: `idempotency_in_progress`; `version_conflict` / `invalid_transition`.
- 422: `invalid_assignee`, `idempotency_key_reused`.

## 8. Lệnh kiểm

Như mục 9 của `session-summary-28-10.md`. Playwright admin hiện **158 test**.
