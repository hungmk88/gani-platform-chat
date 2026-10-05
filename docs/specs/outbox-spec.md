# Đặc tả Outbox — M1.2 (Lõi hội thoại)

| | |
|---|---|
| Trạng thái | **NHÁP — chờ duyệt** |
| Nguồn | Phụ lục v2.3 §21, v2.2 §14, §15, §17; Brief P3.2 mục 21, P8 (`outbox_events`), P9 (`DomainEvent`), P10 F4; `apps/worker/CLAUDE.md` |
| Liên quan | `fsm-spec.md` (nơi ghi sự kiện), `realtime-spec.md` (người tiêu thụ đầu tiên), N16, N40, ADR-004 |
| Ngày | 06/10/2026 |

**Cam kết:** sự kiện đã commit cùng dữ liệu thì **không mất** khi hàng đợi hoặc worker chết (*at-least-once* từ DB tới hàng đợi). Hệ quả cần nói thẳng: có thể **giao trùng** và **không đảm bảo thứ tự**; người tiêu thụ phải chịu được cả hai (§6). Cam kết **dừng ở hàng đợi**; độ bền của Valkey xem §9.

> **Điểm em suy ra, Brief không viết — cần duyệt:** cột bảng (§2), cơ chế relay đọc nhiều tenant dưới RLS (§4, **điểm nhạy cảm nhất**), tên hàng đợi (§5), payload chỉ chứa tham chiếu (§3). Còn lại là chép từ Brief.

## 1. Luồng

```
service ──(cùng TenantTx)──▶ dữ liệu + outbox_events(status=pending)
                                   │
        OutboxRelayWorker ◀── poll ┘   claim ▶ publish ▶ đánh dấu published
                                   │
                                   ▼
                    BullMQ (Valkey)  q.events.…  ──▶  consumer (idempotent, có TenantContext)
```

Service **không bao giờ** gọi hàng đợi hay Socket.IO trực tiếp (worker/CLAUDE.md). ESLint cấm import client BullMQ ngoài `OutboxRelayWorker` và module `queue`.

## 2. Bảng `outbox_events` (đề xuất cột; Brief P8: O, chỉ mục `(status, created_at)`, partition tháng)

| Cột | Ghi chú |
|---|---|
| `id` UUIDv7 | Là `DomainEvent.id` và `jobId` của hàng đợi |
| `org_id`, `workspace_id` (null) | Khóa ngoại kép; `workspace_id` null cho sự kiện cấp org |
| `event_type`, `event_version int` | Ví dụ `conversation.state_changed`, `1` |
| `aggregate_type`, `aggregate_id`, `aggregate_version int` (null) | `conversation`, id, `conversations.version` khi có; để người nhận bỏ sự kiện cũ (§6) |
| `payload jsonb` (object) | Chỉ tham chiếu, xem §3 |
| `actor_kind`, `actor_id`, `trace_id`, `occurred_at` | Khớp `DomainEvent` của P9 |
| `status` | `pending` → `claimed` → `published`; `claimed` → `pending` (thử lại); → `dead_letter` |
| `attempts int`, `available_at`, `claimed_at`, `published_at` | Thử lại và hợp đồng thuê (§4) |
| `last_error text` | Chỉ **mã** lỗi, không thông điệp thô, không PII |
| `created_at` | |

PK `(id, created_at)`, partition tháng (`app.create_log_partitions`), `ENABLE`+`FORCE` RLS theo `org_id`, chỉ mục Brief `(status, created_at)` **cộng** chỉ mục riêng cho relay: `(available_at) WHERE status = 'pending'`.
Quyền `app_role`: `SELECT, INSERT`, và `UPDATE` **theo cột** (`status, attempts, available_at, claimed_at, published_at, last_error`). `payload` và định danh **bất biến** vì không được `UPDATE`; không có `DELETE`.

## 3. Ghi sự kiện

`OutboxWriter.add(tx: TenantTx, event)`: nhận `TenantTx` bắt buộc nên **không thể gọi ngoài transaction**; `org_id` lấy từ tenant context, không từ tham số (RLS `WITH CHECK` giữ lần nữa); `trace_id` từ `RequestContext`/job.

**Payload chỉ chứa tham chiếu**, không chứa nội dung tin: `message.created` mang `{ conversationId, messageId, sequenceNumber }`; bên phát realtime đọc nội dung dưới `TenantTx` (RLS) khi phát. Lý do: nội dung tin không bị nhân bản sang bảng thứ hai (giữ hạn lưu, không PII ở bảng log, quy tắc "không log nội dung tin"). Giá phải trả: thêm một lần đọc mỗi sự kiện. *(Đề xuất, xem O3.)*

Danh mục sự kiện của S2 (ghi cùng transaction với thao tác gây ra):

| `event_type` | Ghi bởi | Payload |
|---|---|---|
| `conversation.created` | FSM T01 | `conversationId` |
| `conversation.state_changed` | FSM (mọi dòng đổi trạng thái hoặc cờ) | `conversationId`, `from`, `to`, `hold` (`aggregate_version` = `version` mới) |
| `conversation.assigned` | FSM T05, T06 | `conversationId`, `assignedUserId` |
| `agent.transferred`, `agent.reassigned` | FSM T15, T16 | `conversationId`, `fromUserId`, `toUserId` |
| `conversation.handoff_requested` | FSM T02, T08 | `conversationId` (S5 sẽ sinh thẻ tóm tắt) |
| `message.created` | luồng tin nhắn | `conversationId`, `messageId`, `sequenceNumber` |

Sự kiện cho `lead.*`, `workspace.autonomy_downgraded`, `payment.*` thuộc sprint sau. Đổi cấu trúc không tương thích → tăng `event_version`, phát song song hai bản trong thời gian chuyển; người nhận bỏ qua trường lạ.

## 4. Relay: đọc nhiều tenant dưới RLS (điểm cần cố vấn duyệt)

Vấn đề: relay phải thấy sự kiện của **mọi** org, nhưng `app_role` bị RLS chặn và không có tenant thì **báo lỗi** (ADR-004, `TN001`). Ba hướng:

| Hướng | Ưu | Nhược |
|---|---|---|
| **A. Hàm `SECURITY DEFINER` chỉ trả `org_id`, rồi mỗi org một `TenantTx` (đề xuất)** | Cùng khuôn `app.memberships_for_user` (N76); mọi truy cập nội dung vẫn qua RLS; lộ ra worker chỉ là id org có việc chờ | Một hàm mới ngoài danh sách |
| B. Role thứ 5 `relay_role` có `BYPASSRLS` | Đơn giản | Thêm role lệch P16 (đã thêm `auth_role` một lần); BYPASSRLS đọc được payload mọi tenant |
| C. Dùng `migration_role` | Không cần gì thêm | Cấm (CLAUDE.md, spec RLS §3: chỉ pipeline migration) |

Hướng A: `app.orgs_with_pending_outbox(p_limit int) RETURNS TABLE(org_id uuid)`, `STABLE SECURITY DEFINER`, `search_path` cố định, chỉ `EXECUTE` cho `app_role`, chỉ trả org còn tồn tại và có dòng `pending` đến hạn. Không trả payload.

Vòng lặp mỗi `OUTBOX_POLL_MS` (đề xuất 500):

1. `orgs = orgs_with_pending_outbox(50)`; xử lý tối đa 4 org song song.
2. **Giữ chỗ** (`TenantTx` của org, giao dịch ngắn):
   ```sql
   UPDATE outbox_events SET status='claimed', claimed_at=now(), attempts=attempts+1
   WHERE id IN (SELECT id FROM outbox_events
                WHERE status='pending' AND available_at <= now()
                ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED)
   RETURNING id, workspace_id, event_type, event_version, aggregate_*, payload, trace_id, actor_*, occurred_at;
   ```
   `SKIP LOCKED` cho nhiều relay chạy song song mà không xử lý cùng một lô.
3. **Đẩy** `queue.addBulk` với `jobId = id` (ngoài transaction DB: không giữ kết nối trong lúc gọi Valkey).
4. **Đánh dấu** (giao dịch ngắn): thành công → `status='published', published_at=now() WHERE id = ANY($1) AND status='claimed'`. Thất bại → `status='pending', available_at=now()+backoff(attempts), last_error=<mã>`; `attempts >= 5` → `dead_letter`.
5. **Thu hồi** mỗi vòng: `claimed` quá `OUTBOX_LEASE_S` (60) → `pending` (relay chết giữa bước 2 và 4). Không cộng `attempts` lần nữa.

`backoff(n) = min(2^n giây, 60 giây)`. Hạn mức 5 lần mượn từ webhook vào (v2.2 §14), Brief không nói cho outbox (O7).

Hệ quả có chủ đích: chết **sau** bước 3 và **trước** bước 4 → sự kiện được đẩy lần hai sau khi hết hạn thuê. Đó là *at-least-once*.

## 5. Hàng đợi và người tiêu thụ

- Tên: `q.events.ws.{workspaceId}` (công bằng giữa workspace, v2.2 §15); sự kiện không có workspace → `q.events.org.{orgId}`. Brief chỉ định tên cho hàng đợi xử lý tin đến (`q.conversations.process.ws.*`), không cho sự kiện ra *(đề xuất, O2)*.
- Dữ liệu job: toàn bộ `DomainEvent` (có `orgId`, `workspaceId`). Tùy chọn: `jobId=id`, `attempts: 5`, `backoff: exponential`, `removeOnComplete: { age: 3600 }`.
- Người tiêu thụ chạy trong `TenantContext.runForJob(payload)`; thiếu `orgId` → **fail ngay**, có log (worker/CLAUDE.md).
- **Hai tầng dead-letter, đừng nhầm:** `dead_letter` của outbox = không đẩy nổi vào hàng đợi; `failed` của BullMQ = đã vào hàng đợi nhưng người tiêu thụ lỗi 5 lần. Cả hai báo động.

## 6. Hợp đồng của người tiêu thụ

1. **Idempotent theo `event.id`.** `jobId` chỉ chống trùng khi job còn tồn tại; sau `removeOnComplete` có thể trùng.
2. **Không dựa vào thứ tự.** Bỏ sự kiện cũ bằng `aggregate_version` (trạng thái) hoặc `sequenceNumber` (tin nhắn).
3. Không log payload; chỉ `eventId`, `eventType`, `orgId`, `workspaceId`, `traceId`.
4. Người tiêu thụ đầu tiên (phát Socket.IO, `realtime-spec.md`) idempotent tự nhiên vì client khử trùng. Bảng khử trùng chung (`ruleId + eventId` của F4) chỉ dựng khi có người tiêu thụ không idempotent (S4 trở đi), không dựng sớm.

## 7. Quan sát và hạn lưu

- Chỉ số: `outbox_pending` (đếm), `outbox_oldest_pending_age_seconds`, `outbox_dead_letter` (đếm), `outbox_publish_failures_total`. Ngưỡng báo động đề xuất: tuổi cũ nhất > 30 giây cảnh báo, > 120 giây khẩn; mọi `dead_letter` > 0 báo ngay (O4).
- Hạn lưu: dòng `published` giữ 30 ngày rồi bỏ cả partition (`PartitionMaintenanceJob`); **không bỏ partition còn dòng chưa `published`** (O5).
- Xử lý lại `dead_letter`: S2 chỉ có hàm SQL `requeue` chạy tay theo runbook; nút trên bảng điều khiển vận hành thuộc sprint sau.

## 8. Câu hỏi mở

| # | Vấn đề | Đề xuất tạm | Cần |
|---|---|---|---|
| O1 | Cơ chế đọc nhiều tenant (§4) | Hướng A | **Cố vấn** (hàm mới ngoài danh sách; có thể là role mới nếu bác A) |
| O2 | Tên hàng đợi sự kiện ra | `q.events.ws.{id}` / `q.events.org.{id}` | Cố vấn |
| O3 | Payload tham chiếu hay chứa nội dung | Tham chiếu | Cố vấn |
| O4 | Độ trễ cho phép từ commit tới phát realtime, ngưỡng báo động | poll 500ms, trễ P95 < 1 giây | CEO/Cố vấn |
| O5 | Hạn lưu `published` | 30 ngày | CEO |
| O6 | Valkey mất job sau khi đã `published` (§9) | Chấp nhận cho realtime; tự đối soát cho automation (S4) | Cố vấn |
| O7 | Số lần thử, backoff của outbox | 5 lần, mũ 2 tối đa 60 giây | Cố vấn |
| O8 | BullMQ chạy trên Valkey 8 chưa kiểm chứng (N40) | Kiểm bằng ca K1 ngay PR đầu của outbox; hỏng thì quay về Redis 7 | Cố vấn |

## 9. Giới hạn thành thật

"Không mất sự kiện" đúng cho đoạn **DB → hàng đợi**. Sau khi `published`, sự kiện sống trong Valkey: nếu Valkey mất bộ nhớ trước khi người tiêu thụ chạy (AOF `everysec` có thể mất tới ~1 giây), sự kiện đó mất mà DB ghi là đã gửi. Với realtime không nghiêm trọng vì tin nhắn nằm trong DB và client `resume` lấy lại. Với automation (F4, S4) cần tác vụ đối soát. Phụ lục v2.2 §14 yêu cầu bật AOF; Terraform module `cache` phải bật (kiểm khi chốt Q2).

## 10. Nghiệm thu (đóng mốc S2 "outbox kill-test pass")

Chỉ chạy được trên CI (N16). Mỗi ca có người tiêu thụ kiểm tập `eventId` nhận được.

| # | Ca | Đạt khi |
|---|---|---|
| K1 | Ghi 100 sự kiện, **dừng Valkey** trước khi relay chạy, bật lại | Trong lúc dừng, dòng ở `pending` và `attempts` tăng; sau khi bật lại cả 100 được giao (ca này đồng thời kiểm BullMQ trên Valkey, O8) |
| K2 | **Giết relay** giữa đẩy và đánh dấu (điểm lỗi chèn chỉ khi `APP_ENV=test`) | Sau khi hết hạn thuê, sự kiện được giao lại; người tiêu thụ idempotent chỉ tác động **1 lần** |
| K3 | 50 sự kiện/giây trong 60 giây, `kill -9` worker giữa chừng rồi bật lại | **0 sự kiện mất** (tập nhận ⊇ tập ghi) |
| K4 | Giao dịch ghi dữ liệu + outbox bị `ROLLBACK` | Không có dòng outbox, không có job |
| K5 | 3 relay chạy song song, không có lỗi | Mỗi sự kiện được đẩy đúng 1 lần (khác biệt với K2) |
| K6 | Hàng đợi từ chối mãi | Sau 5 lần → `dead_letter`, chỉ số báo động tăng; `requeue` đưa lại được |
| K7 | Cô lập | `app_role` không đặt tenant đọc `outbox_events` → lỗi `TN001`; hàm §4 chỉ trả `org_id`; relay của org A không đọc payload org B |

**Mutation** (ghi kết quả vào PR): bỏ `SKIP LOCKED` → K5 đỏ; đánh dấu `published` **trước** khi đẩy → K1/K2 đỏ; ghi outbox ở transaction riêng → K4 đỏ; bỏ bước thu hồi → K2 đỏ.
