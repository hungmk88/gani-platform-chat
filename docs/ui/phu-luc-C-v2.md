## Phụ lục C — Wireframe 10 hạng mục phải duyệt trước khi code

Bản sửa 13/10/2026 · đối chiếu `danh-sach-man-M11.md`, `spec-M8.md` bản nháp 2, ADR-003, N79, N84, U20 (main `98eb712`)

Vendor nộp wireframe dạng prototype bấm được (Figma hoặc tương đương).

- **9 màn Đợt 1 + khung app:** vendor nộp trước **16/11/2026**, CEO + cố vấn duyệt trước **23/11/2026** (1 tuần, đủ cho 1 vòng sửa)
- **Widget:** nộp trước 22/02/2027, duyệt trước 01/03/2027
- **21 màn còn lại:** 3 màn đi kèm 9 màn chính (#9, #13, #17) duyệt cùng đợt 23/11; 18 màn nộp theo sprint, trước sprint làm màn đó ít nhất 1 tuần (lịch ở cuối phụ lục)

Điều kiện để giữ được lịch trên: **spec M8 bản cuối gửi FE ngày 30/10/2026**. Nếu FE chỉ nhận spec ngày 17/11 thì không thể nộp 9 màn trước 16/11.

### Bảng wireframe

| # | Màn (số M11) | Phải thể hiện | Trạng thái phải vẽ | Hạn duyệt |
|---|---|---|---|---|
| 0 | **Khung app** (thành phần dùng chung) | Thanh trên cùng: bộ đổi workspace, bộ chọn trạng thái agent **Online / Bận / Offline**, menu cá nhân; menu 5 nhóm theo vai trò; dải "AI đang tắt"; dải phiên truy cập platform; 4 trang hệ thống (403, 404, Bảo trì, Lỗi chung) | Menu của từng vai trò (8 vai trò); đang đổi workspace; mất kết nối realtime | **23/11/2026** |
| 1 | Hộp thư (#6) | 3 cột; bộ lọc; dòng hội thoại có SLA; thẻ handoff; ô soạn có `/` mẫu; khóa ô gửi khi hết khung Zalo; tải agent "Đang xử lý / Chờ khách"; hộp thoại Chuyển, Đóng (Đã xong / Không phản hồi / Spam), Gửi ZNS khi hết khung | Trống theo vai trò, lỗi, AI tắt, tin gửi lỗi, "Đã được [tên] nhận", **SLA tạm dừng** (ngoài giờ / chờ khách), mẫu có biến chưa điền | **23/11/2026** |
| 2 | Hồ sơ khách (#8) + Gộp khách (#9) | Thông tin, định danh đa kênh có nhãn xác thực, tab Hội thoại/Lead/Ticket/Ghi chú, màn so sánh gộp 2 hồ sơ | SĐT bị che, trường nhạy cảm dạng Che (Marketing/Viewer), đề xuất gộp, cờ "chỉ người phục vụ" | **23/11/2026** |
| 3 | Pipeline lead (#12) + Chi tiết lead (#13) | Kanban 6 bước, thẻ lead, kéo thả, drawer chi tiết lead, hộp chọn lý do Thua, bộ lọc | Trống, cột nhiều thẻ (cuộn), đang lưu | **23/11/2026** |
| 4 | Trình dựng bot (#18) + Danh sách flow (#17) | Canvas + bảng node, cấu hình node, nhánh lỗi, chạy thử, xuất bản, danh sách flow có flow mặc định "Ngoài giờ"; **kèm phương án dự phòng dạng form** | Lỗi cấu hình, chặn xuất bản khi thiếu câu chào bắt buộc | **23/11/2026** |
| 5 | Đăng nhập (#1) | Form email + mật khẩu; link quên mật khẩu; thông báo lỗi | Đang tải nút; lỗi chung "Email hoặc mật khẩu không đúng" (không nói sai cái nào); khóa 30 phút sau 5 lần sai (ADR-003) | **23/11/2026** |
| 6 | Xác thực 2 lớp (#2) | **Nhập mã 6 số từ ứng dụng xác thực (TOTP)**; link "Dùng mã dự phòng"; **luồng cài 2FA lần đầu**: mã QR, nhập mã xác nhận, hiện mã dự phòng 1 lần | Đang tải; mã sai; khóa tạm sau nhiều lần sai; cài 2FA bắt buộc (Owner/Admin/platform operator) | **23/11/2026** |
| 7 | Quên / đặt lại mật khẩu (#3) — **phụ thuộc PR7** | Form email xin link; form đặt mật khẩu mới; xác nhận thành công | Đã gửi: **"Nếu email có trong hệ thống, link đã được gửi"** (cùng một câu dù email có hay không); link hết hạn hoặc đã dùng; mật khẩu không đủ mạnh (≥ 12 ký tự, có chữ và số) | **23/11/2026** — duyệt bố cục; chi tiết duyệt lại khi PR7 xong |
| 8 | Nhận lời mời (#4) — **phụ thuộc PR7** | Thông báo vai trò và workspace được mời; form đặt mật khẩu ngay trên trang; bước cài 2FA nếu vai trò bắt buộc | Link hết hạn; link đã dùng ("Đã chấp nhận, kiểm tra email để đặt mật khẩu" — N31); quá thời gian đặt mật khẩu trên trang → gửi link qua email | **23/11/2026** — duyệt bố cục; chi tiết duyệt lại khi PR7 xong |
| 9 | Hồ sơ cá nhân (#5) | 3 tab: Thông tin (tên, ảnh, mật khẩu), Bảo mật (2FA, phiên), Thông báo (trình duyệt, âm thanh) | 2FA đã bật / chưa bật — **không có nút tắt**; danh sách phiên chỉ có thời điểm tạo + hạn, không IP, không thiết bị (U20-1, U20-2); nút đăng xuất từng phiên | **23/11/2026** |
| 10 | Widget (Đợt 2) | Thu gọn, lời chào, form trước khi chat (có dòng thông báo dữ liệu), hội thoại, đánh giá; bản mobile và desktop; 2 thương hiệu mẫu | Ngoài giờ, mất mạng, có/không câu công bố AI | **01/03/2027** |

### Yêu cầu kèm mỗi wireframe

1. Danh sách token dự kiến (màu, cỡ chữ, khoảng cách)
2. Đếm click cho 4 thao tác chính của Hộp thư: nhận, trả lời, chuyển, đóng
3. Bảng đối chiếu mã tính năng thể hiện trên màn (theo `danh-sach-man-M11.md` §3)
4. Đủ 4 trạng thái bắt buộc (đang tải, trống, lỗi, AI tắt — Brief UI §2.2, §2.3); màn không có AI ghi "Không áp dụng"

### 21 màn còn lại — nộp theo sprint

Danh sách 30 màn Đợt 1 tại `docs/ui/danh-sach-man-M11.md` (main `98eb712`). 9 màn chính ở trên đã gồm #1–6, #8, #12, #18 và kéo theo #9, #13, #17. Còn lại 18 màn, xếp theo sprint:

| Sprint (bắt đầu) | Nộp trước | Màn (số M11) | Số màn |
|---|---|---|---|
| S3 (14/12) | 07/12 | Kênh (#24), Cấu hình Zalo OA (#25) | 2 |
| S4 (28/12) | 21/12 | Danh sách khách (#7), Nhập khách (#10), Danh sách ticket (#14), Chi tiết ticket (#15), Thành viên (#19), Team (#20), Workspace 3 tab (#21), Mẫu trả lời nhanh (#22), Dữ liệu khách 2 tab (#23) | 9 |
| S5 (11/01/2027) | 04/01 | Yêu cầu dữ liệu cá nhân (#11), Tổng quan (#16), AI nội bộ (#26), Tự chủ (#27), Audit (#28), Sự cố bảo mật (#29), Platform 3 tab (#30) | 7 |
| S6 (25/01 – 03/02) | — | Không nhận màn mới — chỉ sửa lỗi pentest + SUS | 0 |

Đối chiếu: 9 màn chính + 3 màn đi kèm (#9, #13, #17) + 18 màn theo sprint = **30 màn**.

Ghi chú: #20, #21 phụ thuộc Q7 (hạn 28/12, trùng ngày bắt đầu S4). Wireframe vẽ **cấu trúc màn** với dữ liệu tạm có nhãn "chờ Q7"; Q7 chỉ thay giá trị khởi tạo, không chặn wireframe.

Vendor báo trước 1 sprint nếu cần dồn wireframe cho sprint sau.

### Lý do tăng từ 4 lên 9 màn (+ khung app)

Ban đầu Phụ lục C ghi 4 màn chính (Hộp thư, Hồ sơ khách, Pipeline, Trình dựng bot), hạn 30/11. Nhưng S2 (30/11) làm khung app và cả 5 màn auth (đăng nhập, 2FA, quên mật khẩu, nhận lời mời, hồ sơ cá nhân). Wireframe các màn này phải được duyệt trước S2 ít nhất 1 tuần, tức 23/11.

### Tài liệu cần đồng bộ khi chốt phụ lục này

| Tài liệu | Chỗ cần sửa |
|---|---|
| Brief Backend P20 (checklist trước go-live) | "Wireframe 4 màn … trước S2 (30/11)" → "9 màn + khung app … duyệt trước 23/11" |
| `danh-sach-man-M11.md` §5 mục 2 | "giữ 4 màn chính" → tham chiếu phụ lục này |
| Brief UI §5.4 | Lời mời "hết hạn 72 giờ" **lệch** ADR-003 "hết hạn 7 ngày" — CEO chọn 1 con số |
