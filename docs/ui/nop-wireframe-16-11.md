# Bảng kiểm nộp wireframe Đợt 1 — nộp 16/11/2026, duyệt 23/11/2026

Đối chiếu từng dòng 0–9 của `phu-luc-C-v3.md` với prototype HTML ở `prototype/dot1/` (main ngày 20/10/2026).
Mở `prototype/dot1/index.html` bằng trình duyệt; thanh đen trên cùng mỗi màn đổi **trạng thái**, **vai trò** (8 vai trò),
**khung** (biến thể khung app) và đếm click. Hình thức nộp: prototype bấm được, "tương đương Figma" theo Phụ lục C.

## 1. Mười hạng mục

| Dòng | Màn | Mở | Trạng thái phải vẽ (Phụ lục C) | Có trên prototype | Còn chờ |
|---|---|---|---|---|---|
| 0 | Khung app | `inbox.html` + ô "Khung" · `system.html` | Menu 8 vai trò; đang đổi workspace; mất kết nối realtime | Đủ; thêm tự chuyển Offline > 5 phút (Q-U20-4), Bận > 30 phút (Q-U20-5), dải phiên platform, 4 trang hệ thống | Spec M8 bản cuối 30/10 |
| 1 | Hộp thư (#6) | `inbox.html` | Trống theo vai trò, lỗi, AI tắt, tin gửi lỗi, "Đã được [tên] nhận", SLA tạm dừng (ngoài giờ / chờ khách), mẫu có biến chưa điền | Đủ | Q7 (giờ làm việc), O7 |
| 2 | Hồ sơ khách (#8) + Gộp (#9) | `customer.html` | SĐT che, trường nhạy cảm Che (Marketing/Viewer), đề xuất gộp, cờ "chỉ người phục vụ" | Đủ | M8 (J1, J4) |
| 3 | Pipeline (#12) + Chi tiết lead (#13) | `leads.html` | Trống, cột nhiều thẻ, đang lưu; drawer chi tiết | Đủ; drawer có đang tải, lỗi | O1 (tên 6 bước, lý do Thua), U25 câu 3 |
| 4 | Trình dựng bot (#18) + Danh sách flow (#17) | `bots.html` | Lỗi cấu hình, chặn xuất bản khi thiếu câu chào; dạng form, không canvas | Đủ | M8 + Q7 (D4) |
| 5 | Đăng nhập (#1) | `login.html` | Đang tải nút, lỗi chung; khóa 30 phút sau 5 lần sai dùng cùng câu lỗi chung, vì API không phân biệt (CEO duyệt 21/10) | Đủ | — |
| 6 | Xác thực 2 lớp (#2) | `twofa.html` | Đang tải, mã sai, khóa tạm, cài 2FA bắt buộc, 10 mã dự phòng | Đủ; thêm cài lại sau khi Admin đặt lại | U25 câu 2 (mã dự phòng khi đang khóa) |
| 7 | Quên mật khẩu (#3) | `reset.html` | Đã gửi (cùng một câu), link hết hạn/đã dùng, mật khẩu yếu | Đủ (bố cục) | **PR7**: duyệt lại chi tiết |
| 8 | Nhận lời mời (#4) | `invite.html` | Link hết hạn, đã dùng (N31), quá thời gian → gửi link email. **N151 (22/10) thay:** nhận một bước (token + mật khẩu + tên, tạo phiên luôn), mọi từ chối là cùng một câu, không còn link email đặt mật khẩu | Đủ theo N151: bình thường, đã đăng nhập đúng email, link không dùng được, thử quá nhiều lần | Tên công ty và người mời: API lookup chỉ trả email và vai trò |
| 9 | Hồ sơ cá nhân (#5) | `me.html` | 2FA bật/chưa bật, không nút tắt; phiên chỉ có thời điểm tạo + hạn; "Phiên này" | Đủ | U25 câu 1 (`PATCH /v1/me`) |

Dòng 10 (Widget) thuộc Đợt 2: nộp 22/02/2027, duyệt 01/03/2027.

## 2. Bốn yêu cầu kèm mỗi wireframe

| Yêu cầu | Nơi xem | Tình trạng |
|---|---|---|
| 1. Danh sách token | `index.html` mục 2 | Đủ; token màu, cỡ chữ, khoảng cách, `--overlay`, `--shadow-dialog` đã duyệt 13/10 |
| 2. Đếm click 4 thao tác Hộp thư | `index.html` mục 3 + bộ đếm trên thanh đen | Đủ; Chuyển có 2 biến thể A/B |
| 3. Bảng đối chiếu mã tính năng | `index.html` mục 4 | Đủ cho 10 hạng mục và các màn sprint sau |
| 4. Bốn trạng thái (đang tải, trống, lỗi, AI tắt) | Ô "Trạng thái" mỗi màn | Đủ; màn không có AI ghi "Không áp dụng AI"; màn form ghi Trống "Không áp dụng" ở mục lục |

## 3. Kiểm tra kỹ thuật trước khi nộp

| Kiểm tra | Kết quả ngày 20/10 |
|---|---|
| Smoke test (mọi trạng thái × 8 vai trò, luồng chính, quyền) | 126 kiểm tra đạt |
| axe-core 4.10.3, WCAG 2.1 AA | 55 trang, 0 vi phạm |
| Bàn phím: ngăn kéo #13, #15 nhận và trả con trỏ | Đạt |
| Dữ liệu giả | SĐT dạng `0900000001`, email `example.test`, không tên miền thật |

Cách chạy lại: `prototype/tools/` (PR bộ test kèm theo).

## 4. Cần CĐT xác nhận trước 16/11

1. Spec M8 bản cuối gửi FE ngày 30/10 (điều kiện giữ lịch, Phụ lục C).
2. Hai điểm sẽ sửa khi có spec cuối: trình dựng bot 3 mức ưu tiên; gỡ nhãn "chờ spec chính thức".
3. Câu hỏi Backend U25–U29 gửi cùng spec cuối.
