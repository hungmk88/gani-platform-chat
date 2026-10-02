# Đặc tả RLS + vai trò DB + policy bảng S1

| Mục | Nội dung |
|---|---|
| Trạng thái | **NHÁP — chờ cố vấn kỹ thuật duyệt** (điều kiện mở PR1, Brief P22 "Điều kiện duyệt") |
| Phạm vi | Bảng M01, M02 một phần, `conversations` khung (S1) |
| Nguồn | Brief v0.4 P8, P16, P17 · Phụ lục v2.1 §1–2, v2.3 §20 |
| Người viết / ngày | Claude (vai Tech Lead) · 03/10/2026 |

## 1. Vai trò DB

Không role nào là superuser. Mật khẩu từng role nằm trong secret manager (Terraform `secrets`).

| Role | Thuộc tính | Quyền | Dùng cho |
|---|---|---|---|
| `migration_role` | LOGIN, **BYPASSRLS**, owner schema `public` + `app` | DDL, backfill | Chỉ pipeline migration/backfill; mỗi lần chạy ghi log |
| `app_role` | LOGIN, NOBYPASSRLS, không owner | `SELECT/INSERT/UPDATE` trên bảng nghiệp vụ; không `DELETE` (soft delete); không quyền trên bảng auth | API, worker |
| `support_role` | LOGIN theo từng người (`IN ROLE support_role`), NOBYPASSRLS | Chỉ `SELECT` | Debug/hỗ trợ; bắt buộc có access-session còn hạn (§5) |
| `auth_role` | LOGIN, NOBYPASSRLS | Chỉ bảng auth (§4) + hàm `app.memberships_for_user` | Pool kết nối riêng của Better Auth |

Mặc định: `REVOKE ALL ON ALL TABLES ... FROM PUBLIC`; mỗi role được cấp đúng bảng/cột cần.

## 2. Ngữ cảnh tenant và cơ chế "báo lỗi khi thiếu"

`TenantTx` mở transaction rồi chạy (tham số hóa, tương thích pooler chế độ transaction):

```sql
SELECT set_config('app.current_org', $1, true),        -- true = LOCAL
       set_config('app.current_workspaces', $2, true); -- '{uuid,uuid}' hoặc '{}'
```

Policy **không** đọc `current_setting` trực tiếp mà qua hàm, để mọi trường hợp thiếu ngữ cảnh đều ra **một mã lỗi duy nhất** `TN001`:

```sql
CREATE FUNCTION app.current_org() RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE v text := current_setting('app.current_org', true);
BEGIN
  IF v IS NULL OR v = '' THEN
    RAISE EXCEPTION 'tenant context missing' USING ERRCODE = 'TN001';
  END IF;
  RETURN v::uuid;
END $$;
-- app.current_workspaces() RETURNS uuid[] — tương tự.
-- Chưa set / chuỗi rỗng → TN001. '{}' là HỢP LỆ (user không có workspace nào) → thấy 0 dòng.
```

Lý do dùng hàm: sau khi transaction trước đã `SET LOCAL`, biến trở thành `''` chứ không còn "không tồn tại". Đọc trực tiếp sẽ ra lỗi ép kiểu khó phân biệt với lỗi khác.

Trong policy, hàm được bọc `(SELECT app.current_org())` để chỉ chạy 1 lần mỗi câu lệnh (initplan), không chạy theo từng dòng.

**Ánh xạ lỗi ở API:** `TN001` → 500 `internal_error` + Sentry (đây là bug quên `TenantTx`). Vi phạm `WITH CHECK` (`42501`) khi ghi → 404 `not_found` (P9: không lộ tài nguyên tenant khác).

## 3. Mẫu policy

**Bảng O** (org):

```sql
ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <t> FORCE ROW LEVEL SECURITY;
CREATE POLICY <t>_app ON <t> FOR ALL TO app_role
  USING      (org_id = (SELECT app.current_org()))
  WITH CHECK (org_id = (SELECT app.current_org()));
CREATE POLICY <t>_support ON <t> FOR SELECT TO support_role
  USING (org_id = (SELECT app.current_org()) AND (SELECT app.support_access_ok()));
```

**Bảng O+W:** thêm `AND workspace_id = ANY ((SELECT app.current_workspaces()))` vào cả `USING` lẫn `WITH CHECK`.

Role không có policy nào khớp (kể cả `auth_role`) → mặc định bị từ chối toàn bộ (do đã FORCE).

## 4. Bảng auth (Better Auth) — không RLS, chỉ `auth_role`

`users`, `auth_sessions`, `auth_accounts` (hash mật khẩu Argon2id), `auth_verifications`, `auth_two_factors`.

- `app_role` **không có quyền** trên `auth_*`.
- Với `users`, `app_role` chỉ được `SELECT (id, display_name, locale)` và có RLS theo membership: `EXISTS (SELECT 1 FROM org_members m WHERE m.user_id = users.id AND m.org_id = (SELECT app.current_org()))`. Nghĩa là user khác tenant không nhìn thấy nhau, cột `email` cũng không đọc được (xem QUESTIONS N1).
- `auth_role` cần **ghi** `auth_sessions`, `auth_verifications`, `auth_two_factors`, ghi cột khóa đăng nhập của `users`. "Đọc hẹp" chỉ áp được cho các bảng tenancy (QUESTIONS N2).
- Khi chưa có tenant, `auth_role` lấy danh sách org mà user là thành viên qua hàm `app.memberships_for_user(user_id) RETURNS TABLE(org_id uuid, role text)`, khai báo `SECURITY DEFINER`, `SET search_path = app, pg_temp`, chỉ trả 2 cột này.

## 5. Support và platform operator

- Mỗi người vận hành có một login DB riêng thuộc `support_role`.
- `app.support_access_ok()` (`SECURITY DEFINER`) kiểm tra trong `platform_access_logs` có dòng thỏa: `db_login = session_user`, `org_id = app.current_org()`, `reason` khác rỗng, `now() < expires_at` (tối đa 60 phút).
- Vì vậy dù support tự `SET app.current_org` thì vẫn không đọc được gì khi chưa có access-session.
- S1 tạo role, hàm và bảng. Endpoint `POST /v1/platform/access-sessions` để S5 (module `platform-admin`).

## 6. Bảng S1

Mọi bảng có `UNIQUE(org_id, id)` (trừ bảng toàn cục). FK giữa các bảng nghiệp vụ là cặp `(org_id, x_id)`. Toàn bộ FK để `ON DELETE RESTRICT`; **không CASCADE từ `organizations`**.

| Bảng | RLS | FK kép (ví dụ) | Ghi chú |
|---|---|---|---|
| `organizations` | `id = current_org()` | — | Tạo org: app sinh UUIDv7 trước, mở `TenantTx` với chính id đó rồi mới INSERT |
| `users` | theo membership (§4) | — | Toàn cục, email unique |
| `org_members` | O | `UNIQUE(org_id, user_id)`; `user_id → users(id)` | `role` ∈ 7 vai trò (CHECK) |
| `workspaces` | O | `UNIQUE(org_id, slug)` | `template` ∈ b2b_sales · b2c_order · service; `default_max_concurrent` = 5 |
| `workspace_members` | O | `(org_id, user_id) → org_members`; `(org_id, workspace_id) → workspaces` | Bảo đảm thành viên workspace phải là thành viên org |
| `teams` / `team_members` | O | `(org_id, workspace_id) → workspaces`; `(org_id, team_id) → teams`; `(org_id, user_id) → org_members` | |
| `agent_settings` | O | `(org_id, user_id) → org_members` | `max_concurrent_conversations` |
| `api_keys` | O | | Chỉ lưu `key_hash`; `key_prefix` unique; `scopes text[]` |
| `invitations` | O | `(org_id, workspace_id) → workspaces` | Token chỉ lưu hash; hết hạn 7 ngày. Bảng này mới so với P8 (QUESTIONS N7) |
| `audit_logs`, `platform_access_logs` | O | | Partition tháng; PK `(id, created_at)` |
| `feature_flags_global` | — (app chỉ SELECT) | | |
| `feature_flags_overrides` | O | `(org_id, workspace_id) → workspaces` | |
| `channel_accounts` | O | `(org_id, workspace_id) → workspaces` | Token mã hóa envelope: `token_ciphertext`, `dek_wrapped`, `kms_key_ref` |
| `channel_policies` | — (app chỉ SELECT) | | Platform quản trị |
| `conversations` (khung) | **O+W** | `(org_id, workspace_id) → workspaces` | `id, org_id, workspace_id, state, version, created_at, updated_at`; S2 mở rộng (expand) |

**Partition:** RLS khai báo ở bảng cha không bảo vệ khi truy cập thẳng vào partition con. Vì vậy:
- `app_role` không có quyền nào trên partition con.
- `PartitionMaintenanceJob` (tạo trước 3 tháng, chạy hằng ngày, lỗi thì cảnh báo) bật thêm ENABLE + FORCE trên từng partition.

## 7. Test chứng minh (chạy mỗi PR, đỏ thì chặn merge)

| # | Ca | Kỳ vọng |
|---|---|---|
| 1 | `app_role` SELECT mọi bảng O/O+W khi chưa có `TenantTx` | Lỗi `TN001` |
| 2 | Context org A, INSERT dòng có `org_id = B` | `42501`, API trả 404 |
| 3 | Context org A, `workspace_members` trỏ tới workspace của org B | FK kép từ chối |
| 4 | Context org A, SELECT `org_members` | Chỉ thấy dòng của org A |
| 5 | Sales thuộc ws A (`current_workspaces = {A}`), SELECT/UPDATE `conversations` của ws B cùng org | 0 dòng / 404 |
| 6 | `support_role` có context nhưng không có access-session | 0 dòng |
| 7 | `app_role` SELECT `auth_sessions`, `users.email` | `permission denied` |
| 8 | Migration lint: `CREATE TABLE` có `org_id` mà thiếu ENABLE/FORCE/POLICY | CI đỏ |
| 9 | Seed chạy với `APP_ENV=production` | Script thoát lỗi, không ghi dòng nào |
