# ADR-002 — ORM: Drizzle

| | |
|---|---|
| Trạng thái | Chấp nhận (Q4, cố vấn đồng ý) · đã áp dụng trong repo (`packages/db`) |
| Ngày | 03/10/2026 |
| Nguồn | Brief P16, P22-Q4 |

## Bối cảnh
Mọi truy vấn phải chạy trong transaction có `SET LOCAL app.current_org` / `app.current_workspaces` (P16). Policy RLS, partition, hàm SQL và khóa ngoại kép phải viết tường minh và review được.

## Quyết định
- Drizzle ORM + driver `pg`; schema TypeScript ở `packages/db/schema`.
- **Migration viết bằng SQL tay.** Không dùng lệnh diff tự sinh để tạo policy/hàm/partition. Tên file `YYYYMMDDHHmm_<verb>_<object>.sql`; mỗi file có khối `-- rollback:` mô tả migration bù (forward-only, P5).
- Mọi truy vấn đi qua `TenantTx`. Lint chặn import client DB thô ngoài `packages/db`.
- `uuid_v7()` ở SQL chỉ là default dự phòng; id chính thức sinh ở `packages/domain/id`.

## Lý do
- SQL tường minh: thấy rõ câu lệnh thật, kiểm tra được `SET LOCAL` nằm trong cùng transaction với truy vấn.
- Không có lớp "phép màu" che mất ngữ cảnh tenant; test fail-loud (ADR-004) chứng minh được.
- Policy RLS, khóa ngoại kép và `CONCURRENTLY` không phụ thuộc vào khả năng của ORM.

## Đánh đổi so với Prisma
| | Prisma | Drizzle (chọn) |
|---|---|---|
| Kiểm soát transaction + `SET LOCAL` | Gián tiếp (client extension, `$transaction`); khó đảm bảo cùng kết nối | Trực tiếp qua `db.transaction()` |
| Policy RLS, hàm, partition | Không quản lý; phải viết SQL ngoài | Cũng viết SQL tay, nhưng là chủ ý, không nửa vời |
| Sinh migration tự động | Mạnh | Có, nhưng không dùng cho phần RLS |
| Hệ sinh thái, tài liệu, người biết dùng | Lớn hơn | Nhỏ hơn |
| Công sức | Ít hơn | Nhiều hơn (migration tay, review kỹ hơn) |

## Hệ quả
- Review migration bắt buộc có Tech Lead (CODEOWNERS).
- Phải có test chứng minh schema Drizzle khớp DB thật (chống lệch giữa schema TS và migration SQL).
