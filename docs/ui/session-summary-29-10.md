# Handoff FE (Gói 2): phiên 28–30/10/2026 (giờ UTC)

Nạp cho phiên mới, đọc theo thứ tự: `CLAUDE.md` (gốc) → `apps/admin/CLAUDE.md` → file này → `QUESTIONS.md` (U57–U60).
Phiên trước: `docs/ui/session-summary-28-10.md` (mục 2–4, 9 vẫn đúng, trừ chỗ file này sửa). Người giao việc: CEO (xưng "anh",
FE xưng "em", trả lời tiếng Việt). Cập nhật lần cuối: 02/11, `main` ở `5ebfa49`.

## 1. Đã merge vào `main` trong phiên

**Trạng thái 01/11 (CEO xác nhận):** `main` `14a8fdc` (#506, merge 12:55:07 UTC theo commit squash, CI 9/9 run `41308741601`).
**Required check: 9 context, gồm `docker images`** (CEO chốt giữ, mục 7); job `skipped` tính là đạt, PR chỉ có docs vẫn `clean`
(#503, #506). `strict` và `enforce_admins` bật. PR FE đang mở: không.

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
    Hiện 9 job (#436 thêm `coverage`), cả 9 là required check từ 01/11: changes (docker needed?), lint/typecheck/test,
    coverage, admin (e2e, axe), database, queue, dependency audit/secret scan, docker images, terraform;
  - job `admin (e2e, axe)` chạy thật (bước `pnpm --filter "@gani/admin..." build` success);
  - `mergeable_state` clean.
- **Job `skipped` (CEO 30/10, sửa luật sau #420):** **chỉ job `docker images`** được `skipped`, và chỉ trên PR chỉ sửa `*.md`
  (do job `changes (docker needed?)` quyết định). Mọi job khác, **kể cả `terraform`**, phải chạy và xanh. PR có file code,
  config hay dependency mà job `docker` bị `skipped` là bất thường: dừng, báo CEO. Khi báo "Sẵn sàng merge": nêu tên từng job,
  đếm đúng số check thực tế (hiện 9), ghi "N success + M skipped (doc-only)". `unstable` khi CI còn chạy là bình thường; chỉ báo
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
  không suy diễn người làm. **Thay bằng luật 01/11 ở dòng dưới: "Mọi mốc giờ lấy từ commit squash, không lấy timeline."**
  Sự kiện không có commit (comment `hold`, chuyển ready, heads-up): luật mới chưa nói nguồn, FE ghi giờ timeline kèm nguồn
  tới khi CEO chốt (câu hỏi mở, mục 7).
- **Mọi mốc giờ lấy từ commit squash, không lấy timeline** (CEO 01/11, ghi nhớ chung). **Giờ merge lấy từ commit squash, ghi kèm timeline** (CEO 01/11): sự kiện xảy ra trong khoảng 08:00–09:00 UTC ngày 01/11 bị
  GitHub ghi `created_at` (timeline, run Actions) nhanh hơn giờ thật 1 giờ; từ khoảng 09:00 khớp lại (mục 7, "Lệch giờ"). Giờ merge = ngày giờ committer của commit squash
  (`git log -1 --format=%cI <squash>`), ghi kèm giờ timeline. **Timeline lệch >5 phút → ghi cả hai, đánh dấu 'timeline
  suspect'. Lệch >24h → escalate người quản lý proxy.**
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
- **Khi merge, luôn truyền `commit_title` bằng tiêu đề PR** (CEO 01/11), kèm ` (#<số PR>)`. Không truyền thì PR chỉ có một
  commit thường (merge commit không tính) lấy message của commit đó làm tiêu đề squash: #485 thành `a57e282` "… (bản đang làm,
  chưa push)". Trước khi bấm merge, đọc lại `commit_title`: không rỗng, không chứa "(bản đang làm", "WIP", "chưa push".
- **Báo loại lint trước khi sửa** (CEO 01/11): tên luật, dòng, có phải bug thật không; chờ anh biết rồi mới sửa. Loại cần cảnh
  giác nhất là `react-hooks/exhaustive-deps` (effect thiếu phụ thuộc chạy sai khi bộ lọc đổi): viết test bắt được hành vi sai
  trước khi sửa, không chỉ thêm phụ thuộc cho lint im.
- **Merge kiểu squash:** commit trên `main` có mã khác HEAD của PR. Kiểm lại bằng `git diff <HEAD PR> <commit main> -- <file của PR>`
  (rỗng là đúng).
- **CI của `main` có `cancel-in-progress`:** lần chạy của một commit có thể "cancelled" khi PR sau merge ngay. Xem lần chạy kế
  tiếp có chứa commit đó (`git merge-base --is-ancestor`).
- **Nhánh làm việc** `claude/cool-carson-fp5o6t` dùng lại cho mỗi PR. GitHub xóa nhánh khi PR merge. PR mới: làm lại từ
  `origin/main` mới nhất (`git checkout -B … origin/main`), rồi **push thường**. Push kiểu `--force-with-lease` bị từ chối.
- **Phiên bị khởi động lại** (29–30/10 xảy ra nhiều lần): lệnh đang chờ phê duyệt bị hủy, việc đã kiểm xong nhưng chưa
  commit/push nằm lại ở máy. Kiểm xong thì commit và push ngay trong cùng lượt; mỗi lần khởi động lại, việc đầu tiên là
  `git status` để xem còn gì chưa đẩy. #413 code xong 29/10 nhưng đến 30/10 mới push được vì lý do này.
- **Quy trình check-in: 3 kênh chạy song song** (CEO 02/11, brief `2810-01112026-FE-BRIEF-16`; không thay luật tầng 1/2/3,
  required check hay "Sẵn sàng merge"; `hold` vẫn dừng mọi hoạt động):
  - **Kênh 1, webhook GitHub đánh thức FE: chưa khả dụng, cần CEO cấp endpoint.** Kiểm 02/11: repo chỉ có
    `.github/workflows/ci.yml` (push, pull_request, workflow_dispatch; không gọi ra ngoài); `GET /repos/…/hooks` bị proxy chặn
    (403), không đọc được webhook. Phiên FE không có endpoint nào GitHub gọi được (`watch_url` chỉ nhận từ dịch vụ artifact).
    FE không tự dựng endpoint hay workflow. Phần có sẵn: `subscribe_pr_activity` (kênh 2b dưới). CEO tạm đóng kênh 1, xem xét
    cấp endpoint ở phiên sau (02/11).
  - **Kênh 2b (CEO duyệt 02/11, brief `2810-01112026-FE-BRIEF-17`):** subscribe_pr_activity cho PR BE, che comment/CI/merge;
    không che push main, không che branch protection; không nhận nếu phiên khác đã đăng ký. Áp cho PR BE đang mở và PR BE mới
    mở. Chỉ theo dõi: không comment, không push lên PR của BE; điều cần nói thì báo CEO. **Chứng minh hiệu quả lần đầu (CEO
    02/11):** #521 của BE, FE nhận ngay sự kiện CI, ready, merge (05:05:28 UTC, squash `878ec01`) mà không chờ lần kiểm; tiếp tục
    theo dõi PR BE đang mở. **Kênh 2b che PR đã biết mở; bù bằng đọc 10 commit gần nhất trên main mỗi lần kiểm 2 giờ** (CEO
    02/11, sau #524: mở 05:14:20, merge 05:20:21, giữa hai lần kiểm).
  - **Review chéo không qua comment GitHub (CEO 02/11, brief `2810-02112026-FE-BRIEF-31`, không đổi luật giữa phiên):** FE vẫn
    không comment vào PR BE (brief 17). Khi BE sửa U-series hoặc file FE phụ trách, FE ghi vào đây: PR, mục bị sửa, nội dung
    đúng/sai, cần CEO xem xét; CEO quyết có ping BE không.
    - BE sửa U63 trong #528 (merge 08:04:39 UTC, squash `43c7822`): nội dung **đúng** (dry-run đã có trong `openapi.json`, #527).
      CEO: không cần ping BE.
    - BE sửa `apps/admin/src/tickets/tickets.ts` và `ticket-create.ts` trong #538 (K1c-1, tầng 3, CEO merge 14:23:40 UTC, squash
      `e74693c`): đổi nguồn kiểu từ `../api/planned` sang `../api/schema`, **đúng** và cần cho typecheck. Hợp đồng đổi
      `TicketAssignee.name` thành `string | null`: FE đồng ý (như U30), sửa hiển thị ở #539 (`ece5747`, "…abcd" thay vì "Chưa
      giao"). Khoảng hở tới K1c-2: danh sách ticket thật nhưng chi tiết vẫn 404 ("Không tìm thấy ticket"); CEO chấp nhận vì chưa
      deploy (brief 40), K1c-2 phải merge trước lần deploy đầu. FE review gửi CEO qua phiên, không comment GitHub.
    - BE sửa `apps/admin/src/tickets/ticket-detail.ts` trong #540 (K1c-2, tầng 3, "Sẵn sàng merge" 15:12:58, `APPROVED` 15:17:34
      và 15:26:49, merge 15:29:36 UTC, squash `265e7ff`): đổi nguồn kiểu từ `../api/planned` sang `../api/schema`, **đúng**. Hợp
      đồng `GET/PATCH /v1/tickets/{id}` giữ nguyên so với bản planned (tham số, body, mã lỗi, schema 200; `TicketDetail`,
      `TicketEvent` giống hệt); `planned.json` hết đường ticket; khoảng hở 404 của #538 đã đóng. Hệ quả cho FE: màn chi tiết hiện
      "Chưa giao" khi người nhận có `name` null, sửa ở PR FE sau #540 (`Assignee` dùng chung với danh sách, brief 43–45). FE review
      gửi CEO qua phiên, không comment GitHub.
    - BE sửa file FE sinh `apps/admin/src/api/planned.d.ts` trong #544 (hợp đồng Lead, tầng 3, `CEO APPROVED` 15:27:32, merge
      15:57:07 UTC, squash `9e29bea`), #547 (Tag, merge 16:08:27, squash `0f4c256`) và #548 (trường tùy chỉnh, merge 16:20:40,
      squash `a4c883f`) (luật #546: FE review trong 24 giờ sau merge; brief 46). **Đúng:** `planned.json` chỉ **thêm** đường,
      không sửa hay bỏ đường, schema nào có sẵn: #544 thêm 5 đường Lead (`/v1/workspaces/{id}/pipeline`, `/v1/leads`,
      `/v1/leads/{id}`, `/stage`, `/close`), #547 thêm 4 đường Tag (`/v1/tags`, `/v1/tags/{id}`, `/v1/tags/{id}/merge`,
      `/v1/customers/{id}/tags`), #548 thêm 3 đường trường tùy chỉnh (`/v1/customer-fields`, `/v1/customer-fields/{id}`,
      `/v1/customers/{id}/fields`); `planned.d.ts` là file sinh (`gen:api`, CI so lệch), không sửa tay. Hệ quả cho FE: 12a sang kiểu
      sinh (#551), #13a trên hợp đồng thật (#555), 23a đổi đường trường tùy chỉnh sang `/v1/customer-fields` (FE đoán
      `/v1/customer-field-defs`). **T-2 chưa chốt:** hợp đồng (N188) cho Support 403 ở Lead, N188 trong `QUESTIONS.md` vẫn "Chờ
      APPROVED"; FE giữ Support trong menu `/leads`, chờ CEO xác nhận rồi làm PR riêng (brief 45–46).
    - **Ghi nhận cho CEO (brief 46):** #547 và #548 (cả hai sửa `planned.json`) merge lúc 16:08:27 và 16:20:40 UTC, **không có
      comment nào trên PR**, trước comment "duyệt lô sprint trên PR (khi đó bỏ heads-up)" của CEO trên #546 (16:25:14; FE báo
      16:25:18 là giờ thông báo, giờ comment trên GitHub là 16:25:14) và trước khi #546 merge (16:40:11). Comment "APPROVED theo
      Mức A, bỏ FE comment" trên #546 lúc 16:06:16 là duyệt chính #546. CI 9/9 success trên HEAD (`fddaa73`, `7e18ccc`). FE không
      thấy brief BE nên không biết phương án đã được duyệt hay chưa. FE không comment PR BE; CEO xử lý.
    - BE sửa file FE sinh `apps/admin/src/api/planned.d.ts` và `schema.d.ts` trong #559 (Tag 3a-ii, `/v1/tags` thành API thật, merge
      18:20:49 UTC 02/11, squash `eaf29a9`; luật #546, review trong 24 giờ). **Đúng:** 3 đường `/v1/tags`, `/v1/tags/{id}`,
      `/v1/tags/{id}/merge` chuyển từ `planned.json` sang `openapi.json`, chỉ bỏ nhãn `x-sprint`/`x-status`; schema `Tag`, `TagList`,
      `TagCreate`, `TagChange`, `TagMerge`, `TagMergeResult` giống hệt; `/v1/customers/{id}/tags` vẫn planned. Hệ quả cho FE: tab Tag
      của 23a (PR B, brief 47) lấy kiểu từ `schema.d.ts`. FE không comment PR BE.
    - BE sửa file FE `apps/admin/e2e/stub-customers.ts`, `apps/admin/src/customers/customer-edit.test.ts` và hai file sinh trong #563
      (Tag 3a-iii, gắn tag cho khách, merge 19:02:47 UTC 02/11, squash `436b5f3`; luật #546, review trong 24 giờ). **Đúng:** `Customer`
      thêm trường bắt buộc `tags: CustomerTag[]`; hai chỗ FE thêm `tags: []` là cần cho typecheck, không đổi hành vi. `GET /v1/customers`
      thêm lọc `tagId`; `PUT /v1/customers/{id}/tags` thành API thật; `planned.json` hết đường Tag; schema `Tag`, `TagList` và
      `GET /v1/tags` không đổi (tab Tag của 23a, #565, không ảnh hưởng). Hệ quả cho FE, **chưa làm, chờ CEO**: danh sách khách (#7) và hồ
      sơ khách (#8) đang ghi "Tag … chờ API" nay có dữ liệu để hiện tag và lọc theo tag; gắn tag (Owner/Admin/Manager/Sales/Support, N190)
      là việc ghi, cần phương án riêng. FE không comment PR BE.
    - BE sửa file FE sinh `apps/admin/src/api/schema.d.ts` (+163, file FE duy nhất) trong #566 (C10-3a, tầng 1, giờ làm việc của
      workspace, merge 19:29:55 UTC 02/11, squash `424a81e`; luật #546, review trong 24 giờ, brief 48). **Đúng:** `openapi.json` chỉ
      thêm `GET/PUT /v1/workspaces/{id}/business-hours` và 3 schema `BusinessDay`, `BusinessHours`, `BusinessHoursChange`; không
      đường hay schema cũ nào đổi; không chạm U-series. CI trước merge 8 success + `terraform` skipped (lẫn BE + file FE sinh): đúng
      bộ lọc; dòng "Lẫn" của bảng đã sửa thành 8 job ở #567 (CEO duyệt 19:15 UTC 02/11 theo mô tả #567, merge 01:45:32 UTC 03/11). Hệ quả cho FE, **chưa làm, chờ
      CEO**: phần "Giờ làm việc, ngày nghỉ" của #21 Workspace (đang ghi "chờ API") nay có API đọc và ghi giờ làm việc. FE không
      comment PR BE.
    - BE sửa file FE sinh `apps/admin/src/api/schema.d.ts` (+185, file FE duy nhất) trong #570 (C10-3b-i, tầng 1, ngày nghỉ của
      workspace, merge 02:02:20 UTC 03/11, squash `f42701d`; luật #546, review trong 24 giờ, brief 49). **Đúng:** `openapi.json` chỉ
      thêm `GET/POST /v1/workspaces/{id}/holidays` và 3 schema `Holiday`, `HolidayCreate`, `HolidayList`; không đường hay schema cũ
      nào đổi; không chạm `QUESTIONS.md` hay U-series. CI trước merge 8 success + `terraform` skipped, đúng dòng "Lẫn" (8 job) sau
      #567. Hệ quả cho FE, **chưa làm, chờ CEO** (brief 49 mục 4: a/b/c): #21 Workspace có API thật cho cả giờ làm việc (#566) lẫn
      ngày nghỉ (#570); `planned.json` không có đường nào cho hai phần này. FE không comment PR BE.
    - BE sửa file FE sinh `apps/admin/src/api/schema.d.ts` (+177/−3, file FE duy nhất) trong #571 (C10-3b-ii, tầng 1, sửa và xóa
      ngày nghỉ, merge 05:36:48 UTC 03/11, squash `0a4881c`; luật #546, review trong 24 giờ). **Đúng:** thêm
      `PATCH/DELETE /v1/workspaces/{id}/holidays/{hid}` và schema `HolidayChange`; `GET/POST /v1/workspaces/{id}/holidays` chỉ đổi chữ
      mô tả lỗi 404/422 (thêm "no such live day off"), không đổi mã lỗi, body hay schema; không chạm U-series. CI trước merge 8 success
      + `terraform` skipped, đúng dòng "Lẫn". Hệ quả cho FE: như #570, chờ CEO chọn a/b/c cho #21. FE không comment PR BE.
    - Hệ quả của #566, #570, #571 **đã chốt** (CEO 03/11, brief 51–52): wireframe #21 duyệt; tab trong `/settings/workspace` cho
      workspace đang chọn ở thanh trên, Owner/Admin (Manager 403); PR 2a giờ làm việc (`?tab=hours`), PR 2b ngày nghỉ, sau 2a.
      2a bản đầu 658 dòng (> 500): CEO chọn tách đọc/ghi (brief 53): 2a-i đọc, 2a-ii sửa dùng lại kiểu, component, API giả của 2a-i,
      sửa 2a-i quá 10 dòng thì báo CEO.
    - BE sửa file FE `apps/admin/e2e/stub-bot-flows.ts` (+1), file FE sinh `apps/admin/src/api/schema.d.ts` (+81) và dòng U77 của
      `QUESTIONS.md` trong #574 (U77 (a), tầng 2, merge 06:11:35 UTC 03/11, squash `969d53d`; luật #546, review trong 24 giờ, hạn
      06:11 UTC 04/11). **Đúng:** `BotFlow` và `BotFlowDetail` thêm `description: string | null`; `BotFlowCreate` thêm
      `description?`; thêm `PATCH /v1/bot-flows/{id}` (`BotFlowChange {name?, description?}`, `null` xóa mô tả, trả `BotFlowDetail`,
      Owner/Admin/Manager như các đường bot flow khác); không đường hay schema cũ nào đổi khác. Stub thêm `description: null` chỉ để
      typecheck, E2E không đổi hành vi. U77 (a) ghi "A chốt 03/11", (b), (c) vẫn mở: đúng. CI trước merge 8 success + `terraform`
      skipped, đúng dòng "Lẫn". Hệ quả cho FE: câu "Mô tả flow: chưa có trong hợp đồng (U77 (a))" ở mục Bot của
      `apps/admin/CLAUDE.md` nay sai. **CEO chốt 03/11 (brief 53): chỉ hiện mô tả, chỉ đọc**: dưới tên flow khi có, ẩn khi `null`;
      không nút "Sửa mô tả", không gọi `PATCH /v1/bot-flows/{id}` (#17 Đợt 1 chỉ đọc, CEO 01/11; mở PATCH là đổi phạm vi Đợt 1).
      1 PR tầng 1 (~50 dòng + E2E) sau 2a-i, 2a-ii. FE không comment PR BE.
    - BE sửa file FE `apps/admin/src/bots/bot-flows.ts` (chỉ chú thích), `flow-list.tsx` (1 câu), `e2e/bots.spec.ts`, mục Bot của
      `apps/admin/CLAUDE.md`, file sinh `schema.d.ts` (+16/−7) và dòng U77 trong #578 (U77 (b), (c), merge 07:26:54 UTC 03/11, squash
      `3e5dd56`; luật #546, review trong 24 giờ). **Đúng:** trần 200 flow sống mỗi workspace (flow 201 → 422
      `bot_flow_limit_reached`), danh sách không bao giờ bị cắt, nên câu đủ 200 dòng đổi thành "Workspace đã có 200 flow, mức tối đa
      của một workspace." và E2E theo; `PATCH /v1/bot-flows/{id}` nhận thêm `status: active|inactive` (422 `bot_flow_not_published`).
      FE không gọi tạo flow hay PATCH (#17 chỉ đọc), nên chưa cần thêm hai mã lỗi mới vào `errors.ts`. CI trước merge 8 success +
      `terraform` skipped, đúng dòng "Lẫn". Còn lại cho PR mô tả #17: câu "Mô tả flow: chưa có trong hợp đồng (U77 (a))" vẫn ở
      `apps/admin/CLAUDE.md`. FE không comment PR BE.
    - BE sửa file FE `apps/admin/src/customer-data/catalog.ts` (kiểu `CustomerField` lấy từ `schema.d.ts`, chú thích),
      `e2e/stub-customer-data.ts` (chú thích), mục Dữ liệu khách của `apps/admin/CLAUDE.md`, hai file sinh (`planned.d.ts` −325,
      `schema.d.ts` +325) và N191 trong #583 (Tag 3b-ii, merge 08:23:40 UTC 03/11, squash `84f7c62`; luật #546, review trong 24
      giờ). **Đúng:** `/v1/customer-fields` và `/v1/customer-fields/{id}` cùng 4 schema (`CustomerField`, `CustomerFieldList`,
      `CustomerFieldCreate`, `CustomerFieldChange`) chuyển nguyên từ planned sang `openapi.json`, hợp đồng không đổi; tab Trường tùy
      chỉnh (23a) chỉ đổi nguồn kiểu, không đổi hành vi. CI trước merge 8 success + `terraform` skipped, đúng dòng "Lẫn". Còn lại:
      `docs/ui/customer-data-shape-assumptions.md` vẫn ghi 23a dùng `planned.d.ts`; FE sửa ở PR này. FE không comment PR BE.
    - BE sửa hai file FE sinh (`planned.d.ts` −170, `schema.d.ts` +170) và N191 trong #588 (Tag 3b-iii-b, merge 09:08:14 UTC
      03/11, squash `fe6f98c`; luật #546, review trong 24 giờ). **Đúng:** `GET/PUT /v1/customers/{id}/fields` và 3 schema
      (`CustomerFieldValues`, `CustomerFieldValueItem`, `CustomerFieldValuesChange`) chuyển từ planned sang `openapi.json`, hợp đồng
      giữ nguyên (chỉ mô tả 503 thêm trường hợp thiếu khóa); FE chưa dùng đường này (giá trị trường trên hồ sơ khách chưa có trong
      phạm vi đã duyệt). CI trước merge 8 success + `terraform` skipped, đúng dòng "Lẫn". FE không comment PR BE.
    - #581, #586 (BE, Tag 3b-i-b, 3b-iii-a) không chạm file FE.
    - BE sửa file FE sinh `apps/admin/src/api/schema.d.ts` (+2, file FE duy nhất) trong #593 (C3, N195, lọc Hộp thư theo tag,
      merge 16:56:29 UTC 04/11, squash `add82c7`; luật #546, review trong 24 giờ, brief 59). **Đúng:** `GET /v1/conversations`
      thêm tham số tùy chọn `tagId` (UUIDv7); tag lạ hay của công ty khác trả 200 danh sách rỗng, như `GET /v1/customers?tagId=`.
      Không đường, schema hay tham số cũ nào đổi; không chạm U-series. CI trước merge 8 success + `terraform` skipped, đúng dòng
      "Lẫn". Hộp thư FE chưa gửi `tagId`, hành vi không đổi; lọc tag ở Hộp thư chờ brief riêng (brief 59 mục 4). FE không comment PR
      BE.
    - #591 (docs, N194–N198), #592 (C6-1, bảng `conversation_notes`) và #594 (C6-2, kho ghi chú) không chạm file FE, không cần
      review.
    - BE sửa file FE sinh `apps/admin/src/api/schema.d.ts` (+200/−0, file FE duy nhất) trong #595 (C6-3, N194, ghi chú nội bộ,
      tầng 2 theo Mức A, merge 18:59:39 UTC 04/11, squash `af873e9`; luật #546, review trong 24 giờ). **Đúng:** `openapi.json`
      chỉ thêm `GET/POST /v1/conversations/{id}/notes` và 3 schema `ConversationNote`, `ConversationNoteCreate`,
      `ConversationNotePage`; không đường hay schema cũ nào đổi; không chạm U-series. CI trước merge 8 success + `terraform`
      skipped, đúng dòng "Lẫn". Hộp thư FE chưa dùng ghi chú, hành vi không đổi; màn ghi chú (C6 ở #6) chờ brief riêng. FE không
      comment PR BE.
    - BE sửa file FE sinh `apps/admin/src/api/schema.d.ts` (+7/−2, file FE duy nhất) và N199 trong #598 (C6-4, lý do chuyển hội thoại,
      tầng 2 theo Mức A, merge 04:34:24 UTC 05/11, squash `4771fe5`; luật #546, review trong 24 giờ, brief 62–64). **Đúng:** body của
      `POST /v1/conversations/{id}/transfer` đổi từ `AssigneeBody` sang `TransferBody` `{version, toUserId, reason?}`, chỉ thêm `reason`
      tùy chọn; không đường hay schema cũ nào đổi; không chạm U-series. CI trước merge 8 success + `terraform` skipped, đúng dòng "Lẫn".
      FE vẫn gửi `{version, toUserId}`, hành vi không đổi. Ô lý do khi Chuyển (U54) là việc mới, chờ brief. FE không comment PR BE.
    - #600, #603 (script đột biến DB), #601 (bảng pipeline), #604 (bảng leads) không chạm file FE, không cần review chéo (brief
      72–76). Số đo chốt sau #604: A 27,5/58, B 19/29, C 21/30, D 27,5/135 (brief 72).
    - #605 (CVE, merge 06:10:24 UTC 05/11, squash `72793a1`) sửa `infra/docker/Dockerfile.admin`, file build ảnh admin, không sửa mã
      `apps/admin` (brief 76, review trong 24 giờ). **Đúng:** stage runtime chỉ nâng `apt`/`libapt-pkg6.0` (`--only-upgrade`, không cài
      thêm), build đỏ nếu bản sau nâng còn dưới 2.6.2, xóa danh sách apt; `API_ORIGIN`, người chạy `node`, cổng 3001 không đổi. CI
      #602 sau #605: `docker images` và `admin (e2e, axe)` xanh. FE không comment PR BE.
    - #606, #607 (`apps/worker`, pipeline mặc định) và #608 (báo cáo cuối ngày BE, `docs/reviews/`) không chạm file FE, không cần
      review chéo.
    - CVE-2026-109518 đã đóng (05/11/2026). Trivy CI #602 HEAD 22207a9 lúc 06:14:48 UTC: 0 HIGH, 0 CRITICAL ở cả 4 ảnh (gani-api,
      gani-worker, gani-admin, gani-migrate). Sửa ở #605 (squash 72793a1): apt/libapt-pkg6.0 ≥ 2.6.2 trong Dockerfile.admin +
      Dockerfile.node.
    - Heads-up #602 lần 5: lần gọi đăng comment bị công cụ báo timeout nhưng vẫn lên GitHub muộn (07:04:52 UTC), thành bản trùng ghi
      sai giờ. Đã sửa comment đó, tính đồng hồ từ lần đăng muộn nhất; merge 07:35:27 UTC, squash `bafe375`. Sau timeout: chờ vài phút,
      kiểm lại rồi mới đăng lại.
    - **Sự cố quy trình 05/11:** worker của phiên FE khởi động lại bốn lần (khoảng 07:42, 08:08, 10:08 và 12:10 UTC); cả bốn lần FE
      trả "No response requested" dù báo cáo 5 mục #602 chưa gửi và B2 chưa push: chậm khoảng 6 giờ. CEO ghi nhận là lỗi hệ thống
      phiên, không trừ điểm FE (brief 77). Sau mỗi lần khởi động lại: làm tiếp việc còn dở (nhánh chưa push, báo cáo chưa gửi, CI
      đang chờ) trước khi kết luận lượt trước đã xong.
    - BE sửa file FE sinh `apps/admin/src/api/planned.d.ts` (+393/−0) và dòng U65 của `QUESTIONS.md` trong #610 (hợp đồng planned của
      #30, tầng 3, CEO APPROVED, merge 14:08:50 UTC 05/11, squash `3c16f9f`; review trong 24 giờ, brief 78). **Đúng:** `planned.json`
      chỉ thêm 4 đường (`GET /v1/platform/tenants/health`, `POST /v1/platform/access-sessions`, `GET /v1/channel-policies`,
      `PUT /v1/channel-policies/{id}`) và 8 schema; không đường hay schema cũ nào đổi hoặc bị xóa. `gen:api` trên `3c16f9f` không lệch.
      CI trước merge 8 success + `terraform` skipped, đúng dòng "Lẫn". FE dùng ở PR 30a (hai đường đọc). FE không comment PR BE.
    - BE sửa file FE trong #616 (L4, tầng 2, merge 16:12:40 UTC 05/11, squash `c364149`; review trong 24 giờ, brief 91–98):
      `apps/admin/src/leads/leads.ts`, `lead-detail.ts` (chỉ đổi import kiểu `../api/planned` → `../api/schema` và chú thích), hai file
      sinh `planned.d.ts`/`schema.d.ts`. **Đúng:** 3 đường đọc lead chuyển từ `planned.json` sang `openapi.json`, hợp đồng giữ nguyên;
      `gen:api` trên `c364149` không lệch; không file FE nào còn import kiểu lead từ `planned`. Hành vi: #12/#13a đọc API thật (trước là
      404 → `PendingPage`). CI trước merge 8 success + `terraform` skipped, đúng dòng "Lẫn" (lần đầu đỏ vì coverage branches
      `apps/api` 79,04 % < 80 %, BE sửa). FE sửa docs theo (`apps/admin/CLAUDE.md` #12/#13a, câu mô tả `leads.test.ts`,
      `lead-detail.test.ts`) ở PR #24 E2E Kênh. #612, #613, #615 (`packages/db`) không chạm FE. FE không comment PR BE.
    - BE sửa file FE sinh `apps/admin/src/api/planned.d.ts` (+289/−8) và các dòng U61, U74, U75, U79, U80 của `QUESTIONS.md` trong #617
      (K1, hợp đồng planned, tầng 3, CEO APPROVED, merge 16:27:53 UTC 05/11, squash `43c3e1c`; review trong 24 giờ, brief 100).
      **Đúng:** `planned.json` chỉ thêm `GET /v1/platform/access-sessions`, `POST …/{id}/end`,
      `GET /v1/channel-policies/{channelType}/{messageClass}/versions`, 4 schema, và 2 trường tùy chọn của `AiSettings`
      (`productionLocked`, `productionLockReason`); không đường hay schema cũ nào bị bỏ; `gen:api` trên `43c3e1c` không lệch. U80 trả
      lời bằng `versions` (có `state` scheduled/in_force/past), không có `effective_at` (CEO chốt bỏ, brief B-U80). FE làm U79, U80,
      U74, U75 theo brief A–D. FE không comment PR BE.
    - **Dọn nhánh FE (brief 87, 90–93):** nhóm A 41 nhánh (đã merge hoặc có bản `-v2`/`-v3` merge thay) CEO xóa trên GitHub UI
      05/11, kiểm `git ls-remote` đủ 41/41; nhóm B 6 nhánh (PR đóng không merge) giữ tới 12/11 rồi xóa; nhóm C giữ
      (`backup/privacy-full`, `docs/ui-prototype-outline`). Bản sao 79 ref fetch trước khi xóa còn ở máy FE; khôi phục bằng
      "Restore branch" trên PR gốc (`refs/pull/N/head`).
  - **2b ngày nghỉ (brief 52) tách theo luật brief 53 ("Vượt 500 dù lý do gì → tách"):** bản một PR 732 dòng, tách đọc/ghi như 2a:
    2b-i đọc (#587), 2b-ii thêm/sửa/xóa + `holiday_overlap`, `holiday_in_past` (#589).
  - **Sự cố quy trình #575 (CEO 03/11, brief 52):** lệnh scan secret nối chung với `git commit` và `git push` trong một lệnh; mẫu
    `sk-` trúng 2 dòng có sẵn của `QUESTIONS.md` (chữ `risk-ownership.md`; báo nhầm, không dòng nào #575 thêm vào khớp mẫu) nhưng
    push vẫn chạy vì lệnh không dừng. Không lộ secret. Sửa: scan chạy riêng, có kết quả thì exit 1 và không push; mẫu `sk-` thành
    `sk-[a-zA-Z0-9]{20,}` ("Scan trước khi push" của `CLAUDE.md` gốc, `docs/claude-changelog.md` 03/11).
  - **Đồng hồ heads-up 30 phút (CEO 02/11, ghi vào `CLAUDE.md` gốc):** chỉ chạy khi (a) comment heads-up đã đăng, (b) 9 job xanh
    thật (PR docs: 8 + `docker images` skipped), (c) `clean`; push thêm commit sau heads-up thì về 0 và phải đăng heads-up mới;
    CI đỏ thì dừng, chạy lại khi xanh. #521: heads-up 04:30:06, push `cbcfe1f` 04:58:59, CI xong 05:05:19, merge 05:05:28 (35 phút
    từ comment, 9 giây từ lúc đủ điều kiện): đúng tinh thần, không phải vi phạm, nhưng lần sau phải theo cách tính trên.
  - **B1 sau #521, #522, #524, #525:** giữ "một phần". #521 chỉ DB (lease, lần thử kế tiếp, `app.outbound_pending_orgs`); #522 (O2a,
    tầng 1 code, auto-merge 05:13:02 sau CI 9/9) chỉ kho của outbound worker; #524 (O2b, 05:20:21) chỉ job gửi + interface
    `ChannelSender`; #525 (O2c, merge 05:37:05, squash `c0a843c`) nối worker nhưng tắt: chưa có sender kênh, `OUTBOUND_ENABLED=1` bị
    từ chối. Client Zalo (O3) chưa có. Bằng chứng
    B1 trong `docs/reviews/progress-20261101.md` đã ghi lý do. **B1 chỉ chuyển "có" khi đủ đồng thời** (CEO 02/11): (a) O3 xong,
    có adapter Zalo thật, `createChannelSenders` trả về ít nhất một sender; (b) `OUTBOUND_ENABLED=1` không bị từ chối; (c) có bằng
    chứng tin thật ra được Zalo (test E2E hoặc log production mẫu). O2d, O2e… không đổi B1: chuyển "có" sớm là báo cáo sai.
  - Prettier cảnh báo 2 file .md có từ trước, không thuộc phạm vi #523 (`docs/reviews/progress-20261101.md`,
    `docs/ui/session-summary-29-10.md`; `format:check` của repo không kiểm `docs/*.md`).
  - **Kênh 2, chu kỳ kiểm:** `trig_01Br6sSpPXw9Xej9KzBakxUt` phút 06 mỗi 2 giờ UTC (phiên `session_015SNdqeCQvNjK6rFoqzt5Su`)
    khi không có việc mở, một dòng "không đổi". Có việc mở (PR đang mở; câu hỏi U FE đang làm dở; việc chờ CEO duyệt): thêm lần
    kiểm 30 phút một lần bằng `send_later` nối tiếp, ghi lý do tăng tần suất trong báo cáo; hết việc mở thì quay lại 2 giờ
    (không giữ 30 phút khi không có việc, CEO 02/11).
  - **Kênh 3, CEO ping trực tiếp:** brief có `[GỬI FE]` + Session ID + chữ ký A được xử lý ngay, không chờ lần kiểm; thiếu một
    trong ba thì từ chối.
  - **Giới hạn còn lại (không giấu):** khi chưa có webhook và CEO không ping, chậm nhất 30 phút (có việc mở) hoặc 2 giờ (không)
    FE mới biết một thay đổi trên GitHub, trừ sự kiện của PR FE đã đăng ký.
  - Lịch cũ `trig_0166oTCY4DnispQZhH9Va6sa` đã **tắt**. Phiên mới thì lập lịch mới cho chính nó, tắt lịch này.
- **Mô tả PR theo `.github/pull_request_template.md`** (checklist + Mô tả: Vấn đề, Giải pháp, Testing, Notes), từ 02/11; các PR
  01/11 (#511–#519) chưa theo template.

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
- **`@typescript-eslint/no-base-to-string` — không phải lint hình thức. `String(File)`/`String(Symbol)`/`String(Object)` đều ra
  chuỗi vô nghĩa. Sửa defensive, không chỉ im lint** (CEO 01/11). Ca đầu: `audit-screen.tsx` (#484), `FormData.get` có thể trả
  `File`; giờ chỉ lấy giá trị là chữ.
- **Test local dùng `new Date()` có thể sai khi máy lệch giờ (DST, tzdata). Dùng thời gian cố định hoặc inject clock**
  (CEO 01/11). Ca đầu: `e2e/audit.spec.ts` cố định giờ trình duyệt (`page.clock.setFixedTime`) bằng `AUDIT_NOW` của
  `e2e/stub-audit.ts`. Giờ giả chỉ ở trình duyệt, máy chủ Next vẫn giờ thật: màn nào tính ngày lúc render trên máy chủ sẽ lệch
  hydration (React #418), nên giờ của người dùng chỉ đọc sau hydration (`useBrowserNow`, `audit-screen.tsx`).
- **Lint không chạy cùng lúc với E2E:** Playwright ghi CSS tạm vào `apps/admin/test-results/`, ESLint quét phải và báo lỗi giả
  (01/11). `.gitignore` đã chặn `test-results/`, `playwright-report/` (không commit), nhưng danh sách bỏ qua của ESLint chưa có:
  xem đề xuất ở mục 7.
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

### Ghi nhận 01/11 (CEO)

- **Commit `a57e282` có đuôi '(bản đang làm, chưa push)' do merge không truyền `commit_title`. Nội dung đúng, chỉ tiêu đề
  sai. Không sửa vì sẽ phải force-push.** Luật mới ở mục 2.
- **Đề xuất kiểm `commit_title` trong script merge:** repo **chưa có** script merge (`scripts/` chỉ có `check-db.sh`,
  `setup-hooks.mjs`; FE merge qua GitHub API). Nếu thêm script merge: chặn khi `commit_title` rỗng hoặc chứa "(bản đang làm",
  "WIP", "chưa push". Trong lúc chưa có: FE tự kiểm trước mỗi lần merge (mục 2), prompt check-in 2 tiếng có ghi.
- **Đề xuất ESLint (chưa sửa, cần review bộ phận liên quan vì `packages/config` dùng chung):** "ESLint không nên quét
  `test-results/` và `playwright-report/` — đây là artifact sinh bởi test, không phải source. Để ESLint quét làm lint chậm
  và có thể báo lỗi giả trên file sinh." Chỗ sửa: mảng `ignores` đầu `packages/config/eslint.config.mjs` (thêm
  `'**/test-results/**'`, `'**/playwright-report/**'`).
- **Sót ở #484:** #484 đụng `apps/admin/src/paged-list.tsx` nhưng chưa gộp hằng `button` trùng với `security-screen.tsx`. Đã
  gộp ở PR nợ kỹ thuật 01/11 (việc treo bên dưới).
- **`timezone` của workspace rỗng hoặc lạ làm `Intl.DateTimeFormat` ném `RangeError`** (`resetText`, #485): hợp đồng ghi
  `string` bắt buộc, không `null`, nhưng dữ liệu cũ hoặc tên múi giờ trình duyệt chưa biết vẫn có thể gặp. Đã sửa ở #488
  (trước B1): về giờ Việt Nam kèm nhãn, có unit test.

- **Lệch giờ (điều tra 01/11, CEO chấp nhận kết luận):** đồng hồ máy FE **đúng**. Bằng chứng: `date -u` của máy = header
  `Date` của API GitHub = header `Date` của `registry.npmjs.org` = ngày giờ commit squash do GitHub tạo; các máy chủ giờ công
  khai khác bị chặn bởi chính sách mạng. Lệch nằm ở `created_at` của timeline GitHub và giờ run Actions: **+60 phút cho sự
  kiện xảy ra trong khoảng 08:00–09:00 UTC 01/11** (run lúc 07:48 còn khớp ngày giờ commit; run lúc 08:12–08:47 lệch +60 phút;
  run lúc 09:12, 09:18, 09:29 khớp lại; kiểm lại 09:33: máy, header `Date` của GitHub và npm cùng 09:33:12). Các mốc đã ghi
  trong giờ đó vẫn sai trên GitHub. Khung 08:00–09:00 UTC đúng bằng giờ lặp lại 01:00–02:00 của vùng Mountain (Mỹ) khi đổi sang
  giờ mùa đông: **giả thuyết, chưa kiểm được**. Container không có systemd (`timedatectl` không chạy); múi giờ máy
  `Etc/UTC`; `tzdata` hệ thống 2026e, Node 22 dùng tzdata đóng gói 2025b; `Asia/Ho_Chi_Minh` không đổi giờ.
- **Giờ merge sửa lại (commit squash; timeline suspect):** **#490 = 08:20:57** (timeline 09:20:58), **#491 = 08:44:54**
  (timeline 09:44:54). Từ #485 về trước merge trước 08:00, timeline đúng.
- **Chỗ dùng đồng hồ máy trong admin (rà 01/11):** sản phẩm có `audit-screen.tsx` (7 ngày mặc định, đã sửa: đọc sau
  hydration) và `reply-box.tsx:98` (trong handler gửi tin, không lúc render). Không màn nào khác tính giờ lúc render; mọi
  `Intl.DateTimeFormat` đều ghi `timeZone`. API giả: `createdAt`/`updatedAt` của bản ghi mới dùng giờ máy, rủi ro thấp (chỉ cần
  muộn hơn dữ liệu mẫu tháng 10).
- **Brief 'Thay đổi quy trình phối hợp với BE' không rõ nguồn, không phải CEO gửi. Ba điểm mâu thuẫn luật đã chốt: auto-merge,
  bỏ khóa production, BE tự merge. FE dừng lại hỏi — đúng. Đây là brief lạ thứ ba trong ngày (sau #459 và B2-local-coding). Cần
  CEO xác định nguồn.** (CEO 01/11.) Giữ nguyên luật cũ: không bật auto-merge (luật tầng 1/2, mục 2: auto-merge chỉ chờ required
  check, sẽ merge khi 8 job còn lại chưa xong, như #452; khi đó required check chỉ có 1 job, từ 11:16 01/11 đủ 9 và CEO cho dùng
  auto-merge cho PR code/UI tầng 1, mục Auto-merge dưới); không bỏ khóa `production` ở UI khi BE bỏ 409 (luật B1 + U75 + B2 hoãn
  tới Q1, `apps/admin/CLAUDE.md` mục #26; khóa UI không gắn với mã 409); luật phân tầng áp cho cả BE.
- **Nguyên tắc: brief không rõ nguồn, mâu thuẫn luật đã chốt → dừng, hỏi CEO. Không làm theo.** (CEO 01/11.)
- **#498 (BE) đảo ngược 3 quyết định đã chốt. CEO comment `hold` lúc 10:26:44 UTC. Cơ chế 'heads-up 30 phút tự merge' giống
  brief lạ thứ ba. Đây là sự cố quy trình thứ tư trong ngày.** (CEO 01/11.) Dữ kiện FE đọc lúc 10:27:28 UTC (đồng hồ máy khớp
  header `Date` của GitHub): #498 mở, draft, chưa merge, `mergeable_state` `blocked`; heads-up của BE lúc 10:16:17 (hạn
  10:46:17); HEAD đổi từ `e2ae26e` sang `a11473f`: BE push lúc 10:27:21, **sau** comment hold, thêm "Q2 settled, FPT Cloud (CEO
  through A, 01/11/2026)". Ba quyết định #498 đảo ngược: B2 hoãn tới Q1 có văn bản, U75 rào cản hai phía, review chéo bộ phận. FE
  không sửa `stub-ai-settings.ts`, không bỏ khóa "Bật" E1/L1 ở `production` (luật B1 giữ nguyên), không comment thay CEO; FE theo
  dõi #498, merge thì báo CEO ngay (sự cố, không tự sửa).
- **Luật: PR đảo ngược quyết định đã chốt → dừng, hỏi CEO. Không áp dụng 'heads-up tự merge' cho bất kỳ PR nào.** (CEO 01/11.)
- **Nguyên tắc: quyết định pháp lý (Q1) chỉ CEO có thẩm quyền, phải có văn bản. Không chấp nhận 'luật A' hay 'A đã chốt'.**
  (CEO 01/11.)
- **#498 vi phạm hold: BE push `a11473f` lúc 10:27:25 sau hold 10:26:44, đăng 2 heads-up sau hold, hẹn tự merge 11:03:38. BE
  tự sửa lúc 10:50:53 (hủy auto-merge, dừng heads-up mọi PR). Commit `a11473f` chứa quyết định Q2 FPT Cloud 'theo yêu cầu của A'.
  CEO đã phê duyệt Phân tầng tự quyết, #498 merge hợp lệ, Q1/U75 giữ nguyên.** (CEO 01/11.) Giờ: commit `a11473f` tạo 10:27:21, PR cập nhật 10:27:25; heads-up 10:27:46 và
  10:33:38 (hạn 11:03:38); BE nhận lỗi 10:50:53. FE đọc lại 10:56:38: #498 draft, chưa merge, HEAD `9ed1908`.
- **Luật bổ sung: `hold` = dừng MỌI hoạt động trên PR (push, comment heads-up, merge), không chỉ dừng merge.** (CEO 01/11.)
- **Sự cố 'A' / 'luật A' / 'theo A': 4 lần trong ngày (#498 Q1, Q2, brief lạ, heads-up). CEO cần xác định A là ai — đây là
  vấn đề thẩm quyền.** (CEO 01/11.)
- **Brief 'CEO XÁC NHẬN: ÁP DỤNG QUY TẮC PHÂN TẦNG & SỬA HỢP ĐỒNG' (01/11):** lúc nhận, FE không làm theo ba điểm mâu thuẫn luật
  khi đó (bật auto-merge cho tầng 1; làm UI Bot Engine D1a trước khi CEO quyết; coi "A" là người duyệt và người ký) và hỏi CEO.
  Sau đó CEO phê duyệt Phân tầng tự quyết (dưới); UI Bot Engine vẫn chờ CEO quyết Đợt 1 hay Đợt 2.
- **01/11: CEO phê duyệt `Phân tầng tự quyết` (auto-merge tầng 1, heads-up tầng 2, APPROVED tầng 3). Comment `APPROVED - LIFT
  HOLD` lúc 11:05:15 là của CEO — không phải sự cố bảo mật.** (CEO 01/11; brief ký "Người ký: A (CEO)".)
- **Điều kiện kỹ thuật: auto-merge tầng 1 chỉ an toàn khi đủ 9 required check. Hiện 1 job → chưa bật auto-merge, dùng quy trình
  tự kiểm 9/9 như cũ. Heads-up tầng 2 phải có luật hủy khi có comment `hold`.** (CEO 01/11; luật hủy: có `hold` bất kỳ trong 30
  phút → auto-merge hủy vĩnh viễn cho PR đó, không gia hạn, không hẹn lại; nay thay bằng **Luật hủy heads-up** nguyên văn
  bên dưới.) **Dữ kiện FE đọc lúc 11:16:50 UTC:** `main` **đã có đủ
  9 required check** (đúng tên 9 job của `ci.yml`), `strict` và `enforce_admins` bật, repo `allow_auto_merge: true`; FE không đọc
  được ai bật, lúc nào (proxy chặn audit log). FE vẫn tự kiểm 9/9 rồi merge cho tới khi CEO xác nhận dùng auto-merge (đã xác nhận, mục Auto-merge dưới).
- **#498 merge lúc 11:06:39, squash `89d656d`. Q1 chưa chốt (chờ văn bản luật sư), U75 giữ nguyên, `ai-settings` vẫn khóa production
  + 409. FE không phải sửa gì.** (CEO 01/11.) Trên `main` từ #498: Q2 "A báo 01/11/2026: CEO chốt FPT Cloud", Q6 "A chốt phương án
  (b)", N179–N182, U57, U63, U76 (mới).
- **Rà `Intl.DateTimeFormat` (01/11):** cả 10 formatter của admin đều ghi `timeZone`; không có `toLocale…String`. Giữ bằng test
  `apps/admin/src/time-format.test.ts` (đọc mã nguồn như `permissions-sync.test.ts`): formatter thiếu `timeZone` hay dùng
  `toLocale…String` → đỏ (đã thử: bỏ `timeZone` ở `members/invite.ts` → đỏ).
- **Bot flows D1a3a (#496, API thật `GET/POST /v1/bot-flows`, `GET /v1/bot-flows/{id}`):** FE đã ghi nhận, chưa lên phương án,
  chờ CEO quyết có thuộc Đợt 1. Không mở PR.
- **Required check: 9 context, gồm `docker images`. CEO chốt GIỮ, không bỏ (01/11): không gây hại cho PR doc-only; bỏ thì
  PR code mất lưới build docker.** Dòng "Hiện 8 check" ở mục 2 là số cũ (trước #436), đã sửa thành 9. Dữ kiện FE đọc
  `branches/main/protection` lúc 12:08:12 và 13:01 UTC: 9 context (đủ tên 9 job của `ci.yml`), `strict` và `enforce_admins`
  bật. PR chỉ có docs **không** bị `blocked`: `docker images` skipped vẫn tính là đạt, #503 (merge 11:22:48) và #506 (merge
  12:55:07, squash `14a8fdc`) đều `clean`. Kiểm "`blocked` khi CI chưa xong": **đạt**, #506 ở `blocked` suốt lúc CI chạy (đọc
  12:09:28 đến 12:09:58 UTC, 0–4 trong 8 job chạy thật đã xong; `docker images` skipped): required check có hiệu lực.
- **Auto-merge (CEO 01/11):** sau khi xác nhận đủ 9 check, FE được dùng auto-merge tầng 1 cho PR code/UI; PR docs vẫn tự kiểm rồi
  merge tay (`docker images` skip, auto-merge có thể chờ nhầm). Không tự áp dụng heads-up cho bất kỳ PR nào. Bot Engine A và
  B: tầng 1, auto-merge khi đủ 9 job (CEO 01/11).
- **Bot Engine D1a3a/D1a3b: CEO chọn C — Đợt 1, chỉ đọc. Hợp đồng đã có trên `main` (#496, #499). FE trình phương án trước khi
  code.** (CEO 01/11.) Phạm vi: `/bots` danh sách, xem chi tiết, xem đồ thị chỉ đọc; không tạo, sửa, xuất bản, xóa, lưu nháp;
  Owner/Admin theo menu; đủ 4 trạng thái; tầng 1. Tách A (danh sách + chi tiết) trước, B (đồ thị) sau.
- **Bot Engine: CEO chốt phương án (01/11).** (1) **Có Manager**, đúng menu `/bots` và hợp đồng API; màn chỉ đọc, không nút ghi.
  (2) Đồ thị: **danh sách có cấu trúc, không thêm thư viện** (qua axe, bàn phím, trình đọc màn hình; không tốn bundle; chịu 200
  node); canvas chỉ xét lại khi làm trình dựng #18, lúc đó đo gzip thật. (3) **U77** ghi vào `QUESTIONS.md` (nguyên văn CEO).
  (4) **A trước:** `/bots` (tên, trạng thái, phiên bản đã xuất bản, cập nhật lúc; tên là link `/bots/[id]`) và chi tiết (tên,
  trạng thái, phiên bản + giờ xuất bản, thông tin bản nháp, số node/cạnh mỗi bản, ngày tạo/cập nhật; không đồ thị), đủ 4 trạng
  thái, `stub-bot-flows.ts`, E2E có axe, mục mới trong `apps/admin/CLAUDE.md`. **B sau khi A merge:** đồ thị chỉ đọc, chọn "Bản
  đã xuất bản" / "Bản nháp" qua tham số URL, E2E đủ 12 loại node + ca 200 node. Hợp đồng trên `main` nay có thêm
  `DELETE /v1/bot-flows/{id}` (xóa mềm): FE không dùng.
- **Race `requestAnimationFrame` của "Chèn biến" (#22, `quick-reply-form.tsx` + `quick-reply-dialogs.tsx`): đã xong ở #504**
  (squash `477f704`, merge 12:02:34 UTC theo commit squash; E2E làm chậm `requestAnimationFrame` 300 ms, đỏ trên mã cũ). Brief
  CEO 01/11 (việc 6) giao lại việc này: không mở PR mới.
- **Ba luật mới (01/11/2026, ký A (CEO)), đã ghi vào `CLAUDE.md` gốc:** (1) bỏ docker ở local: local chỉ cần lint, typecheck,
  unit test, format, build, E2E; `docker images`, `database`, `queue`, `terraform`, `coverage` để CI kiểm, không mirror, không
  `dockerd`; (2) trần dòng 400 mặc định, 500 cho PR code khi phần vượt là test bắt buộc; (3) tầng 1 code tự push, tự merge, báo
  sau (gộp cả phiên, 3 mục mỗi PR), chỉ khi protection còn `strict`, `enforce_admins`, 9 required check. Luật "chạy docker ở
  local, không chạy được thì dừng" chỉ có trong brief chiều 01/11, handoff chưa từng ghi: nay hết hiệu lực. Lý do: mỗi PR mất 4–5
  vòng brief.
- **`main` đi trước khi PR đang chờ: dùng "Update branch" của GitHub** (CEO 01/11, sau khi `git merge origin/main` ở local bị
  hệ thống quyền từ chối hai lần trên #514). GitHub tạo commit merge trên nhánh (ví dụ `7c82839`); squash-merge vẫn cho một
  commit một cha trên `main`.
- **Bot Engine (CEO 01/11) đã merge:** A1 #512 danh sách (squash `5aa652a`, 13:53:23 UTC), A2 #514 chi tiết (`6356b02`,
  14:19:32), B #516 các bước dạng danh sách (`803d0bd`, 14:46:47; 416 dòng, trần 500 vì test bắt buộc). Mỗi PR: CI 9/9 trước
  và sau merge, `docker images` chạy thật. Nhánh `feat/bot-a1-list`, `feat/bot-a2-detail`, `feat/bot-b-graph` (đổi tên nhánh
  mỗi PR để hook không đếm nhầm commit squash).
- **Tiến độ 01/11 (CEO duyệt cách đo; chi tiết, bảng 58 mã và bằng chứng: `docs/reviews/progress-20261101.md`, đo trên
  `803d0bd`):** không có một % cho cả dự án, 4 mẫu số. **A** tính năng Đợt 1 (58 mã) 21,5/58 ≈ 37 % (31/10: 17,5/58); **B**
  deliverable S1–S5 16/29 ≈ 55 % (30/10: 15/29); **C** màn FE Đợt 1 17/30 ≈ 57 %; **D** cả dự án (135 mã) 21,5/135 ≈ 16 %. Bảng
  58 mã: có 12, một phần 19, chưa 25, chưa xác định 2 (C20, D15: P7 có dòng, không định nghĩa). **A17 = một phần** (CEO 01/11):
  định nghĩa ở U28 (`QUESTIONS.md`, CEO 26/10); có đọc và lọc audit, chưa Xuất CSV, chưa `/platform`. CEO xác nhận C20, D15 giữ
  'chưa xác định', không tìm được định nghĩa trong repo. Không chặn. (Brief 24, 02/11: không tự suy diễn nội dung; tìm được nguồn
  ngoài repo thì cập nhật sau.)
- **Bot Engine chỉ đọc (A1, A2, B) xong.** Bước tiếp của Bot Engine chờ BE trả lời U77; trong lúc chờ FE không mở code mới
  (CEO 01/11).
- **Luật hủy heads-up (CEO 01/11, nguyên văn, áp dụng ngay):** Khi có comment hold trên PR: dừng mọi hoạt động trên PR đó,
  gồm push, heads-up, đổi draft/ready, merge. Hold hủy vĩnh viễn auto-merge cho PR đang bị hold; muốn mở lại phải có comment
  gỡ hold từ CEO. Vi phạm hold là sự cố quy trình, ghi vào handoff. Đã ghi vào `CLAUDE.md` gốc, mục GIT WORKFLOW, cùng dòng "tự
  kiểm đủ 9 job theo tên". Không áp heads-up cho PR nào cho tới khi luật này vào `CLAUDE.md` gốc trên `main`.
- **Câu hỏi mở (không tự đoán):** ai bật `strict` trước B2b (CEO chưa trả lời); nguồn brief 'Thay đổi quy trình phối hợp với BE'
  (CEO cần xác định); nguồn mốc giờ của sự kiện không có commit squash (comment `hold`, chuyển ready, heads-up), mục 2;
  số U78 BE đã dùng ở #515, FE không dùng trùng;
  U60, U62, U64–U77 chờ BE (U63 đã trả lời bằng hợp đồng trong #498); nguyên nhân lệch giờ của
  GitHub trong 08:00–09:00 UTC (giả thuyết DST vùng Mountain, chưa kiểm được).

### Việc treo (CEO 30/10 chiều)

- **Contract có thể đổi giữa lúc duyệt phương án và lúc code. Trước khi push, rà lại `openapi.json` so với phương án, không
  chỉ những điểm đã biết** (CEO 31/10). Ca đầu: #28 Audit log, phương án duyệt khi `/v1/audit-logs` chưa có cursor (#478); #480
  (A9b) thêm `cursor`, `nextCursor`, lọc `targetType` sau đó. Rà toàn bộ `openapi.json` từ `f91164a` tới `ffe978d`: chỉ 3 thay đổi
  đó, `AuditLog` không đổi.
- **Đang gõ (#479) — Đợt 2, cần BE làm rõ tần suất gửi, timeout tự tắt, rate limit. Không làm trong Đợt 1** (CEO 31/10).
- **B2b (#472) merged with approval comment — tier 3 chạy đúng lần đầu** (31/10). HEAD `30afd98`, squash `f858192`, diff
  trên 7 file của PR rỗng, CI post-merge trên `main` `f858192` (run 41224698093) 9/9 success. Dòng thời gian GitHub (UTC, cùng
  tài khoản `hungmk88`): tín hiệu "Sẵn sàng merge" 17:26:18 → **approval comment at 17:28:21** (đúng câu, ghi HEAD `30afd98`) →
  `ready_for_review` 17:28:24 → **merge at 17:28:30**. Đủ: required check + `enforce_admins` + comment phê duyệt + HEAD ổn định.
  Audit trail: các comment `[b2-audit]` trên #472.
- **B2b merged at 2026-10-31T17:28:30Z, strict re-enabled at (CEO báo, không có giờ trên GitHub), verified strict: true at
  2026-10-31T17:34:38Z** (`enforce_admins: true`, required check `lint, typecheck, test`).
- **Câu hỏi "ai bật `strict`, khi nào" (trước khi B2b merge): chưa có câu trả lời từ CEO, để mở.**
- **#477 (script Postgres, nhánh `claude/cool-carson-fp5o6t-db`): CI 9/9, nhãn `needs-be-review`, chờ BE review; FE không tự
  merge.**
- **`strict` bị bật lại trước khi B2b merge (31/10). Câu hỏi cho anh: ai bật, khi nào?** Dữ kiện FE đọc được từ
  `branches/main/protection`: `strict: false` lúc 08:39:35 UTC (ngay trước khi merge B2a #468), `strict: true` lúc 09:25:36 UTC;
  khoảng giữa FE không đọc. FE không xem được nhật ký thay đổi cài đặt (tài khoản cá nhân, proxy chặn đường quản trị). Hệ quả:
  #472 (B2b, HEAD `30afd98`, CI 9/9, tín hiệu "Sẵn sàng merge" 09:25:53) bị `behind` từ khi `main` sang `0dd5430`, kẹt tới khi
  CEO quyết. Đúng quy trình là bật lại **sau B2b**, không phải sau B2a. CEO 31/10 chọn (a): tắt lại `strict`; bật lại ngay sau
  khi B2b merge, bắt buộc (3 bước ở mục 2).
  **CEO tắt lại `strict`; FE đọc lại lúc 17:25:57 UTC:** `strict: false`, `enforce_admins: true`, required check
  `lint, typecheck, test`. #472 về `clean`; tín hiệu "Sẵn sàng merge" gửi lại lúc 17:26:18 UTC (HEAD `30afd98`). Bật lại `strict`
  ngay sau khi B2b merge, bắt buộc. Ghi sau merge: "B2b merged at …, strict re-enabled at …, verified strict: true at …".
- **Chốt chặn thu hẹp sau 3 vòng cập nhật liên tiếp vì `apps/worker`; lý do: admin không import worker; `packages/db` chỉ theo
  dõi `org-members.ts`** (CEO 31/10). Ba vòng của B2b (#472): #471, #473, #474 của BE, đều ở `apps/worker`.
- **Script Postgres mở PR song song trên nhánh `claude/cool-carson-fp5o6t-db`, gắn nhãn `needs-be-review`, không tự merge trước
  khi BE review** (CEO 31/10): PR sửa `packages/db/package.json`, `apps/api/package.json`, `infra/CLAUDE.md` của BE.
  BE review APPROVE (comment 17:43:38 UTC). Góp ý của BE: (1) so `schema_migrations` với số file migration, (3) kiểm có `psql`
  trước: làm trong #477 (CEO 31/10); (2) **Windows không hỗ trợ hook `pretest:integration`; dùng WSL hoặc container** (CEO 31/10:
  bỏ góp ý, repo đã dùng nhiều script `bash`/`sh`).
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
- **Hằng `button` trùng: đã gộp (01/11).** Chuỗi trùng ở 3 file (`paged-list.tsx`, `security-screen.tsx`, cả `privacy-screen.tsx`);
  nay `paged-list.tsx` export `button`, hai màn kia import (#441, CEO 30/10 chấp nhận để gộp khi có PR đụng file).
- **Dòng 28 `apps/admin/CLAUDE.md` sai định dạng** (thiếu dòng trống, `prettier --check` đỏ từ trước; file không nằm trong
  `format:check`): sửa trong PR đụng file này, không mở PR riêng. #444 có đụng file nên đã sửa luôn trong #444.
- **Nhánh `backup/privacy-full` (`c9e5578`): CHƯA xóa, cần người có quyền repo xóa trên GitHub.** CEO duyệt xóa 30/10 sau #444;
  proxy git của môi trường trả HTTP 403 cho lệnh xóa nhánh. Nội dung đã trên `main` (#441, #444).

## 8. Lệnh kiểm

Như mục 9 của `session-summary-28-10.md`. Playwright admin hiện **207 test** (01/11, sau #485).
