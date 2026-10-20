# Đặc tả Realtime (Socket.IO) — M1.2 (Lõi hội thoại)

| | |
|---|---|
| Trạng thái | **ĐÃ DUYỆT 06/10/2026**; điều chỉnh đã ghi trong bản; câu hỏi chưa chốt xử lý khi code tới |
| Nguồn | Brief P9 (mục Realtime), P14 (dòng "Realtime"), P5, P8 (`messages`), P10 F1; Phụ lục v2.1 (`sequence_number`), v2.2 §17; `apps/admin/CLAUDE.md` |
| Liên quan | `fsm-spec.md`, `outbox-spec.md`, N90–N93 (request context, cổng 2FA), N40 (Valkey) |
| Ngày | 06/10/2026 |

**Phạm vi S2 ("Socket.IO khung"):** namespace `/agent`; xác thực lúc bắt tay; phòng; ba sự kiện `message.created`, `conversation.state_changed`, `conversation.assigned`; `conversation.subscribe`; `resume`; adapter Valkey. **Ngoài S2:** `/widget` (đợt 2/3, chưa có widget token), `typing`, `agent.presence` (cần cho T17–T20 ở S4), `lead.score_changed` (S4), `ai.suggestion_ready` (S5).

> **Điểm em suy ra, Brief không viết — cần duyệt:** §2 (bắt tay phải tự lặp lại cổng 2FA và chọn org), §4 (ngữ nghĩa `sequence_number`, mâu thuẫn P10 bước 2), §3 (định tuyến phòng), §6 (kiểm lại phiên). Chỗ chưa chốt ở §8. **Đã duyệt 06/10:** §2 bắt tay tự kiểm 2FA (N1 bắt buộc), §4 (R2, R8), §6 (R5); còn lại chốt khi code tới.

## 1. Vận chuyển và triển khai

- Socket.IO 4 với `@socket.io/redis-adapter` trên Valkey (N40, chưa kiểm chứng; kiểm ở PR đầu của Socket.IO). Worker phát bằng `@socket.io/redis-emitter` (§3), không chạy máy chủ Socket.IO.
- `transports: ['websocket']`: không cần sticky session ở LB (Brief rủi ro: "sticky session hoặc chỉ dùng WebSocket"). Phụ thuộc LB của Q2 (R6).
- **Tắt** `connectionStateRecovery`: Brief chọn `resume` tường minh, và tính năng đó không sống qua khởi động lại.
- Cho phép `Origin` theo danh sách cấu hình (gồm `BETTER_AUTH_URL`); khác → từ chối (chống chiếm kết nối từ trang khác).
- `maxHttpBufferSize` 64 KB (client chỉ gửi ack và tham số nhỏ).
- Phụ thuộc mới cho PR đầu: `socket.io`, `@socket.io/redis-adapter`, `@socket.io/redis-emitter`, client Redis (BullMQ cũng cần). Node không có sẵn máy chủ WebSocket kèm phòng/adapter nhiều instance, nên stdlib không đủ; license/maintainer/CVE kiểm bằng `pnpm audit` và ghi vào PR.

## 2. Bắt tay và xác thực

**Điều dễ sai:** cổng 2FA (`two-factor.gate.ts`) và middleware tenant (`/v1`) là middleware **Express**. Socket.IO tự xử lý đường `/socket.io/` ở tầng engine, nên theo thiết kế đó chúng **không chạy** cho kết nối này (xác minh bằng test N1, không dựa vào trí nhớ về thư viện). Nếu không tự lặp lại, người phải thiết lập 2FA mà chưa xong vẫn nhận hội thoại qua socket.

Middleware bắt tay của namespace `/agent`, đúng thứ tự:

1. `Origin` thuộc danh sách, không thì từ chối.
2. `SessionResolver.resolve(socket.request)` → không có phiên → `unauthorized`.
3. `mustSetUpTwoFactor(session.userId)` → `two_factor_setup_required` (cùng mã với cổng HTTP, N132).
4. Chọn org: **cùng hàm** với middleware tenant (tách hàm chọn org khỏi `tenant-context.middleware.ts` rồi cả hai gọi; không chép, như bài học `TWO_FACTOR_SETUP_ROUTES`): `activeOrgId` → một org active duy nhất → `ORG_NOT_SELECTED` → `NO_ORGANISATION`.
5. `readMemberContext` trong `withTenant` → `role`, `workspaceIds`.
6. Đóng băng `socket.data.ctx = { orgId, workspaceIds, userId, role, sessionId }` (cùng hình `RequestContext`).
7. Vào phòng tự động (§3).

Lỗi trả qua `connect_error` với `data: { code, traceId }`, **không** nguyên nhân bên trong (như 503 của cổng 2FA). `orgId`, `workspaceIds`, tên phòng **không bao giờ** lấy từ client; mọi trường `auth`/`query` của client bị bỏ qua cho mục đích tenant.

Mỗi handler sự kiện chạy trong `runWithRequestContext(socket.data.ctx, …)` và `database.withTenant(...)`, dùng lại hạ tầng 6d-2a: `currentRequestContext()` hoạt động, quên tenant thì báo lỗi (ADR-004). Mỗi lần xử lý có `traceId` mới.

## 3. Phòng và định tuyến

| Phòng | Vào bằng | Mục đích |
|---|---|---|
| `org:{orgId}` | tự động | sự kiện cấp org (S2 chưa phát gì; có sẵn vì P9 liệt kê) |
| `ws:{workspaceId}` | tự động, mỗi workspace trong `workspaceIds` | cập nhật danh sách Inbox |
| `user:{userId}` | tự động | việc giao cho riêng người đó |
| `conv:{conversationId}` | `conversation.subscribe { conversationId }` | khung chat đang mở; tối đa 20 phòng/socket |

`conversation.subscribe` đọc hội thoại dưới `withTenant` (RLS O+W). Không thấy → ack `{ ok:false, code:'not_found' }`: **giống hệt** id không tồn tại (404, không 403; P9). `conversation.unsubscribe` rời phòng.

Định tuyến sự kiện outbox → socket (S2). Người tiêu thụ là worker; nó đọc dữ liệu cần thiết dưới `withTenant` rồi phát bằng emitter vào `/agent`:

| Sự kiện outbox | Sự kiện socket | Phòng | Dữ liệu |
|---|---|---|---|
| `message.created` | `message.created` | `conv:{id}` | tin đầy đủ (`messageId`, `sequenceNumber`, `senderKind`, nội dung, `platformSentAt`, `createdAt`) |
| | | `ws:{wsId}` | **rút gọn, không nội dung:** `conversationId`, `sequenceNumber`, `senderKind`, `createdAt` *(R3)* |
| `conversation.state_changed` | `conversation.state_changed` | `ws:{wsId}`, `conv:{id}` | `conversationId`, `from`, `to`, `hold`, `version`, `assignedUserId` |
| `conversation.assigned`, `agent.transferred`, `agent.reassigned` | `conversation.assigned` | `user:{toUserId}`, `user:{fromUserId}` (nếu có), `ws:{wsId}` | `conversationId`, `assignedUserId`, `previousUserId` *(R4: Brief không liệt kê sự kiện socket cho transfer/reassign)* |

Khung gói chung: `{ eventId, type, version, occurredAt, traceId, aggregateVersion, data }`. Client bỏ gói có `aggregateVersion` nhỏ hơn bản đã có (sự kiện có thể trùng/đảo thứ tự, `outbox-spec.md` §6). Gói ở mức socket là *at-most-once*: độ đúng đến từ `sequence_number` và `resume`, không từ việc không mất gói.

Vì sao worker phát, không phải API: có N instance API, nếu mỗi instance cùng tiêu thụ hàng đợi thì mỗi sự kiện bị phát N lần.

## 4. `sequence_number` — nền của `resume` (đã duyệt 06/10: R2, R8)

- **Cấp số** trong cùng transaction với `INSERT messages`, bằng khóa tư vấn theo hội thoại:
  ```sql
  SELECT pg_advisory_xact_lock(hashtext(:conversation_id::text));
  SELECT COALESCE(MAX(sequence_number), 0) + 1 FROM messages WHERE org_id = :org AND conversation_id = :c;  -- rồi INSERT
  ```
  Không cột đếm trên `conversations` (bỏ `last_sequence_number` của bản nháp đầu): ghi tin không cần chạm dòng `conversations` để cấp số, nên không tranh với FSM.
- **Vì sao đúng:** khóa giữ tới COMMIT, nên các tin cùng hội thoại xếp hàng và **thứ tự commit = thứ tự số**; người đọc không thấy 6 trước khi 5 commit, nên `resume` với `last=6` không bỏ sót 5 (điều mà `SEQUENCE` và `max()+1` không khóa không đảm bảo). `READ COMMITTED` đọc lại `MAX` sau khi có khóa nên thấy số của người trước. Khóa mức transaction dùng được sau pooler chế độ transaction. Hội thoại khác nhau không chờ nhau; `hashtext` 32 bit va nhau thì chỉ chờ thừa, không sai.
- **Thứ tự khóa (tránh deadlock với FSM):** luồng ghi tin luôn lấy **khóa tư vấn trước, dòng `conversations` sau** (khi cập nhật `last_message_at` và gọi FSM). Luồng không ghi tin (claim, transfer…) chỉ khóa dòng, không lấy khóa tư vấn, nên không có chu trình.
- **Ngữ nghĩa (R2, đã duyệt):** `sequence_number` cấp lúc **ghi vào DB** (`MAX+1`) nên là thứ tự đến, không bao giờ đánh số lại. **Thứ tự hiển thị** theo P10 bước 2: client sắp theo `(platformSentAt, platformMessageId)`; `platformMessageId` phá thế hòa. Tin Zalo về trễ nhận số cao hơn và hiện đúng chỗ theo giờ gửi. Spec này **không** đánh số theo `platform_sent_at`: tin chèn giữa sẽ có số nhỏ hơn con trỏ của client và `resume` không bao giờ trả nó về. Cách hiểu này đã được xác nhận 06/10.
- `UNIQUE (org_id, conversation_id, sequence_number)` **không dựng được** vì `messages` partition tháng (khóa duy nhất phải chứa cột partition). Giữ chỉ mục thường như P8; tính duy nhất do khóa tư vấn đảm bảo, **test chứng minh** (N4). Đã duyệt (R8).
- `MAX()` quét chỉ mục `(org_id, conversation_id, sequence_number)` ở từng partition; hội thoại dài nhiều tháng quét nhiều partition. Chấp nhận ở quy mô P5 (~75.000 tin/tháng); đo ở N4.

## 5. `resume`

Client → `resume { conversationId, lastSequenceNumber }` (ack). Zod: `conversationId` UUID, `lastSequenceNumber` số nguyên ≥ 0.

Thứ tự **bắt buộc** (đảo là mất tin):

1. Kiểm lại phiên (§6): bộ đệm có TTL 60 giây, hết hạn thì đọc mới.
2. **Vào phòng `conv:{id}` trước** (cùng kiểm quyền như `subscribe`).
3. Đọc `state, hold, version, assigned_user_id` của hội thoại và `MAX(sequence_number)` của nó.
4. Đọc `messages WHERE conversation_id=$1 AND sequence_number > $2 ORDER BY sequence_number LIMIT 200`.
5. Ack `{ ok:true, conversation:{…}, messages:[…], hasMore, resync }`.

Vào phòng trước khi đọc → tin đến giữa chừng vừa được phát trực tiếp vừa có thể nằm trong trang phát lại; client khử trùng theo `sequenceNumber` và **đệm** tin trực tiếp có số lớn hơn số kế tiếp cho tới khi phát lại xong. Đọc trước rồi mới vào phòng → có khoảng hở mất tin.

- `hasMore` → client gọi lại với số cuối của trang. Giới hạn 200 để một client không kéo cả hội thoại.
- `lastSequenceNumber` > `MAX(sequence_number)` của server (client lạc hậu/đổi môi trường) → `resync: true`, `messages: []`; client tải lại bằng REST cursor.
- Trạng thái lỡ (`state_changed`) được sửa bằng ảnh chụp `conversation` kèm `version` trong ack.
- Brief chỉ định `resume` theo từng hội thoại. Danh sách Inbox (phòng `ws:`) sau khi kết nối lại: client **tải lại danh sách bằng REST** (R10).
- Giới hạn: 10 `resume`/10 giây/socket → `rate_limited`.

## 6. Kiểm lại phiên (không để quyền cũ sống mãi) — đã duyệt 06/10: R5

Bắt tay chỉ kiểm một lần, nhưng kết nối sống hàng giờ: người bị đăng xuất, khóa, thôi việc, hay mất vai trò vẫn nhận tin. Chốt: **bộ đệm phiên có TTL 60 giây + kiểm lại định kỳ**, không kiểm ở mỗi tin.

- Kết quả bước 2–5 của §2 được giữ trong `socket.data` kèm `checkedAt`. Hết 60 giây (`SOCKET_REVALIDATE_S`) thì chạy lại bước 2–5, bằng bộ đếm giờ mỗi socket và trước mỗi `subscribe`/`resume` nếu bản ghi đã quá hạn. Thất bại → `socket.disconnect(true)` với mã; `workspaceIds` đổi → rời/vào phòng `ws:` theo phần chênh. Quyền cũ sống tối đa ~60 giây sau khi bị thu hồi.
- **Bẫy đã thấy trong mã:** `SessionResolver` đệm theo **đối tượng request** (WeakMap, không TTL) để mỗi request chỉ tra một lần. Với socket, `socket.request` sống suốt kết nối, nên đệm đó **vĩnh viễn** và không bao giờ thấy phiên đã thu hồi. Lần kiểm lại phải đi đường không dùng WeakMap đó (cờ `fresh` hoặc khóa đệm mới), có TTL riêng, và có test (N9).
- 500 kết nối / 60 giây ≈ 8 truy vấn/giây: chấp nhận được. Chặn tức thì khi đăng xuất/khóa (`io.in('user:{id}').disconnectSockets()`) cần móc vào Better Auth, để sau.

## 7. Lỗi, giới hạn, quan sát

- Ack lỗi: `{ ok:false, code, traceId }` dùng mã P9 (`validation_failed`, `unauthorized`, `not_found`, `rate_limited`, `internal_error`). Không bao giờ lộ sự tồn tại của tài nguyên tenant khác.
- Tối đa 5 socket/người dùng (nhiều tab), 20 kết nối/phút/IP.
- Log: `socketId`, `userId`, `orgId`, `traceId`, mã; **không** nội dung tin, không tên phòng chứa dữ liệu nhạy cảm ngoài id.
- Chỉ số: `socket_connections` theo instance, `socket_resume_total`, `socket_resume_messages_total`, `socket_auth_rejected_total{code}`.

## 8. Câu hỏi mở

| # | Vấn đề | Đề xuất tạm | Cần |
|---|---|---|---|
| R1 | `/widget` có tạo ở S2 không | Không; chưa có widget token (đợt 2/3) | Chốt phạm vi |
| R2 | `sequence_number` vs `platform_sent_at` (P10 bước 2) | **Đã chốt 06/10:** cấp số lúc ghi (`MAX+1`), hiển thị theo `(platform_sent_at, platform_message_id)`; xem §4 về cách hiểu | Xong |
| R3 | Phòng `ws:` nhận tin đầy đủ hay rút gọn | Rút gọn, không nội dung | Cố vấn |
| R4 | Sự kiện socket cho transfer/reassign | Dùng `conversation.assigned` có `previousUserId` | Cố vấn |
| R5 | Chu kỳ kiểm lại phiên | **Đã chốt 06/10:** TTL 60 giây + kiểm lại định kỳ; móc đăng xuất/khóa để sau | Xong |
| R6 | WebSocket-only hay sticky | WebSocket-only; kiểm với LB khi chốt Q2 | Q2 |
| R7 | NestJS 12 với `@nestjs/platform-socket.io` chưa kiểm chứng | Thử ở PR đầu; không hợp thì gắn `socket.io` thẳng vào HTTP server | Quyết ở PR |
| R8 | Không dựng được `UNIQUE` cho `sequence_number` do partition | **Đã chốt 06/10:** khóa tư vấn theo hội thoại + `MAX+1`; test N4 chứng minh | Xong |
| R9 | `typing`, `agent.presence` | Ngoài S2; presence làm ở S4 cùng routing | Chốt phạm vi |
| R10 | Danh sách Inbox sau kết nối lại | Tải lại bằng REST | Cố vấn |
| R11 | Phụ thuộc mới (§1) | Duyệt cùng PR | Anh |

## 9. Nghiệm thu (đóng mốc S2 "Socket.IO khung")

Postgres + Valkey, chạy trên CI (N16).

| # | Ca | Đạt khi |
|---|---|---|
| N1 | Bắt tay | không cookie → `unauthorized`; **chủ org chưa thiết lập 2FA → `two_factor_setup_required`** (chứng minh cổng Express không phủ socket); không org → `NO_ORGANISATION`; `Origin` lạ → từ chối |
| N2 | Cô lập phòng | hai client ở workspace A và B (và hai org): phát 20 sự kiện mỗi bên → **0** gói chéo |
| N3 | `subscribe` | hội thoại workspace khác → `not_found`, không phân biệt được với id bịa |
| N4 | `sequence_number` | 50 tin đồng thời cùng hội thoại → đúng `1..50`, không trùng, không lỗ; người đọc thăm dò không thấy lỗ; rollback không để lỗ; tin về trễ (giờ gửi cũ) nhận số cao hơn và vẫn được `resume` trả về |
| N5 | `resume` | ngắt client, gửi 120 tin, nối lại với `last=k` → nhận đúng `k+1..120`, qua `hasMore`; tin trực tiếp đến **giữa lúc phát lại** không mất, không trùng (chèn trễ ở bước 4) |
| N6 | Nhiều instance | 2 API + Valkey: sự kiện từ worker tới client nối vào instance bất kỳ |
| N7 | Tải | 500 kết nối đồng thời + phát tới tất cả, ghi thời gian vào PR |
| N8 | Kiểm lại phiên | khóa thành viên/đăng xuất → socket bị ngắt trong chu kỳ (thu ngắn trong test) |
| N9 | Bộ đệm TTL | thu hồi phiên sau khi kết nối → socket bị ngắt hoặc `resume` bị từ chối trong vòng một TTL (TTL thu ngắn trong test); không còn sống mãi |

**Mutation** (ghi kết quả vào PR): bỏ kiểm quyền ở `subscribe` → N2/N3 đỏ; bỏ khóa tư vấn (chỉ `MAX+1`) → N4 đỏ; đọc trước khi vào phòng → N5 đỏ; dùng WeakMap theo request cho socket → N9 đỏ; bỏ bước 3 của bắt tay → N1 đỏ.
