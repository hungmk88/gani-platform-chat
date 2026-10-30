# Tóm tắt session Backend K (để session sau đọc lại)

Session `session_01BjcEWmGXkhq6DYgXdQ5YyF` · Backend (Gói 1) · từ **26/10/2026 18:11 UTC** tới **30/10/2026 ~08:40 UTC**.
Session trước: `docs/reviews/J-session-summary.md` (mục 1, 4 vẫn đúng, trừ chỗ file này sửa). Người giao việc: anh (xưng "anh",
Backend xưng "em", trả lời tiếng Việt). `main` lúc chốt sổ: `14509e9`.

Đọc theo thứ tự: `CLAUDE.md` (gốc) → `apps/api/CLAUDE.md`, `packages/db/CLAUDE.md`, `infra/CLAUDE.md` → file này → `QUESTIONS.md`
(N168–N172, U52–U60) → `docs/business/risk-ownership.md`.

## 1. Quy tắc làm việc (giữ nguyên ở session sau)

**Kế thừa từ J:**
- Plan trước, anh duyệt rồi mới code. PR ≤ 400 dòng (vượt thì báo trước khi push).
- Trailer `Co-Authored-By` + `Claude-Session`, không ghi tên model vào commit hay PR.
- gitleaks + `git grep` mẫu secret in thẳng kết quả trước mỗi lần push. Exit code thật, không pipe che.
- Flaky: tìm root cause, không re-run cho xanh. Không amend commit đã push.

**Anh chốt thêm trong session K:**
- **CI:** xanh thì báo anh merge (kèm HEAD). Đỏ thì phân tích và báo trước, **không tự sửa**.
  Anh có thể bảo em merge (squash), như #414.
- **Xung đột merge:**
  - Hai phía sửa dòng sát nhau mà không giẫm nội dung: **em tự giải**, không cần hỏi.
  - Chỉ hỏi khi cùng dòng mà khác ý, hoặc phải bỏ chữ của phía kia.
  - Sau khi giải: chạy lại đủ kiểm chứng.
- **Rà checklist:** đối chiếu từng mục với **file thật trong repo**, không dựa vào tài liệu.
  Bài học 28/10: S1 "chưa có hạ tầng as-code nào", không phải "chỉ thiếu staging".
- **Lead BE:** không trả lời hay xác nhận thay lead BE.
  Khi anh viết "mục này chờ lead BE" thì mới là việc chờ lead BE.
- **Văn bản rủi ro:** dev chỉ ghi nhận sự kiện. Không kết luận trách nhiệm của ai, không ký thay ai.
- **Terraform:** không làm gì thêm cho tới khi có Q2.
- **Kiểm chứng thay đổi:**
  - **Đột biến (mutation):** báo số bị bắt / tổng.
  - **Đột biến tương đương:** ghi nhận, không cố viết test để bắt.
- **Thứ tự lệnh khi đổi API:** build API → `openapi` + `gen:api` → build toàn bộ.
- **Giờ:**
  - Lịch nhắc chạy theo đồng hồ máy chủ (UTC); giờ VN = UTC + 7.
  - Ngày trong tuần phải kiểm lại (anh từng ghi nhầm thứ, em hỏi lại).

## 2. PR đã merge trong session (23 PR, squash)

| PR | Nội dung | Ghi chú |
|---|---|---|
| #356 | K-IN chờ thêm một lượt stalled check bị bỏ (#324) | Mục 4.1 |
| #361 | U31 tầng DB: ứng viên người nhận + đếm hội thoại đang giữ | Hàm SECURITY DEFINER thứ 15 (sau #385 là 16) |
| #363 | U31: `GET /v1/conversations/{id}/assignees?purpose=transfer\|assign` | FE nối ở #369, #377 |
| #367 | U30 PR 1: `channel`, `assignee`, `lastMessagePreview` trên dòng Hộp thư | 372 dòng. FE nối ở #374 |
| #371 | Sửa flaky #368: test bootstrap-operator chạy REPEATABLE READ | Trước đó đỏ khoảng 1/3 lần chạy cả bộ |
| #372 | Docs U52/U53 (người nhận ticket, ticket của một hội thoại), N170 | Hợp đồng planned |
| #379 | U30 PR 1b: script điền lại đoạn trích cho hội thoại cũ | `--dry-run`, log tiến độ, lô 1000, idempotent, test tranh chấp |
| #380 | Docs U54 (lý do chuyển chờ ghi chú nội bộ N135), U55 (gán tay không chặn tải) | |
| #383 | U30 PR 1c: thư FE `docs/ui/u30-dong-hop-thu.md` | |
| #385 | `openCount` = `HUMAN_ACTIVE` (Brief §M04); thêm `awaitingCustomerCount` | Hàm mới `held_conversation_counts_by_state`; hàm cũ để xóa ở #386 |
| #387 | Thư FE về `openCount`/`awaitingCustomerCount` (U31, N168, U55) | |
| #390 | U30 PR 2: lọc Hộp thư theo `channelId` và `q` | `q` dùng chung `searchOf` với `/v1/customers`; mọi bộ lọc AND với con trỏ trang |
| #393 | Tên khách lưu NFC (sửa lúc ghi + migration 202611010900 + CHECK) | Phương án A anh chọn |
| #395 | Đóng U30 cho Đợt này; hạn 10/11 cho pháp lý và Q7 (N171, N172) | |
| #398 | U56: `GET /v1/conversations/channels` (kênh cho ô lọc Hộp thư) | 236 dòng, anh duyệt không tách; 6/6 đột biến |
| #400 | `docs/business/q7-q8-q9-survey.md` | 34 câu; gửi thứ Sáu 30/10, trả lời trước 06/11 |
| #402 | `docs/business/staging-options.md` (A: chờ Q2; B: staging tạm) | |
| #406 | Docker: 4 image (`api`, `worker`, `migrate`, `admin`) + job CI `docker` | Mục 4.5 |
| #407 | `docs/business/risk-ownership.md` (4 rủi ro Đợt 1) | Anh soạn bản đầu, em sửa 5 lỗi |
| #409 | Khung Terraform: 8 module interface, 2 env, job CI `terraform` | 612 dòng, anh duyệt. Mục 4.6 |
| #410 | Rủi ro 2 đóng (#406 merge) | |
| #414 | U59: `ANSWERABLE` dời sang `permissions.ts` và export; trả lời U57, U58 | Em merge theo lệnh anh, `da45290` |

## 3. Quyết định ghi trong `QUESTIONS.md`

- **N168 (U31):** luật lọc người nhận trùng `handOver`. `openCount` toàn công ty chỉ đếm `HUMAN_ACTIVE`;
  `awaitingCustomerCount` đếm `PENDING_CUSTOMER` (sửa 28/10, #385).
- **N169 (U30):** đoạn trích **lưu sẵn** trên `conversations` (phương án B, sau khi đo). Chi tiết:
  - Lý do: đọc `messages` phải dò mọi partition. Ở 39 partition, p95 là 4,56 ms so với nền 0,65 ms, và tăng theo số tháng.
  - Tin hệ thống không tính.
  - DB chỉ lưu loại tin; API ghép nhãn `[Hình ảnh]`, `[Tệp]`, `[Sticker]`, `[Lựa chọn]` lúc đọc.
  - Cắt 120 grapheme sau khi chuẩn hóa NFC, không thêm `…`.
  - Support không đọc được hai cột này.
- **N170:** người nhận ticket là Owner/Admin/Manager/Support (U52). `GET /v1/tickets?conversationId=` (U53, planned).
  `GET /v1/workspaces/{id}/assignees?purpose=ticket` làm ở S4 (28/12).
- **N171:** số tin chưa đọc trên dòng Hộp thư. **Mở**, chưa có sprint (cần bảng đánh dấu đã đọc, sau S1).
- **N172:** hạn CEO trả lời Q1 (pháp lý, kéo theo Q2) và Q7 là **10/11/2026**; mốc báo động **05/11/2026**.
- **U52–U56:** đã trả lời hoặc đã làm (xem mục 2).
- **U57:** API không trả `channel_unavailable` ở đường nào. Câu FE đề xuất:
  "Kênh đang lỗi. Tin đã được lưu, hệ thống sẽ thử gửi lại. Nếu không gửi được, tin sẽ chuyển sang trạng thái thất bại."
  Bản ngắn phải có chữ "có giới hạn". Còn mở, **chờ lead BE chốt khi làm 8b**: `POST …/messages` có trả 502 không.
- **U58:** chưa có chế độ bảo trì, nên đề xuất FE bỏ vế "Tin khách gửi tới vẫn được lưu".
  Còn mở, **chờ lead BE quyết khi làm bảo trì** (Brief dòng 859).
- **U59:** đã làm (#414). Câu trả lời U57/U58 đã comment cho FE trên #396, U59 trên #399.
- **U60 (mở, gửi Backend, CEO duyệt gửi 28/10):** khi làm ticket thật ở S4, đặt luật ticket vào file API export được, để FE viết
  test đồng bộ như #378. Luật gồm: ai đọc, ai đổi trạng thái, ai hủy, các bước chuyển, ai làm người nhận.

## 4. Chi tiết theo chủ đề

### 4.1 #324: K-IN đỏ sau kill-9 (đã đóng 28/10)

- **Root cause (H5):** BullMQ 5.81.5 đặt khóa `stalled-check` với PX **bằng đúng** `stalledInterval` (30 s).
  - Khoảng 2,5 % lượt check bị bỏ (đo bằng `MONITOR`).
  - Bình thường job mồ côi quay lại sau ~64 s; khi một lượt bị bỏ thì ~94 s, quá hạn cũ (~93,4 s).
- **Sửa (#356):** hạn chờ = `kill + 4 × interval + 10 s` = 130 s.
  - `apps/worker/CLAUDE.md` ghi 3 mốc 64 / 94 / 130 s và "không hạ xuống 3×".
  - Không đổi logger, cấu hình hay `stalledInterval` của bản chạy thật.
- **H4** (mất log khi SIGKILL) bị loại. **H2** (biến cấu hình `stalledInterval`) anh chưa duyệt.
- **Issue gửi BullMQ:**
  - Bản cuối: `/tmp/claude-0/-home-user-gani-platform-chat/5a2b7fa5-def8-5368-af30-cbfe3f4c243f/scratchpad/bullmq-issue-post-final.md`
    (dẫn #286, ghi rõ khác biệt; số đo local, máy rảnh, 3,8 % và 13,8 %, sau khi vá là 0).
  - Session không có quyền vào `taskforcesh/bullmq`, nên **anh đăng bằng tài khoản cá nhân**.
  - Chưa có xác nhận đã đăng. File scratchpad mất khi container bị thu hồi, cần thì soạn lại từ #324.

### 4.2 U31: người nhận Gán lại / Chuyển

- **#361 (DB):** `listAssigneeCandidates` + đếm theo người.
- **#363 (API):** endpoint đọc trước luật `handOver`. Test `conversation-assignees.integration.test.ts` giữ hai bên khớp nhau.
- **#385:** `openCount` theo Brief §M04. Hàm cũ `app.held_conversation_counts` không còn ai gọi; issue **#386** để `DROP` nó
  (ưu tiên thấp). Trước khi DROP phải chạy lại `git grep held_conversation_counts` và anh xác nhận.

### 4.3 U30: dòng Hộp thư (đóng phần Đợt này ở #395)

- **PR 1 (#367):** ba trường mới; đoạn trích ghi trong `insertMessage` (`previewOf` / `messagePreview` của `@gani/domain`).
- **PR 1b (#379):** script `backfill:last-message-preview`.
  - Chạy bằng `migration_role`, có `--dry-run`.
  - Cache nguội ~50–55 s cho ~20k hội thoại; cache nóng ~4 s.
  - Chỉ giữ khóa dòng từ UPDATE tới COMMIT của từng lô.
  - Test tranh chấp chứng minh script không ghi đè đoạn trích mới hơn do worker vừa ghi.
- **PR 1c (#383):** thư FE. Hội thoại cũ có `lastMessagePreview = null` cho tới khi script chạy trên môi trường đó.
- **PR 2 (#390):**
  - `channelId` + `q`, AND với nhau và với con trỏ trang.
  - `q` rỗng hoặc chỉ khoảng trắng → 400.
  - `q` có `@` thì chỉ tìm email khớp đúng, không lùi về tìm theo tên.
  - `%` và `_` là chữ thường, không phải ký tự đại diện.
- **NFC (#393):**
  - Sửa lúc ghi (`updateCustomer`), migration chuyển tên cũ sang NFC (không đổi `updated_at`), CHECK
    `customers_display_name_nfc_check`.
  - Tìm kiếm chỉ chuẩn hóa `q`: quét 10 000 khách mất 14,4 ms.
- **Còn lại:** số tin chưa đọc (N171), tag trên dòng và lọc tag (U47), SLA (U18/U40, chờ Q7).

### 4.4 Tài liệu kinh doanh (`docs/business/`)

- **Khảo sát Q7/Q8/Q9 (#400):**
  - 34 câu, công ty 3–5 để placeholder.
  - U40 có ba phương án A/B/C, ghi "Backend đề xuất phương án A".
  - Gửi thứ Sáu 30/10, trả lời trước thứ Sáu 06/11.
- **Staging (#402):** A (chờ Q2) hoặc B (staging tạm). B cần luật sư trả lời câu 2–3 trước khi bật.
- **Phân công rủi ro (#407, #410):**
  - Rủi ro 1, Q1/Q2: CEO.
  - Rủi ro 2, image `api`: **đã đóng**.
  - Rủi ro 3, lead BE xác nhận mốc 30/10: lead BE.
  - Rủi ro 4, 16 hàm SECURITY DEFINER: chủ đầu tư (N35).
  - Dòng xác nhận của CEO và lead BE còn trống.

### 4.5 Docker (#406)

- **Image và nền:**
  - `Dockerfile.node` (`--target api|worker|migrate`) và `Dockerfile.admin` (Next.js standalone).
  - Nền `node:22.23.3-slim`, chỉ linux/amd64.
- **Lúc chạy:**
  - Chạy bằng uid 1000, không có npm/corepack/pnpm, có HEALTHCHECK.
  - `migrate` là job: chạy trong pipeline trước khi deploy, không chạy trong production runtime.
- **Image `api`:**
  - Deploy với `--config.auto-install-peers=false --config.dedupe-peer-dependents=false`.
  - Peer `socket.io-adapter` khai báo trực tiếp trong `apps/api`.
  - Kích thước giảm từ 1165 MB xuống 353 MB.
- **`API_ORIGIN` của admin:** gắn lúc build. Chạy production với giá trị mặc định thì log cảnh báo.
- **CI `infra/docker/test-images.sh`, các ngưỡng:**
  - Bản nén > 150 MB đỏ, > 100 MB cảnh báo.
  - Bản giải nén chỉ cảnh báo (> 400 MB, > 600 MB).
- **CI `test-images.sh`, các kiểm tra:**
  - uid, nội dung image, dừng ngay khi thiếu cấu hình.
  - Migrate, probe, HEALTHCHECK, Socket.IO.
  - `docker stop` < 10 s.
  - Trivy 0.58.1 ghim digest.
- **Số đo CI:**

  | Image | Nén | Giải nén |
  |---|---|---|
  | api | 129 MB | 353 MB |
  | worker | 94 MB | 253 MB |
  | admin | 110 MB | 286 MB |
  | migrate | 90 MB | 240 MB |

  Trivy: 0 HIGH/CRITICAL.

### 4.6 Terraform (#409): khung, chưa `plan`/`apply`

- **Module:**
  - 8 module interface. `platform` chọn cài đặt bằng `count` + `one(...)`.
  - `modules/database` có `dummy_a`/`dummy_temp` + `tests/platform.tftest.hcl`.
  - Không có thư mục mang tên cloud.
- **Env:** `envs/staging`, `envs/production` có guard `terraform_data.platform_chosen`.
  - `validate` qua; `plan` dừng với "platform not set, cannot plan".
- **Phiên bản:**
  - `.terraform-version` = 1.16.6. `terraform.sha256` có 5 nền tảng, đối chiếu SHA256SUMS có chữ ký HashiCorp.
  - `required_version` là `>= 1.16.6, < 2.0.0`.
- **CI:** fmt → init → validate → test, **không chạy plan**. Đột biến 5/5 bị bắt.
- **Khi có Q2:** làm theo `infra/CLAUDE.md` (provider, lock file commit, `backend.tf`, cache plugin).

## 5. Mốc và lịch nhắc

| Ngày (UTC) | Việc | Ai |
|---|---|---|
| 30/10 | Đã gửi báo cáo tiến độ, trễ 6 giờ so với hạn 02:00 (anh chấp nhận). Lead BE chưa xác nhận; CEO ping lần 1 lúc 29/10 17:35; anh ping lần 2 lúc 30/10 ~08:22 | — |
| **31/10 02:00** | Lead BE vẫn chưa phản hồi thì anh báo CEO can thiệp. Em không xác nhận thay | Anh |
| 05/11 01:00 | Nhắc CEO Q1/Q2 lần 1 + kiểm khảo sát Q7 (`trig_01MXf3p1XMCGt4EAawi9VSAf`) | Em (tự chạy) |
| 06/11 | Hạn trả lời khảo sát Q7/Q8/Q9 | CEO / các công ty |
| 06/11 01:00 | Nhắc lần 2: S1 trượt điều kiện "staging lên" nếu 48 giờ không quyết (`trig_0134rDP8XEuPfWGiZwHd9BCh`) | Em (tự chạy) |
| 08/11 01:00 | Đề xuất ghi nhận sự kiện vào N172, chỉ ghi khi CEO đồng ý (`trig_01DKAHXQBLz1mAbb9HmzfxPb`) | Em (tự chạy) |
| 10/11 | Hạn CEO trả lời Q1/Q2/Q7 (N172) | CEO |
| 16/11 | S1 Backend bắt đầu (điều kiện "staging lên") | — |
| 28/12 | S4: ticket thật + `GET /v1/workspaces/{id}/assignees?purpose=ticket` + U60 | BE |

Lịch "FE check-in 2 tiếng" (`trig_01Br6sSpPXw9Xej9KzBakxUt`) là của session FE, không phải của session này.

## 6. Việc tiếp theo (anh duyệt thứ tự 29/10, nhắc lại 30/10)

1. **Mục 2: soạn phương án cho lead BE.** Danh sách đã gửi anh 30/10; **chờ anh chọn câu nào gấp trước** rồi mới đọc code.

   | Mã | Màn | Câu hỏi |
   |---|---|---|
   | U41 | C8/C10 | Đổi giờ làm việc hay thêm ngày lễ khi hội thoại đang mở: tính lại hạn SLA hay giữ hạn cũ |
   | U44 | C10 | Ngày lễ sửa/xóa được không, trùng khoảng ngày, ngày đã qua; nghỉ trưa riêng từng ngày hay chung cả tuần |
   | U45 | C9 | Agent ở nhiều team/workspace: vòng xoay và giới hạn tải tính theo team, workspace hay theo người |
   | U46 | J1 | Trường tùy chỉnh: số lựa chọn tối thiểu, giới hạn số trường và độ dài tên, đổi kiểu hay bật "Nhạy cảm" khi đã có dữ liệu |
   | U47 | J4 | Tag cấp công ty hay workspace; "Ẩn" tag; lọc theo tag ẩn; tag trên dòng Hộp thư (chuyển từ U30) |
   | U51 | A4 | Tên team trùng trong workspace: prototype chặn, API (N160) cho trùng và sinh slug `-2` |

2. **Mục 3: lọc theo đường dẫn cho job `docker`.** Plan ngắn trước khi code. Path kích hoạt anh yêu cầu liệt kê:
   - `.github/workflows/ci.yml`;
   - `infra/docker/**`;
   - `package.json`, `pnpm-lock.yaml`;
   - `packages/**/package.json`;
   - `apps/{api,worker,admin}/src/**`;
   - `apps/admin/next.config.ts`.

   Không kích hoạt: `docs/**`, `*.md`, `.github/ISSUE_TEMPLATE/**`.

   Anh cho phép cách đơn giản hơn: chỉ bỏ job khi PR chỉ đổi `docs/` hoặc `*.md`. Em cân nhắc và nêu lý do trong plan.

   Lưu ý khi plan: image còn phụ thuộc `packages/*/src`, `packages/db/migrations`, `scripts/`, `.dockerignore`, `.npmrc`,
   `pnpm-workspace.yaml`, `tsconfig*`. Một danh sách cho phép (allowlist) dễ bỏ sót path, còn danh sách loại trừ (denylist,
   chỉ loại docs/md) thì an toàn hơn.
3. **Mục 4: rà độ phủ test.** Làm sau mục 2 và 3.
4. **Việc tồn, ưu tiên thấp:**
   - **#386:** `DROP` hàm cũ, cần anh xác nhận.
   - **#381:** prettier cho Markdown. 50/56 file `.md` chưa qua prettier; anh chọn làm sau S1, trước S4.
   - **N171:** chưa có sprint.
   - **U60:** làm ở S4.
   - **Issue BullMQ:** anh đăng.

## 7. Môi trường local (container cloud)

- **Postgres 16 tự dựng.** Container MỚI chưa có `/var/tmp/kin-pg`, nên dựng một lần. Không chép nguyên bước "Bootstrap roles"
  của `ci.yml`: CI chạy `docker exec` vào container Postgres, còn ở local Postgres chạy thẳng trên máy.
  1. `install -d -o postgres /var/tmp/kin-pg`, rồi
     `su postgres -s /bin/sh -c "/usr/lib/postgresql/16/bin/initdb -D /var/tmp/kin-pg"`.
  2. Start (container khởi động lại thì chỉ cần bước này):
     `su postgres -s /bin/sh -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/tmp/kin-pg -o '-p 5432 -k /tmp -c listen_addresses=127.0.0.1' -l /var/tmp/kin-pg/log start"`.
  3. Tạo DB (CI dùng `gani_platform`), rồi chạy cùng file SQL CI dùng, với 3 biến mật khẩu `APP_ROLE_PASSWORD`,
     `AUTH_ROLE_PASSWORD`, `MIGRATION_ROLE_PASSWORD` (giá trị đặt ở `.env.test`, **không** ghi vào tài liệu):
     `psql -h /tmp -U postgres -v ON_ERROR_STOP=1 -d <db> < infra/db/bootstrap-roles.sql`.
     Test `support_role` cần thêm `infra/db/ci-support-login.sql` (biến `SUPPORT_TEST_LOGIN_PASSWORD`).
  4. Đặt `DATABASE_URL_APP` / `_AUTH` / `_MIGRATION` theo mẫu bước "Migrate and run database tests" của `ci.yml`.

  Đã thử 30/10 trên cluster tạm (cổng 5433): initdb, start, tạo DB, hai file SQL, `migrate` (75 migration) đều exit 0.
- **Valkey/Redis:** `redis-server --port 6379 --bind 127.0.0.1 --daemonize yes`.
  - Test tích hợp worker cần `REDIS_URL=redis://127.0.0.1:6379`.
- **Docker:**
  - Docker Hub trả 429, nên kéo image qua `mirror.gcr.io`.
  - Build local cần image nền có CA của proxy, `--network host` và build-arg proxy.
  - Script env của scratchpad đặt shim `docker` lên đầu PATH, nên gọi `/usr/bin/docker`.
- **Công cụ:** Terraform 1.16.6 và gitleaks nằm trong scratchpad.
  - Scratchpad mất khi container bị thu hồi; tải lại và kiểm SHA256 trước khi dùng.
  - gitleaks phải có trong PATH, nếu không hook pre-commit (`.githooks/pre-commit`) chỉ cảnh báo rồi **BỎ QUA** bước quét.
- **GitHub:**
  - Free không bật được required check (N38). Anh tự kiểm job đỏ trước khi merge.
  - "Sẵn sàng merge" nghĩa là **mọi** job trong `ci.yml` xanh trên đúng HEAD và `mergeable_state` clean. Hiện là 7 job.

## 8. Bài học trong session

- **Tin của anh soạn từ trí nhớ có thể lệch repo:** số PR, số hàm, tên công ty, thứ trong tuần. Đối chiếu trước khi làm,
  báo chỗ lệch kèm bằng chứng. Anh đã cảm ơn các lần em sửa.
- **Đọc đúng thời điểm của số liệu CI:** "Lần chạy CI của PR" khác "lần chạy trên `main` sau merge". Báo cáo phải ghi đúng
  lần nào.
- **Postgres tắt giữa lúc chạy test:** là lỗi môi trường. Bật lại rồi chạy lại hai lần. Không sửa code, không re-run mù.
- **Báo cáo đến hạn khi đang dở việc:** vẫn viết, ghi rõ trễ bao lâu. Số liệu kiểm trên GitHub ngay lúc viết.
