# Đặc tả FSM hội thoại — M1.2 (Lõi hội thoại)

| | |
|---|---|
| Trạng thái | **ĐÃ DUYỆT 06/10/2026**; điều chỉnh đã ghi trong bản; câu hỏi chưa chốt xử lý khi code tới |
| Nguồn | Brief P14 (bảng + bổ sung v0.4), P10 F1/F6, P3.2 mục 3 và 9, P8 M04; Phụ lục v2.1 §3, §9, v2.3 §20 |
| Liên quan | `outbox-spec.md` (sự kiện đi cùng transaction), `realtime-spec.md` (`sequence_number`, `version`), N75 (bảng khung `conversations`), ADR-004 |
| Ngày | 06/10/2026 |

Phạm vi S2: toàn bộ transition của P14 ở dạng **thư viện + test**. Chưa có bot, routing, bộ hẹn giờ, presence: các nơi đó (S3–S5) chỉ **gọi** FSM. FSM không tự gọi giờ làm việc hay SLA; người gọi truyền vào `inHours`, `slaExceeded`, `agentOnline`.

> **Điểm em suy ra, Brief không viết — cần duyệt:** §5 (ràng buộc DB), §6 (xử lý va chạm), và các dòng đánh dấu *(đề xuất)* trong bảng §2. Các chỗ Brief mâu thuẫn hay thiếu nằm ở §8.

## 1. Mô hình

Trạng thái: `BOT_ACTIVE`, `HUMAN_WAITING_Q`, `HUMAN_ACTIVE`, `PENDING_CUSTOMER`, `CLOSED` (đã có `CHECK` ở migration `202610031830`) và cờ trực giao `after_hours_hold`.

Hai lớp, tách để test được không cần DB:

| Lớp | Nơi | Việc |
|---|---|---|
| `decide(current, event) → Decision \| InvalidTransition` | `packages/domain` (thuần, không I/O) | Tra bảng §2. Trả `{ next: {state, hold, assignedUserId}, effects[] }` |
| `ConversationStateMachine` | `apps/api/src/modules/conversations` | Mở `TenantTx`, đọc, gọi `decide`, ghi (§4). **Nơi duy nhất** được đổi cột FSM |

Cột do FSM sở hữu: `state`, `version`, `assigned_user_id`, `after_hours_hold`, `closed_at`, `outcome`. Cột ngoài FSM (`last_message_at`, `updated_at`) do luồng tin nhắn ghi.

## 2. Bảng transition (nguồn: P14; số thứ tự là của đặc tả này)

`inHours` do người gọi truyền. Mọi dòng ghi **một** `conversation_events` và các outbox ở cột cuối, trong cùng transaction.

| # | Từ | Sự kiện (người gọi) | Điều kiện | Sang | Phụ | Outbox |
|---|---|---|---|---|---|---|
| T01 | (chưa có) | `customer_message` (hội thoại mới) | — | `BOT_ACTIVE` | `version=0` | `conversation.created` |
| T02 | `BOT_ACTIVE` | `needs_human` | `inHours` | `HUMAN_WAITING_Q` | yêu cầu thẻ tóm tắt | `state_changed`, `handoff_requested` |
| T03 | `BOT_ACTIVE` | `needs_human` | `!inHours` | `BOT_ACTIVE` | `hold=true` | `state_changed` |
| T04 | `BOT_ACTIVE` | `bot_resolved` | — | `CLOSED` | `hold=false`, `closed_at` | `state_changed` |
| T05 | `HUMAN_WAITING_Q` | `claim(u)` | — | `HUMAN_ACTIVE` | `assigned=u` | `state_changed`, `assigned` |
| T06 | `BOT_ACTIVE` + `hold` | `claim(u)` (v0.4) | — | `HUMAN_ACTIVE` | `assigned=u`, `hold=false` | `state_changed`, `assigned` |
| T07 | `HUMAN_WAITING_Q` | `wait_expired` | `!inHours` hoặc `slaExceeded` | `BOT_ACTIVE` | `hold=true`, `assigned=null` | `state_changed` |
| T08 | `BOT_ACTIVE` + `hold` | `release_after_hours` (F6) | `inHours` | `HUMAN_WAITING_Q` | `hold=false` | `state_changed`, `handoff_requested` |
| T09 | `HUMAN_ACTIVE` | `agent_waits_customer` | — | `PENDING_CUSTOMER` | — | `state_changed` |
| T10 | `PENDING_CUSTOMER` | `customer_message` | `agentOnline` | `HUMAN_ACTIVE` | — | `state_changed` |
| T11 | `PENDING_CUSTOMER` | `customer_message` | `!agentOnline` | `HUMAN_WAITING_Q` | `assigned=null` | `state_changed` |
| T12 | `HUMAN_ACTIVE` | `hand_back_to_bot` | — | `BOT_ACTIVE` | `assigned=null` | `state_changed` |
| T13 | `HUMAN_ACTIVE`, `PENDING_CUSTOMER` | `close(outcome)` | `outcome` bắt buộc | `CLOSED` | `closed_at`, `outcome` | `state_changed` |
| T14 | `CLOSED` | `customer_message` | `now − closed_at ≤ 72h` | `BOT_ACTIVE` | mở lại cùng hội thoại, `closed_at=null`, `assigned=null` | `state_changed` |
| T15 | `HUMAN_ACTIVE`, `PENDING_CUSTOMER` | `transfer(u2)` | — | **giữ nguyên** | `assigned=u2` | `agent.transferred` (+ audit) |
| T16 | `HUMAN_ACTIVE`, `PENDING_CUSTOMER` | `reassign(u2)` (Manager/Admin) | — | **giữ nguyên** | `assigned=u2` | `agent.reassigned` (+ audit) |
| T21 | `HUMAN_WAITING_Q` | `reassign(u2)` (Manager/Admin) | — | `HUMAN_ACTIVE` | `assigned=u2` | `state_changed`, `agent.reassigned` (+ audit) — **F2, chốt 06/10** |
| T17 | `HUMAN_ACTIVE` | `agent_offline_timeout` | offline > 10 phút, khách còn tin chưa trả lời, `inHours` | `HUMAN_WAITING_Q` | `assigned=null` | `state_changed` + báo quản lý |
| T18 | `HUMAN_ACTIVE` | `agent_offline_timeout` | như T17 nhưng `!inHours` | `BOT_ACTIVE` | `hold=true`, `assigned=null` | `state_changed` |
| T19 | `HUMAN_ACTIVE` | `agent_logout` | `inHours` | `HUMAN_WAITING_Q` | `assigned=null` | `state_changed` |
| T20 | `HUMAN_ACTIVE` | `agent_logout` | `!inHours` | `BOT_ACTIVE` | `hold=true`, `assigned=null` | `state_changed` |

**Không phải transition** (`decide` trả `NoChange`, không ghi event trạng thái, tin vẫn được lưu bởi luồng tin nhắn): `customer_message` ở `BOT_ACTIVE`, `HUMAN_WAITING_Q`, `HUMAN_ACTIVE`; `PENDING_CUSTOMER` khi agent offline/đăng xuất (P14 dòng "Giữ nguyên"); `CLOSED` quá 72h (người gọi tạo hội thoại mới = T01, không phải transition).

**Mọi cặp (trạng thái, cờ, sự kiện) không có trong bảng → `InvalidTransitionError`** (P14: "transition không có trong bảng → lỗi"). T06, T08, T11, T16 và việc xóa `assigned` ở T07/T11/T12/T14/T17–T20 là **đề xuất**: Brief v0.4 / F6 / P14 nhắc tới hành vi nhưng không viết thành dòng riêng. Xem §8.

## 3. Bất biến (CHECK ở DB, thêm bằng migration expand ở PR đầu của M1.2)

1. `after_hours_hold = false OR state = 'BOT_ACTIVE'`
2. `state IN ('HUMAN_ACTIVE','PENDING_CUSTOMER') ⇒ assigned_user_id IS NOT NULL`; `state IN ('BOT_ACTIVE','HUMAN_WAITING_Q','CLOSED') ⇒ assigned_user_id IS NULL` (nếu F3 bị bác thì bỏ `HUMAN_WAITING_Q` khỏi vế này)
3. `state = 'CLOSED' ⇔ closed_at IS NOT NULL ⇔ outcome IS NOT NULL` (hai chiều; mở lại T14 xóa cả hai); `outcome IN ('won','lost','resolved','resolved_by_bot')`
4. `(org_id, assigned_user_id)` tham chiếu `org_members` (khóa ngoại kép), `ON DELETE RESTRICT`

Dữ liệu không đạt bất biến bị DB từ chối ngay cả khi mã FSM sai.

## 4. Một lần ghi (trong một `TenantTx`, isolation `READ COMMITTED`)

```
BEGIN                                       -- TenantTx: set_config org + workspaces (ADR-004)
  1. SELECT state, version, hold, assigned…  -- RLS O+W lọc; không thấy → NotFound (404, không 403)
  2. decide(current, event)                  -- thuần; InvalidTransition → dừng, không ghi gì
  3. SELECT set_config('app.fsm', 'on', true)
  4. UPDATE conversations SET state=…, version=version+1, …
       WHERE id=$id AND state=$from AND after_hours_hold=$hold      -- + AND version=$v (xem §6)
       RETURNING version
  5. 0 dòng → va chạm (§6); 1 dòng ↓
  6. INSERT conversation_events (…)          -- 1 dòng cho mỗi transition
  7. INSERT outbox_events (…)                -- cột "Outbox" của §2; xem outbox-spec.md
COMMIT                                       -- hoặc ROLLBACK: không đổi trạng thái, không event, không outbox
```

Ghi tin nhắn đến và `onCustomerMessage` chạy **cùng một transaction**: lưu tin (gán `sequence_number`, xem `realtime-spec.md` §4), gọi `decide`, ghi §4 bước 3–7. Tin không bao giờ ở lại mà trạng thái không đổi theo.

## 5. Chỉ FSM được đổi cột FSM (P3.2 mục 9, CLAUDE.md quy tắc 4)

Ba lớp, vì lint không đủ:

| Lớp | Cách | Bắt được |
|---|---|---|
| Mã | module `conversations` không export hàm ghi cột FSM ngoài `ConversationStateMachine`; ESLint cấm `.update(conversations)` và chuỗi `UPDATE conversations` ngoài thư mục đó; test kiểm tập tệp vi phạm = ∅ | Quên, đi đường tắt |
| DB | trigger `BEFORE UPDATE` từ chối đổi `state, version, assigned_user_id, after_hours_hold, closed_at, outcome` khi `current_setting('app.fsm', true)` khác `'on'` | Mã mới viết sai, `psql` thủ công bằng `app_role` |
| Test | kết nối bằng `app_role`, `UPDATE conversations SET state=…` → phải lỗi | Trigger bị gỡ |

Giới hạn thành thật: `app.fsm` do chính mã ứng dụng đặt, nên trigger chặn nhầm lẫn chứ không chặn kẻ đã chạy được mã trong tiến trình. `INSERT` trạng thái đầu (T01) cũng đi qua FSM (N75: `state` không có `DEFAULT`).

## 6. Va chạm

- **Claim (T05, T06):** đúng câu của Brief, điều kiện mở rộng v0.4: `WHERE id=$c AND (state='HUMAN_WAITING_Q' OR (state='BOT_ACTIVE' AND after_hours_hold))`, không kiểm `version`, có `version=version+1`. 0 dòng → `409 conversation_already_claimed`. Không Redlock. **Phải `READ COMMITTED`**: người thua chờ khóa dòng, thắng commit, người thua đánh giá lại điều kiện thấy sai → 0 dòng. Ở `REPEATABLE READ` họ nhận lỗi tuần tự hóa `40001` thay vì 0 dòng, nên cấm.
- **Hành động của người (T09, T12, T13, T15, T16, T21):** thêm `AND version=$v` với `$v` là bản client đang xem. 0 dòng → `409 version_conflict`.
- **Sự kiện hệ thống (T01–T04, T07, T08, T10, T11, T14, T17–T20):** không có client để bảo tải lại. 0 dòng → đọc lại và `decide` lại, tối đa 3 lần; còn thua → ghi log `trace_id`, dòng việc quay về hàng đợi để thử lại (không mất tin).
- 0 dòng không nói được "va chạm" hay "không tồn tại": bước đọc ở §4.1 đã phân biệt (không thấy → 404).

## 7. `conversation_events` (đề xuất cột; Brief P8 chỉ cho khóa và chỉ mục)

`id` UUIDv7 · `org_id` · `conversation_id` · `occurred_at` · `event_type` (`state_changed`, `claimed`, `transferred`, `reassigned`, `created`, `reopened`) · `from_state` · `to_state` · `from_hold` · `to_hold` · `actor_kind`, `actor_id` (kiểu `DomainEvent.actor` của P9) · `version_after` · `outcome` · `trace_id` · `detail jsonb` (object, **không PII, không nội dung tin**).
PK `(id, occurred_at)`, partition tháng bằng `app.create_log_partitions` (như `audit_logs`), chỉ mục `(org_id, conversation_id, occurred_at)`, khóa ngoại kép `(org_id, conversation_id)`, `ENABLE`+`FORCE` RLS, `app_role` chỉ `SELECT, INSERT` (append-only).

## 8. Câu hỏi mở — chưa tự quyết

| # | Vấn đề | Đề xuất tạm | Cần |
|---|---|---|---|
| F1 | `HUMAN_WAITING_Q`: khách nhắn thì bot trả lời hay im? F1 bước 3 chỉ nói im ở `HUMAN_ACTIVE`/`PENDING_CUSTOMER`; T07 lại nói "bot nhận lời nhắn" | Im lặng ở `HUMAN_WAITING_Q` (khách đã được báo chờ người) | Cố vấn |
| F2 | `reassign` (Manager) ở `HUMAN_WAITING_Q` | **Đã chốt 06/10: được**, chuyển thẳng `HUMAN_ACTIVE` + `assigned` (T21); không dùng cho `BOT_ACTIVE` + hold (dùng claim) | Xong |
| F3 | Dọn `assigned_user_id` khi về hàng chờ/bot | **Đã chốt 06/10: có**, `CHECK` hai chiều (§3.2) | Xong |
| F4 | Giá trị `outcome` | **Đã chốt 06/10:** `won, lost, resolved, resolved_by_bot` + `CHECK` | Xong |
| F5 | Mốc 72h | **Đã chốt 06/10:** từ `closed_at` | Xong |
| F6 | Mã lỗi chuyển trạng thái sai | **Đã chốt 06/10:** `409 invalid_transition` (khác `version_conflict`); còn cập nhật bảng mã lỗi P9 của Brief | Cập nhật P9 |
| F7 | `conversation_events` là **O** (P8) còn `conversations` là **O+W**: người không có workspace đó vẫn đọc được event của hội thoại ở workspace khác trong cùng org | **Đã chốt 06/10:** giữ **O** theo Brief (không thêm `workspace_id`) **và** thêm test bắt buộc "workspace A không thấy event của workspace B". Để test đạt, policy `conversation_events_app` thêm `EXISTS (SELECT 1 FROM conversations c WHERE c.org_id = conversation_events.org_id AND c.id = conversation_events.conversation_id)`: RLS của `conversations` lọc theo workspace nên event chỉ thấy khi hội thoại thấy (cả `USING` và `WITH CHECK`). Cách này là đề xuất của em, chờ xác nhận ở dàn ý PR1 | Xác nhận cách |
| F8 | Bộ hẹn giờ cho T07, T17, T18, T19, T08 chưa có chủ (SLA S4, presence S4) | S2 chỉ cung cấp phương thức + test; người gọi làm ở S4 | Chốt phạm vi |

## 9. Nghiệm thu (đóng mốc S2 "Transition test pass")

1. **Quét toàn bộ**: test sinh mọi tổ hợp `(5 trạng thái × cờ × mọi sự kiện × điều kiện)`; tổ hợp có trong §2 cho đúng kết quả, còn lại → `InvalidTransitionError`. Thêm dòng vào bảng mà không sửa test → đỏ.
2. **`claim-race.spec`** (PostgreSQL): 50 agent claim cùng lúc → đúng 1 thắng, 49 nhận `conversation_already_claimed`, `version` tăng đúng 1, đúng 1 `conversation_events` claim, đúng 1 outbox `assigned`. Chạy cả cho T06.
3. **Nguyên tử**: ép lỗi sau bước 4 → không đổi trạng thái, không event, không outbox.
4. **Chặn đường tắt (§5)**: `app_role` đổi `state` trực tiếp → lỗi; quét mã không thấy vi phạm.
5. **Bất biến (§3)**: mỗi `CHECK` có một ca ghi sai bị từ chối.
6. **Cô lập**: workspace khác không thấy, không đổi được; trả `404`. **Cả `conversation_events`** (F7): người có workspace A không đọc, không ghi được event của hội thoại ở workspace B.
7. **Mutation** (bắt buộc, ghi kết quả vào PR): bỏ `state=$from` khỏi `WHERE` → `claim-race` đỏ; bỏ `READ COMMITTED` → ca 40001 đỏ; bỏ một dòng khỏi bảng → test quét đỏ; gỡ trigger → ca 4 đỏ.
