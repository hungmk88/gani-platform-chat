# ADR-004 — RLS fail-loud: thiếu tenant context thì báo lỗi

| | |
|---|---|
| Trạng thái | Chấp nhận (Brief P16 "3 role DB" đã chốt); chi tiết cài đặt chờ cố vấn duyệt |
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
Không thêm `SECURITY DEFINER` mới trừ khi bất khả kháng. Ở S1 chỉ cho phép đúng các đối tượng sau (đều theo spec §3.6):
- `app.support_access_ok()`, `app.memberships_for_user()`, `app.lookup_invite()`, `app.accept_invite()`.
- View `app.org_users` (chạy bằng quyền owner, cùng mức rủi ro).
Thêm đối tượng thứ sáu phải qua cố vấn duyệt.

**Xóa user bỏ dở dùng `migration_role` qua `PendingUserCleanupJob`**, không thêm hàm `SECURITY DEFINER` để xóa (spec §3.7).

## Thu hồi token lời mời
`invite_token_hash` trên `org_members` dùng **ghi đè** thay vì `revoked_at`. Token cũ chết ngay khi hash bị ghi đè. Không thêm cột `revoked_at`. (Áp dụng cho `resend-invite` và khi `PendingUserCleanupJob` trả lời mời về `pending`.)

## Hệ quả
- Test bắt buộc: `app_role` không set tenant → mọi bảng RLS phải ném `TN001`.
- Lint migration: `CREATE TABLE` có `org_id` mà thiếu ENABLE/FORCE/POLICY → CI đỏ.
- Mọi code đường nóng phải đi qua `TenantTx`; không có "chế độ bỏ qua" cho `app_role`.
