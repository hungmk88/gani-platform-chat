# ADR-0002 — ORM: Drizzle

- Trạng thái: Chấp nhận (Q4, cố vấn đồng ý) · 03/10/2026
- Nguồn: Brief P22-Q4, P16

## Bối cảnh
Mọi truy vấn phải chạy trong transaction có `SET LOCAL` tenant (P16). Policy RLS, partition và hàm SQL phải viết tường minh, có review.

## Quyết định
- Dùng Drizzle ORM với driver `pg`. Schema TypeScript nằm ở `packages/db/schema`.
- **Migration viết bằng SQL tay**, không dựa vào lệnh diff tự sinh để tạo policy. Tên file theo mẫu `YYYYMMDDHHmm_<verb>_<object>.sql`. Mỗi file có khối `-- rollback:` mô tả migration bù (forward-only, P5).
- Chỉ dùng `db.transaction()` qua `TenantTx`. Lint chặn import client DB thô bên ngoài `packages/db`.
- Hàm `app.uuid_v7()` chỉ làm default dự phòng; id chính thức sinh ở `packages/domain/id`.

## Hệ quả
- Không có "phép màu" ORM che mất `SET LOCAL`, nên test fail-loud kiểm chứng được.
- Đổi lại, phải viết SQL tay nhiều hơn, và việc review migration bắt buộc có Tech Lead (CODEOWNERS).
