# apps/api — Domain modules, FSM, endpoint

## Tenant context

- Mọi truy vấn chạy trong `TenantTx` (đã `SET LOCAL app.current_org`,
  `app.current_workspaces`). Không chạy query ngoài wrapper.
- `org_id` lấy từ `RequestContext`, không đọc từ body/query.
- Truy cập chéo tenant trả **404**, không trả 403.

## FSM hội thoại (P14 Brief)

- Chỉ `ConversationStateMachine` được đổi `conversations.state`.
- Cấm `UPDATE conversations SET state = ...` trực tiếp — lint chặn.
- Mọi transition ghi `conversation_events`.
- Transition không có trong bảng P14 → lỗi.

Các trạng thái: `BOT_ACTIVE`, `HUMAN_WAITING_Q`, `HUMAN_ACTIVE`,
`PENDING_CUSTOMER`, `CLOSED` (+ cờ `after_hours_hold`).

Claim: `UPDATE ... WHERE state='HUMAN_WAITING_Q' RETURNING id` →
0 dòng = 409 `conversation_already_claimed`. Không dùng Redlock.

## API

- REST `/v1`, lỗi RFC 9457 (`application/problem+json`).
- `org_id` không bao giờ nhận từ client.
- Cursor pagination, không offset.
- Idempotency-Key cho POST tạo dữ liệu.
- Webhook vào: verify → ghi `inbound_events` → trả 200 < 100ms → worker xử lý.

## Kiểm chứng

- `claim-race.spec`: 50 agent claim cùng lúc → đúng 1 thắng.
- `tenant-isolation.spec`, `workspace-isolation.spec` sinh từ OpenAPI.
- Mọi endpoint mới phải có OpenAPI cập nhật trong cùng PR.

## Cấm

- Không `any` trong `apps/api/src/modules/*`.
- Không log nội dung tin nhắn, chỉ log `messageId`.
