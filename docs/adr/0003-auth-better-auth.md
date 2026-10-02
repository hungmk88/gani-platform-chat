# ADR-0003 — Xác thực: Better Auth (giới hạn phạm vi)

- Trạng thái: Chấp nhận có điều kiện (Q5) · 03/10/2026
- Nguồn: Brief P22-Q5, P17

## Quyết định
Better Auth **chỉ** lo đăng nhập, phiên và 2FA. Tenancy và RBAC tự viết theo P8 (module `tenancy`).

| Hạng mục | Cấu hình |
|---|---|
| Plugin `organization` | **Không dùng** |
| Băm mật khẩu | Argon2id (ghi đè `password.hash/verify`) |
| ID | UUIDv7 (`advanced.database.generateId`) |
| Kết nối DB | Pool riêng, đăng nhập bằng `auth_role` (xem đặc tả RLS §4) |
| Phiên | Hết hạn 12 giờ, không gia hạn trượt quá mốc 12 giờ |
| Cookie | `HttpOnly`, `Secure`, `SameSite=Lax`, tiền tố `__Host-` |
| Tạo lại phiên | Sau đăng nhập, sau bật/tắt 2FA. Khi đổi vai trò: thu hồi **mọi** phiên của người bị đổi |
| 2FA | TOTP + mã dự phòng; bắt buộc với Owner/Admin/platform_operator (chưa bật thì không vào được API quản trị) |
| CSRF | Token cho mọi request ghi dữ liệu qua cookie phiên |
| Mật khẩu | ≥ 12 ký tự, có cả chữ lẫn số |
| Khóa tài khoản | Sai 5 lần → khóa 30 phút; cộng thêm rate limit theo IP ở `/auth/*` |
| Lời mời | Hết hạn sau 7 ngày, gửi qua adapter email (dev dùng Mailpit; nhà cung cấp thật chốt ở S3) |

## Hệ quả
- Phải kiểm lại từng lần nâng phiên bản Better Auth, vì có ghi đè hàm băm và hàm sinh id. Đã có test khóa hai điểm này.
- Khóa tài khoản theo user có thể bị kẻ xấu lợi dụng để khóa người khác. Rate limit theo IP giảm được rủi ro này nhưng không loại bỏ hẳn.
