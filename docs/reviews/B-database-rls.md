# Code Review — Nhóm B: Cơ sở dữ liệu và RLS (migration, schema, phân quyền)

- **Mốc code:** `main` = `a443721`. PR4b-2a (`efce039`) ngoài mốc; nó không thêm migration nào.
- **Ngày rà soát:** 12/10/2026. **Người rà soát:** Claude (chính tác giả, xem mục "Giới hạn").
- **Phạm vi:** 48 file trong `packages/db/migrations`, `packages/db/src/schema/*`, `packages/db/lint/lint-migrations.mjs`, `packages/db/scripts/migrate.mjs`, `infra/db/*.sql`, các spec RLS (`rls-all-tables`, `tenant-isolation`, `workspace-isolation`, `support-access`, `partitions`).
- **Cách tìm bằng chứng:** đọc từng migration; áp cả 48 file lên PGlite (PostgreSQL 18, một kết nối) rồi quét catalog; mỗi quét là một kịch bản ngoài kho, kết quả dán dưới đây.

## Tóm tắt

| Mức | Số | Mã |
|---|---|---|
| CRITICAL | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 1 | B-01 |
| LOW | 0 | — |
| INFO | 2 | B-02, B-03 |

Không tìm thấy lỗi cách ly tenant. Toàn bộ 18 bảng có RLS đều đúng khuôn (xem bảng "Đã kiểm"). Phát hiện duy nhất cần quyết là **B-01**: việc dọn/tạo partition chưa có người làm và có một cái bẫy chưa được ghi lại.

---

## Phát hiện

### [MEDIUM] B-01 — `PartitionMaintenanceJob` chưa có; sau 01/01/2027 dòng mới rơi vào `DEFAULT` và việc tạo partition tháng đó sẽ **lỗi cứng**
- **File:** `packages/db/migrations/202610031600_create_log_partition_functions.sql:37-77`; nơi hứa có job: `202610061200_create_outbox_events.sql:62`, `202610071210_create_inbound_events.sql:63`, `docs/specs/outbox-spec.md` mục O5 (hạn 01/01/2027), `docs/specs/rls-spec-M01.md:421`, `QUESTIONS.md` S1-8, N67.
- **Nhóm:** B (ảnh hưởng E, F).
- **Mô tả:** Sáu bảng chia theo tháng (`audit_logs`, `platform_access_logs`, `messages`, `conversation_events`, `outbox_events`, `inbound_events`) chỉ có partition cho tháng chạy migration cộng hai tháng, và một partition `DEFAULT`. Không có mã nào gọi lại `app.create_log_partitions` sau migration (chỉ test gọi). Khi hết tháng thứ ba, mọi dòng mới vào `DEFAULT`. Từ lúc đó, `CREATE TABLE ... PARTITION OF ... FOR VALUES FROM (tháng đó)` **thất bại** vì `DEFAULT` đã chứa dòng thuộc khoảng ấy; muốn tạo phải chuyển dữ liệu ra trước. `N67` mới nói dòng rơi vào `DEFAULT` là "khó dọn"; chưa ghi rằng việc tạo partition sẽ báo lỗi và job phải biết tách dòng ra. Ngoài ra, hạn lưu của `outbox_events` và `inbound_events` ("bỏ cả partition sau 30 ngày") phụ thuộc cùng job, và `purgeInboundEventKeys` (`packages/db/src/inbound-store.ts:286`) cũng chưa có nơi gọi định kỳ.
- **Bằng chứng:**
  ```
  # tái hiện bằng PGlite (kịch bản part-trap.mjs, ngoài kho)
  CREATE TABLE t (...) PARTITION BY RANGE (at);  CREATE TABLE t_default PARTITION OF t DEFAULT;
  INSERT INTO t VALUES (1, '2027-01-15Z');                -- row landed in: t_default
  CREATE TABLE t_y2027m01 PARTITION OF t FOR VALUES FROM ('2027-01-01Z') TO ('2027-02-01Z');
  -- create failed: 23514 updated partition constraint for default partition "t_default" would be violated by some row
  ```
  Quét catalog: mỗi bảng trong sáu bảng có đúng 4 partition (`_default`, `_y2026m10`, `_y2026m11`, `_y2026m12`). `git grep -n "create_log_partitions" a443721 -- apps packages` ngoài test và migration: rỗng. `test/partitions.spec.ts:161-166` chứng minh dòng cũ rơi vào `DEFAULT`, **không** có test cho tình huống "dòng đã nằm trong `DEFAULT` rồi mới tạo partition".
- **Đề xuất:** (không sửa trong PR docs) (1) xếp job vào lộ trình **trước 01/01/2027** (còn 81 ngày tính từ 12/10/2026); (2) job phải tạo trước ≥ 3 tháng mỗi ngày (đúng `rls-spec-M01.md:421`) **và** xử lý được `DEFAULT` đã có dòng: tách `DEFAULT` ra, tạo partition, chèn lại trong một transaction; (3) thêm test "9d": dòng trong `DEFAULT` + gọi tạo partition tháng đó → job vẫn thành công; (4) ghi vào N67 cái bẫy 23514. Đây là việc cần Plan Mode riêng.
- **Mức độ:** MEDIUM

### [INFO] B-02 — Lint `MIG-RLS` chỉ kiểm có *một* `CREATE POLICY`, không kiểm cặp `_app`/`_support`
- **File:** `packages/db/lint/lint-migrations.mjs:183-184`.
- **Nhóm:** B.
- **Mô tả:** Với bảng có `org_id`, lint yêu cầu `ENABLE`, `FORCE` và "một `CREATE POLICY` bất kỳ" cùng file. Hai policy đúng khuôn và `WITH CHECK` có `current_org` được kiểm bởi `rls-all-tables.spec` (sinh từ catalog thật) chứ không phải lint. Lint cũng chỉ nhìn `CREATE TABLE` có cột `org_id` ngay trong câu lệnh; thêm `org_id` bằng `ALTER TABLE ... ADD COLUMN` sẽ lọt, nhưng `rls-all-tables.spec` bắt ở CI. Không có lỗ hổng thật; ghi lại vì CLAUDE.md của `packages/db` viết như thể lint là chốt chặn chính.
- **Bằng chứng:** `lint-migrations.mjs:183-184` (`has(String.raw\`^CREATE\s+POLICY ...\`)`); quét catalog dưới đây cho thấy cả 18 bảng đều đúng 2 policy.
- **Đề xuất:** thêm một câu vào `packages/db/CLAUDE.md`: "chốt chặn đúng khuôn policy là `rls-all-tables.spec`, lint chỉ là cảnh báo sớm".
- **Mức độ:** INFO

### [INFO] B-03 — `support_role` đọc được nội dung tin nhắn và `payload` outbox, với số "khóa" khác nhau
- **File:** `packages/db/migrations/202610061010_create_messages.sql:44-54`, `202610061200_create_outbox_events.sql:59-65`.
- **Nhóm:** B / E.
- **Mô tả:** Theo thiết kế N94: `messages_support` cần ba khóa (phiên truy cập, org, workspace) và cho đọc `body`. `outbox_events_support` chỉ cần hai (phiên truy cập, org) vì `outbox_events` là bảng O, không phải O+W. Không sai; ghi để người rà Nhóm E biết payload outbox phải **không chứa nội dung tin**. Ở mốc này payload chỉ chứa mã định danh và mã chuyển trạng thái; PR4b-2a (ngoài mốc) cho `message.created` mang `conversationId`, `messageId`, `sequenceNumber`, không có `body` (`outbox-writer.ts:130-134`).
- **Bằng chứng:** hai đoạn policy trên; quét catalog cột nhạy cảm: `messages.body` — `support_role` SELECT = true; `outbox_events.payload` — `support_role` SELECT = true; `inbound_events.payload` — `support_role` = false.
- **Đề xuất:** thêm vào spec outbox một câu "payload không chứa nội dung tin nhắn (PII)"; test hiện có của Nhóm E nên khẳng định điều này. Đưa vào lượt rà Nhóm E.
- **Mức độ:** INFO

---

## Đã kiểm, không có phát hiện

Quét catalog PGlite trên 48 migration (`review-catalog.mjs`, `review-fk.mjs`, ngoài kho):

| Mục | Kết quả |
|---|---|
| Bảng ở schema `public` (không tính partition con) | 25: 18 có RLS, 7 không có (`accounts`, `sessions`, `two_factors`, `verifications`, `users`, `channel_policies`, `feature_flags_global`) |
| 18 bảng RLS: `ENABLE` + `FORCE` | 18/18 `relrowsecurity` và `relforcerowsecurity` |
| Số policy mỗi bảng RLS | đúng 2 (`*_app`, `*_support`) ở cả 18 |
| `USING`/`WITH CHECK` có `current_org` | 18/18 (`organizations` theo `id`) |
| O+W (`conversations`, `messages`) có `current_workspaces` cả `USING` lẫn `WITH CHECK`, cả hai policy | đúng |
| Partition con (6 bảng × 4) | `rls`, `force`, 2 policy, không cấp quyền trực tiếp — khớp bảng cha |
| 7 bảng không RLS | `app_role`/`support_role` không có quyền nào, trừ `channel_policies` và `feature_flags_global` (chỉ `SELECT`); `auth_role` chỉ trên bảng auth và `users` theo cột |
| Quyền `DELETE`/`TRUNCATE` của `app_role`, `support_role` | không có trên bảng nào |
| `ON DELETE CASCADE` / `SET NULL` / `SET DEFAULT` | 0 trong 87 khóa ngoại (tính cả partition con) |
| Khóa ngoại từ bảng có `org_id` kèm `org_id` | 41/43; 2 ngoại lệ có lý do: `feature_flags_overrides_flag_fk` (trỏ `feature_flags_global`, bảng toàn cục) và `org_members_user_fk` (trỏ `users`, bảng toàn cục) |
| Cột mặc định gọi UUIDv4 | 0 (`gen_random_uuid`/`uuid_generate_v4` không có ở default nào; lint cũng chặn, `lint-migrations.mjs:198`) |
| Hàm `SECURITY DEFINER` | 6/6 có `search_path = pg_catalog, public, pg_temp` cố định |
| Hàm `app.*` thuộc nhóm có tác dụng phụ (`create_log_partitions`, `secure_log_partition`, `copy_policies_to_partitions`, `conversations_fsm_guard`) | `search_path` cố định, `EXECUTE` không cấp cho role ứng dụng |
| `EXECUTE` cho `PUBLIC` | không có trên kho thật: `202610031000_create_tenant_context.sql:10` đặt `ALTER DEFAULT PRIVILEGES FOR ROLE migration_role REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` và `foundation.test.ts:60-72` kiểm `PUBLIC` không chạy được hàm nào ở schema `app`, kể cả hàm tạo sau. Quét PGlite thấy 4 hàm còn `PUBLIC` (`current_org`, `current_workspaces`, `api_key_scopes_valid`, `users_status_transition_check`): **do PGlite chạy bằng superuser nên bỏ qua default privileges của `migration_role`**, không phải lỗi của kho. Đã loại khỏi phát hiện. |
| `app.org_users` (view) | `security_barrier = true`, chỉ `app_role` SELECT |
| `app.conversation_visible` | `SECURITY INVOKER` (không nâng quyền), `EXECUTE` chỉ `app_role`/`support_role` |
| Cột nhạy cảm | `*_enc`, `key_hash`, `invite_token_hash`: chỉ `app_role` đọc (không `support_role`); cột auth (`password`, `token`, `secret`, `backup_codes`): chỉ `auth_role`; `inbound_events.payload`: không `support_role` |
| Trigger | 2: `conversations_fsm_guard` (chặn đổi trạng thái ngoài FSM), `users_status_transition_check` |
| Phiên bản/runner | `migrate.mjs`: chạy lint trước, `pg_advisory_lock`, so checksum đã áp dụng, mỗi file một transaction; lint `MIG-TXN`/`MIG-ROLLBACK`/`MIG-NAME` bật |
| `schema_migrations` | `app_role`, `support_role` không quyền (`rls-all-tables.spec`, `GLOBAL_TABLES`) |

## Cần kiểm thêm (INFO, chưa chứng minh được)

1. **Quyền theo vai trò thật** (`migration_role` làm chủ schema, `BYPASSRLS`) không dựng được trong PGlite; CI (`db` job, `rls-all-tables.spec`, `support-access.spec`) là nơi chứng minh. Đã dẫn tên test, không chạy lại cục bộ.
2. **Hiệu năng `COUNT`/`MAX` trên `messages` theo hội thoại** (`message-store.ts`, Nhóm F): chỉ mục `messages_conversation_sequence_idx` có trong catalog; chưa đo với dữ liệu lớn.

## Đề xuất ghi vào `QUESTIONS.md` (chưa ghi, anh quyết)

| Số đề xuất | Nội dung | Phát hiện |
|---|---|---|
| N110 | `PartitionMaintenanceJob`: hạn 01/01/2027, xử lý `DEFAULT` đã có dòng (lỗi 23514), test "9d"; gồm cả gọi `purgeInboundEventKeys` định kỳ | B-01 |
| N111 | Ghi vào `packages/db/CLAUDE.md`: chốt chặn khuôn policy là `rls-all-tables.spec`, lint chỉ cảnh báo sớm | B-02 |

## Giới hạn

Rà soát bởi chính tác giả. Checklist cứng + bằng chứng chạy được. Không thay thế review độc lập.

- PGlite một kết nối, chủ sở hữu là superuser: nó kiểm được *hình dạng* (cờ RLS, policy, ACL ghi trong catalog), không kiểm được hành vi `FORCE`/`BYPASSRLS` thật của từng role, và **không áp default privileges của `migration_role`** (xem dòng `EXECUTE` cho `PUBLIC` ở bảng trên: một kết quả quét bị loại vì lý do này).
- Bộ test tích hợp `db` không chạy cục bộ (không PostgreSQL thật); các nhận định "test này chứng minh điều kia" dựa vào đọc test và lần CI xanh trên `main`.
