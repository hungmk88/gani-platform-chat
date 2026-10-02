# ADR-003 — Xác thực: Better Auth, giới hạn phạm vi

| | |
|---|---|
| Trạng thái | Chấp nhận có điều kiện (Q5) · chờ review PR0 và cố vấn duyệt `auth_role` |
| Ngày | 03/10/2026 |
| Nguồn | Brief P17, P22-Q5; Phụ lục v2.1 |

## Quyết định
Better Auth **chỉ** lo đăng nhập, phiên và 2FA. **Không dùng plugin `organization`.** Tenancy và RBAC tự viết theo P8 (module `tenancy`).

## Cấu hình bắt buộc
| Hạng mục | Giá trị |
|---|---|
| Băm mật khẩu | Argon2id (ghi đè hàm băm/kiểm tra mặc định) |
| ID | UUIDv7 (ghi đè hàm sinh id) |
| Phiên | Hết hạn 12 giờ |
| Tạo lại phiên | Sau đăng nhập · sau đổi vai trò · sau bật/tắt 2FA |
| 2FA | TOTP; bắt buộc Owner/Admin/platform_operator (P17) |
| CSRF | Token cho mọi request ghi dữ liệu dùng cookie phiên |
| Cookie | `HttpOnly`, `Secure`, `SameSite=Lax` |
| Mật khẩu | ≥ 12 ký tự, có chữ và số |
| Khóa tài khoản | Sai 5 lần → khóa 30 phút |
| Lời mời | Hết hạn 7 ngày |
| Kết nối DB | Pool riêng, đăng nhập bằng `auth_role` (xem `docs/specs/rls-spec-M01.md` §3) |

## Lý do
- Có sẵn phiên, 2FA, chống brute-force; không tự viết lại phần dễ sai về bảo mật.
- Không dùng `organization`: bảng của plugin trùng và lệch với `org_members` / `workspaces` / `workspace_members` đã thiết kế theo P8 (khóa ngoại kép, RLS, UUIDv7).

## Đánh đổi / rủi ro
- Hai điểm ghi đè (băm mật khẩu, sinh id) có thể hỏng khi nâng phiên bản → cần test khóa hai điểm này và rà lại mỗi lần nâng.
- Khóa tài khoản theo user có thể bị lợi dụng để khóa người khác. Rate limit theo IP giảm nhưng không loại bỏ.
- Better Auth chạy trước khi có tenant context → cần `auth_role` (lệch Brief P16 có chủ đích; xem spec §3).

## Xác minh email và trạng thái `pending_password`
- Khi `accept_invite` tạo user mới: `status = 'pending_password'`, **`email_verified_at = NULL`**; chưa đăng nhập được.
- Khi đặt mật khẩu thành công (JWT 15 phút hoặc magic link 24 giờ): `email_verified_at = now()` và `status = 'active'` **cùng một transaction**.
- Magic link: token riêng 256 bit, lưu hash SHA-256 trong `verifications`, dùng một lần.
- Chi tiết: `docs/specs/rls-spec-M01.md` §3.7.

## Phiên: thu hồi, không xóa
- Ghi đè hành vi mặc định của Better Auth (xóa phiên khi đăng xuất): đặt `revoked_at`, **không `DELETE`** (`auth_role` không có quyền `DELETE`).
- `SessionCleanupJob` chạy bằng `migration_role`, **xóa cứng** phiên đã `revoked` hoặc hết hạn quá **30 ngày**.
- PR6 phải có test chứng minh đăng xuất đặt `revoked_at` và không xóa dòng.

## Điểm mở (đã ghi vào `QUESTIONS.md`)
- "Tạo lại phiên khi đổi vai trò": thu hồi mọi phiên của người bị đổi hay chỉ phiên hiện tại? Tài liệu này **chưa chốt**.
- Người thuộc nhiều công ty: chọn công ty đang hoạt động bằng cách nào.
