# Code Review — Nhóm E: Outbox và worker (relay, hàng đợi, kill-test)

- **Mốc code:** `main` = `1dfd6c5` (gồm PR fix #85). So với `82caafe`, #85 không đổi file nào của nhóm E, trừ việc `createDbPool` nay có ba giới hạn thời gian (xem E-03).
- **Ngày rà soát:** 12/10/2026. **Người rà soát:** Claude (chính tác giả, xem mục "Giới hạn").
- **Phạm vi:** `packages/db/src/outbox-store.ts`, `packages/db/migrations/202610061200`, `202610061300`, `apps/worker/src/{main,worker,config,logger,tenant-job}.ts`, `apps/worker/src/relay/*`, `apps/worker/src/queue/bullmq-publisher.ts`, `apps/api/src/modules/conversations/outbox-writer.ts`, test (`outbox-relay.spec`, `outbox-events.spec`, `apps/worker/test/{k1,k2,k3,sigterm,no-crash-switch,bullmq-publisher}.spec.ts`), đối chiếu `docs/specs/outbox-spec.md`.
- **Cách tìm bằng chứng:** đọc mã song song spec §4–§10; `git grep`; một kịch bản PGlite chạy `claimOutboxBatch`/`reapExpiredOutboxClaims`/`failOutboxEvent` thật (ngoài kho, kết quả dán dưới).

## Tóm tắt

| Mức | Số | Mã |
|---|---|---|
| CRITICAL | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 1 | E-01 |
| LOW | 1 | E-02 |
| INFO | 2 | E-03, E-04 |

Thiết kế at-least-once đứng vững: sự kiện cùng transaction với dữ liệu, relay thuê (lease) + `SKIP LOCKED`, `jobId` là id sự kiện, không `DELETE` nào ở app_role, tenant lấy từ dòng outbox (`runForJob`). Điều cần quyết: **E-01** (các chỉ số của spec §7 không có nơi phát và không có N-số).

---

## Phát hiện

### [MEDIUM] E-01 — Các chỉ số quan sát của outbox (spec §7, O4) không có mã phát ra và không có N-số theo dõi
- **File:** `docs/specs/outbox-spec.md` §7 và O4 (dòng 115-117, 128); `apps/worker/src/relay/outbox-relay.ts`, `apps/worker/src/logger.ts`.
- **Nhóm:** E.
- **Mô tả:** Spec chốt bốn chỉ số (`outbox_pending`, `outbox_oldest_pending_age_seconds`, `outbox_dead_letter`, `outbox_publish_failures_total`) và ngưỡng báo động (tuổi cũ nhất > 30 giây cảnh báo, > 120 giây khẩn; `dead_letter` > 0 báo ngay). Mã chỉ có dòng log JSON (`dead_letter`, `publish_failed`, `queue_full`, `lease_lost`); không có bộ đo, không có truy vấn lấy tuổi cũ nhất, không có điểm xuất cho hệ giám sát. Không N-số nào ghi việc này là nợ hay cho hạn. Hệ quả: nếu relay kẹt (queue đầy, DB chậm, relay chết), sẽ không có gì báo; ngưỡng 30/120 giây của O4 chỉ có trên giấy.
- **Bằng chứng:**
  ```
  $ git grep -nE "oldest_pending|outbox_pending|outbox_dead_letter|publish_failures" -- apps packages ':!*.md'
  (rỗng)
  $ grep -n -i "outbox_oldest\|chỉ số báo động\|metrics\|giám sát" QUESTIONS.md
  (chỉ N-số khác, không phải chỉ số outbox)
  ```
- **Đề xuất:** chọn một trong hai và ghi N-số có hạn (trước go-live): (a) một hàm `app.outbox_stats(p_org)` hoặc truy vấn đọc cho dashboard vận hành; (b) relay tự đo mỗi lượt và xuất ra chuẩn của hạ tầng giám sát (chưa chọn, nên cần quyết định hạ tầng). Tối thiểu làm ngay: log mỗi lượt `outbox_oldest_pending_age_seconds` khi > 30.
- **Mức độ:** MEDIUM

### [LOW] E-02 — `failOutboxEvent` không kiểm lần claim (`attempts`) như kho inbound, nên relay cũ có thể đẩy lần claim của relay mới về `pending`
- **File:** `packages/db/src/outbox-store.ts:99-116`; so với `packages/db/src/inbound-store.ts` (`failInboundEvent`, khối chú thích về "đúng lần claim").
- **Nhóm:** E.
- **Mô tả:** `inbound-store` giới hạn `WHERE ... AND status = 'claimed' AND attempts = $n` với lý do ghi rõ trong chú thích: relay mất thuê không được làm hỏng claim của relay kế tiếp. `outbox-store` có trường `attempts` trong `OutboxFailure` nhưng chỉ dùng để tính `dead`, không đưa vào `WHERE`. Khi một relay giữ claim quá thời hạn thuê (DB chậm giữa publish và `fail`), bị thu hồi và relay thứ hai claim lại, lời gọi muộn của relay thứ nhất vẫn đổi dòng đang `claimed` của relay thứ hai thành `pending` (hoặc `dead_letter`). Hệ quả thực: sự kiện đẩy lần nữa (an toàn vì `jobId`), nhưng `markOutboxPublished` của relay thứ hai trả 0 và log `lease_lost` sai, và một lần `dead_letter` sớm là có thể. Khả năng xảy ra thấp: mỗi lần gọi hàng đợi bị chặn 5 giây (`QUEUE_CALL_MS`), thuê mặc định 60 giây.
- **Bằng chứng:** chạy thật trên PGlite (`review-outbox-stale.mjs`, ngoài kho):
  ```
  relay 1 claims (attempts 1)                       {"status":"claimed","attempts":1}
  lease expired, reaped                             {"status":"pending","attempts":1}
  relay 2 claims (attempts 2) and is publishing     {"status":"claimed","attempts":2}
  stale relay 1 fails its OLD claim -> returns pending
  state now                                         {"status":"pending","attempts":2,"last_error":"E_QUEUE"}
  ```
  `outbox-relay.spec.ts:152-175` chỉ kiểm `fail` sau khi dòng đã không còn `claimed` (trả `null`), không kiểm claim mới của người khác.
- **Đề xuất:** thêm `eq(outboxEvents.attempts, f.attempts)` vào `WHERE` của `failOutboxEvent` (đúng khuôn inbound) kèm test "relay cũ không đụng claim của relay mới". PR nhỏ (~30 dòng), không đổi migration.
- **Mức độ:** LOW

### [INFO] E-03 — Chưa có người tiêu thụ ở mã chạy thật; mỗi hàng đợi đầy ở 10 000 thì relay bỏ qua cả tổ chức và ghi cảnh báo mỗi lượt
- **File:** `apps/worker/src/relay/outbox-relay.ts:104-120`, `apps/worker/src/config.ts` (`OUTBOX_QUEUE_MAX_WAITING` mặc định 10 000, `OUTBOX_POLL_MS` 500); `apps/worker/test/consumer.ts` (người tiêu thụ duy nhất).
- **Nhóm:** E.
- **Mô tả:** (1) `git grep "new Worker("` ở mã chạy thật rỗng: sự kiện vào hàng đợi `waiting` và ở đó. Từ PR4b-2a, mỗi tin sinh một `message.created` (cộng `state_changed`), nên một workspace bận chạm 10 000 `waiting` sau vài nghìn tin. (2) `isFull` duyệt **mọi** hàng đợi tổ chức đã đẩy tới và bỏ qua cả tổ chức nếu **một** cái đầy, nên một workspace đầy chặn các workspace khác cùng tổ chức (đúng spec v2.2 §15 "tổ chức có hàng đợi đầy bị bỏ qua", test `outbox-relay.test.ts:169`). (3) mỗi lượt (500 ms) ghi `queue_full` một dòng cho mỗi tổ chức đầy: tới 2 dòng/giây/tổ chức, không giới hạn tần suất (khác `throttledErrorLog` của lỗi kết nối). Sự kiện không mất (nằm ở `pending`). Sau khởi động lại, `queues` rỗng nên lượt đầu của mỗi tổ chức claim một mẻ trước khi biết hàng đợi đầy. Nhờ PR #85, mọi giao dịch của relay bị `idle_in_transaction_session_timeout` 30 giây canh, nên không có nguy cơ giữ khóa.
- **Bằng chứng:** `git grep -n "new Worker(" -- apps packages ':!*.spec.ts'` chỉ ra `apps/worker/test/consumer.ts`; đọc `outbox-relay.ts:104-118`; dàn ý PR4b-2 (rủi ro 4: "đã có người phát, chưa có người nhận") nhưng không có N-số nào ghi hạn cho người tiêu thụ.
- **Đề xuất:** (a) giới hạn tần suất cho `queue_full` (ví dụ một dòng mỗi 30 giây mỗi hàng đợi); (b) ghi N-số hạn cho người tiêu thụ đầu tiên (realtime/automation) trước khi khối lượng thật vào; (c) cân nhắc so mức đầy theo từng hàng đợi thay vì cả tổ chức nếu quyết định kiến trúc cho phép.
- **Mức độ:** INFO

### [INFO] E-04 — Khử trùng bằng `jobId` chỉ đúng khi BullMQ còn giữ job: cửa sổ 1 giờ / 10 000 job hoàn tất
- **File:** `apps/worker/src/queue/bullmq-publisher.ts:14-19`; `packages/db/src/outbox-store.ts:144-157` (`requeueDeadLetters`).
- **Nhóm:** E.
- **Mô tả:** `removeOnComplete: { age: 3600, count: 10_000 }` giữ job xong 1 giờ hoặc 10 000 cái. Đẩy lại sau cửa sổ đó (một `requeueDeadLetters` chạy tay sau hơn một giờ, hoặc một cơn bão hoàn tất làm trôi job cũ) được BullMQ nhận như job mới và người tiêu thụ chạy lần hai. Spec §6 đã yêu cầu người tiêu thụ idempotent, nên đây là điều kiện biên cần ghi rõ cho runbook, không phải lỗi.
- **Bằng chứng:** `bullmq-publisher.spec.ts:131` ("still ignores a job id after the job has run, while the queue keeps the finished job") chứng minh đúng khi còn giữ; không có ca nào cho "sau khi bị bỏ".
- **Đề xuất:** thêm vào runbook `dead_letter`: "đẩy lại sau 1 giờ có thể chạy lại sự kiện đã xử lý; người tiêu thụ phải idempotent theo `eventId`". Khi viết người tiêu thụ đầu tiên, đặt khóa idempotent theo `eventId` trong DB, không dựa vào BullMQ.
- **Mức độ:** INFO

---

## Đã kiểm, không có phát hiện

| Mục | Cách kiểm | Kết quả |
|---|---|---|
| Sự kiện cùng transaction với dữ liệu | `OutboxWriter.add` nhận `TenantTx` của người gọi; test K4 (`outbox-relay.spec.ts:205`) + rollback tin/outbox (`message-service.integration.test.ts`) | rollback không để lại dòng outbox, không có job |
| Relay đọc nhiều tenant dưới RLS | `app.outbox_pending_orgs` (SECURITY DEFINER, `search_path` cố định, chỉ trả `org_id`, `EXECUTE` chỉ `app_role`); `createDbRelayStore` đi qua `runForJob({ orgId })` | `orgId` rỗng/không hợp lệ bị từ chối trước khi lấy kết nối; không có đường đọc payload khác tenant (K7) |
| `FOR UPDATE SKIP LOCKED`, lease, reap | `outbox-store.ts:64-76, 122-142`; test `:116-135, 174-188` | hai relay không trùng mẻ; claim hết hạn thu hồi không tính attempts hai lần; hết lượt thử → `dead_letter` `E_LEASE_EXPIRED` |
| Không DELETE | `git grep -n "DELETE FROM outbox\|\.delete(outboxEvents" -- apps packages` (bỏ test) | rỗng; `app_role` chỉ `SELECT, INSERT`, `UPDATE` theo cột |
| Quyền cột | migration `202610061200:62-67` | `UPDATE (status, attempts, available_at, claimed_at, published_at, last_error)` đúng cột relay cần |
| Backoff, số lần thử | `job.ts:58-61`, `config.ts` | `min(2^n, 60)` giây, 5 lần (O7) |
| Mã lỗi không lộ giá trị | `errorCodeOf` (`job.ts:74-84`), `LogFields` | chỉ `E_QUEUE`/`E_QUEUE_DOWN`; logger nhận giá trị phẳng, không có chỗ để nhét nội dung hay thông báo |
| Log không PII | `git grep -nE "console\.\|process\.stdout" -- apps/worker/src` (bỏ test) | chỉ `createLogger` và một dòng `stderr` của `ConfigError` (tên biến, không giá trị URL) |
| Cấu hình | `config.ts:34-62` | mọi biến có khoảng hợp lệ; sai thì dừng với tên biến, không chép URL (N90) |
| Tắt máy | `worker.ts:68-111`, `sigterm.spec.ts`, `no-crash-switch.spec.ts` | relay dừng → queue đóng → pool đóng; `SIGTERM` thứ hai thoát ngay; mã chạy thật không có công tắc gây lỗi |
| Giới hạn kết nối | `main.ts:26-29` | `max = orgParallel + 2`; từ PR #85 có `statement_timeout`/`lock_timeout`/`idle_in_transaction` mặc định |
| Ranh giới thư viện (ADR-002) | `git grep -ln "from 'bullmq'\|from 'ioredis'" -- apps` | chỉ `bullmq-publisher.ts` ở mã chạy thật (test dùng riêng) |
| Kill-test | K1a/K1b, K2a/K2b, K3, SIGTERM S1/S2; mutation M1–M5 | kết quả đã ghi ở spec §10 và N99 (CI #135, #151); không chạy lại cục bộ |
| Nợ trong mã | `git grep -nE "TODO\|FIXME\|eslint-disable\|@ts-ignore\|as any"` ở E | rỗng |

## Cần kiểm thêm (INFO, chưa chứng minh được)

1. **K5 ở mức relay** (spec §10: 3 relay song song, mỗi sự kiện đẩy đúng một lần): có test `SKIP LOCKED` ở tầng kho (hai relay), chưa có ca ba relay thật qua hàng đợi. §10 đã ghi K4–K7 "ngoài phạm vi O-5, theo O-1…O-3"; nên xác nhận K5 coi như đạt bằng test kho.
2. **K6 ở mức hàng đợi** ("hàng đợi từ chối mãi → 5 lần → `dead_letter`, chỉ số báo động tăng"): phần "chỉ số tăng" phụ thuộc E-01.
3. **Thứ tự trong cùng một giao dịch**: `state_changed` và `assigned` cùng `aggregateVersion`; thứ tự giao cho người tiêu thụ là `occurredAt` rồi `id`. Người tiêu thụ đầu tiên phải không phụ thuộc thứ tự giữa hai loại sự kiện cùng phiên bản (spec §6).

## Đề xuất ghi vào `QUESTIONS.md` (chưa ghi, anh quyết)

| Số đề xuất | Nội dung | Phát hiện |
|---|---|---|
| N118 | Chỉ số quan sát outbox (spec §7): chọn hướng phát và hạn trước go-live; tối thiểu log tuổi cũ nhất | E-01 |
| N119 | `failOutboxEvent` kiểm `attempts` như kho inbound + test relay cũ | E-02 |
| N120 | Người tiêu thụ đầu tiên có hạn; giới hạn tần suất `queue_full`; ghi cửa sổ khử trùng 1 giờ vào runbook | E-03, E-04 |

## Giới hạn

Rà soát bởi chính tác giả. Checklist cứng + bằng chứng chạy được. Không thay thế review độc lập.

- Toàn bộ nhóm E do chính tác giả viết (M1.2 O-1 → O-5): **nên cân nhắc review độc lập Nhóm D/E/F** (ghi lại ở `00-summary.md`).
- Kill-test (K1–K3, SIGTERM) và test tích hợp chỉ chạy trên CI có Valkey và PostgreSQL thật; ở đây chỉ dẫn tên test và lần chạy CI, không chạy lại. Kịch bản PGlite một kết nối chỉ chứng minh logic của kho, không chứng minh đồng thời.
