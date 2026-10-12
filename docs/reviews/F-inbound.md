# Code Review — Nhóm F: Tin vào (inbound: bảng, hàm DB, kho, khóa chống trùng)

> ⚠️ Cập nhật 13/10/2026: F-02 đã được nâng lên HIGH; lệnh `git grep` ở dòng "Ngoài mốc" dùng pathspec không hiệu lực (kết luận vẫn đúng). Xem 00-summary.md mục "Phát hiện đã nâng mức" và G-docs.md G-08.

- **Mốc code:** `main` = `61c1e79` (PM-2b-2, #97). Nhóm D và E đã rà ở `1dfd6c5`, không rà lại.
- **Ngày rà soát:** 13/10/2026. **Người rà soát:** Claude (chính tác giả, xem mục "Giới hạn").
- **Phạm vi (tầng DB và kho):** migration `202610071000` (`channel_accounts`), `202610071100`/`202610071110` (`channel_policies` và hạt giống), `202610071200`, `202610071210` (`inbound_events`), `202610071220` (`inbound_event_keys`, `purge_inbound_event_keys`), `202610071300` (`channel_account_for_webhook`), `202610071310` (cột kênh của `conversations`), `202610071320` (`inbound_pending_orgs`); `packages/db/src/inbound-store.ts`, `message-store.ts` (đã có D-02); các spec `inbound-*`, `conversation-channel`, `channel-*`; đối chiếu `docs/specs/inbound-spec.md`.
- **Ngoài mốc (chưa có mã):** webhook ingress, `InboundProcessor`, bộ chuẩn hóa Zalo. `git grep -n -i "InboundProcessor\|webhook" -- 'apps/*/src' 'packages/*/src'` (bỏ test) rỗng; `apps/api/src/modules` chỉ có `auth`, `conversations`, `database`, `health`, `request-context`. Chúng thuộc PR6; xem checklist ở cuối, **không phải phát hiện**.

## Tóm tắt

| Mức | Số | Mã |
|---|---|---|
| CRITICAL | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 2 | F-01, F-02 |
| LOW | 1 | F-03 |
| INFO | 3 | F-04, F-05, F-06 |

Cách ly tenant và khử trùng đúng: bảng khóa không chia tháng, khóa ghi cùng giao dịch với sự kiện, `payload` không đọc được với `support_role`. Hai điều cần quyết nằm ở **hạn lưu PII** (F-01) và **thời điểm nhận do người gọi đặt** (F-02).

## Dọn dữ liệu của inbound: hai lớp, một lớp đã xong

| Lớp | Nơi | Ai dọn | Hạn | Trạng thái |
|---|---|---|---|---|
| Khóa khử trùng | `inbound_event_keys` (không nội dung, chỉ id kênh và id tin) | `app.purge_inbound_event_keys(35 ngày, 10 000)` do job của worker gọi hằng ngày (PM-2b-2, #97, N121) | 35 ngày (hàm ép ≥ 30) | **Xong** |
| Dòng và `payload` | `inbound_events` (chứa **nội dung tin của khách**: PII) | bỏ cả partition cũ (PM-3) | 30 ngày (I3, còn mở) | **Chưa có**; hạn 15/05/2027, xem F-01 |

`app_role` không có `DELETE` và không có `UPDATE (payload)`, nên không có đường dọn nào khác ngoài bỏ partition.

---

## Phát hiện

### [MEDIUM] F-01 — Hạn lưu `payload` (PII) thực tế dài hơn 30 ngày, và dòng trong `DEFAULT` không bao giờ hết hạn
- **File:** `packages/db/migrations/202610071210_create_inbound_events.sql:63-65`; `docs/specs/inbound-spec.md:63,71` (§5 và I3, còn mở).
- **Nhóm:** F (liên quan B-01).
- **Mô tả:** I3 chốt tạm "30 ngày" cho `payload` thô (nội dung tin của khách). Cơ chế duy nhất là **bỏ cả partition** (`app_role` không `DELETE`, và cột `payload` không nằm trong `GRANT UPDATE`, nên không xóa nội dung theo dòng được). Bảng chia theo **tháng** (`received_at`): một partition chỉ bỏ được khi dòng **mới nhất** của nó đã quá 30 ngày. Vậy một tin nhận ngày 1 sống tới ~30 ngày sau **cuối tháng đó**, tức tối đa ~61 ngày, không phải 30. Thêm nữa, một dòng trong partition `DEFAULT` (giờ nhận ngoài mọi khoảng đã tạo, xem F-02) **không thuộc partition tháng nào** nên không bao giờ bị bỏ, và PII ở đó sống mãi. Hiện chưa có gì chạy (PM-3, hạn 15/05/2027), và thỏa thuận pháp lý của I3 còn là "Anh/pháp lý, còn mở".
- **Bằng chứng:**
  - migration `:63`: `-- No DELETE: finished rows leave with their partition (PartitionMaintenanceJob, 30 days, not in this PR).`
  - migration `:65`: `GRANT UPDATE (status, attempts, available_at, claimed_at, processed_at, last_error)`: không có `payload`.
  - `inbound-events.spec.ts:149`: một dòng có ngày cũ được định tuyến vào `inbound_events_default`; không có mã nào đọc hay dọn `DEFAULT` ngoài hàm đếm `app.log_default_partition_rows` (chỉ báo).
  - `git grep -n -i "drop table\|detach partition" -- apps packages ':!*.test.ts' ':!*.spec.ts' ':!*.md'`: một kết quả duy nhất, là chuỗi mẫu trong `packages/db/lint/lint-migrations.test.mjs:26`; không có mã bỏ partition nào (kể cả trong migration).
- **Đề xuất:** (không sửa trong PR docs) khi viết PM-3, ghi hạn lưu tính **theo partition** ("30 ngày sau khi tháng kết thúc") vào I3 và vào thỏa thuận với pháp lý, **hoặc** thêm bước xóa nội dung theo dòng sau khi xử lý (cần `GRANT UPDATE (payload)` hẹp hơn hoặc hàm `SECURITY DEFINER` đặt `payload` về `'{}'`); và quyết định cách xử `DEFAULT` trong PM-3 (bỏ qua có chủ ý, hay báo). Ghi một N-số.
- **Mức độ:** MEDIUM

### [MEDIUM] F-02 — `received_at` do người gọi đặt, không kiểm: một giờ lạ làm dòng rơi vào `DEFAULT` hoặc chặn partition tháng
- **File:** `packages/db/src/inbound-store.ts:55-56, 80`.
- **Nhóm:** F (cùng loại D-02, nhưng ở khóa partition).
- **Mô tả:** `NewInboundEvent.receivedAt` là tùy chọn "When it was received. Absent: the database's now()" và `insertIfAbsent` ghi nguyên giá trị người gọi đưa vào (`values({ ...event, orgId })`). Tên là "thời điểm nhận", nhưng cột là **khóa partition** và là **đồng hồ của hạn lưu**. Nếu PR6 truyền giờ của nền tảng (đúng thứ D-02 đã làm hỏng ở `last_customer_message_at`) thì: giờ ở quá khứ xa hoặc tương lai xa rơi vào `DEFAULT` (F-01: PII không bao giờ hết hạn), giờ rơi vào một tháng sắp tạo làm `ensure_log_partitions` báo `blocked_months` cho bảng này. Hiện không có đường nào gọi hàm này ngoài test (test dùng năm 2001 có chủ ý, `inbound-store.spec.ts:152-153`), nên chưa phát tác.
- **Bằng chứng:** `inbound-store.ts:56` (`readonly receivedAt?: Date`), `:80` (`tx.insert(inboundEvents).values({ ...event, orgId })`); `git grep -n "insertIfAbsent" -- apps packages ':!*.test.ts' ':!*.spec.ts'` chỉ ra định nghĩa và `index.ts`: chưa có người gọi.
- **Đề xuất:** bỏ tham số khỏi đường sản xuất (để cột lấy `now()` của DB), giữ một tùy chọn riêng cho test; hoặc kẹp như N116/N117. Ghi trong checklist PR6 để người viết bộ xử lý không tự đặt.
- **Mức độ:** MEDIUM

### [LOW] F-03 — Mã lỗi `last_error` chỉ được kiểm ở tầng mã, không ở DB
- **File:** `packages/db/src/inbound-store.ts:15-21`; `202610071210_create_inbound_events.sql:43` (cùng ràng buộc ở `202610061200_create_outbox_events.sql` và `202610071000_create_channel_accounts.sql:56`).
- **Nhóm:** F (cùng khuôn với `outbox_events`, `channel_accounts`).
- **Mô tả:** kho dùng `^[A-Z][A-Z0-9_]{0,63}$` và từ chối một tên người và một số điện thoại giả của test (có test: `inbound-store.spec.ts:336`, `inbound-store-recovery.spec.ts:181`). Ràng buộc DB chỉ cần `btrim <> ''` và dài ≤ 64: một đường ghi không qua kho (một `UPDATE` trực tiếp bằng `app_role`, quyền `UPDATE (last_error)` có) lưu được một câu chữ có tên hay số điện thoại. Không có đường như vậy trong mã hiện tại.
- **Bằng chứng:** `inbound_events_last_error_check` (`:43`) chỉ kiểm không rỗng và ≤ 64 ký tự; `inbound-events.spec.ts:169` cho thấy `app_role` đổi được `last_error` trực tiếp.
- **Đề xuất:** thêm `CHECK (last_error ~ '^[A-Z][A-Z0-9_]{0,63}$')` ở một migration mở rộng cho ba bảng (dữ liệu hiện có đều là mã, nên hợp lệ) cùng test từ chối.
- **Mức độ:** LOW

### [INFO] F-04 — `app.channel_account_for_webhook` trả hai bản mã bí mật cho mọi người gọi bằng `app_role`
- **File:** `packages/db/migrations/202610071300_create_channel_account_for_webhook.sql:13-28`.
- **Nhóm:** F / B.
- **Mô tả:** hàm là `SECURITY DEFINER` và không kiểm tenant (webhook đến chưa có tenant): ai gọi bằng `app_role` và biết một `id` tài khoản kênh nhận `app_secret_enc` và `oa_secret_key_enc` (**bản mã**, buộc vào hàng và cột bằng AAD). Chủ ý (Z2 chưa chốt khóa nào ký webhook). Bản mã chỉ có ích với người có khóa giải mã (ở mốc này **chưa có mã giải mã nào** trong repo), nên hiện không lộ bí mật. Hàm không trả `id`, token truy cập hay làm mới.
- **Bằng chứng:** `channel-account-webhook.spec.ts:78` (không token, không id), `:142` (chỉ `app_role` `EXECUTE`); `support_role` không có quyền cột `*_enc` (`channel-accounts.spec.ts:295`).
- **Đề xuất:** khi Z2 chốt, thu hẹp hàm một cột (migration mở rộng, ghi sẵn trong chú thích); ghi vào checklist PR6 "khóa giải mã chỉ nằm ở tiến trình cần ký, không vào log".
- **Mức độ:** INFO

### [INFO] F-05 — Số tiền và khung của `channel_policies` là hạt giống "tạm, chờ xác nhận"
- **File:** `packages/db/migrations/202610071110_seed_channel_policies.sql:1-18`.
- **Nhóm:** F.
- **Mô tả:** hai dòng Zalo OA (khung 48 giờ, 8 tin miễn phí, 55 đồng, 165 đồng) lấy từ thông báo của Zalo, ghi `note = 'tạm, chờ xác nhận'`, chủ chưa xác nhận (C4). Chưa có mã đọc bảng này (chính sách gửi chưa làm), nên chưa ảnh hưởng. Khi chính sách gửi ra mắt, các con số đó thành tiền thật. Cách sửa đúng đã ghi: dòng mới với `effective_from` mới, không sửa dòng.
- **Bằng chứng:** `git grep -n "channel_policies\|channelPolicies" -- apps packages ':!*.test.ts' ':!*.spec.ts' ':!*.sql' ':!*.md'`: chỉ `schema/channel-policies.ts` và `index.ts`.
- **Đề xuất:** đặt "C4 đã xác nhận" thành cổng của PR đầu đọc bảng này (không gửi trả phí khi `note` còn chứa "tạm").
- **Mức độ:** INFO

### [INFO] F-06 — Khử trùng dựa vào `platform_message_id` duy nhất cho mỗi sự kiện; chưa biết Zalo có đảm bảo
- **File:** `docs/specs/inbound-spec.md` §1 (khóa), I5 (sự kiện không có id); `docs/specs/zalo-channel-spec.md:83` (Z-e).
- **Nhóm:** F.
- **Mô tả:** khóa là `(channel_account_id, platform_message_id)`. Nếu Zalo dùng cùng một `message_id` cho hai loại sự kiện khác nhau (một tin và phản hồi của nó), sự kiện thứ hai bị coi là trùng và **bỏ im lặng**. Phụ thuộc cấu trúc payload chưa xác minh (Z-e), nên chưa kết luận được.
- **Bằng chứng:** Z-e ở §7 của spec kênh, cột trạng thái "**Chưa** (không có nguồn)"; `inbound-event-keys.spec.ts:64-73` chỉ chứng minh cơ chế, không chứng minh ngữ nghĩa của Zalo.
- **Đề xuất:** khi xác minh payload, nếu `message_id` không đủ duy nhất thì đưa `event_type` vào khóa (migration mở rộng cho bảng khóa) trước khi có dữ liệu thật.
- **Mức độ:** INFO

---

## Nghiệm thu `inbound-spec.md` §8: mã và test ở mốc này

| # | Ca | Tầng DB/kho (có mã) | Phần cần webhook/bộ xử lý |
|---|---|---|---|
| I-N1 | Gửi hai lần, kể cả qua ranh giới tháng | **Có mã + test**: `inbound-store.spec.ts:137,149,174`, `inbound-event-keys.spec.ts:64,75` | ngoài mốc (đường vào) |
| I-N2 | Chaos 50 tin/giây khi restart | — | ngoài mốc (cần bộ xử lý) |
| I-N3 | Worker chết giữa chừng | **Có mã + test**: thu hồi `inbound-store-recovery.spec.ts:195`, đời sống sự kiện `:282` | ngoài mốc (đường xử lý) |
| I-N4 | Lỗi > 5 lần → `dead_letter`, `requeue` | **Có mã + test**: `:134,244,282` | cảnh báo: ngoài mốc |
| I-N5 | Hai tin đầu cùng lúc → một hội thoại | **Có mã + test** của bất biến: chỉ mục `conversations_open_per_user_key`, `conversation-channel.spec.ts:115,122` | khóa tư vấn người liên hệ: ngoài mốc |
| I-N6 | 50 tin đồng thời | **Có mã + test**: `message-store.spec.ts:120` | — |
| I-N7 | Tin về trễ | **Có mã + test**: `message-store.spec.ts:194` (giữ nguyên tới 30 ngày, N117) | — |
| I-N8 | `ROLLBACK` giữa chừng | **Có mã + test**: `message-service.integration.test.ts:191` | — |
| I-N9 | Sự kiện không phải tin → `ignored` | **Có mã + test** (kho): `inbound-store.spec.ts:326` | "0 hội thoại": ngoài mốc |
| I-N10 | Cô lập | **Có mã + test**: `inbound-pending-orgs.spec.ts:83-161`, `inbound-events.spec.ts:94`, `inbound-store.spec.ts:246` | — |
| I-N11 | T10/T11/T14 | **Có mã + test**: `message-service.integration.test.ts:287`; T14 ở `conversation-channel.spec.ts:143` | — |

**Không có ca "có mã chưa test"** trong phần đã có mã. Mọi ca còn thiếu là phần cần mã chưa viết.

## Đã kiểm, không có phát hiện

| Mục | Cách kiểm | Kết quả |
|---|---|---|
| RLS, `FORCE`, hai policy | quét catalog nhóm B, `rls-all-tables.spec` | `inbound_events`, `inbound_event_keys`, `channel_accounts` đúng khuôn; partition con thừa kế policy (`partitions.spec.ts:78,85`, danh sách có `inbound_events`) |
| `support_role` không đọc nội dung | `inbound-events.spec.ts:224`; quét cột nhạy cảm | `payload` không có; `*_enc` của `channel_accounts` không có; cột chỉ liệt kê |
| Khóa ngoại kép | `inbound_events` `(org_id, workspace_id, channel_account_id)`; khóa tới `channel_accounts` | tài khoản phải cùng tổ chức **và** workspace; có test `23503` |
| Khử trùng không phụ thuộc partition | bảng khóa không chia, `PRIMARY KEY (channel_account_id, platform_message_id)` | khóa ghi trước, `ON CONFLICT DO NOTHING`, cùng giao dịch (`inbound-store.ts:70-80`); khóa rút lại khi sự kiện bị từ chối (`inbound-store.spec.ts:159`) |
| Thuê, thu hồi, `dead_letter` | `failInboundEvent` kiểm `attempts` (khác `failOutboxEvent`, E-02) | relay cũ không chạm claim mới (`inbound-store-recovery.spec.ts:154`) |
| Mã lỗi không chứa PII | `assertErrorCode`, lỗi không chép giá trị | có test từ chối tên và số điện thoại |
| Hàm `SECURITY DEFINER` | `search_path` cố định, `EXECUTE` chỉ `app_role`, giới hạn tham số `22023` | 3 hàm: `channel_account_for_webhook`, `inbound_pending_orgs`, `purge_inbound_event_keys` |
| Không `DELETE` cho `app_role` | `GRANT` của `inbound_events`, `inbound_event_keys`; `inbound-events.spec.ts:197`, `inbound-event-keys.spec.ts:106` | `SELECT, INSERT` và `UPDATE` theo cột |
| Không nợ trong mã | `git grep -nE "TODO\|FIXME\|eslint-disable\|as any\|@ts-ignore" -- packages/db/src/inbound-store.ts`, exit 1 | không có kết quả |

## Checklist cho PR6 (webhook và bộ xử lý): chưa phải phát hiện

1. Đặt `received_at` bằng `now()` của DB, không dùng giờ nền tảng (F-02).
2. Chữ ký trên **thân thô** trước khi ghi; thân > giới hạn trả 413 (`zalo-channel-spec`); cùng một mã và thân cho "kênh không tồn tại / bị ngắt / chữ ký sai".
3. Trả 200 sau khi **giao dịch ghi khóa + sự kiện** commit; không trả 200 trước.
4. Chọn hội thoại: mở thì dùng; **đóng ≤ 72 giờ thì mở lại (T14)** trước khi tạo hội thoại mới; xử lý `23505` của chỉ mục I2 (`conversation-channel.spec.ts:115,143`).
5. Khóa tư vấn theo `(channel_account_id, external_user_id)` trước khi tìm hội thoại (I-N5).
6. Một sự kiện là **một** giao dịch; `markInbound*` trả `false` thì ROLLBACK cả giao dịch.
7. Không log `payload`, không đưa nội dung vào mã lỗi; `ConversationContendedError` đưa sự kiện về `pending`, không mất tin.
8. Mã `ignored` là mã cố định (regex của kho).
9. Khóa giải mã bí mật kênh chỉ nằm ở tiến trình cần ký, không vào log (F-04); `access_token` chỉ dùng khi gửi, không ghi log.

## Cần kiểm thêm (INFO, chưa chứng minh được)

1. **I-N2 và I-N3 đầu-cuối** chỉ chứng minh được khi có bộ xử lý: khuôn K3 (job `queue`).
2. **Hiệu năng `claimInboundBatch`** với backlog lớn (`FOR UPDATE SKIP LOCKED ... LIMIT`): chỉ mục có (`inbound_events_due_idx`), chưa đo.
3. **`requeueInboundDeadLetters` không giới hạn số dòng** khi gọi không có `keys` (đúng hợp đồng đã ghi: "all of the organisation"): cập nhật cả tổ chức trong một câu lệnh; runbook cần nói rõ và nên có `keys` khi số dòng lớn.

## Đề xuất ghi vào `QUESTIONS.md` (chưa ghi, anh quyết)

| Số đề xuất | Nội dung | Phát hiện |
|---|---|---|
| N122 | Hạn lưu `payload` tính theo partition (30 ngày sau cuối tháng) hoặc xóa nội dung theo dòng; cách xử `DEFAULT` trong PM-3; chốt I3 với pháp lý | F-01 |
| N123 | `received_at` do DB đặt trên đường sản xuất; không nhận giờ nền tảng | F-02 |
| N124 | `CHECK` regex mã lỗi cho `last_error` (ba bảng); thu hẹp `channel_account_for_webhook` khi Z2 chốt; cổng "C4" trước gửi trả phí; `event_type` vào khóa nếu Z-e đòi | F-03, F-04, F-05, F-06 |

(N118–N120 là đề xuất của nhóm E, chưa ghi; N121 đã ghi.)

## Giới hạn

Rà soát bởi chính tác giả. Checklist cứng + bằng chứng chạy được. Không thay thế review độc lập.

- Phần lớn nhóm F (kho inbound, hàm DB) do chính tác giả viết ở PR1 và PR2 của M1.3: **nên cân nhắc review độc lập Nhóm D/E/F**.
- Test tích hợp chỉ chạy ở CI; ở đây dẫn tên test và vị trí, không chạy lại.
- Webhook và bộ xử lý chưa có mã: danh sách trên là việc kiểm cho PR6, không phải kết luận.
