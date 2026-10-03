# Đặc tả RLS — nhóm migration M01 (Tenancy & identity) + `conversations` khung

| | |
|---|---|
| Trạng thái | **NHÁP — chờ cố vấn kỹ thuật duyệt** (điều kiện mở PR1; Brief P22 "Điều kiện duyệt") |
| Nguồn | Brief P3.2 (mục 1, 2, 10, 20), P8, P16, P17; Phụ lục v2.1 §1–2, §10; v2.3 §20 |
| Quyết định liên quan | ADR-002 (Drizzle), ADR-003 (Better Auth), ADR-004 (fail-loud) |
| Ngày | 03/10/2026 |

Ký hiệu RLS (theo P8): **O** = theo `org_id` · **O+W** = theo `org_id` + `workspace_id` · **—** = không RLS.

> **Các điểm lệch Brief có chủ đích — cần cố vấn duyệt**
> 1. Thêm role `auth_role` (Brief P16 chỉ có 3 role). Xem §3.
> 2. `users` giữ nguyên "—" (không RLS) theo Brief, nhưng `app_role` **không được đọc trực tiếp**. Xem §3.3.
> 3. Chưa có bảng `invitations`: lời mời nằm trên `org_members` (`status='pending'`). Brief P8 không nói gì về lời mời. Xem §4.3 và QUESTIONS.

## 1. Quy ước chung

- PK `id` kiểu UUID, **UUIDv7** sinh ở app (`packages/domain/id`); `DEFAULT app.uuid_v7()` chỉ là dự phòng.
- Cột chuẩn mọi bảng nghiệp vụ: `id, org_id, [workspace_id], created_at, updated_at, created_by`.
- Mọi bảng nghiệp vụ có `UNIQUE (org_id, id)` để làm đích khóa ngoại kép.
- Khóa ngoại giữa bảng nghiệp vụ luôn là cặp `(org_id, x_id) → cha(org_id, id)`. **Tất cả `ON DELETE RESTRICT`**; không `CASCADE` từ `organizations`.
- Soft delete bằng `deleted_at timestamptz`: `app_role` **không có quyền `DELETE`**. Bảng ghi log (`audit_logs`...) không có `UPDATE`/`DELETE` cho `app_role`.
- Mọi bảng có RLS: `ENABLE` + `FORCE` + `POLICY` (lint migration kiểm cả ba).

## 2. Ngữ cảnh tenant (fail-loud, ADR-004)

`TenantTx` mở transaction rồi chạy (tham số hóa, tương thích pooler chế độ transaction):

```sql
SELECT set_config('app.current_org', $1, true),         -- true = LOCAL
       set_config('app.current_workspaces', $2, true);  -- '{uuid,uuid}' hoặc '{}'
```

`app.current_org()` và `app.current_workspaces()` ném lỗi `TN001` khi thiếu context (code đầy đủ ở ADR-004). Policy dưới đây dùng hai hàm này.

## 3. Vai trò DB

| Role | Thuộc tính | Dùng cho |
|---|---|---|
| `app_role` | LOGIN, NOBYPASSRLS, không owner | API, worker |
| `migration_role` | LOGIN, **BYPASSRLS**, owner schema | Chỉ pipeline migration/backfill; mỗi lần chạy ghi log |
| `support_role` | NOLOGIN; mỗi người hỗ trợ có login riêng `IN ROLE support_role`; NOBYPASSRLS | Debug/hỗ trợ — cần access-session (§3.4) |
| `auth_role` *(đề xuất mới)* | LOGIN, NOBYPASSRLS | Pool kết nối riêng của Better Auth |

Mặc định `REVOKE ALL ... FROM PUBLIC`; mỗi role chỉ nhận đúng quyền bên dưới.

### 3.1 Bảng auth — không RLS, phân quyền bằng GRANT theo cột

Better Auth cần bảng cho người dùng, phiên, tài khoản (chứa hash mật khẩu Argon2id), xác minh, 2FA. Tên bảng: `users`, `sessions`, `accounts`, `verifications`, `two_factors`. *(Tên cuối cùng chốt ở PR6 khi cấu hình Better Auth.)* Cả 5 bảng **là bảng toàn cục: không có `org_id`, không RLS.**

### 3.2 Quyền của `auth_role` — **đề xuất, cần cố vấn duyệt**

Yêu cầu ban đầu: "đọc hẹp `users` và `sessions`, column-level GRANT, không RLS". Đăng nhập vẫn phải **ghi** phiên, nên `auth_role` có thêm quyền ghi giới hạn theo cột. **Không bảng nào có `DELETE`.**

**Cột được `SELECT`:**

| Bảng | Cột |
|---|---|
| `users` | `id, email, email_verified_at, display_name, locale, status, is_platform_operator, two_factor_enabled, failed_login_count, locked_until, deleted_at` |
| `sessions` | Toàn bộ cột (gồm `revoked_at`, `expires_at`, `active_org_id`) |
| `accounts`, `verifications`, `two_factors` | Toàn bộ cột |
| `org_members` | Không có quyền trực tiếp; chỉ qua hàm `app.memberships_for_user(user_id)` (§3.5) |

**Cột được `UPDATE`:**

| Bảng | Cột |
|---|---|
| `users` | `failed_login_count, locked_until, two_factor_enabled, display_name, status, email_verified_at, updated_at` — `status` chỉ được chuyển `pending_password` → `active`, và `email_verified_at` chỉ được đặt **cùng lúc** với lần chuyển đó (trigger chặn mọi trường hợp khác) |
| `sessions` | `revoked_at, updated_at` — **không** có `expires_at`: phiên tối đa 12 giờ, không gia hạn trượt |
| `accounts` | Toàn bộ cột (đổi mật khẩu) |
| `verifications`, `two_factors` | Toàn bộ cột (đánh dấu đã dùng, đổi cấu hình 2FA) |

**`INSERT`:**

| Bảng | `auth_role` |
|---|---|
| `users` | **Không.** Tạo user khi nhận lời mời chạy qua hàm `app.accept_invite` (`SECURITY DEFINER`, §3.7). Tài khoản `platform_operator` đầu tiên tạo bằng script `migration_role` (câu hỏi mở N25) |
| `sessions`, `accounts`, `verifications`, `two_factors` | Có |

**Phiên:** thu hồi bằng `revoked_at` (có dấu vết), **không `DELETE`**. `SessionCleanupJob` chạy bằng `migration_role`, xóa cứng phiên đã `revoked`/hết hạn quá 30 ngày; bản ghi `verifications` hết hạn dọn tương tự. Better Auth mặc định xóa phiên khi đăng xuất, nên PR6 phải cấu hình/ghi đè để đặt `revoked_at` và có test chứng minh (rủi ro).

`auth_role` **không** có quyền trên bảng nghiệp vụ nào khác.

### 3.3 Quyền của `app_role` với `users` — điểm chưa Brief nói

`users` là bảng toàn cục không RLS. Nếu `app_role` có `SELECT` trực tiếp (kể cả theo cột), một tenant đọc được **mọi** người dùng của tenant khác. Đề xuất:

- `app_role` **không có quyền** trên `users`, `sessions`, `accounts`, `verifications`, `two_factors`.
- Hiển thị tên thành viên đi qua view `app.org_users` (owner `migration_role`, `security_barrier`):

```sql
CREATE VIEW app.org_users WITH (security_barrier = true) AS
SELECT m.org_id, u.id AS user_id, u.display_name, u.locale, m.role, m.status
FROM org_members m JOIN users u ON u.id = m.user_id
WHERE m.org_id = app.current_org()
  AND m.deleted_at IS NULL
  AND m.status = 'active'
  AND u.deleted_at IS NULL;
GRANT SELECT ON app.org_users TO app_role;
```
- View chạy bằng quyền owner (`migration_role`, BYPASSRLS) nên **toàn bộ việc cách ly tenant dựa vào mệnh đề `WHERE`**. Thiếu context thì `app.current_org()` ném `TN001` (fail-loud). View không hiện thành viên đã xóa, đang `pending`/`suspended`, hay user đã bị soft delete. Test riêng ở §7 ca 13–15.
- `email` không nằm trong view. Nếu cần hiển thị email trong màn mời/quản lý thành viên: câu hỏi mở (xem QUESTIONS).

### 3.4 `support_role`

- `app.support_access_ok()` (`SECURITY DEFINER`, `SET search_path = pg_catalog, public, pg_temp`; xem §3.6) kiểm `platform_access_logs` có dòng: `db_login = session_user`, `org_id = app.current_org()`, `reason` khác rỗng, `now() < expires_at` (≤ 60 phút, P16).
- Chỉ `SELECT`. Policy `support` trên mỗi bảng thêm điều kiện `app.support_access_ok()`.
- S1 tạo role, hàm và bảng; endpoint `POST /v1/platform/access-sessions` làm ở sprint sau.

### 3.5 Hàm `app.memberships_for_user(user_id uuid)`

`SECURITY DEFINER`, `SET search_path = pg_catalog, public, pg_temp` (§3.6), trả `TABLE(org_id uuid, role text, status text)`, chỉ cho `auth_role` gọi. Dùng khi vừa đăng nhập, chưa có tenant context, để biết người này thuộc công ty nào (câu hỏi mở: công ty nào đang hoạt động).

### 3.6 Quy tắc chung cho mọi hàm `SECURITY DEFINER`

- Khai báo `SET search_path = pg_catalog, public, pg_temp` (`pg_temp` đặt **cuối**, nếu không có thì PostgreSQL tìm bảng tạm trước, kẻ tấn công che được tên bảng thật).
- **Mọi tên bảng/hàm trong thân hàm phải ghi kèm schema** (`public.org_members`, `app.current_org()`), không dựa vào `search_path`.
- Owner là `migration_role`. `REVOKE ALL ON FUNCTION ... FROM PUBLIC`, rồi chỉ `GRANT EXECUTE` cho đúng role cần.
- Ngoài ra: `REVOKE CREATE ON SCHEMA public FROM PUBLIC`.
- Lint migration: hàm `SECURITY DEFINER` thiếu `SET search_path` → CI đỏ.
- *Lệch nhỏ so với chỉ đạo:* chỉ đạo ghi `pg_catalog, public`; em thêm `pg_temp` cuối vì lý do trên. Nếu anh muốn đúng nguyên văn thì em bỏ.

### 3.7 Hàm tra và nhận lời mời

Người nhận lời mời chưa đăng nhập nên chưa có tenant context (§4.3). Hai hàm, cùng quy tắc §3.6, chỉ `auth_role` được `EXECUTE`. *(Chỉ đạo ghi các quy tắc này ở "§3.4"; §3.4 là `support_role`, nên đặt ở đây.)*

```sql
-- Chỉ nhận chuỗi token. KHÔNG nhận org_id, email, user_id từ client.
CREATE FUNCTION app.lookup_invite(p_token text)
RETURNS TABLE (member_id uuid, org_id uuid, invited_email text, role text)
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT m.id, m.org_id, m.invited_email, m.role
  FROM public.org_members m
  WHERE m.invite_token_hash = pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8'))
    AND m.status = 'pending'
    AND m.invite_expires_at > pg_catalog.now()
    AND m.deleted_at IS NULL
$$;

-- Chỉ nhận chuỗi token. Danh tính người nhận lấy từ phiên đã xác thực của server
-- (set_config('app.auth_user_id', ..., true) trong transaction của auth service), không từ client.
CREATE FUNCTION app.accept_invite(p_token text)
RETURNS TABLE (user_id uuid, org_id uuid, role text) ...;  -- thân hàm viết ở PR7, theo các bước dưới
```

**Các bước của `accept_invite`** (thân hàm viết ở PR7):
1. Băm `p_token` bằng SHA-256 trong DB, tra theo `invite_token_hash` với `FOR UPDATE`; điều kiện `status='pending'`, chưa hết hạn, `deleted_at IS NULL`.
2. Lấy `v_auth := app.auth_user_id` (từ phiên server; có thể rỗng).
   - **Có `v_auth`** (đã có tài khoản và đã đăng nhập): **email của phiên đăng nhập phải bằng `invited_email`** (so sánh sau khi chuẩn hóa chữ thường, bỏ khoảng trắng đầu/cuối). Không khớp → lỗi (xem bước 4).
   - **Không có `v_auth`** (chưa đăng nhập), tra `users` theo email của lời mời:
     - chưa có user → hàm **tạo `users`** với `email = invited_email` lấy từ DB, **`status = 'pending_password'`, `email_verified_at = NULL`**, `pending_password_since = now()`;
     - đã có user `status = 'active'` → lỗi (phải đăng nhập rồi mới nhận);
     - đã có user `status = 'pending_password'` → **không từ chối**: gắn thành viên cho user đó, thu hồi magic link cũ chưa dùng, phát magic link mới và đặt lại `pending_password_since = now()` (xem "Người đang `pending_password` được mời vào org khác").
3. Đặt `user_id`, `status='active'`, **`invite_token_hash = NULL`, `invite_expires_at = NULL`** (dùng một lần). Nếu người đó đã là thành viên org → lỗi.
4. **Mọi lỗi trong luồng `accept_invite` trả cùng status + cùng message, kể cả khi user đã có tài khoản nhưng chưa đăng nhập** (token sai, hết hạn, đã dùng, email không khớp, đã có tài khoản mà chưa đăng nhập, đã là thành viên). Message: "Link không hợp lệ hoặc đã hết hạn." Status: một giá trị chung (đề xuất `404 not_found`). Không để dò xem token hay email có tồn tại.

**Đặt mật khẩu sau khi nhận lời mời** (chỉ với user mới, `status = 'pending_password'`):
- `accept` trả **JWT 15 phút**, phạm vi duy nhất là đặt mật khẩu; không dùng được cho API nào khác.
- Đồng thời gửi **magic link** đặt mật khẩu: token riêng, ngẫu nhiên 256 bit, **lưu hash SHA-256 trong `verifications`**, **TTL 24 giờ**, dùng một lần.
- Đặt mật khẩu thành công (qua JWT hoặc magic link): `INSERT accounts`, `UPDATE users.display_name`, **`status = 'active'` và `email_verified_at = now()` cùng lúc** (một transaction). Trước thời điểm đó `email_verified_at` luôn `NULL` và người dùng không đăng nhập được.

**Idempotency của `accept`** (kho idempotency 24 giờ, P9):
- Kho chỉ lưu `user_id`, `org_member_id`, `accepted_at`. **Không lưu JWT.**
- Gửi lại cùng `Idempotency-Key` → trả "Đã chấp nhận, kiểm tra email để đặt mật khẩu" (không cấp JWT mới; người dùng dùng magic link đã gửi).
- Khi replay `accept_invite` với cùng `Idempotency-Key`, response là "Đã chấp nhận, kiểm tra email để đặt mật khẩu" — **khác thông báo lỗi chung**. Chỉ người có cả token lẫn `Idempotency-Key` thấy được. Mức lộ chấp nhận được (token 256-bit). **Cố vấn xác nhận.**

**Người đang `pending_password` được mời vào org khác:**
- Được phép (không reject). Khi `accept` với lời mời mới: gắn thành viên org mới cho user đó, **thu hồi mọi magic link cũ chưa dùng**, phát **magic link mới** (TTL 24 giờ, đặt lại `pending_password_since`).
- Một user `pending_password` có thể có nhiều `org_members` đang chờ; cleanup xử lý tất cả (bên dưới).

**`PendingUserCleanupJob`** (chạy bằng `migration_role`, **không** thêm hàm `SECURITY DEFINER`, xem ADR-004). Với mỗi user `pending_password` có `pending_password_since` quá 24 giờ (**tính từ `pending_password_since`, không phải `created_at`**):
1. Với **mọi** `org_members` của user đó, trả về lời mời chưa nhận: `status = 'pending'`, `user_id = NULL`. Vì `CHECK` bắt buộc dòng `pending` phải có token và hạn, job gán `invite_token_hash` = hash của chuỗi ngẫu nhiên không ai biết và `invite_expires_at = now()`: lời mời **hết hạn**, Owner/Admin phải gửi lại (sinh token mới).
2. Xóa cứng các dòng của user trong `accounts`, `sessions`, `two_factors`, `verifications`, rồi xóa `users`. (Thứ tự bắt buộc vì `org_members.user_id` là `RESTRICT`.)
3. Ghi `audit_logs` (`action = 'pending_user_expired'`, một dòng cho mỗi org liên quan, không PII).

**Token và hash:**
- Token: 32 byte từ CSPRNG, mã hóa base64url (≥ 256 bit). Chỉ xuất hiện trong liên kết email, **không** lưu plaintext trong DB, log, `audit_logs` hay Sentry.
- Hash: **SHA-256**, lưu `bytea` 32 byte. (Đủ vì token ngẫu nhiên 256 bit, không cần hàm băm chậm như mật khẩu.)

**Rate limit (tầng ứng dụng)** — áp cho `/v1/invitations/lookup` và `/v1/invitations/accept`:
- **10 lần/phút/token**, hai endpoint dùng chung một bộ đếm. Khóa đếm là `SHA-256(token)` (không lưu token plaintext trong Redis): `auth:rl:invite:tok:<sha256hex>`.
- **60 lần/phút/IP**, chỉ để chống spam. Đây không phải lớp chống dò token: giới hạn theo token không cản được kẻ thử nhiều token khác nhau; việc đoán token bất khả thi nhờ entropy 256 bit.
- Vượt → `429 rate_limited` kèm `Retry-After`.
- Hai endpoint này **chưa có trong bảng P9**, cần bổ sung như `/v1/teams`.
- Khóa `auth:rl:…` là ngoại lệ so với quy tắc P16 ("khóa cache bắt đầu `org:{orgId}:`") vì chưa biết tenant — ghi vào QUESTIONS (N26).

**Không để token lọt vào log PostgreSQL** (cấu hình trong Terraform module `database`):
- `ALTER ROLE app_role SET log_min_duration_statement = -1;` và **`ALTER ROLE auth_role SET log_min_duration_statement = -1;`** — token đi qua `auth_role` (chạy hàm lời mời), không phải `app_role`, nên cần áp cho cả hai.
- `log_parameter_max_length = 0` và `log_parameter_max_length_on_error = 0` (PostgreSQL ≥ 13): chỉ tắt log theo thời gian chưa đủ, vì tham số vẫn xuất hiện khi câu lệnh gây lỗi hoặc khi `log_statement` được bật.
- Bật `pg_stat_statements` để đo hiệu năng (lưu câu lệnh đã chuẩn hóa, không lưu giá trị tham số).
- Mọi truy vấn mang token **bắt buộc dùng tham số hóa (prepared statement / extended protocol)**, không ghép chuỗi.
- Nhà cung cấp managed có thể không cho đổi các tham số này (cần quyền superuser) → kiểm khi chốt Q2.

## 4. Đặc tả từng bảng

Mẫu policy cho bảng **O**:

```sql
ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <t> FORCE  ROW LEVEL SECURITY;
CREATE POLICY <t>_app ON <t> FOR ALL TO app_role
  USING      (org_id = (SELECT app.current_org()))
  WITH CHECK (org_id = (SELECT app.current_org()));
CREATE POLICY <t>_support ON <t> FOR SELECT TO support_role
  USING (org_id = (SELECT app.current_org()) AND (SELECT app.support_access_ok()));
```

Với bảng **O+W**, thêm `AND workspace_id = ANY ((SELECT app.current_workspaces())::uuid[])` vào `USING` **và** `WITH CHECK`. `::uuid[]` là bắt buộc: thiếu thì PostgreSQL hiểu là dạng truy vấn con của `ANY` và so `uuid` với từng phần tử `uuid[]`, lỗi `operator does not exist: uuid = uuid[]`. Không "đơn giản hoá" bỏ phép ép kiểu. Role không có policy khớp (kể cả `auth_role`) bị từ chối toàn bộ vì đã `FORCE`.

Dưới đây liệt kê phần **khác nhau** của từng bảng; mọi bảng O dùng đúng mẫu trên (thay `<t>`), trừ khi ghi rõ.

### 4.1 `organizations` — RLS theo chính `id`

| | |
|---|---|
| PK / tenant key | `id` (UUIDv7); **chính `id` là tenant key**, không có cột `org_id` |
| Workspace key | — |
| Cột chính | `slug`, `name`, `deleted_at`, `created_at`, `updated_at` |
| Index | `UNIQUE (slug)` |

```sql
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE  ROW LEVEL SECURITY;
CREATE POLICY organizations_app ON organizations FOR ALL TO app_role
  USING      (id = (SELECT app.current_org()))
  WITH CHECK (id = (SELECT app.current_org()));
CREATE POLICY organizations_support ON organizations FOR SELECT TO support_role
  USING (id = (SELECT app.current_org()) AND (SELECT app.support_access_ok()));
```

Tạo công ty mới: app sinh `id` trước, mở `TenantTx` với chính `id` đó rồi mới `INSERT`. Quyền tạo org (ai được tạo) thuộc quy tắc nghiệp vụ, không phải RLS — câu hỏi mở ở QUESTIONS.

### 4.2 `users` — toàn cục, không RLS

| | |
|---|---|
| PK / tenant key | `id` (UUIDv7); **không có** `org_id` |
| Workspace key | — |
| RLS | **—** (theo Brief P8); kiểm soát bằng GRANT (§3.2–3.3) |
| Cột chính | `email` (lưu dạng chuẩn hóa chữ thường), `display_name`, `locale`, `status` (`pending_password` · `active`), `pending_password_since`, `email_verified_at`, `is_platform_operator`, `two_factor_enabled`, `failed_login_count`, `locked_until`, `deleted_at` |
| Ràng buộc | `pending_password_since` **nullable**: đặt `now()` khi `status = 'pending_password'`, **đặt lại** mỗi lần phát magic link mới, `NULL` khi `status = 'active'`; `CHECK ((status = 'pending_password') = (pending_password_since IS NOT NULL))` |
| Index | `UNIQUE (email)` (kể cả bản ghi đã soft delete, để không đăng ký lại cùng email) |

### 4.3 `org_members` — O (kết nối user ↔ org, kiêm lời mời)

| | |
|---|---|
| PK / tenant key | `id` / `org_id` |
| Workspace key | — |
| Cột chính | `user_id` (**nullable** khi `status='pending'`), `invited_email`, `role` (CHECK 7 vai trò), `status` (`pending` · `active` · `suspended`), `invite_token_hash` (**`bytea`, SHA-256, đúng 32 byte**), `invite_expires_at`, `invited_by`, `deleted_at` |
| Ràng buộc | `UNIQUE (org_id, id)`; `UNIQUE (org_id, user_id)` (không phải `partial` để làm đích khóa ngoại; `NULL` nhiều dòng được phép); `CHECK (status <> 'pending' OR (invite_token_hash IS NOT NULL AND invite_expires_at IS NOT NULL AND invited_email IS NOT NULL))`; `CHECK (invite_token_hash IS NULL OR octet_length(invite_token_hash) = 32)` |
| FK | `(user_id) → users(id)` (bảng toàn cục); `(org_id, invited_by) → org_members(org_id, user_id)` |
| Index | `(org_id, user_id)` (chính là unique ở trên); `UNIQUE (invite_token_hash) WHERE invite_token_hash IS NOT NULL`; `UNIQUE (org_id, invited_email) WHERE status = 'pending'` |
| RLS | O, mẫu chuẩn |

Chỉ lưu **hash SHA-256** của token mời, không lưu plaintext (chi tiết §3.7). Hạn 7 ngày (đã chốt). Lời mời dùng cột trên bảng này thay vì `invitations` riêng (anh chỉ đạo; cần cố vấn duyệt). Hai vấn đề của hướng này, đã ghi vào QUESTIONS:
- Người nhận lời mời chưa đăng nhập nên **chưa có tenant context**: tra cứu theo `invite_token_hash` không đi qua RLS được. Cần hàm `SECURITY DEFINER` hẹp cho `auth_role`: `app.lookup_invite(p_token text)` và `app.accept_invite(p_token text)` (§3.7).
- Một dòng `org_members` có `user_id IS NULL` không thể là đích khóa ngoại cho `workspace_members` / `team_members` — đây là hành vi mong muốn (người chưa chấp nhận chưa vào workspace).

### 4.4 `workspaces` — O

| | |
|---|---|
| PK / tenant key | `id` / `org_id` |
| Workspace key | `id` chính nó là workspace key của các bảng con |
| Cột chính | `slug`, `name`, `template` (`b2b_sales` · `b2c_order` · `service`), `timezone`, `default_max_concurrent` (mặc định 5, bổ sung v0.4), `deleted_at` |
| Ràng buộc | `UNIQUE (org_id, id)` |
| Index | `UNIQUE (org_id, slug)` |
| RLS | O, mẫu chuẩn. *(Cố ý chỉ O, không O+W: người dùng cần thấy danh sách workspace để chọn; xem câu hỏi mở N-Workspace trong QUESTIONS.)* |

### 4.5 `workspace_members` — O

| | |
|---|---|
| PK / tenant key / workspace key | `id` / `org_id` / `workspace_id` |
| Cột chính | `user_id`, `workspace_role` *(nếu khác vai trò org; câu hỏi mở)*, `deleted_at` |
| Ràng buộc | `UNIQUE (org_id, id)`; `UNIQUE (org_id, workspace_id, user_id)` |
| FK kép | `(org_id, workspace_id) → workspaces(org_id, id)`; `(org_id, user_id) → org_members(org_id, user_id)` — bảo đảm người trong workspace phải là thành viên org |
| Index | `(org_id, user_id)`; `(org_id, workspace_id)` |
| RLS | O, mẫu chuẩn |

### 4.6 `teams` — O

| | |
|---|---|
| PK / tenant key / workspace key | `id` / `org_id` / `workspace_id` |
| Cột chính | `name`, `slug`, `deleted_at` |
| Ràng buộc | `UNIQUE (org_id, id)`; `UNIQUE (org_id, workspace_id, slug)` *(P8 chỉ ghi chung `(org_id, slug)`; đề xuất thêm `workspace_id`)* |
| FK kép | `(org_id, workspace_id) → workspaces(org_id, id)` |
| RLS | O, mẫu chuẩn |

> **Ghi chú (03/10/2026, chốt cùng N14):** một team có thể xuyên workspace, nên `teams.workspace_id` có thể `NULL` (team cấp công ty). Nếu cho `NULL`: khóa ngoại kép `(org_id, workspace_id)` chỉ kiểm khi khác `NULL`; `UNIQUE (org_id, workspace_id, slug)` coi các `NULL` là khác nhau (trùng slug cấp công ty không bị chặn), nên cần `NULLS NOT DISTINCT` (PostgreSQL ≥ 15) hoặc index riêng; và RLS O+W chưa áp cho team cấp công ty. **Kiểm tra và chốt ở PR 3d**, chưa đổi bảng ở đây.

### 4.7 `team_members` — O

| | |
|---|---|
| PK / tenant key | `id` / `org_id` (không có `workspace_id` riêng; lấy qua `teams`) |
| Cột chính | `team_id`, `user_id`, `deleted_at` |
| Ràng buộc | `UNIQUE (org_id, id)`; `UNIQUE (org_id, team_id, user_id)` |
| FK kép | `(org_id, team_id) → teams(org_id, id)`; `(org_id, user_id) → org_members(org_id, user_id)` |
| Index | `(org_id, user_id)`; `(org_id, team_id)` |
| RLS | O, mẫu chuẩn |

### 4.8 `api_keys` — O

| | |
|---|---|
| PK / tenant key / workspace key | `id` / `org_id` / `workspace_id` (nullable: key cấp công ty) |
| Cột chính | `name`, `key_prefix`, `key_hash` (**chỉ hash**), `scopes text[]`, `last_used_at`, `revoked_at`, `expires_at`, `deleted_at` |
| Ràng buộc | `UNIQUE (org_id, id)` |
| Index | `UNIQUE (key_prefix)` (toàn cục — P8) |
| FK kép | `(org_id, workspace_id) → workspaces(org_id, id)` khi `workspace_id` không null |
| RLS | O, mẫu chuẩn |

Khi một request đến với API key, **chưa có tenant context** để tra `key_prefix` qua RLS. Public API là đợt 3, nhưng bảng đã có ở S1 → ghi vào QUESTIONS cách tra khóa trước khi có tenant (cần hàm hẹp tương tự lời mời).

### 4.9 `audit_logs`, `platform_access_logs` — O, partition tháng

| | `audit_logs` | `platform_access_logs` |
|---|---|---|
| PK | `(id, created_at)` | `(id, created_at)` |
| Tenant key | `org_id` | `org_id` |
| Cột chính | `actor_user_id`, `action`, `target_type`, `target_id`, `detail jsonb` (không PII) | `operator_user_id`, `db_login`, `reason` (NOT NULL), `expires_at` |
| Index | `(org_id, created_at)` | `(org_id, created_at)` |
| Partition | `PARTITION BY RANGE (created_at)`, tháng | như bên trái |

`app_role`: `SELECT, INSERT` (không `UPDATE/DELETE`).
Policy dùng mẫu O. Với `platform_access_logs`, `app_role` **không** có quyền `INSERT` trực tiếp ngoài hàm cấp access-session (làm ở sprint sau), để không tự cấp quyền cho mình.

**Partition và RLS — xem §6.**

### 4.10 `feature_flags_global` (—) và `feature_flags_overrides` (O)

| | `feature_flags_global` | `feature_flags_overrides` |
|---|---|---|
| Tenant key | không có (toàn cục) | `org_id` |
| Workspace key | — | `workspace_id` (nullable) |
| Cột chính | `key` (PK), `default_enabled`, `owner`, `remove_by` | `key`, `enabled` |
| Index | PK `key` | `UNIQUE (org_id, key, COALESCE(workspace_id, '00000000-0000-0000-0000-000000000000'))` |
| FK kép | — | `(org_id, workspace_id) → workspaces(org_id, id)` |
| RLS | **—**; `app_role` chỉ `SELECT` | O, mẫu chuẩn |

Đọc cờ: tìm `overrides` theo workspace trước, rồi `overrides` theo org, rồi `global` (bảng cấu hình 2 lớp, P8).

### 4.11 `agent_settings` — O *(bổ sung v0.4)*

| | |
|---|---|
| PK / tenant key | `id` / `org_id` |
| Cột chính | `user_id`, `max_concurrent_conversations` (nullable → dùng `workspaces.default_max_concurrent`) |
| Ràng buộc | `UNIQUE (org_id, id)`; `UNIQUE (org_id, user_id)` |
| FK kép | `(org_id, user_id) → org_members(org_id, user_id)` |
| RLS | O, mẫu chuẩn |

### 4.12 `conversations` — **khung S1**, O+W (S2 mở rộng theo kiểu expand)

| | |
|---|---|
| PK / tenant key / workspace key | `id` / `org_id` / `workspace_id` |
| Cột S1 (đã chốt) | `id, org_id, workspace_id, state, version, created_at, updated_at` |
| Ràng buộc | `UNIQUE (org_id, id)`; `CHECK (state IN ('BOT_ACTIVE','HUMAN_WAITING_Q','HUMAN_ACTIVE','PENDING_CUSTOMER','CLOSED'))`; `version int NOT NULL DEFAULT 0` |
| FK kép | `(org_id, workspace_id) → workspaces(org_id, id)` |
| Index S1 | `(org_id, workspace_id, state)`. Index đầy đủ P8 (`last_message_at DESC`, `assigned_user_id`) thêm ở S2 khi có cột. |
| RLS | **O+W** |

```sql
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations FORCE  ROW LEVEL SECURITY;

-- `::uuid[]` bắt buộc: nếu thiếu, PostgreSQL hiểu là subquery của ANY
-- và so sánh uuid với từng phần tử uuid[] → lỗi "operator does not exist".
-- Không "đơn giản hoá" bỏ ép kiểu.
CREATE POLICY conversations_app ON conversations FOR ALL TO app_role
  USING (
        org_id = (SELECT app.current_org())
    AND workspace_id = ANY ((SELECT app.current_workspaces())::uuid[])
  )
  WITH CHECK (
        org_id = (SELECT app.current_org())
    AND workspace_id = ANY ((SELECT app.current_workspaces())::uuid[])
  );

CREATE POLICY conversations_support ON conversations FOR SELECT TO support_role
  USING (
        org_id = (SELECT app.current_org())
    AND workspace_id = ANY ((SELECT app.current_workspaces())::uuid[])
    AND (SELECT app.support_access_ok())
  );
```

Ghi chú:
- Ở S1, cột `state` chưa có `ConversationStateMachine` (S2). Quy tắc "cấm `UPDATE conversations SET state` trực tiếp" (CLAUDE.md quy tắc 4) áp dụng từ S2; S1 chỉ tạo bảng khung và policy.
- Danh sách workspace trong phiên (`app.current_workspaces`) lấy từ `workspace_members` lúc tạo `RequestContext`.

## 5. Ma trận GRANT tóm tắt

| Bảng | `app_role` | `support_role` | `auth_role` |
|---|---|---|---|
| `organizations`, `workspaces`, `workspace_members`, `teams`, `team_members`, `api_keys`, `agent_settings`, `feature_flags_overrides`, `conversations` | SELECT, INSERT, UPDATE | SELECT | — |
| `org_members` | SELECT, INSERT, UPDATE | SELECT | — (chỉ qua hàm §3.5) |
| `audit_logs` | SELECT, INSERT | SELECT | — |
| `platform_access_logs` | SELECT | SELECT | — |
| `feature_flags_global` | SELECT | SELECT | — |
| `users`, `sessions`, `accounts`, `verifications`, `two_factors` | — (xem §3.3) | — | theo §3.2 |
| view `app.org_users` | SELECT | — | — |

`DELETE`: không role nào (soft delete + `TenantPurgeJob` chạy bằng `migration_role`).

## 6. Partition và RLS

**Sự thật cần ghi rõ:** RLS khai báo trên bảng cha **không tự động áp lên partition con** khi truy vấn đi thẳng vào partition con. Khi truy vấn qua bảng cha, PostgreSQL dùng policy của bảng cha. Khi truy vấn thẳng vào partition con, dùng policy (và quyền) của partition con.

Ảnh hưởng ở S1: `audit_logs` và `platform_access_logs` (partition tháng).

**Đề xuất (cả hai lớp, kết hợp):**
1. **Chặn đường truy cập thẳng:** `app_role`, `support_role`, `auth_role` **không có quyền nào** trên các partition con. Quyền (`GRANT`) chỉ cấp trên bảng cha; truy vấn qua bảng cha kiểm quyền ở bảng cha.
2. **Phòng thủ chiều sâu:** mỗi partition con cũng `ENABLE` + `FORCE` + có policy giống bảng cha. Phát hiện được trường hợp ai đó lỡ cấp quyền trên partition.
3. `PartitionMaintenanceJob` (tự viết ở S1; tạo trước 3 tháng, chạy hằng ngày, lỗi → cảnh báo DevOps) thực hiện **cả hai bước** ngay khi tạo partition; không tạo partition rồi "thêm quyền sau".
4. Partition `DEFAULT` cũng phải qua cùng bước; không để bản ghi rơi vào partition không có policy.
5. Test (§7 ca 9a–9d): quét `pg_inherits` + `relrowsecurity` + `relforcerowsecurity` + `pg_policies` cho mọi partition (kể cả `DEFAULT`); truy vấn thẳng partition con bằng `app_role` phải bị từ chối; chạy job tạo partition tháng kế rồi quét lại; mô phỏng cấp nhầm quyền trên một partition con để chứng minh RLS vẫn chặn.

Phương án thay thế đã xem xét: chỉ dựa vào bảng cha. **Không đề xuất**, vì một lần cấp quyền nhầm sẽ hở dữ liệu chéo tenant mà không báo lỗi.

## 7. Test chứng minh (chạy mỗi PR; đỏ → chặn merge)

| # | Ca | Kỳ vọng |
|---|---|---|
| 1 | `app_role` `SELECT` mọi bảng O / O+W khi chưa có `TenantTx` | Lỗi `TN001` (không trả 0 dòng) |
| 2 | Context org A, `INSERT` dòng có `org_id = B` | `42501`; API trả 404 |
| 3 | Context org A, `workspace_members` trỏ workspace của org B | Khóa ngoại kép từ chối |
| 4 | Context org A, `SELECT` `org_members` | Chỉ thấy dòng org A |
| 5 | `current_workspaces = {A}`, `SELECT`/`UPDATE` `conversations` của workspace B cùng org | 0 dòng / 404 |
| 6 | `support_role` có context nhưng chưa có access-session | 0 dòng |
| 7 | `app_role` `SELECT` `users`, `sessions`, `accounts` | `permission denied` |
| 8 | `auth_role` `SELECT`/`UPDATE` cột ngoài danh sách §3.2; `SELECT` bảng nghiệp vụ | `permission denied` |
| 9a | Quét `pg_inherits` + `pg_class.relrowsecurity` + `relforcerowsecurity` + `pg_policies` cho **mọi** partition của `audit_logs`, `platform_access_logs` (kể cả partition `DEFAULT`) | Mọi partition có ENABLE + FORCE + policy giống bảng cha |
| 9b | `app_role` truy vấn thẳng một partition con | `permission denied` |
| 9c | Chạy `PartitionMaintenanceJob` tạo partition tháng kế, rồi quét lại như 9a | Partition mới cũng đạt 9a và 9b |
| 9d | Trong transaction thử (rollback sau test): `migration_role` cấp `SELECT` cho `app_role` trên một partition con (mô phỏng sai cấu hình). Rồi `app_role` truy vấn partition đó (i) không có `TenantTx`, (ii) có context org A | (i) lỗi `TN001`; (ii) chỉ thấy dòng org A, không thấy org B → RLS của partition con vẫn chặn (defense-in-depth) |
| 10 | Lint migration: `CREATE TABLE` có `org_id` mà thiếu ENABLE / FORCE / POLICY | CI đỏ |
| 11 | `app_role` `DELETE` bất kỳ bảng | `permission denied` |
| 12 | Seed chạy với `APP_ENV=production` | Script thoát lỗi, không ghi dòng nào |
| 13 | View `app.org_users`: context org A; có thành viên org B | Chỉ thấy user org A, không thấy user org B |
| 14 | View `app.org_users`: user bị soft delete (`users.deleted_at`), hoặc thành viên bị soft delete / `pending` / `suspended` | Không hiện trong view |
| 15 | View `app.org_users` khi chưa có `TenantTx` | Lỗi `TN001` |
| 16 | `accept_invite`: email phiên khác `invited_email`; token sai; token hết hạn; token đã dùng; user đã có tài khoản nhưng chưa đăng nhập | Cùng một thông báo "Link không hợp lệ hoặc đã hết hạn"; không khác biệt nội dung hay mã trạng thái |
| 17 | Sau khi tạo lời mời: quét `org_members`, log ứng dụng, `audit_logs`, log PostgreSQL | Không có token plaintext; `invite_token_hash` đúng 32 byte |
| 18 | Gọi lookup/accept lần thứ 11 trong 1 phút với cùng một token; lần thứ 61 từ cùng một IP | `429 rate_limited` + `Retry-After` |
| 19 | `auth_role` `INSERT` vào `users`, `DELETE` bất kỳ bảng auth, `UPDATE sessions.expires_at` | `permission denied` |
| 20 | `PendingUserCleanupJob`: user `pending_password` quá 24 giờ | `org_members` trở về `pending` + hết hạn, token cũ không dùng được, user và dữ liệu auth của user bị xóa, có `audit_logs`; user quá hạn chưa tới 24 giờ không bị đụng |
| 21 | JWT 15 phút từ `accept` gọi API ngoài việc đặt mật khẩu; magic link dùng lần hai; magic link quá 24 giờ | Từ chối cả ba |
| 22 | `auth_role` đổi `users.status` từ `active` về `pending_password`, hoặc sang giá trị khác | Bị trigger chặn |
| 23 | `accept_invite` tạo user mới; rồi đặt mật khẩu thành công | Sau accept: `status = 'pending_password'`, `email_verified_at IS NULL`, không đăng nhập được. Sau đặt mật khẩu: `status = 'active'`, `email_verified_at` có giá trị, hai thay đổi cùng một transaction; đặt riêng một trong hai → trigger chặn |
| 24 | Gửi lại `accept` với cùng `Idempotency-Key` | Trả "Đã chấp nhận, kiểm tra email để đặt mật khẩu"; không có JWT trong phản hồi; quét kho idempotency chỉ thấy `user_id`, `org_member_id`, `accepted_at` |
| 25 | User `pending_password` được mời vào org thứ hai và `accept` | Không bị từ chối; magic link cũ không còn dùng được, magic link mới hoạt động; `pending_password_since` đặt lại; cleanup sau 24 giờ trả **cả hai** `org_members` về lời mời hết hạn |
| 26 | User `pending_password` (link đầu tạo lúc T) nhận lời mời thứ hai và magic link mới lúc T + 23 giờ; chạy `PendingUserCleanupJob` lúc T + 25 giờ | User **không** bị dọn (`pending_password_since` đã đặt lại lúc T + 23 giờ); chạy lại job lúc T + 48 giờ + 1 phút → bị dọn, cả hai `org_members` trở về lời mời hết hạn |

## 8. Ngoài phạm vi tài liệu này

`channel_accounts`, `channel_policies` (M02 một phần), `inbound_events`, `outbox_events` và các bảng M03 trở đi; spec cho các bảng đó viết ở PR tương ứng.
