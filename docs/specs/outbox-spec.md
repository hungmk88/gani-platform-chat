# Đặc tả Outbox — M1.2 (Lõi hội thoại)

| | |
|---|---|
| Trạng thái | **ĐÃ DUYỆT 06/10/2026**; điều chỉnh đã ghi trong bản; câu hỏi chưa chốt xử lý khi code tới |
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
| `last_error text` | Chỉ **mã** lỗi, không thông điệp thô, không PII: `CHECK` không rỗng và **≤ 64 ký tự** |
| `created_at` | |

PK `(id, created_at)`, partition tháng (`app.create_log_partitions`), `ENABLE`+`FORCE` RLS theo `org_id`, chỉ mục Brief `(status, created_at)` **cộng** hai chỉ mục một phần cho relay: `(org_id, available_at) WHERE status = 'pending'` (việc đến hạn; cũng là thứ danh sách org quét) và `(org_id, claimed_at) WHERE status = 'claimed'` (việc relay chết để lại). `CHECK`: `status` thuộc bốn giá trị, `published_at` có **khi và chỉ khi** `published`, `claimed` phải có `claimed_at`, `attempts ≥ 0`, `payload` là object. Đã dựng ở O-1 (migration `202610061200`).
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
| `conversation.manager_alert` | FSM T17 (agent offline lâu, khách còn chờ, trong giờ) | `conversationId`, `reason` (`agent_offline`) |
| `message.created` | luồng tin nhắn | `conversationId`, `messageId`, `sequenceNumber` |

**Thứ tự ghi trong một transaction (O-2):** trạng thái mới, rồi các dòng outbox theo thứ tự effects, rồi dòng `conversation_events` **cuối cùng**. Dòng lịch sử đứng cuối có chủ đích: nếu nó lỗi thì rollback phải kéo cả các dòng outbox đã ghi trước đó, và test chứng minh điều đó (các dòng outbox đã tồn tại bên trong transaction, rồi biến mất). `OutboxWriter` từ chối payload có khóa trông như nội dung hoặc người (`text`, `body`, `content`, `name`, `email`, `phone`, `address`) và giá trị không phải giá trị đơn (object, mảng).

Sự kiện cho `lead.*`, `workspace.autonomy_downgraded`, `payment.*` thuộc sprint sau. Đổi cấu trúc không tương thích → tăng `event_version`, phát song song hai bản trong thời gian chuyển; người nhận bỏ qua trường lạ.

## 4. Relay: đọc nhiều tenant dưới RLS (điểm cần cố vấn duyệt)

Vấn đề: relay phải thấy sự kiện của **mọi** org, nhưng `app_role` bị RLS chặn và không có tenant thì **báo lỗi** (ADR-004, `TN001`). Ba hướng:

| Hướng | Ưu | Nhược |
|---|---|---|
| **A. Hàm `SECURITY DEFINER` chỉ trả `org_id`, rồi mỗi org một `TenantTx` (đề xuất)** | Cùng khuôn `app.memberships_for_user` (N76); mọi truy cập nội dung vẫn qua RLS; lộ ra worker chỉ là id org có việc chờ | Một hàm mới ngoài danh sách |
| B. Role thứ 5 `relay_role` có `BYPASSRLS` | Đơn giản | Thêm role lệch P16 (đã thêm `auth_role` một lần); BYPASSRLS đọc được payload mọi tenant |
| C. Dùng `migration_role` | Không cần gì thêm | Cấm (CLAUDE.md, spec RLS §3: chỉ pipeline migration) |

Hướng A: `app.outbox_pending_orgs(p_limit int, p_lease_seconds int DEFAULT 60) RETURNS TABLE(org_id uuid)`, `STABLE SECURITY DEFINER`, `search_path` cố định, chỉ trả org còn tồn tại và có dòng `pending` đến hạn **hoặc** dòng `claimed` quá `p_lease_seconds` (relay chết giữa chừng, bước 5). Không trả payload. Giới hạn kiểm tra thật (`22023`): `p_limit` từ 1 đến 1000, `p_lease_seconds` ≥ 1. Org đã xóa mềm không được trả. Xếp theo việc cũ nhất. Là **hàm**, không phải view (view không có definer nên `app_role` bị RLS chặn). Tham số thứ hai là chỗ lệch nhẹ so với chữ ký ban đầu `(p_limit int)`: không có nó hàm không biết org nào có dòng cần thu hồi, và hằng số thuê nằm trong hàm sẽ lệch với `OUTBOX_LEASE_S` của worker (N97).

Vòng lặp mỗi `OUTBOX_POLL_MS` (đề xuất 500):

1. `orgs = outbox_pending_orgs(50, OUTBOX_LEASE_S)`; xử lý tối đa 4 org song song.
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
5. **Thu hồi** mỗi vòng: `claimed` quá `OUTBOX_LEASE_S` (60) → `pending` (relay chết giữa bước 2 và 4). Không cộng `attempts` lần nữa. Nếu dòng đã dùng hết `attempts` (relay chết ngay mỗi lần thử) thì sang `dead_letter` với `last_error = 'E_LEASE_EXPIRED'`, để một dòng làm relay sập không lặp mãi (O-3).

`backoff(n) = min(2^n giây, 60 giây)`. Hạn mức 5 lần mượn từ webhook vào (v2.2 §14), Brief không nói cho outbox (O7).

Hệ quả có chủ đích: chết **sau** bước 3 và **trước** bước 4 → sự kiện được đẩy lần hai sau khi hết hạn thuê. Đó là *at-least-once*.

**Đã chốt 06/10 (O1):** hướng A, tên `app.outbox_pending_orgs(p_limit int, p_lease_seconds int)` (mặc định 60), **không thêm role**, `EXECUTE` cấp cho **`app_role`** (worker dùng `app_role`, như `worker/CLAUDE.md`). Hàm chỉ trả `org_id`, không payload, không lộ dữ liệu; `MIG-DEFINER` đã bắt buộc `search_path` cố định. Không cấp cho `auth_role`, `support_role`, `PUBLIC`: test kiểm đúng tập quyền.

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
- Xử lý lại `dead_letter`: S2 chỉ có hàm `requeueDeadLetters` của kho (`packages/db`), chạy tay theo runbook, theo từng org (trong `TenantTx`) và có thể giới hạn theo id; nút trên bảng điều khiển vận hành thuộc sprint sau.

## 8. Câu hỏi mở

| # | Vấn đề | Đề xuất tạm | Cần |
|---|---|---|---|
| O1 | Cơ chế đọc nhiều tenant (§4) | **Đã chốt 06/10:** hướng A, `app.outbox_pending_orgs`, `EXECUTE` cho `app_role`, không thêm role | Xong |
| O2 | Tên hàng đợi sự kiện ra | **Đã chốt 06/10:** `q.events.ws.{workspaceId}` / `q.events.org.{orgId}` | Xong |
| O3 | Payload tham chiếu hay chứa nội dung | **Đã chốt:** tham chiếu (spec §3) | Xong |
| O4 | Độ trễ cho phép, ngưỡng báo động | **Đã chốt 06/10:** poll 500 ms; cảnh báo khi tuổi cũ nhất > 30 giây, khẩn > 120 giây | Xong |
| O5 | Hạn lưu `published` | **Đã chốt 06/10:** 30 ngày; bỏ partition thuộc `PartitionMaintenanceJob` (hạn 01/01/2027), **không** thuộc chuỗi outbox | Xong |
| O6 | Valkey mất job sau khi đã `published` (§9) | **Đã chốt:** chấp nhận cho realtime; đối soát cho automation (S4) | Xong |
| O7 | Số lần thử, backoff của outbox | **Đã chốt 06/10:** 5 lần, `min(2^n, 60)` giây | Xong |
| O8 | BullMQ chạy trên Valkey 8 (N40) | **Đã chốt 06/10/2026:** BullMQ 5.81.5 chạy trên Valkey 8.0.11 (CI run #135: K1, K2 và 5 test của O-5a xanh); không phải quay về Redis 7 | Xong |

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

**Kết quả (06/10/2026, CI run #135 trên `main`, job `queue` 1 phút 23 giây):**

| Ca | Kết quả | Ghi chú |
|---|---|---|
| K1 | **PASS** (K1a theo spec; K1b thêm) | K1a: Valkey dừng trước khi relay chạy: sự kiện ở `pending`, `attempts = 1`, 0 `published`, sau khi bật lại đủ 100. K1b: Valkey dừng khi relay **đã biết** hàng đợi: bước hỏi backpressure lỗi trước khi claim, nên `attempts` **không tăng** (cảnh báo `queue_unreachable`); "`attempts` tăng" chỉ đúng khi relay chưa biết hàng đợi (N99). |
| K2 | **PASS** (K2a sau đẩy, K2b trước đẩy) | Điểm lỗi **không** chèn bằng `APP_ENV=test` trong mã chạy thật mà bằng lối vào test `apps/worker/test/support/crash-main.mjs` (mã chạy thật không có công tắc; `no-crash-switch.spec.ts` quét `src/` và `dist/`). K2a: hàng đợi đúng 20 job, mỗi id nhận đúng 1 lần. |
| K3 | **PASS** (CI run #151 trên `main` sau #66, 06/10/2026) | 50 sự kiện/giây trong 60 giây, `SIGKILL` đúng lúc thấy `claimed > 0`, bật lại worker; tập nhận ⊇ tập ghi (đọc từ bảng sau khi producer đã dừng hẳn) và `dead_letter = 0`. Ca thống kê: khẳng định bất biến "không mất" dưới tải, không khẳng định điểm kill. Annotation (đọc ở run #158): ghi 3010 sự kiện, `claimed` lúc kill 10, id nhận trùng 0. |
| SIGTERM | **PASS** (CI run #151) | S1: một `SIGTERM` giữa 1000 sự kiện (batch 5): thoát mã 0, `worker_stopping` đúng 1 dòng, 0 `claimed`, 0 `dead_letter`. S2: `SIGTERM` thứ hai khi tín hiệu đầu đang được xử lý (Valkey dừng, một lượt đang chờ kết nối): thoát mã 1 ngay. S3 (thêm sau M4 lần 1, CI run #156): một `SIGTERM` khi Valkey dừng và một lượt đang kẹt chờ kết nối: chờ lượt, `publish_failed` 1 dòng (20 sự kiện), 0 `claimed`, 20 `pending` với `attempts` 1, thoát mã 0. Các ca chỉ chạy được trên Linux/CI. |
| K4–K7 | Ngoài phạm vi O-5 | Theo các PR O-1…O-3. |

**Mutation** (ghi kết quả vào PR): bỏ `SKIP LOCKED` → K5 đỏ; đánh dấu `published` **trước** khi đẩy → K1/K2 đỏ; ghi outbox ở transaction riêng → K4 đỏ; bỏ bước thu hồi → K2 đỏ. **Đã chạy (06–07/10/2026):** M1 (`published` trước khi đẩy, run #139), M2 (bỏ thu hồi, run #146), M3 (bỏ `jobId`, run #147), M4 (`stop()` không chờ lượt đang chạy, run #154 và #157), M5 (`main` thoát 0 ở tín hiệu thứ hai, run #158): cả năm làm test đơn vị hoặc kill-test đỏ, tức đều bị bắt. M4 lần 1 làm lộ S1 yếu (không bắt được M4), nên thêm S3; chi tiết ở N99.

## 11. Chia PR và hạ tầng (chốt 06/10/2026, N97)

| PR | Nơi | Nội dung |
|---|---|---|
| O-1 | `packages/db` | bảng `outbox_events`, `insertOutboxEvent` (đã xong) |
| O-2 | `apps/api` | `OutboxWriter`; `ConversationStateMachine` ghi effects cùng transaction, kiểm bằng ca ROLLBACK; `conversation.manager_alert` vào danh mục |
| O-3 | `packages/db` | `app.outbox_pending_orgs` (hàm `SECURITY DEFINER`, không phải view), kho cho relay: giữ chỗ, đánh dấu, thất bại, thu hồi, `requeue` |
| O-4a | `apps/worker` | khung worker (Node thuần, không NestJS), `config.ts` (thiếu hoặc sai biến thì không khởi động), `runForJob` (job thiếu `orgId` thì fail ngay, không truy vấn), dữ liệu job, tên hàng đợi, backoff |
| O-4b | `apps/worker` | `OutboxRelay`: vòng poll theo org, thu hồi → giữ chỗ → đẩy → đánh dấu, tắt gọn, trên cổng hàng đợi giả |
| O-4c | `apps/worker` | bộ nối BullMQ (`bullmq` 5.81.5 + `ioredis` 5.11.1, ghim đúng phiên bản, `pnpm audit --audit-level=high`), `main.ts`, script `dev`/`start`; `jobId = event.id`, trùng thì log rồi bỏ qua |
| O-5 | CI + test | job CI **`queue` riêng** (không nhét vào `db`): Valkey 8, AOF bật; K1–K3 giết tiến trình thật |

Thứ tự O-1 → (O-2 // O-3) → O-4a → O-4b → O-4c → O-5; mỗi PR tạo từ `main` sau khi PR trước merge, không xếp chồng.

**Worker (O-4, chốt 06/10/2026):** Node thuần, không NestJS (lệch Brief P5 "NestJS standalone": relay chỉ vài trăm dòng, không cần DI, test chạy được không cần SWC). Biến môi trường: `DATABASE_URL_APP`, `REDIS_URL` (bắt buộc), `OUTBOX_POLL_MS=500`, `OUTBOX_LEASE_S=60`, `OUTBOX_BATCH=100`, `OUTBOX_MAX_ATTEMPTS=5`, `OUTBOX_ORGS_PER_TICK=50`, `OUTBOX_ORG_PARALLEL=4`, `OUTBOX_SHUTDOWN_MS=10000`. Chỉ số và health check để sau O-5.
