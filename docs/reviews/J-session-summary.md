# Tóm tắt session Backend J (để session sau đọc lại)

Session `session_01K8V4vrQNXt2JfmZLweh2JE` · Backend (Gói 1) · chốt sổ **26/10/2026, ~17:40 UTC** (00:40 27/10 giờ VN).
Báo cáo đầy đủ trước đó: `docs/reviews/J-session-backend-2026-10-26.md` (82 PR, N128–N166). File này bổ sung phần sau báo cáo đó và
**bàn giao task #324** (test kill-9) cho session mới.

## 1. Quy tắc làm việc anh đã chốt (giữ nguyên ở session sau)

- **Code:** Plan Mode trước mọi việc code, chờ anh duyệt. Mỗi PR một nhánh; Conventional Commits; trailer `Co-Authored-By` + `Claude-Session`; không ghi tên model vào commit hay PR.
- **Kích thước PR:** ≤ 400 dòng là mục tiêu, không tính file sinh. Vượt thì **báo trước khi push** và tách theo ranh giới nghiệp vụ (đã làm ở P7/P11, mục 3).
- **Trước mỗi lần push:**
  - gitleaks (`--log-opts="origin/main..HEAD"`);
  - `git grep -i -E "npg_|sk-|sk-ant-|AIza|AKIA|ghp_|PASSWORD="` **in thẳng kết quả ra để review**, kể cả khi chỉ là chuỗi giả. Không đẩy vào `/dev/null`, không che exit code (bài học 26/10).
  - Chuỗi giả đã biết trên `main`, không phải secret: `password=x` (`zalo-webhook.test.ts`), `password=hunter2` (`tenant-context.middleware.test.ts`, `two-factor.gate.test.ts`).
- **Pháp lý:** chỉ dùng DB local tạm cho test. **Không deploy lên Neon cloud hay production** cho tới khi anh có kết luận của luật sư (anh đang gửi email). Không kết nối production, không chạy seed ngoài dev/staging, không DELETE/TRUNCATE/DROP khi chưa hỏi.
- **Flaky test:** tìm root cause. **Không tự re-run cho xanh.** Báo cáo riêng khi có kết quả.
- **PR CI xanh thì báo anh merge** (anh tự merge).

## 2. PR đã merge sau báo cáo J (26/10)

| PR | Nội dung | Ghi chú |
|---|---|---|
| #323 | Phản hồi Backend gói câu hỏi 30/10 (U25–U38, U40–U51), N166 | Đã gửi session FE |
| #329 | Chẩn đoán consumer cho K-IN (issue #324): log `event_job_stalled`/`event_job_failed`, 6 metric consumer, báo cáo trạng thái BullMQ khi test hết giờ | Xem mục 5 |
| #333 | U34: `NullableUuidSchema` (`type: [string, null]` + `format: uuid`); `document.test.ts` đỏ nếu còn `allOf` | Admin bỏ 3 chỗ ép kiểu |
| #335 | U38: `POST /v1/quick-replies/preview {workspaceId, body}` (xem trước mẫu chưa lưu) | FE dùng ở #338 |
| #337 | U48: `GET /v1/customers?q=` có `@` → tìm email **khớp đúng**; Marketing/Viewer chỉ tìm theo tên | Merge `main` để giải xung đột `apps/api/CLAUDE.md` |
| #339 | OpenAPI planned (1/5): `src/openapi/planned.ts` + `docs/openapi/planned.json` + Ticket | N167 |
| #341 | Planned (2/5): Tổng quan, feature flag, mức tự chủ | Merge `main` (xung đột add/add) |
| #344 | Planned (3/5): P7 yêu cầu dữ liệu cá nhân + E20 prompt chỉ đọc | |
| #345 | Planned (4/5): P11 cảnh báo và sự cố bảo mật | Merge `main` (xung đột add/add) |

**Còn mở:** #346 (5/5) — thư gửi FE `docs/ui/openapi-planned-30-10.md` + `QUESTIONS.md` N167. Lúc chốt sổ, job `admin (e2e, axe)` đã chạy hơn
10 phút (thường khoảng 2,5 phút), các job khác xanh. Session sau kiểm tiếp; đỏ thì đọc log tìm nguyên nhân, không re-run cho xanh.
Sau khi #346 merge mới gửi thư qua session FE (`session_01P7fC5sNL63dpuyWmZNaa2d`), vì anh dặn duyệt PR này trước.

## 3. Quyết định đã ghi `QUESTIONS.md`

- **N166:** anh duyệt phản hồi Backend 30/10, đã gửi FE.
- **N167 (anh duyệt 26/10) — hợp đồng trước, mã sau:**
  - `planned.json` riêng, mỗi operation có `x-status: planned` và `x-sprint`. `openapi.json` vẫn là nguồn sự thật.
  - Khi làm thật, chuyển lời gọi `register…` từ `planned.ts` sang `document.ts`; test đỏ nếu một path nằm ở cả hai.
  - Ticket: 5 trạng thái, `done` mở lại được, `cancelled` là cuối và chỉ Owner/Admin/Manager; 409 `invalid_transition`.
  - Tổng quan: Sales/Support có `scope: me`. P11: 6 loại cảnh báo, 4 mức. P7: hai bước, giữ hội thoại và ticket ở dạng ẩn danh.
  - Thời hạn theo luật chờ luật sư.
  - **Khi làm thật feature flag:** nới CHECK của `feature_flags_global` để key có dấu chấm (`ai.internal`).
- **U34, U38, U48:** đánh dấu "Đã sửa / Đã làm" trong `QUESTIONS.md`.

## 4. Cách giải xung đột đã dùng (dùng lại được)

- **PR xếp chồng sau khi PR cha được squash vào `main`:** xung đột add/add ở file sinh hoặc file chung.
  1. Kiểm `git diff --quiet origin/<nhánh-cha> origin/main -- <file>`.
  2. Nếu trùng (`main` == nhánh cha) thì `git checkout --ours <file>`.
  3. Sinh lại file sinh (`pnpm --filter @gani/api openapi`, `pnpm --filter @gani/admin gen:api`) và xác nhận không có diff.
  4. Commit merge có trailer, rồi push. Không rebase, không force-push.
- **Hai phía sửa hai dòng khác nhau của cùng một đoạn** (ví dụ `apps/api/CLAUDE.md`): so từng dòng với merge-base, giữ dòng mới của mỗi phía.

## 5. Bàn giao task #324 — test K-IN kill-9 (`apps/worker/test/inbound-e2e.spec.ts`)

**Đề bài (anh giao 26/10):**
- Tìm root cause việc K-IN hết giờ ở bước "the consumer to handle every message.created". Anh ghi là "kẹt 55 giây"; log CI thực tế cho thấy consumer im khoảng 75 giây.
- Không re-run cho xanh. Báo cáo riêng. Kèm kết quả vào báo cáo tiến độ 30/10 (đã đặt nhắc lúc 30/10 02:00 UTC).

**Dữ kiện lần đỏ duy nhất** (CI `main` `9bbec46`, run 40328987384, job 121593425168):

| Dữ kiện | Giá trị |
|---|---|
| Outbox lúc hết giờ | `pending=0 claimed=0 published=1015 dead_letter=0`; Valkey `running` |
| Mốc kill (suy ra) | Kill khoảng 13:17:22.7 (dòng `event_consumed` cuối của worker 1: 13:17:22.686) |
| Worker 2 | Tiêu thụ đều tới 13:17:40.748, sau đó **không còn dòng log nào** tới khi hết giờ 13:18:56 |
| Log | Không có warn, error hay stalled trong 40 dòng cuối của cả hai worker |
| Bối cảnh | Commit kế tiếp xanh. K3 (cũng kill -9) xanh trong cùng job. BullMQ 5.81.5, ioredis 5.11.1, Valkey 8.0.11 |

**Đã đo ở máy (Postgres + Valkey local tạm):**
- K-IN 10 lần đều xanh, kể cả khi ép một CPU (`taskset -c 0`).
- **H1 — job mồ côi chờ stalled check.** Job worker 1 đang giữ lúc bị kill nằm lại ở `active`. Worker 2 chỉ lấy lại sau **hai lượt** stalled check: lượt thứ nhất đánh dấu, lượt thứ hai chuyển về `wait`, mỗi lượt cách 30 giây; còn phải chờ khóa `stalled-check` do worker 1 đặt hết hạn.
  - Đo được: lấy lại sau **64,8–69,2 giây** kể từ kill. Hạn chót của test vào khoảng kill + 93 giây, nên còn dư khoảng 25 giây. H1 một mình **chưa giải thích được** lần đỏ trên CI.
  - Khi ép hạn còn 15 giây, báo cáo mới cho thấy: 4 job `active`, `lock-ttl -2` (lock đã hết), `stalled-set=4`, `stalled-check-ttl` còn 27 giây. Đúng như H1 dự đoán.
- **H4 — mất log khi SIGKILL (thử nghiệm riêng, đã tái hiện được):**
  - Node ghi stdout vào pipe kiểu bất đồng bộ. Khi tiến trình cha (vitest) đọc chậm, phần đã ghi nhưng chưa xuống pipe nằm trong bộ đệm của worker (đo được tới 2 MB) và **mất** khi bị SIGKILL.
  - Hệ quả: job đã `completed` trong BullMQ mà dòng `event_consumed` không tới test. Khớp triệu chứng "không stalled, không lỗi".
  - Điều kiện: kernel pipe đầy, tức khoảng 64 KB. Với lưu lượng K-IN, tiến trình cha phải trễ cỡ 2,5 giây trở lên. **Chưa có bằng chứng trên CI.**
- **H2/H3 (chưa loại):**
  - H2: handler trả sớm với `event_message_missing`, nên job `completed` mà không có `event_consumed`.
  - H3: job rơi vào `failed` (`UnrecoverableError`, hoặc `stc > maxStalledCount`).
- **Phụ:** Valkey ở máy tích hàng nghìn hàng đợi cũ trong sổ `q.events:queues`. Worker nhận tất cả (`EVENTS_MAX_QUEUES=10000`), mỗi hàng đợi một kết nối chặn riêng. Khi đo nên dùng DB Valkey logic trống, ví dụ `redis://127.0.0.1:6379/2`.

**#329 đã thêm** (để lần đỏ tới có bằng chứng):
- `bullmq-source.ts`: log `event_job_stalled {queue, jobId}` và `event_job_failed {queue, jobId, attemptsMade, error}`.
- `/metrics`: `event_jobs_handled_total`, `event_handler_errors_total`, `event_last_job_timestamp_seconds`, `event_jobs_stalled_total`, `event_jobs_failed_total`, `event_queues_subscribed`.
- K-IN khi hết giờ in thêm:
  - mốc kill, khởi động lại, bắt đầu chờ; số `message.created` thiếu;
  - với từng job thiếu (`test/jobs.ts` `describeJobs`): trạng thái BullMQ, `attemptsMade`, `stalledCounter`, `processedOn`/`finishedOn`, TTL lock, bộ đếm hàng đợi, TTL `stalled-check`;
  - mọi dòng `event_job_*`, `event_handler_failed`, `event_message_missing` của hai worker.
- K-IN khi xanh ghi annotation: `jobs taken back from the killed worker N (s after the kill: …), all consumed X s after the kill`.
  - Số đo CI đầu tiên (#329): 0 job mồ côi, xong 18,1 giây sau kill.

**Cách phân biệt khi có lần đỏ tới:**

| Báo cáo cho thấy | Kết luận |
|---|---|
| Job thiếu `active`, lock hết, sắp tới lượt check | H1, hạn chờ không đủ |
| Job `completed` với `finishedOn` < mốc kill | H4, mất log |
| Job `completed` sau mốc kill, có `event_message_missing` | H2 |
| Job `failed` | H3 |

**Hướng sửa có thể** (chưa làm, cần anh duyệt khi có bằng chứng):
- H4: test xác nhận "đã tới consumer" bằng trạng thái job trong BullMQ (`completed`) thay vì dòng log; hoặc logger ghi đồng bộ (`fs.writeSync`).
- H1: test tính hạn chờ theo hai lượt stalled check; hoặc worker đặt `stalledInterval`/`lockDuration` ngắn hơn. Việc này đổi hành vi production nên phải hỏi anh.

**Gợi ý thêm:** chủ động thu thập annotation `jobs taken back …` của nhiều lần chạy CI (job `queue`) để có phân bố thời gian lấy lại job trên CI, không chỉ chờ lần đỏ.

## 6. Môi trường máy (sẽ mất khi session hết)

Scratchpad của session này không chuyển sang session mới. Cần dựng lại:
- **Postgres 16 local:** cluster riêng, tạo DB mới bằng `infra/db/bootstrap-roles.sql` + `infra/db/ci-support-login.sql`, rồi `pnpm --filter @gani/db migrate`.
- **Biến môi trường:** `DATABASE_URL_APP`, `DATABASE_URL_AUTH`, `DATABASE_URL_MIGRATION`, `DATABASE_URL_SUPPORT`. Mật khẩu tự sinh, chỉ giữ ở máy, **không ghi vào tài liệu**.
- **Valkey:** không có Docker. Dùng `redis-server` local và một shim `docker` giả `stop`/`start`/`inspect`. Đặt `REDIS_URL` và `VALKEY_CONTAINER`.
- **Bộ kiểm đầy đủ:** build, lint, typecheck, test, format:check, lint:migrations, migrate, db-int ×2, api-int, worker-int, `api smoke`. Admin e2e khi đổi kiểu dùng chung: `env -u NODE_ENV pnpm --filter @gani/admin build && CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome pnpm --filter @gani/admin e2e`.
- **K-IN riêng:** `cd apps/worker && npx vitest run --config vitest.integration.config.ts test/inbound-e2e.spec.ts -t K-IN --reporter=verbose` (cần `pnpm --filter @gani/worker... build` trước).

## 7. Việc còn lại

| Hạn | Việc |
|---|---|
| Ngay | #346 xanh CI → anh merge → gửi thư cho session FE |
| Session mới | #324 kill-9 (mục 5) |
| 30/10 | Báo cáo tiến độ + kết quả #324 (đã đặt nhắc) |
| Trước S1 (16/11) | U30: `channel`, `lastMessagePreview` (≤ 120 ký tự, không log), `assignee {id, name}`, lọc `channelId` và `q` trên `GET /v1/conversations`. U31: `GET /v1/conversations/{id}/assignees?purpose=transfer\|assign` |
| Chờ | Q7 (anh đang gửi form cho các công ty), Q8, luật sư (P7, deploy) |
