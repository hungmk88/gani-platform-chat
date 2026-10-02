# packages/db — Schema & RLS

Đọc trước khi sửa. Sai ở đây gây rò dữ liệu chéo tenant (sự cố mức 1).

## Quy tắc

- Mọi bảng nghiệp vụ có `org_id`. Bảng nhạy cảm có thêm `workspace_id`.
- Khóa ngoại giữa bảng nghiệp vụ luôn là cặp `(org_id, x_id)` →
  bảng cha phải có `UNIQUE(org_id, id)`.
- Bật **ENABLE + FORCE ROW LEVEL SECURITY** + `CREATE POLICY` cho mọi bảng.
- Migration theo mẫu expand → migrate → contract (≥ 2 release).
- Index nặng chạy `CREATE INDEX CONCURRENTLY`, không khóa `messages`.

## 4 role DB (không được dùng lẫn)

| Role | RLS | Thiếu tenant | Dùng cho |
|---|---|---|---|
| `app_role` | Bị lọc, không owner, không BYPASSRLS | **Báo lỗi** | API, worker, traffic thật |
| `migration_role` | BYPASSRLS | — | Chỉ pipeline migration |
| `support_role` | Bị lọc như app_role | Báo lỗi | Debug, cần `access-session` có lý do |
| `auth_role` | Bị lọc, không có policy nào trên bảng nghiệp vụ nên bị từ chối toàn bộ | — | Pool riêng của Better Auth; chỉ GRANT theo cột trên bảng auth (spec §3.2) |

## Kiểm chứng bắt buộc

- `tenant-isolation.spec`: dùng `app_role` không set tenant → phải báo lỗi.
- `workspace-isolation.spec`: Sales workspace A không đọc được hội thoại workspace B.
- Lint migration: mọi `CREATE TABLE` mới phải có `ENABLE ROW LEVEL SECURITY` + `FORCE`.
  CI báo đỏ nếu thiếu; GitHub Free không enforce branch protection nên không chặn được merge (N38), anh kiểm tay.

## Cấm

- Không dùng UUIDv4. Chỉ UUIDv7.
- Không `ON DELETE CASCADE` từ `organizations` — dùng soft delete + `TenantPurgeJob`.
- Không thêm bảng mới mà không cập nhật `tenant-isolation.spec`.
