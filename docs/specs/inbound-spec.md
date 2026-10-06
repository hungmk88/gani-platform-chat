# Đặc tả xử lý tin vào — M1.3 (`inbound_events`, bộ xử lý, người liên hệ, ghi tin)

| | |
|---|---|
| Trạng thái | **ĐÃ DUYỆT 07/10/2026** (I1, I2, I6, I7 chốt; I3 và I5 còn mở). Phần phụ thuộc cấu trúc payload của Zalo **chưa xác minh** (`zalo-channel-spec.md` §7), PR chuẩn hóa chờ |
| Nguồn | Brief P3.2 mục 13, 14; P8 (`inbound_events`, `messages`, `conversations`); P9 (webhook, `NormalizedInboundMessage`); P10 F1 bước 1–3; P14 (FSM); Phụ lục v2.1 (`sequence_number`), v2.2 §14, §15 |
| Liên quan | `zalo-channel-spec.md` (nơi sự kiện được ghi), `fsm-spec.md` §2, §4 (T01, T10, T11, T14), `realtime-spec.md` §4 (`sequence_number`), `outbox-spec.md` (khuôn claim/thuê/thu hồi/dead-letter), N96, N98, N100 |
| Ngày | 07/10/2026 |

**Cam kết:** một tin khách đã được webhook trả 200 thì **không mất** và **không tạo hai tin** (webhook gửi lại, worker chết giữa chừng, chạy lại đều an toàn). Hệ quả có chủ đích: xử lý một sự kiện là **một transaction duy nhất** gồm ghi tin, đổi trạng thái hội thoại, ghi outbox và đánh dấu `processed`; hoặc cả bốn, hoặc không gì.

> **Điểm em suy ra, Brief không viết, cần duyệt:** §1 (bảng khóa chống trùng tách rời, vì xung đột partition, **điểm nhạy cảm nhất**), §2 (thăm dò DB thay hàng đợi BullMQ), §3 (người liên hệ tối thiểu, tạo hội thoại), §4 (`MessageService`, `onCustomerMessage`).

## 1. `inbound_events` và chống trùng

Bảng nghiệp vụ, RLS theo org (**O**), **partition theo tháng** (`received_at`; khuôn `outbox_events`, `app.create_log_partitions`). Khóa chính `(id, received_at)`.

| Cột | Ghi chú |
|---|---|
| `id` (UUIDv7), `org_id`, `workspace_id`, `channel_account_id` | khóa ngoại kép `(org_id, channel_account_id)` tới `channel_accounts` |
| `platform_message_id` | id sự kiện/tin do nền tảng cấp (text) |
| `event_type` | như nền tảng gửi (chưa xác minh tên, `zalo-channel-spec.md` §7 Z-e) |
| `payload` | **thân thô** (jsonb), nguyên văn, để xử lý lại và điều tra |
| `received_at`, `created_at` | thời điểm nhận |
| `status` | `pending` · `claimed` · `processed` · `ignored` · `dead_letter` |
| `attempts`, `available_at`, `claimed_at`, `processed_at` | như `outbox_events` |
| `last_error` | **mã** (≤ 64 ký tự), không thông điệp |

Chỉ mục: `(status, received_at)` (Brief P8); `(org_id, available_at) WHERE status='pending'` và `(org_id, claimed_at) WHERE status='claimed'` cho worker (khuôn outbox).

**Xung đột cần duyệt (I1):** Brief P8 và Phụ lục #14 đòi **UNIQUE `(channel_account_id, platform_message_id)`** *và* partition theo tháng, nhưng PostgreSQL không cho ràng buộc duy nhất trên bảng partition nếu không chứa cột partition (cùng lý do R8 của `sequence_number`). `UNIQUE(…, received_at)` không chống được webhook gửi lại **qua ranh giới tháng**. **Đề xuất:** bảng nhỏ **không partition** `inbound_event_keys(channel_account_id, platform_message_id)` với PRIMARY KEY, ghi **trong cùng transaction** với `inbound_events` bằng `INSERT … ON CONFLICT DO NOTHING`; 0 dòng được chèn = trùng, **không ghi** `inbound_events`. Dọn khóa cũ hơn `INBOUND_KEY_RETENTION_DAYS` (đề xuất 35, lớn hơn mọi khoảng gửi lại hợp lý của nền tảng, **chưa xác minh**, Z-f) bằng job nền. Phương án khác: bỏ partition của `inbound_events` (lệch P8). Em chọn bảng khóa riêng.
**Sự kiện không có id** (nếu nền tảng không cấp; chưa xác minh): khóa = `sha256(thân thô)` có tiền tố, để tránh trùng; ghi trong đặc tả kênh khi biết.

## 2. Xử lý: thăm dò, không phải hàng đợi BullMQ (lệch Brief, cần duyệt)

Brief P3.2/`worker/CLAUDE.md` nêu `q.conversations.process.ws.{workspaceId}`. Đề xuất: **worker thăm dò `inbound_events`** theo đúng khuôn relay đã qua kill-test (O-5): `app.inbound_pending_orgs(p_limit, p_lease_seconds)` (`SECURITY DEFINER`, chỉ trả `org_id`), mỗi org một `TenantTx` ngắn: **giữ chỗ** (`UPDATE … status='claimed', attempts=attempts+1 … FOR UPDATE SKIP LOCKED`, giới hạn lô), **xử lý** (§3, transaction riêng), **thu hồi** quá hạn thuê, `dead_letter` khi `attempts` ≥ 5 (hằng số mượn từ Phụ lục #14), hàm `requeue` theo org (chạy tay theo runbook).

Lý do: nguồn sự thật bền đã ở PostgreSQL (Phụ lục #14: "không dùng Redis làm nơi lưu duy nhất"), thiết kế đã được kill-test chứng minh, API không phải phụ thuộc Redis. **Công bằng giữa workspace** (Phụ lục #15, Brief P15): mỗi lượt giữ chỗ tối đa N sự kiện **mỗi workspace** rồi quay vòng; workspace B2C dồn tin không chặn workspace B2B. Hàng đợi BullMQ theo workspace dời tới khi có đo tải (P20, S13); cùng giao diện thăm dò nên đổi sau không phá hợp đồng.

## 3. Một sự kiện = một transaction (`InboundProcessor`)

Trong `TenantTx` của org (isolation `READ COMMITTED`), sau khi giữ chỗ ở transaction ngắn riêng:

1. **Phân loại:** sự kiện không phải tin khách (theo dõi/bỏ theo dõi, sự kiện hệ thống): `status='ignored'` kèm mã lý do, **không** tạo hội thoại. Loại tin chưa hỗ trợ (ảnh, file, nhãn dán): lưu tin với `kind` đúng và `body = null`, kèm tham chiếu thô trong `inbound_events.payload`; **không tải tệp về** (cần hạ tầng `files`, ngoài M1.3).
2. **Chuẩn hóa** (`ZaloAdapter.normalize`, chờ xác minh payload) → `NormalizedInboundMessage` (Brief P9); văn bản chuẩn hóa **Unicode NFC**.
3. **Người liên hệ tối thiểu:** khóa tư vấn theo `(channel_account_id, external_user_id)` trong transaction (hai tin đầu của một khách đến cùng lúc không tạo hai hội thoại); tìm hội thoại **đang mở** của cặp đó; không có → T01 qua `ConversationStateMachine.create` (hội thoại mới `BOT_ACTIVE`), có `CLOSED` trong 72 giờ → T14 (mở lại), quá 72 giờ → hội thoại mới (người gọi tạo, `fsm-spec` §2). `customers` và `IdentityResolutionService` thuộc S4: M1.3 chỉ lưu `conversations.channel_account_id` và `external_user_id` (migration PR2), và index unique một phần chống hai hội thoại mở cho cùng cặp (I2).
4. **Ghi tin:** `MessageService.append` (§4), gán `sequence_number`, `platform_message_id`, `platform_sent_at`.
5. **FSM:** `ConversationStateMachine.onCustomerMessage` (§4) ghi `conversation_events` và outbox (`message.created`, `conversation.state_changed` khi có), cùng transaction.
6. **Đánh dấu:** `UPDATE inbound_events SET status='processed' … WHERE id=$1 AND status='claimed'`. **0 dòng** (thuê bị thu hồi lúc đang xử lý) → **ROLLBACK cả transaction**: tin không ở lại, sự kiện sẽ được người khác xử lý; không có đường hai tin.
7. Lỗi: bắt lỗi theo mã (không thông điệp, không PII); `attempts`/`dead_letter` như §2.

**Tin về trễ/đảo thứ tự:** `sequence_number` cấp lúc ghi (thứ tự đến); hiển thị sắp theo `(platform_sent_at, platform_message_id)` (`realtime-spec` §4, R2).

## 4. `MessageService` và `onCustomerMessage` (nợ của M1.2, vào M1.3)

- `MessageService.append(tx, { conversationId, senderKind, senderUserId?, kind, body, platformMessageId?, platformSentAt? })`: lấy khóa tư vấn theo hội thoại, `MAX(sequence_number)+1` trong cùng transaction (`realtime-spec` §4, N4), `INSERT messages`, cập nhật `conversations.last_message_at`; trả `{ id, sequenceNumber }`. Tin **không bao giờ ở lại mà trạng thái không đổi theo** (`fsm-spec` §4).
- `ConversationStateMachine.onCustomerMessage(tx, conversationId, …)`: gọi `decide` với sự kiện `customer_message` (T10, T11, T14; còn lại `NoChange`, tin vẫn được lưu); không thêm đường ghi cột FSM ngoài FSM (cổng ba lớp của `fsm-spec` §5).
- Ghi outbox `message.created` (payload tham chiếu, `outbox-spec` §3) cùng transaction. Realtime phát từ outbox (Socket.IO chưa xây; Inbox cơ bản đọc qua REST).
- Chi tiết hợp đồng, lỗi và test: PR của `MessageService` (PR4 của M1.3) viết lại thành tài liệu hóa cụ thể nếu cần.

## 5. Vận hành

Chỉ số: `inbound_pending`, tuổi sự kiện cũ nhất, `inbound_dead_letter`, độ trễ nhận → xử lý. Cảnh báo: tuổi cũ nhất > 30 giây cảnh báo, > 120 giây khẩn (như outbox, O4); mọi `dead_letter` > 0 báo ngay. Runbook `requeue` theo org (hàm kho, chạy tay; nút trên bảng điều khiển là sprint sau). **Hạn lưu:** `processed`/`ignored` giữ 30 ngày rồi bỏ partition (như outbox, O5); `payload` thô chứa PII của khách (tên, nội dung): **hạn lưu ngắn hơn hoặc che** là câu hỏi mở (I3), mặc định 30 ngày, không log.

## 6. Câu hỏi mở

| # | Vấn đề | Đề xuất tạm | Cần |
|---|---|---|---|
| I1 | UNIQUE vs partition | **Đã chốt 07/10:** bảng khóa `inbound_event_keys` không partition, `UNIQUE(channel_account_id, platform_message_id)`, `ON CONFLICT DO NOTHING` cùng transaction, job dọn khóa | Xong |
| I2 | Một hội thoại mở cho mỗi cặp (kênh, người dùng) | **Đã chốt 07/10:** index unique một phần + khóa tư vấn | Xong |
| I3 | Hạn lưu và che PII của `payload` thô | 30 ngày, không log; xem lại khi có chính sách | Anh/pháp lý |
| I4 | Khách nhắn lại sau khi đóng | ≤ 72 giờ mở lại (T14), sau đó hội thoại mới | Brief P14 |
| I5 | Sự kiện không có `platform_message_id` | Khóa = băm thân thô | Tài liệu |
| I6 | Thăm dò thay hàng đợi workspace | **Đã chốt 07/10 (N100):** xem lại khi đo tải | Xong |
| I7 | Ảnh/file | **Đã chốt 07/10 (N100):** ghi loại tin + tham chiếu, không tải | Xong |

## 7. Giới hạn thành thật

Thăm dò thêm độ trễ nhỏ (đề xuất 500 ms) so với đẩy tức thì; chấp nhận cho 50 tin/giây. Bảng khóa chống trùng thêm một lần ghi mỗi sự kiện và một job dọn. Cấu trúc payload của Zalo chưa xác minh: bộ chuẩn hóa viết sau khi đối chiếu tài liệu; trước đó bộ xử lý chạy trên `NormalizedInboundMessage` do test dựng.

## 8. Nghiệm thu

| # | Ca | Đạt khi |
|---|---|---|
| I-N1 | Cùng sự kiện gửi hai lần (kể cả qua ranh giới tháng) | Một dòng `inbound_events`, một tin |
| I-N2 | **Chaos:** restart worker và API khi 50 tin/giây, 60 giây | 0 tin mất (tập nhận ⊇ tập gửi); 0 tin trùng trong `messages` (khuôn K3, job `queue`) |
| I-N3 | Worker chết giữa lúc xử lý | Thu hồi sau hạn thuê; **một** tin; không `claimed` mồ côi |
| I-N4 | Lỗi xử lý > 5 lần | `dead_letter`, cảnh báo; `requeue` đưa lại được |
| I-N5 | Hai tin đầu của cùng khách đến đồng thời | Một hội thoại |
| I-N6 | 50 tin đồng thời cùng hội thoại | `sequence_number` đúng `1..50`, không trùng, không lỗ (N4) |
| I-N7 | Tin về trễ (giờ gửi cũ) | Nhận số cao hơn, hiển thị đúng chỗ, `resume` trả về |
| I-N8 | Transaction `ROLLBACK` giữa chừng | Không tin, không event, không outbox, sự kiện được thu hồi và xử lý lại sau hạn thuê |
| I-N9 | Sự kiện không phải tin | `ignored`, 0 hội thoại |
| I-N10 | Cô lập | Worker của org A không đọc payload org B; hàm `inbound_pending_orgs` chỉ trả `org_id` |
| I-N11 | Khách nhắn ở `PENDING_CUSTOMER`, `CLOSED` ≤ 72 giờ | T10/T11, T14 đúng |

**Mutation:** bỏ khóa chống trùng → N1 đỏ; đánh dấu `processed` **trước** khi ghi tin → N2/N3 đỏ; bỏ thu hồi → N3 đỏ; bỏ khóa tư vấn người liên hệ → N5 đỏ; bỏ kiểm `status='claimed'` khi đánh dấu → N3 đỏ.
