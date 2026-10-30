# ADR-004 — RLS fail-loud: thiếu tenant context thì báo lỗi

| | |
|---|---|
| Trạng thái | Chấp nhận (Brief P16 "3 role DB" đã chốt) · đã cài (migration, `rls-all-tables.spec`); duyệt chi tiết cài đặt của cố vấn chưa ghi nhận trong repo (review G-03) |
| Ngày | 03/10/2026 |
| Nguồn | Brief P16, P3.2 mục 2; Phụ lục v2.1 §2, v2.3 §20 |

## Quyết định
Khi `app_role` (và `support_role`) truy vấn bảng có RLS mà **chưa** set tenant context, PostgreSQL phải **báo lỗi**, không được trả 0 dòng.

## Lý do
- "0 dòng im lặng" che mất lỗi quên `TenantTx`: test xanh giả, dữ liệu rỗng giả.
- Với backfill/migration, "âm thầm 0 dòng" làm job báo thành công mà không cập nhật gì (Brief P16) → `migration_role` dùng BYPASSRLS có kiểm soát, không dùng cơ chế im lặng.
- Quên `TenantTx` phải lộ ngay khi dev và ở CI.

## Cơ chế
Policy không đọc `current_setting` trực tiếp mà qua hàm; hàm ném lỗi mã riêng `TN001`:

```sql
CREATE FUNCTION app.current_org() RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE v text := current_setting('app.current_org', true);
BEGIN
  IF v IS NULL OR v = '' THEN
    RAISE EXCEPTION 'tenant context missing' USING ERRCODE = 'TN001';
  END IF;
  RETURN v::uuid;
END $$;
-- app.current_workspaces() RETURNS uuid[]: tương tự; '{}' hợp lệ (0 workspace → 0 dòng).
```

Lý do dùng hàm: sau khi một transaction đã `SET LOCAL`, biến trở thành chuỗi rỗng `''` chứ không còn là "không tồn tại"; đọc trực tiếp sẽ ra lỗi ép kiểu mơ hồ. Trong policy gọi dạng `(SELECT app.current_org())` để chạy một lần mỗi câu lệnh.

## Ánh xạ lỗi ở API
| Lỗi DB | Ý nghĩa | HTTP |
|---|---|---|
| `TN001` | Bug: quên `TenantTx` | 500 `internal_error` + Sentry |
| `42501` (vi phạm `WITH CHECK`) | Ghi sang tenant khác | 404 `not_found` (P9: không lộ tài nguyên) |

## Vai trò DB
`app_role`, `migration_role`, `support_role` theo Brief P16. Đề xuất thêm `auth_role` — **lệch Brief có chủ đích, cần cố vấn duyệt** (xem spec §3).

## `SECURITY DEFINER`: danh sách đóng
Không thêm `SECURITY DEFINER` mới trừ khi bất khả kháng. Mỗi hàm thêm phải có dòng trong bảng dưới và một N-số trong `QUESTIONS.md`.

**Cho phép ở S1 (spec §3.6):**
- `app.support_access_ok()`, `app.memberships_for_user()`: đã tạo.
- `app.lookup_invite(text)`, `app.accept_invite(text, uuid)`: đã tạo (`202610221000`, N147; `rls-spec-M01.md` §3.6, §3.7). `accept_invite` nhận thêm id UUIDv7 của người mới do server sinh (PostgreSQL 16 không sinh được UUIDv7).
- View `app.org_users` (chạy bằng quyền owner, cùng mức rủi ro): đã tạo.

**Đã thêm sau S1** (20/10/2026: 10 hàm `SECURITY DEFINER` có trong migration; hai hàm đầu ở trên, tám hàm dưới đây; xác nhận của cố vấn cho từng hàm chưa ghi nhận trong repo, review G-01):

| Hàm | Migration | N |
|---|---|---|
| `app.outbox_pending_orgs` | `202610061300` | N94 |
| `app.purge_inbound_event_keys` | `202610071220` | N104 |
| `app.channel_account_for_webhook` | `202610071300` | N101, N105 |
| `app.inbound_pending_orgs` | `202610071320` | N104 |
| `app.ensure_log_partitions` | `202610121500` | N110 |
| `app.log_default_partition_rows` | `202610131000` | N110 |
| `app.outbox_stats` | `202610191200` | N118 |
| `app.purge_idempotency_keys` | `202610201200` | N134 |
| `app.reset_member_two_factor` | `202610241000` | N155 (đặt lại 2FA của thành viên công ty hiện tại; từ chối người dùng chung với công ty khác) |
| `app.audit_own_account_event` | `202610251000` | N162 (audit đổi/đặt lại mật khẩu của chính người đang đăng nhập, mỗi công ty họ còn active; chỉ hai action) |
| `app.held_conversation_counts` | `202610281000` | N168 (số hội thoại mỗi người đang giữ trong mọi workspace còn sống của công ty hiện tại; chỉ id người và số). **Không còn ai gọi** từ `202610301000`; xóa ở PR riêng |
| `app.held_conversation_counts_by_state` | `202610301000` | N168, U55 (thay hàm trên: tách `HUMAN_ACTIVE` (tải, Brief §M04) và `PENDING_CUSTOMER` (chờ khách); chỉ id người và hai số) |
| `app.channel_refresh_due_orgs` | `202611021000` | N173 (công ty có kênh Zalo OA tới hạn làm mới token, B2; chỉ id công ty). `p_before_seconds` do job truyền, cho phép đổi ngưỡng theo cấu hình worker. Hàm thứ 17, anh chấp nhận 31/10 có điều kiện; chờ cố vấn cùng 16 hàm kia (#386) |

`packages/db/test/security-definer.spec.ts` so tập hàm thật (17 hàm, 31/10/2026) với danh sách này và kiểm mỗi hàm khóa `search_path`: thêm hàm mà không sửa danh sách thì test đỏ (N125).

**Xóa user bỏ dở dùng `migration_role` qua `PendingUserCleanupJob`**, không thêm hàm `SECURITY DEFINER` để xóa (spec §3.7).

## Thu hồi token lời mời
`invite_token_hash` trên `org_members` dùng **ghi đè** thay vì `revoked_at`. Token cũ chết ngay khi hash bị ghi đè. Không thêm cột `revoked_at`. (Áp dụng cho `resend-invite` và khi `PendingUserCleanupJob` trả lời mời về `pending`.)

## Hệ quả
- Test bắt buộc: `app_role` không set tenant → mọi bảng RLS phải ném `TN001`.
- Lint migration: `CREATE TABLE` có `org_id` mà thiếu ENABLE/FORCE/POLICY → CI đỏ.
- Mọi code đường nóng phải đi qua `TenantTx`; không có "chế độ bỏ qua" cho `app_role`.
- **Giới hạn của fail-loud (phát hiện ở PR 3b, QUESTIONS N59):** `TN001` chỉ nổ khi policy **được đánh giá**, mà RLS đánh giá theo từng dòng. Bảng rỗng, hoặc kế hoạch truy vấn không quét dòng nào, có thể trả 0 dòng **không lỗi** dù thiếu context (tùy planner). Vì vậy fail-loud là lưới an toàn, không phải chốt chặn duy nhất.
- Chốt chặn thật: mọi truy vấn đi qua `TenantTx` (`withTenant`) và lint cấm import `pg`/`drizzle-orm` ngoài `packages/db`.
- Test fail-loud phải có sẵn dòng mẫu trong bảng; test không có dòng mẫu có thể xanh giả.
- `set_config(..., true)` để lại chuỗi rỗng `''` (không phải NULL) trên kết nối đã dùng; `app.current_org()` coi cả hai là "thiếu context", và test chứng minh context không rò sang người dùng kế tiếp của kết nối trong pool.
- Drizzle bọc lỗi của driver: mã SQLSTATE (`TN001`, `42501`) nằm ở `error.cause`, cần đi theo `cause` khi ánh xạ lỗi sang HTTP (N58).
