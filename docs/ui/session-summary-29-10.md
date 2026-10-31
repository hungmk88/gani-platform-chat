# Handoff FE (Gói 2): phiên 28–30/10/2026 (giờ UTC)

Nạp cho phiên mới, đọc theo thứ tự: `CLAUDE.md` (gốc) → `apps/admin/CLAUDE.md` → file này → `QUESTIONS.md` (U57–U60).
Phiên trước: `docs/ui/session-summary-28-10.md` (mục 2–4, 9 vẫn đúng, trừ chỗ file này sửa). Người giao việc: CEO (xưng "anh",
FE xưng "em", trả lời tiếng Việt). Cập nhật lần cuối: 30/10, `main` ở `0503a00`.

## 1. Đã merge vào `main` trong phiên

| PR   | Nội dung                                                                                                       | Ghi chú                        |
| ---- | -------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| #405 | U60 vào `QUESTIONS.md`: xin BE đặt luật ticket ở file export được                                              | Điều kiện test đồng bộ ticket  |
| #408 | Tạo ticket từ hội thoại bị 404 → câu riêng `CONVERSATION_GONE` (`goneOf`), giữ form, không bỏ liên kết         | CEO chọn phương án (a)         |
| #411 | Focus ban đầu của Gán lại/Chuyển: hộp thoại khi đang tải, rồi ô "Tìm người" hoặc "Người nhận", không "Hủy"     | Sau rà soát a11y 29/10         |
| #412 | Handoff này (bản 29/10); quy ước "tất cả job CI xanh" và "chỉ merge khi có Sẵn sàng merge kèm HEAD"            | Tài liệu                       |
| #413 | Focus ban đầu của Người trong workspace, Người của team, Kênh của team: hộp thoại khi đang tải, rồi ô chọn đầu | Cùng cách #411, đo trước 29/10 |
| #416 | K5: câu `channel_unavailable` (U57, bản (a)) và trang bảo trì bỏ vế sai (U58); handoff cập nhật tới 30/10      | `main` `063202c`               |
| #417 | K4: A1 của `permissions-sync.test.ts` so `canReply` theo cả trạng thái, đọc `ANSWERABLE` của API (U59)         | `main` `6cb9e7a`; chỉ test     |

BE trong phiên:

- #406 Docker image (thêm job CI `docker`); #409 khung Terraform (thêm job CI `terraform`).
- #407, #410 docs business (rủi ro Đợt 1).
- **#414 (30/10): trả lời U57, U58, U59.** `ANSWERABLE` dời sang `permissions.ts` và export. Kích hoạt K4, K5 (mục 6).
- #415 docs reviews (tóm tắt phiên K); #418 tài liệu gửi lead BE xác nhận U41, U44, U45, U46, U47, U51.

Không còn PR FE mở. Nhánh làm việc trùng `main`.

## 2. Quy ước sửa/thêm trong phiên (CEO chốt)

- **"Sẵn sàng merge"** chỉ khi đủ cả 5 điều kiện:
  - đã push hết;
  - HEAD của PR trên GitHub khớp `git ls-remote` của nhánh;
  - **TẤT CẢ job CI xanh trên đúng HEAD đó**, đếm theo `.github/workflows/ci.yml` của `main`. Không dùng con số cứng (CEO 29/10).
    Hiện 8 check (từ #420): changes (docker needed?), lint/typecheck/test, admin (e2e, axe), database, queue,
    dependency audit/secret scan, docker images, terraform;
  - job `admin (e2e, axe)` chạy thật (bước `pnpm --filter "@gani/admin..." build` success);
  - `mergeable_state` clean.
- **Job `skipped` (CEO 30/10, sửa luật sau #420):** **chỉ job `docker images`** được `skipped`, và chỉ trên PR chỉ sửa `*.md`
  (do job `changes (docker needed?)` quyết định). Mọi job khác, **kể cả `terraform`**, phải chạy và xanh. PR có file code,
  config hay dependency mà job `docker` bị `skipped` là bất thường: dừng, báo CEO. Khi báo "Sẵn sàng merge": nêu tên từng job,
  đếm đúng số check thực tế (hiện 8), ghi "N success + M skipped (doc-only)". `unstable` khi CI còn chạy là bình thường; chỉ báo
  khi mọi check đã xong và `mergeable_state = clean`. (Bản trước ghi "docker/terraform" là sai.)
- **Job CI mới trên `main` (CEO 30/10, sau #436 thêm `coverage`, nay 9 job):** mọi PR đang mở phải cập nhật từ `main`
  (merge `origin/main` vào nhánh, **không rebase**) để chạy đủ job mới **trước khi** báo "Sẵn sàng merge". PR mới: kiểm nhánh
  đã có commit thêm job (`git merge-base --is-ancestor <commit> HEAD` exit 0). Một PR đã merge mà thiếu job mới (#438): **bắt
  buộc** kiểm run CI trên `main` chứa commit squash, mọi job kể cả job mới xanh, **trước khi** bắt đầu việc tiếp theo; run bị
  `cancel-in-progress` hủy thì tìm run kế tiếp chứa commit đó.
- **PR mở ở trạng thái draft** (CEO 30/10, sau #438 và #441 merge khi chưa có "Sẵn sàng merge"): chỉ chuyển sang ready khi đã
  kiểm đủ điều kiện và gửi "Sẵn sàng merge"; GitHub chặn merge PR draft. Đề xuất branch protection trên `main`: U71.
- **Mốc thời gian (CEO 31/10):** mọi mốc thời gian ghi vào handoff phải lấy từ dòng thời gian GitHub (`issues/*/timeline`,
  trường `created_at`), không lấy từ giờ thông báo về phiên; chênh lệch thường 2–6 giây. Chỉ ghi dữ kiện (tài khoản nào),
  không suy diễn người làm.
- **Lệnh dừng merge chỉ áp dụng FE; BE vẫn merge; trước mỗi bước phải kiểm lại HEAD `main` hiện tại** (CEO 31/10). Không dùng
  kết quả CI cũ của một HEAD `main` đã qua.
- **Phân tầng merge (CEO 31/10), có hiệu lực từ 31/10:**
  - (1) `main` có required check `lint, typecheck, test` và `enforce_admins` bật: CEO bật 31/10, FE đọc lại 07:56 UTC;
  - (2) **Điều kiện comment #457 bỏ; thay bằng: CEO comment phê duyệt vào từng PR tầng 3 trước khi merge** (CEO 31/10);
  - (3) trước mỗi bước, CI trên HEAD `main` hiện tại xanh 9/9 theo tên.

  Các luật "Sẵn sàng merge" ở trên nay áp cho tầng 3; tầng 1/2 theo bảng dưới.
- **Branch protection + required check có hiệu lực từ 31/10 (FE đọc lại lúc 07:56 UTC).** Bằng chứng đầu tiên: #468 hiện
  `mergeable_state = blocked` khi required check chưa xanh. (#466 bị `behind` vì `strict`, phải cập nhật từ `main` 2 lần trước
  khi merge — không phải `blocked`.) Lần đầu cơ chế kỹ thuật chặn được merge sớm, khác 6 lần trước chỉ dựa vào quy trình.
- **`strict` (nhánh phải cập nhật từ `main` trước khi merge) tạm tắt cho B2a/B2b** (CEO 31/10): `strict` phá chuỗi phê duyệt
  tầng 3 (`main` đổi lúc chờ comment → HEAD đổi → comment ghi HEAD cũ). Required check và `enforce_admins` vẫn bật. **Bật lại
  ngay sau khi B2b merge, bắt buộc**, 3 bước: CEO bật lại; FE đọc `branches/main/protection` thấy `strict: true`; không thấy thì
  báo CEO ngay. Ghi: "B2b merged at …, strict re-enabled at …, verified strict: true at …".
- **Chốt chặn thay `strict`** (chạy trước khi chuyển ready; danh sách thu hẹp, CEO 31/10): `git diff <base> origin/main` chạm
  `apps/admin`, `apps/api`, `packages/domain`, `packages/ui`, `packages/config`, `packages/db/src/schema/org-members.ts`,
  `package.json`, `pnpm-lock.yaml`, `turbo.json`, `.github/workflows`, `CLAUDE.md` gốc hay `QUESTIONS.md` → merge `origin/main`
  vào nhánh (không rebase) và chờ CI như có `strict`. Không theo dõi `apps/worker` và phần còn lại của `packages/db`. Sau merge:
  run CI trên `main` chứa commit squash xanh 9/9, đỏ → báo CEO ngay.
- **Công thức đếm job theo loại PR** (CEO 31/10) — PR có code: 9/9 success bắt buộc; PR doc-only: 8 success + 1 skipped
  (`docker images`) hợp lệ. Không dùng lẫn. PR có code mà `docker images` skipped → dừng, báo CEO.
- **Mốc sự kiện phải đọc từ GitHub timeline (`created_at`), không lấy theo tiêu đề brief hay tin nhắn — áp dụng cho cả ngày,
  không chỉ giây** (CEO 31/10; brief ghi "01/11" cho việc bật protection, timeline là 31/10).

  | Tầng | Loại PR                                                                       | Người merge                                                       |
  | ---- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------- |
  | 1    | Docs, chỉ đọc, test, fix nhỏ                                                  | DEV                                                               |
  | 2    | Thao tác ghi thông thường (B1)                                                | DEV                                                               |
  | 3    | Thao tác ghi không hoàn tác (B2 xóa dữ liệu, PR B màn 2 hạ mức tự chủ)        | CEO, sau tín hiệu "Sẵn sàng merge" của DEV và comment phê duyệt   |

  - **Tầng 1, 2:** bỏ nghi thức "Sẵn sàng merge".
    - PR vẫn mở **draft**. Draft là trạng thái an toàn mặc định, ready là ngoại lệ có chủ đích. Draft không thay required
      check, phải có cả hai.
    - DEV tự chuyển ready **ngay trước khi tự merge, trong cùng một lượt**, để khoảng ready→merge ngắn nhất có thể.
    - DEV tự kiểm **đủ 9 job theo tên**; required check 1 job chỉ là lưới an toàn cuối, không phải chuẩn chất lượng.
    - DEV tự merge, rồi báo: HEAD, tên từng job, thời điểm merge, diff giữa HEAD và squash.
  - **Tầng 3:**
    - DEV gửi "Sẵn sàng merge" kèm HEAD đầy đủ, 9 job theo tên, `mergeable_state = clean` khi check đã kết thúc.
    - Trước khi bấm merge, CEO comment vào PR: "Tôi đã đọc tín hiệu Sẵn sàng merge của FE (HEAD …, ngày …, giờ …). Tôi phê
      duyệt thực hiện." Đây là biện pháp duy nhất còn lại, vì required check không chặn được merge khi CI đã xanh.
  - **"PR có thao tác ghi"** = PR gửi POST/PATCH/DELETE lên API.
  - Approval bị bỏ: không khả thi khi mọi PR do một tài khoản `hungmk88` mở (N36).
  - **Áp dụng cho cả FE và BE** (CEO 31/10; lý do: #448 của BE cũng merge trước khi BE xác nhận). Tầng 3 của BE do BE lead
    định nghĩa trong tài liệu BE; FE không viết ví dụ BE.
  - `CLAUDE.md` gốc, mục GIT WORKFLOW, đã sửa theo luật này (CEO 31/10). Chỉ sửa mục đó.
  - PR docs gộp các luật này (sau khi đủ 3 điều kiện) áp dụng luật tầng 1, theo thứ tự:
    1. **trước khi merge**, comment vào PR: "PR sửa `CLAUDE.md` gốc — file dùng chung FE + BE. Đề nghị BE lead đọc và bổ sung
       ví dụ tầng 3 của BE trong PR docs BE kế tiếp. Nguyên tắc áp dụng ngay từ khi luật có hiệu lực." Có tài khoản GitHub
       của BE lead (anh cung cấp) thì tag đúng; không có thì **không `@`**. Không tag được ai thì không làm như đã tag;
    2. DEV tự chuyển ready rồi merge khi required check xanh;
    3. **sau merge**, thông báo cho BE lead bằng hai đường:
       - comment trên GitHub để lưu vết;
       - FE soạn sẵn nội dung để anh chuyển qua kênh anh đang dùng với BE lead.

       Không gửi vào phiên Claude BE: phiên có thể đã dừng, và dễ hiểu nhầm thẩm quyền.
  - **Ngoại lệ có ghi chú:** PR docs gộp tự vi phạm luật "PR sửa file của bộ phận khác cần review", vì sửa `CLAUDE.md` gốc
    (file dùng chung). Mô tả PR ghi: "PR này thiết lập luật phân tầng, đồng thời sửa `CLAUDE.md` gốc (file dùng chung). BE lead
    chưa review. Chấp nhận ngoại lệ để luật có hiệu lực sớm; BE lead xác nhận trong PR docs BE kế tiếp."
- **"Ready" ≠ "xong" (CEO 31/10, nguyên văn):** "Ready" ≠ "xong". Chuyển PR khỏi draft chỉ có nghĩa "không còn là draft" — có
  thể do lỗi công cụ, do sửa mô tả, do bất kỳ ai. Tín hiệu duy nhất để merge một PR tầng 3 là tin "Sẵn sàng merge" từ FE, kèm
  đủ 3 thứ: HEAD đầy đủ, danh sách job theo tên, `mergeable_state = clean` khi check đã kết thúc. Không có tin đó → không merge,
  kể cả khi PR ready và CI xanh.
- **PR sửa file của bộ phận khác phải có review của bộ phận đó, kể cả comment** (CEO 31/10, sau #456 và #458 sửa file
  `apps/admin` không qua FE).
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

## 6. K4, K5: đã xong (30/10)

- **K5** (#416, `main` `063202c`): câu `channel_unavailable` theo U57, **CEO chọn bản (a)**: "Kênh đang lỗi. Tin đã được lưu,
  hệ thống sẽ thử gửi lại. Nếu không gửi được, tin sẽ chuyển sang trạng thái thất bại." (phải nói rõ hệ quả cuối; bản ngắn chỉ
  dùng khi chỗ hiển thị quá chật và có đường xem giải thích đầy đủ). Trang bảo trì bỏ vế "Tin khách gửi tới vẫn được lưu" (U58).
- **K4** (#417, `main` `6cb9e7a`): A1 của `permissions-sync.test.ts` import `ANSWERABLE` từ `permissions.ts`, so `canReply` với
  `mayAct(…, 'send_message') && ANSWERABLE.has(state)` trên mọi vai trò × trạng thái × người giữ. Đột biến: bỏ `PENDING_CUSTOMER`
  khỏi `ANSWERABLE` → đỏ.
- Cả hai: CEO kiểm `git diff <HEAD PR> <commit trên main>` rỗng.

## 7. Việc chờ, có điều kiện kích hoạt

**Ngoài các việc treo ở cuối mục này (màn trên hợp đồng planned), mọi việc còn lại chờ BE:**

- **K1–K3:** chờ S4/S5 (ticket thật, danh sách người nhận cấp workspace, tổng quan).
- **Test đồng bộ ticket:** chờ K1 **và** U60.
- **K5-b:** chờ BE làm outbound worker 8b hoặc chế độ bảo trì (Brief dòng 859).
- **K6:** chờ S4 nới phạm vi đọc hội thoại (A3 của `permissions-sync.test.ts` đỏ).

Chi tiết từng việc:

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

### Việc treo (CEO 30/10 chiều)

- **Chốt chặn thu hẹp sau 3 vòng cập nhật liên tiếp vì `apps/worker`; lý do: admin không import worker; `packages/db` chỉ theo
  dõi `org-members.ts`** (CEO 31/10). Ba vòng của B2b (#472): #471, #473, #474 của BE, đều ở `apps/worker`.
- **Script Postgres mở PR song song trên nhánh `claude/cool-carson-fp5o6t-db`, gắn nhãn `needs-be-review`, không tự merge trước
  khi BE review** (CEO 31/10): PR sửa `packages/db/package.json`, `apps/api/package.json`, `infra/CLAUDE.md` của BE.
- **DÂY CHUYỀN DỪNG (CEO 31/10)** sau năm lần merge khi FE chưa gửi "Sẵn sàng merge". Điều tra cơ chế merge, bảng năm sự cố,
  câu hỏi cho anh, đề xuất branch protection tối thiểu: `docs/ui/dieu-tra-merge-30-10.md`. **B2 dừng hoàn toàn**, điều kiện mở
  lại ở mục 7 của file đó.
- **Brief gửi nhầm phiên FE hai lần (#459 và B2-local-coding); FE từ chối đúng, không phải chậm tiến độ** (CEO 31/10). #459
  là PR của BE (nhánh `test/rls-quick-replies-cross-org`); FE không merge PR của bộ phận khác (luật "PR sửa file bộ phận khác
  phải có review bộ phận đó"); FE merge PR của BE chỉ khi CEO nói rõ và ghi ngoại lệ.
- **PR docs gộp sửa `CLAUDE.md` gốc — BE lead chưa review; cần BE lead xác nhận trong PR docs BE kế tiếp** (CEO 31/10). Chưa
  có tài khoản GitHub của BE lead nên comment không `@`. Luật phân tầng áp dụng cho cả FE và BE.
- **#458 (BE) thêm 2 test E2E vào file của FE, FE đã đọc (CEO 31/10: đọc, không revert): test đúng, ghi nhận, không sửa.**
  Hai file sửa: `apps/admin/e2e/privacy-write.spec.ts` và `reply.spec.ts`. Mỗi file thêm một ca: API trả 409
  `idempotency_in_progress` cho POST đầu, màn hiện "Yêu cầu trước vẫn đang xử lý. Đợi một chút.", lần bấm sau gửi cùng
  `Idempotency-Key`.
  - Chạy trên `main` `7282f73`: 2 file 8/8 passed.
  - Đột biến ở máy FE (đã hoàn lại):
    - sinh khóa mới mỗi lần gửi: cả 2 test mới đỏ (thêm 1 test cũ);
    - client tự thử lại 409: test ô trả lời đỏ. Test "Ghi nhận yêu cầu" xanh vì hộp thoại gửi `retry: false`; đây là đúng thiết
      kế, không phải lỗ hổng của test.
- **#457 (docs, file điều tra) merge khi CI CHƯA CHẠY và FE chưa gửi "Sẵn sàng merge" (30/10, sự cố thứ 6).** GitHub timeline:
  `ready_for_review` 18:01:52, `merged` 18:02:04, cùng tài khoản `hungmk88`, `app=none`. Lúc merge, run CI của PR (41103169210)
  còn `queued`, chưa có check run nào của `ci.yml`. Lệnh ghi cuối của FE: sửa mô tả kèm `draft: true` (18:01:10), đọc lại
  18:01:14 vẫn draft. Diff `5f710b7`/`46492c2` rỗng. Draft chặn được merge sớm: 0/4. Chi tiết: `dieu-tra-merge-30-10.md` mục 3b.
  Phải kiểm run CI trên `main` chứa `46492c2` (41103352713) xanh trước việc kế tiếp. FE không tự xử lý; bản ghi này nằm trên
  nhánh, **chưa mở PR**, chờ CEO quyết.
- **#452 (docs) merge khi CI CHƯA CHẠY JOB NÀO và FE chưa gửi "Sẵn sàng merge" (30/10, sự cố thứ 5).** GitHub timeline:
  `ready_for_review` 17:42:46, `merged` 17:42:53, cùng tài khoản `hungmk88`, `app=none`. Lúc merge, CI trên HEAD `ecea0cb`
  chưa xong: lúc FE đọc (17:43:38) API trả 8/8 job `queued`; giờ GitHub ghi về sau cho thấy chỉ `terraform` (17:41:59) và
  GitGuardian xong trước merge, `coverage` chưa được tạo. Thao tác cuối của FE lên #452 là sửa mô tả kèm `draft: true` (PR
  `updated_at` 17:35:55), sau đó FE chỉ đọc trạng thái và push commit `98d4a1f` (sau lúc merge, nên commit này không vào
  `main`; PR kế tiếp mang lại). Diff giữa `ecea0cb` và `ad131f0` trên 2 file rỗng. Draft chặn được merge sớm: 0/3 (#447,
  #450, #452). Theo luật mục 2: phải kiểm run CI trên `main` chứa `ad131f0`, mọi job xanh, trước việc kế tiếp (đã kiểm: run 41100997464, 9/9 success); B2 dừng hoàn
  toàn (CEO 31/10).
- **#450 (`retry: false`) cũng merge khi FE chưa gửi "Sẵn sàng merge" (30/10, 17:27 UTC).** PR rời draft lúc 17:27:06,
  merge lúc 17:27:12 (giờ sự kiện của GitHub timeline, không phải giờ thông báo đến phiên). CI 9/9 trên HEAD `ce544b50` đã xong success lúc 17:26:19; diff giữa `ce544b50` và `47bea27` trên 6
  file của PR rỗng. **Sửa 31/10:** lệnh sửa mô tả của FE (`update_pull_request`, chỉ `body`) xong lúc 17:25:51, 75 giây trước
  `ready_for_review`; từ 17:25:52 tới 17:27:10 FE không gọi lệnh nào. Câu cũ "có thể chính lệnh sửa mô tả đã đưa PR khỏi draft,
  cùng thời điểm" là sai (`dieu-tra-merge-30-10.md` mục 3). FE vẫn sửa mô tả PR draft luôn kèm `draft: true` và đọc lại trạng
  thái ngay sau. Draft chặn được merge sớm: 0/2 (#447, #450).
  **Kiểm auto-merge (CEO 31/10, API công khai vì `gh` không đăng nhập được):** repo `allow_auto_merge: false`; `auto_merge`
  của #450 là `null`; dòng thời gian không có `auto_merge_enabled` → **auto-merge không phải nguyên nhân**. Dòng thời gian ghi
  `ready_for_review` 17:27:06 và `merged` 17:27:12, cùng `hungmk88`, `app=none` (như #447, rời draft 9 giây trước merge mà
  FE không gọi lệnh nào; như #449 FE tự chuyển qua công cụ): **không xác định được ai đưa #450 khỏi draft**. Giữ biện pháp
  `draft: true` mỗi lần sửa mô tả PR draft.
- **#447 (B1) merge khi chưa đủ điều kiện (30/10, 16:36 UTC), ca thử đầu tiên của PR draft: draft KHÔNG chặn được.**
  PR được chuyển ready lúc 16:35:55 và merge lúc 16:36:04 (GitHub timeline), bởi tài khoản `hungmk88`, khi FE **chưa gửi
  "Sẵn sàng merge"**.
  CI trên HEAD `6cf3dbc` đã xong 9/9 success (kể cả `coverage`, `docker images` chạy thật) lúc 16:35:03; diff giữa
  `6cf3dbc` và `e48ce4a` trên 13 file của PR rỗng. **Thiếu so với điều kiện CEO giao cho B1 (cùng ngày):** `main` có B1 với cách thử lại cũ
  của client (tự thử lại mọi lỗi `wait`, kể cả 4xx 429/409; không hiện "Đang thử lại…", không khóa form; API giả chưa chống
  trùng theo khóa). Bản sửa đã làm và kiểm ở máy (commit `056c3e4`, chỉ ở máy FE, chưa push): `api(…, { retry: false })`,
  thử lại một lần chỉ mạng/502/503/504 có hiển thị và khóa, API giả chống trùng, E2E "đúng 1 dòng mới". **Chờ CEO quyết**
  cách đưa lên; FE không tự xử lý. Số lần draft chặn được merge sớm (U71): 0/1.
- **U68 (iii) đã xóa** ở PR docs sau #437 (vế về `limit`: hợp đồng đã ghi mặc định 50, trần 100 cho cả hai đường); comment
  `apps/admin/src/security/security.ts` thành "50 = mặc định của hợp đồng (trần 100, cả hai đường)". Phiên sau kiểm trên
  `main`: dòng U68 của `QUESTIONS.md` không còn "(iii)", `security.ts` không còn "U68 (iii)". Còn thấy → PR đó chưa merge, việc
  vẫn treo.
- **Màn 4 Dữ liệu khách** (`/settings/customer-data`, planned S5 `/v1/privacy-requests*`): PR A chỉ đọc danh sách yêu cầu
  (không nút) xong ở #444. PR B tách hai (CEO 30/10): **B1** ghi nhận yêu cầu (PR draft đầu tiên); **B2** hộp thoại
  thực hiện xóa, nhánh mới từ `origin/main` sau khi B1 merge, **không tự thử lại 503** (CEO: mỗi lần gửi là một lần bấm).
  **B2 DỪNG HOÀN TOÀN (CEO 31/10)**, điều kiện mở lại: `dieu-tra-merge-30-10.md` mục 7.
  Thiết kế hộp thoại xóa **đã duyệt** (CEO 30/10), dành cho B2:
  - Gõ lại chuỗi `XOA-<6 ký tự cuối mã yêu cầu>` (hiện monospace; không dùng tên khách); so khớp: cắt khoảng trắng đầu/cuối,
    không phân biệt hoa thường, không chuẩn hóa khoảng trắng bên trong, không bỏ gạch; không có nút "Sao chép".
  - Câu "không hoàn tác được" ở đầu hộp thoại; liệt kê loại và phạm vi sẽ xóa; tên khách `null` → "khách chưa có tên" + mã
    yêu cầu; lý do là chữ thuần, dài thì vùng cuộn, không cắt.
  - Focus vào ô gõ; Enter không gửi (không form submit, nút `type="button"`); lỗi → focus `role="alert"` (hoặc "Đóng"),
    thành công → focus "Đóng", đóng → trả focus về nút đã mở.
  - Một `Idempotency-Key` sinh khi mở hộp thoại, giữ qua mọi "Thử lại", bỏ khi đóng. Đang xử lý: khóa nút, Esc và "Hủy".
    409/404/403/503 nói lý do thật, không bao giờ "đã xóa" giả; thành công hiện số thật API trả (`PrivacyErasure`).
  - U70 (số lượng trong `GET /v1/privacy-requests/{id}`, "tại thời điểm xem") không chặn PR B.
- **502/504 chưa được tự thử lại** vì `apps/admin/src/api/errors.ts` map chúng vào `internal_error` (action `show`), dù luật của
  `client.ts` (#450) cho phép 429/502/503/504: sửa khi có nhu cầu, không mở PR riêng bây giờ (CEO 31/10).
- **Hằng `button` trùng** giữa `apps/admin/src/paged-list.tsx` và `apps/admin/src/security/security-screen.tsx` (#441, CEO 30/10
  chấp nhận): gộp khi có PR đụng một trong hai file, không mở PR riêng.
- **Dòng 28 `apps/admin/CLAUDE.md` sai định dạng** (thiếu dòng trống, `prettier --check` đỏ từ trước; file không nằm trong
  `format:check`): sửa trong PR đụng file này, không mở PR riêng. #444 có đụng file nên đã sửa luôn trong #444.
- **Nhánh `backup/privacy-full` (`c9e5578`): CHƯA xóa, cần người có quyền repo xóa trên GitHub.** CEO duyệt xóa 30/10 sau #444;
  proxy git của môi trường trả HTTP 403 cho lệnh xóa nhánh. Nội dung đã trên `main` (#441, #444).

## 8. Lệnh kiểm

Như mục 9 của `session-summary-28-10.md`. Playwright admin hiện **158 test**.
