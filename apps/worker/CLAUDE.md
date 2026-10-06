# apps/worker — Queue, Outbox, Scheduler

## Cấu trúc (N98)

- **Node thuần, không NestJS** (lệch Brief P5; relay nhỏ, không cần DI, test chạy không cần SWC). **Khi worker có ≥ 3 loại job thì xem lại** quyết định này.
- `src/config.ts`: đọc env, sai thì không khởi động. `src/tenant-job.ts`: `runForJob`. `src/relay/job.ts`: sự kiện → job, tên hàng đợi, backoff.
- `src/relay/outbox-relay.ts`: `OutboxRelay` (`tick()`, `start()`, `stop()`: vòng poll, tắt gọn, backpressure) trên hai cổng `RelayStore` và `QueuePublisher`, không biết BullMQ. `src/logger.ts`: log JSON, chỉ id và mã.
- `src/queue/bullmq-publisher.ts`: `BullmqPublisher` (cổng `QueuePublisher` trên BullMQ). **Chỉ `src/queue/` được import `bullmq`/`ioredis`** (ESLint chặn chỗ khác; ngược lại `src/queue/` không import `pg`/`drizzle-orm`).
- `src/relay/db-store.ts`: `createDbRelayStore` (cổng `RelayStore` trên `@gani/db`): mỗi bước một transaction ngắn của một org, qua `runForJob` rồi `withTenant`; chỉ `pendingOrgs` chạy ngoài tenant. `src/worker.ts`: `startWorker` (dựng relay, `shutdown()`: relay → hàng đợi → pool, mỗi bước lỗi hay treo quá `OUTBOX_SHUTDOWN_MS` thì ghi log và đi tiếp, trả `false`; gọi lại thì trả lại kết quả cũ). `src/main.ts`: đọc cấu hình (sai thì in tên biến, thoát 1), dựng pool `app_role` (`max = OUTBOX_ORG_PARALLEL + 2`) và bộ nối BullMQ, `SIGINT`/`SIGTERM` → `shutdown()` → thoát 0 hoặc 1; tín hiệu thứ hai thoát ngay.
- Chạy: `pnpm dev:worker` (gốc; cần Postgres và Valkey đang chạy, `.env` ở gốc) hoặc `pnpm --filter @gani/worker build && pnpm --filter @gani/worker start` (đọc biến từ môi trường).
- SQL nằm ở `packages/db` (`pendingOrgs`, `claimOutboxBatch`, …); worker không import `drizzle-orm`/`pg` (ADR-002). Không import `@gani/domain` (chưa đóng gói, N61).
- Biến môi trường: `.env.example` (`DATABASE_URL_APP`, `REDIS_URL`, `OUTBOX_*`); đặc tả: `docs/specs/outbox-spec.md`.

## Tenant

- Job payload **bắt buộc** có `orgId` (+ `workspaceId` nếu thuộc workspace).
- Trước khi xử lý: `runForJob(payload, fn)` set lại context từ payload, không từ request.
- Thiếu hoặc sai `orgId`/`workspaceId` → **fail ngay**, không truy vấn, không chạy ngầm.

## Hàng đợi

- Hội thoại: `q.conversations.process.ws.{workspaceId}` — không dùng FIFO chung.
- Sự kiện ra từ outbox: `q.events.ws.{workspaceId}` (hoặc `q.events.org.{orgId}` khi không có workspace); `jobId` = id sự kiện.
- Lý do: workspace B2C chạy chiến dịch không được làm chậm workspace B2B.

## Outbox

- Mọi sự kiện nghiệp vụ ghi `outbox_events` trong **cùng transaction** với dữ liệu.
- `OutboxRelay` đẩy lên queue: thu hồi → giữ chỗ → đẩy (ngoài transaction) → đánh dấu; đẩy lỗi thì lùi theo backoff, hết lần thử thì `dead_letter`. Không publish trực tiếp từ service.
- Backpressure: hàng đợi có ≥ `OUTBOX_QUEUE_MAX_WAITING` job chờ thì bỏ qua org đó ở lượt này (các org khác vẫn đi) và cảnh báo trong log. Relay chỉ biết các hàng đợi đã đẩy kể từ lúc khởi động, nên lô đầu của mỗi org sau khi khởi động chưa được kiểm (N98).
- Bộ nối BullMQ: một `Queue` cho mỗi tên hàng đợi, chung một kết nối; job có `jobId` = id sự kiện, `attempts: 5`, backoff mũ 1 giây, giữ job xong 1 giờ/10.000 job và job lỗi 7 ngày/1000 job. Kết nối thất bại nhanh (`enableOfflineQueue: false`, 5 giây) và mọi lời gọi có hạn 5 giây: một `Queue` dựng khi chưa có kết nối thì chờ vô hạn (đã kiểm với cổng đóng), nên `publish`/`waiting` chờ kết nối `ready` trước. Lỗi thành `E_QUEUE_DOWN`.
- Tắt gọn: `stop()` chờ lượt đang chạy, không bắt đầu lượt mới, trả `false` và cảnh báo nếu quá `OUTBOX_SHUTDOWN_MS`; phần còn `claimed` do tắt cứng được thu hồi sau thời hạn thuê.

## Kiểm chứng

- Kill queue sau commit → sự kiện vẫn đi (outbox kill-test, O-5).
- Kill worker khi đang nhận 50 tin/s → 0 tin mất.
- Job thiếu `orgId` → fail ngay, có log.
