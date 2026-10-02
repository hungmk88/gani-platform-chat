# apps/worker — Queue, Outbox, Scheduler

## Tenant

- Job payload **bắt buộc** có `orgId` (+ `workspaceId` nếu thuộc workspace).
- Trước khi xử lý: `TenantContext.runForJob(payload)` set lại context.
- Thiếu `orgId` → **fail ngay**, không chạy ngầm.

## Hàng đợi

- Hội thoại: `q.conversations.process.ws.{workspaceId}` — không dùng FIFO chung.
- Lý do: workspace B2C chạy chiến dịch không được làm chậm workspace B2B.

## Outbox

- Mọi sự kiện nghiệp vụ ghi `outbox_events` trong **cùng transaction** với dữ liệu.
- `OutboxRelayWorker` đẩy lên queue. Không publish trực tiếp từ service.

## Kiểm chứng

- Kill queue sau commit → sự kiện vẫn đi (outbox kill-test).
- Kill worker khi đang nhận 50 tin/s → 0 tin mất.
- Job thiếu `orgId` → fail ngay, có log.
