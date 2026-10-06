# apps/worker — Queue, Outbox, Scheduler

## Cấu trúc (N98)

- **Node thuần, không NestJS** (lệch Brief P5; relay nhỏ, không cần DI, test chạy không cần SWC). **Khi worker có ≥ 3 loại job thì xem lại** quyết định này.
- `src/config.ts`: đọc env, sai thì không khởi động. `src/tenant-job.ts`: `runForJob`. `src/relay/job.ts`: sự kiện → job, tên hàng đợi, backoff.
- Sắp có: `src/relay/outbox-relay.ts` (O-4b), `src/queue/bullmq-publisher.ts` và `src/main.ts` (O-4c). Chỉ `src/queue/` được import `bullmq`/`ioredis`.
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
- `OutboxRelayWorker` đẩy lên queue. Không publish trực tiếp từ service.

## Kiểm chứng

- Kill queue sau commit → sự kiện vẫn đi (outbox kill-test, O-5).
- Kill worker khi đang nhận 50 tin/s → 0 tin mất.
- Job thiếu `orgId` → fail ngay, có log.
