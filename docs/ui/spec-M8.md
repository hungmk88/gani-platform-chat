# Spec M8 — 11 hạng mục Đợt 1 chưa có màn spec

Bản nháp 1 · 13/10/2026 · Bổ sung cho Brief UI v1.0 · Người duyệt: CEO HUNG MK + cố vấn kỹ thuật

**Kết luận:** 9 hạng mục có giao diện ở Đợt 1 (hướng a), 2 hạng mục tạo bằng script quản trị (hướng b), không hạng mục nào bị gỡ khỏi Đợt 1. Phạm vi Đợt 1 giữ **58 mã**. Có 2 phần nhỏ trong mã C9 và J4 đề xuất dời sang Đợt 2, chờ CEO chốt (mục "Cần quyết định").

Căn cứ: Brief UI v1.0 · Brief Backend & Core v1.0 (P8, P14, P16, P17) · Phụ lục B Ma trận quyền · Phạm vi triển khai 135 mã · Phụ lục kỹ thuật v2.1–v2.3.

## 1. Bảng phân loại

| # | Mã | Hạng mục | Hướng | Màn / cách làm |
| --- | --- | --- | --- | --- |
| 1 | A1 | Tạo Organization | **(b)** Script quản trị | Lệnh CLI do platform operator chạy; không có màn |
| 2 | A2 | Tạo Workspace, chọn mẫu | **(b)** Script + sửa trên màn | Tạo bằng CLI; sửa thông tin ở `/settings/workspace` |
| 3 | A4 | Team | **(a)** | `/settings/teams` |
| 4 | C7 | Quản lý mẫu trả lời nhanh | **(a)** | `/settings/quick-replies` |
| 5 | C8 | SLA, mức ưu tiên | **(a)** | `/settings/workspace` — tab SLA & ưu tiên |
| 6 | C9 | Phân bổ tự động | **(a)**, một phần CẦN QUYẾT ĐỊNH | `/settings/workspace` — tab Phân bổ |
| 7 | C10 | Trạng thái agent, giờ làm việc | **(a)** | Trạng thái: thanh trên cùng · Giờ làm việc: `/settings/workspace` — tab Thông tin & giờ làm việc |
| 8 | J1 | Trường tùy chỉnh khách | **(a)** | `/settings/customer-data` — tab Trường tùy chỉnh |
| 9 | J4 | Tag, segment, tìm kiếm, lọc | **(a)**, một phần CẦN QUYẾT ĐỊNH | `/settings/customer-data` — tab Tag; lọc/tìm ở `/customers` |
| 10 | D4 | Xử lý ngoài giờ | **(a)** | Dùng chung giờ làm việc (mục 7) + flow mặc định "Ngoài giờ" trong `/bots` |
| 11 | A5, A3 | Đăng nhập, 2FA, đổi workspace, hồ sơ cá nhân | **(a)** | 5 màn nhóm Chung + bộ đổi workspace |

Mục 11 không phải "mã thiếu": đó là A5 (đăng nhập, 2FA, phiên) và A3 (nhận lời mời), đều thuộc Đợt 1.

## 2. Hướng (b) — tạo bằng script

### A1 — Tạo Organization

- **Cách làm:** lệnh `tenant:create-org --name --slug` trong `apps/worker` (CLI), platform operator chạy qua pipeline có phê duyệt; mỗi lần chạy ghi `audit_logs` và `platform_access_logs`.
- **Lý do:** Đợt 1 chỉ có 5 công ty, tạo một lần. Màn tự phục vụ thuộc A10 (Chờ dữ liệu).
- **Đầu ra bắt buộc:** org + Owner đầu tiên (gửi lời mời qua email) + bản ghi audit.
- **Nghiệm thu:** chạy lệnh 2 lần cùng `slug` → lần 2 báo trùng, không tạo bản ghi thứ hai.

### A2 — Tạo Workspace, chọn mẫu B2B / B2C / Service

- **Cách làm:** lệnh `tenant:create-workspace --org --template b2b|b2c|service --name`, gọi `WorkspaceTemplateService.apply` (Brief-P16): tạo flow mặc định (gồm "Ngoài giờ"), pipeline 6 bước, SLA mặc định, team mặc định, giờ làm việc theo Q7.
- **Sửa sau khi tạo:** tên, múi giờ, giờ làm việc ở `/settings/workspace` (mục 3.4).
- **Nghiệm thu:** workspace mới có đủ flow mặc định, pipeline, SLA, team mặc định ngay sau lệnh; Admin đăng nhập thấy đủ, không phải cấu hình tay.

## 3. Hướng (a) — spec ngắn

### 3.1. A4 — Team

**Màn hình:** `/settings/teams` (nhóm Cài đặt)
**Vai trò:** Owner, Admin xem và sửa. Manager xem team của mình (theo Phụ lục B: cài đặt team chỉ Owner/Admin).
**Thao tác chính:**
- Tạo team (tên, mô tả)
- Thêm/bớt thành viên; một người có thể ở nhiều team
- Đặt team mặc định của workspace (nhận hội thoại khi chưa có quy tắc khác)
- Gán team phụ trách một kênh (vd. Zalo OA Gani → team Sales B2B)
**Trạng thái:**
- Đang tải: skeleton bảng team
- Trống: "Chưa có team — Tạo team đầu tiên"
- Lỗi: "Không tải được danh sách team. Mã: … — Thử lại"
- AI tắt: Không áp dụng
**Nghiệm thu:**
- Tạo team mới ≤ 3 click
- Xóa team đang là team mặc định hoặc đang phụ trách kênh → bị chặn, báo lý do

> Khác mẫu trong đề bài: bỏ "gán team phụ trách pipeline" vì Brief không có quy định này (không tự mở rộng phạm vi).

### 3.2. C7 — Mẫu trả lời nhanh

**Màn hình:** `/settings/quick-replies` (nhóm Cài đặt)
**Vai trò:** Owner, Admin, Manager tạo/sửa/xóa mẫu dùng chung của workspace. Sales, Support chỉ dùng mẫu trong Inbox (gõ `/`).
**Thao tác chính:**
- Tạo mẫu: tên ngắn (gõ sau `/`), nội dung, tag phân loại
- Chèn biến Đợt 1: tên khách, tên nhân viên, tên công ty, SĐT công ty
- Tìm mẫu theo tên/tag; sắp xếp theo số lần dùng
- Xem trước với dữ liệu mẫu trước khi lưu
**Trạng thái:**
- Đang tải: skeleton danh sách
- Trống: "Chưa có mẫu trả lời — Tạo mẫu đầu tiên"
- Lỗi: "Không lưu được mẫu. Mã: … — Thử lại"
- AI tắt: Không áp dụng
**Nghiệm thu:**
- Mẫu mới tạo dùng được ngay trong Inbox (gõ `/` ra mẫu) không cần tải lại trang
- Mẫu có biến thiếu dữ liệu → Inbox hiện ô trống để điền, không gửi chữ `{{…}}` ra khách

### 3.3. C8 — SLA và mức ưu tiên

**Màn hình:** `/settings/workspace` — tab "SLA & ưu tiên"
**Vai trò:** Owner, Admin sửa. Manager xem.
**Thao tác chính:**
- Đặt 3 mức ưu tiên: Thường / Cao / Khẩn
- Mỗi mức đặt 2 chỉ tiêu: thời gian phản hồi đầu tiên, thời gian xử lý xong
- Đặt mốc cảnh báo agent (mặc định 15 phút) và báo quản lý (mặc định 30 phút) — Brief-P14
- Ưu tiên mặc định của hội thoại mới: Thường; agent/Manager đổi trong Inbox
**Trạng thái:**
- Đang tải: skeleton form
- Trống: không có — workspace luôn có SLA mặc định từ mẫu
- Lỗi: "Không lưu được SLA. Mã: … — Thử lại"
- AI tắt: Không áp dụng
**Nghiệm thu:**
- Đổi SLA → hội thoại mới áp dụng ngay; hội thoại đang mở giữ hạn cũ
- Đồng hồ SLA chỉ chạy trong giờ làm việc và dừng khi hội thoại ở "Chờ khách trả lời" (đề xuất mặc định — CEO xác nhận ở mục 5, Q-M8-3)

### 3.4. C10 + D4 — Giờ làm việc, trạng thái agent, xử lý ngoài giờ

**Màn hình:** `/settings/workspace` — tab "Thông tin & giờ làm việc"; bộ chọn trạng thái agent trên thanh trên cùng (mọi màn); flow mặc định "Ngoài giờ" trong `/bots`.
**Vai trò:** Giờ làm việc: Owner, Admin sửa; Manager xem. Trạng thái: mọi người có quyền Inbox tự đổi; Manager thấy trạng thái cả team.
**Thao tác chính:**
- Đặt lịch tuần theo ngày (giờ mở/đóng, nghỉ trưa), múi giờ (mặc định Asia/Ho_Chi_Minh)
- Thêm ngày nghỉ lễ (vd. Tết 04–10/02/2027); ngày nghỉ = ngoài giờ cả ngày
- Agent đổi trạng thái: Online / Bận / Vắng / Offline. Chỉ Online được phân bổ tự động
- Sửa flow "Ngoài giờ" (lời nhắn, hẹn giờ liên hệ lại) trong trình dựng bot; flow có sẵn từ mẫu (D3)
**Trạng thái:**
- Đang tải: skeleton form lịch
- Trống: không có — lịch mặc định từ mẫu workspace
- Lỗi: "Không lưu được giờ làm việc. Mã: … — Thử lại"
- AI tắt: Không áp dụng
**Nghiệm thu:**
- Tin đến ngoài giờ hoặc ngày lễ → hội thoại gắn cờ "Ngoài giờ", khách nhận lời nhắn; mở cửa → hội thoại vào "Chờ nhân viên nhận" (Brief-P10 F6)
- Agent chuyển "Bận" → không nhận hội thoại tự động mới, vẫn giữ hội thoại đang xử lý

### 3.5. C9 — Phân bổ tự động

**Màn hình:** `/settings/workspace` — tab "Phân bổ"
**Vai trò:** Owner, Admin sửa. Manager xem.
**Thao tác chính:**
- Chọn cách phân bổ cho từng team: "Tự động xoay vòng" hoặc "Agent tự nhận"
- Đặt giới hạn tải mặc định của workspace (mặc định 5); giới hạn riêng từng agent sửa ở `/settings/members`
- Bật/tắt "Ưu tiên người đã xử lý khách này lần trước" (nếu đang Online, chưa đầy tải)
**Trạng thái:**
- Đang tải: skeleton form
- Trống: không có — mặc định "Agent tự nhận"
- Lỗi: "Không lưu được cấu hình phân bổ. Mã: … — Thử lại"
- AI tắt: Không áp dụng (phân bổ không dùng AI ở Đợt 1)
**Nghiệm thu:**
- 10 hội thoại vào team 3 agent Online → chia 4/3/3, không ai vượt giới hạn tải
- Agent đầy tải hoặc không Online → không được phân bổ; vẫn tự nhận được kèm cảnh báo (Brief-P14)

> Phân bổ **theo kỹ năng** (tag kỹ năng ↔ ý định do AI phân loại): đề xuất dời Đợt 2 — xem mục 5, Q-M8-1.

### 3.6. J1 — Trường tùy chỉnh khách

**Màn hình:** `/settings/customer-data` — tab "Trường tùy chỉnh". Trường định nghĩa ở cấp **công ty** (bảng `customer_field_defs`, RLS theo org — Brief-P8), dùng chung mọi workspace của công ty.
**Vai trò:** Owner, Admin.
**Thao tác chính:**
- Tạo trường: tên, kiểu (chữ, số, ngày, chọn 1, chọn nhiều, SĐT, email), bắt buộc hay không
- Đánh dấu "Nhạy cảm" → mã hóa cột (Brief-P8) và che với Marketing, Viewer
- Sắp xếp thứ tự hiển thị trên hồ sơ khách; ẩn trường không dùng
- Trường đã có dữ liệu chỉ được ẩn, không xóa
**Trạng thái:**
- Đang tải: skeleton bảng trường
- Trống: "Chưa có trường tùy chỉnh — Thêm trường đầu tiên"
- Lỗi: "Không lưu được trường. Mã: … — Thử lại"
- AI tắt: Không áp dụng
**Nghiệm thu:**
- Trường mới hiện trên hồ sơ khách và trong bộ lọc `/customers` ngay sau khi lưu
- Trường "Nhạy cảm": Marketing/Viewer thấy dạng che; dữ liệu trong DB được mã hóa (kiểm bằng truy vấn trực tiếp)

### 3.7. J4 — Tag, tìm kiếm, lọc

**Màn hình:** `/settings/customer-data` — tab "Tag" (quản lý); tìm và lọc ở `/customers` (Brief UI §6.1).
**Vai trò:** Owner, Admin, Manager quản lý tag. Sales, Support gắn/bỏ tag có sẵn trên hồ sơ và hội thoại.
**Thao tác chính:**
- Tạo, đổi tên, ẩn tag; xem số khách đang mang tag
- Gộp 2 tag thành 1 (vd. "bò viên" và "bo vien")
- Lọc khách theo tag, kênh, trường tùy chỉnh, người phụ trách, ngày liên hệ cuối; tìm theo tên, SĐT, email
**Trạng thái:**
- Đang tải: skeleton danh sách tag
- Trống: "Chưa có tag — Tạo tag đầu tiên"
- Lỗi: "Không tải được danh sách tag. Mã: … — Thử lại"
- AI tắt: tag do AI tự gắn (E1) không xuất hiện; tag gắn tay vẫn dùng bình thường
**Nghiệm thu:**
- Gộp 2 tag: mọi khách mang tag cũ chuyển sang tag mới, không mất khách nào (đếm trước/sau)
- Lọc 10.000 khách theo 2 điều kiện trả kết quả < 1 giây

> **Lưu phân khúc** (đặt tên một bộ lọc để dùng lại): đề xuất dời Đợt 2 cùng Campaign — xem mục 5, Q-M8-2.

### 3.8. A5, A3 — Đăng nhập, 2FA, đổi workspace, hồ sơ cá nhân

**Màn hình:** `/login` · `/login/2fa` · `/reset-password` · `/invite/[token]` · `/me` (3 tab: Thông tin · Bảo mật · Thông báo) · bộ đổi workspace trên thanh trên cùng.
**Vai trò:** mọi người dùng. 2FA bắt buộc với Owner, Admin, platform operator (Brief-P17).
**Thao tác chính:**
- Đăng nhập email + mật khẩu; bước 2FA nếu đã bật hoặc vai trò bắt buộc
- Nhận lời mời: đặt mật khẩu; vai trò bắt buộc 2FA phải cài 2FA ngay
- Quên mật khẩu: link đặt lại một lần, có hạn
- `/me`: đổi tên, ảnh, mật khẩu; bật/tắt 2FA; xem và đăng xuất các phiên đang mở; bật thông báo trình duyệt và âm thanh (C11)
- Đổi workspace: danh sách workspace được cấp; đổi xong xóa cache và ngắt realtime của workspace cũ (Brief UI §2.6, test T1)
**Trạng thái:**
- Đang tải: nút đăng nhập hiện đang xử lý
- Trống: không áp dụng
- Lỗi: "Email hoặc mật khẩu không đúng" (không nói rõ sai cái nào); khóa tạm sau nhiều lần sai; link mời/đặt lại hết hạn → "Link đã hết hạn — Yêu cầu link mới"
- AI tắt: Không áp dụng
**Nghiệm thu:**
- Người được mời đăng nhập lần đầu và vào Inbox ≤ 3 phút
- Đổi workspace: không còn dữ liệu, thông báo hay sự kiện realtime nào của workspace cũ (test T1)

## 4. Thay đổi phạm vi Đợt 1

| Mã | Thay đổi | Ảnh hưởng số mã |
| --- | --- | --- |
| A1, A2 | Giao bằng script quản trị, không có màn tạo | Không đổi — vẫn thuộc Đợt 1 |
| C9 | Phần "theo kỹ năng" dời Đợt 2 (nếu CEO duyệt Q-M8-1) | Không đổi — mã vẫn ở Đợt 1, giao một phần |
| J4 | Phần "lưu phân khúc" dời Đợt 2 (nếu CEO duyệt Q-M8-2) | Không đổi — mã vẫn ở Đợt 1, giao một phần |

**Phạm vi Đợt 1 giữ 58 mã.** Không mã nào chuyển hẳn sang Đợt 2 hay bị bỏ.

## 5. Cần quyết định (CEO chốt)

| # | Câu hỏi | Phương án 1 | Phương án 2 | Đề xuất |
| --- | --- | --- | --- | --- |
| Q-M8-1 | Phân bổ theo kỹ năng (C9) có làm ở Đợt 1? | Làm: thêm tag kỹ năng cho agent, khớp với ý định AI phân loại | Dời Đợt 2; Đợt 1 chỉ xoay vòng + theo team | **Phương án 2.** Team mỗi công ty 3–6 người, chia theo team đã đủ; ý định AI chỉ chạy production khi có văn bản pháp lý |
| Q-M8-2 | Lưu phân khúc (J4) có làm ở Đợt 1? | Làm: đặt tên bộ lọc, dùng lại | Dời Đợt 2 cùng Campaign (N1–N3) — nơi phân khúc thật sự được dùng | **Phương án 2.** Đợt 1 chưa có việc nào dùng phân khúc đã lưu |
| Q-M8-3 | Đồng hồ SLA có dừng ngoài giờ và khi chờ khách? | Dừng ngoài giờ + dừng khi "Chờ khách trả lời" | Chạy liên tục 24/7 | **Phương án 1.** Không dừng thì SLA quá hạn hàng loạt mỗi sáng, cảnh báo mất tác dụng |

## 6. Đề xuất bổ sung (không tự thêm vào phạm vi)

1. **Phụ lục B — Ma trận quyền** cần thêm 4 dòng:
   - Quản lý mẫu trả lời nhanh: Owner, Admin, Manager
   - Tạo/đổi tên/gộp tag: Owner, Admin, Manager; Sales/Support chỉ gắn tag có sẵn
   - Xem cài đặt SLA, phân bổ, giờ làm việc: Owner, Admin, Manager (sửa: Owner, Admin)
   - Đổi trạng thái agent của người khác: Manager trở lên
2. **Brief Backend P9** — OpenAPI cần có endpoint cho: team (CRUD + thành viên + kênh), mẫu trả lời nhanh (CRUD), `sla_policies`, cấu hình phân bổ, giờ làm việc + ngày lễ, `customer_field_defs`, tag (CRUD + gộp), trạng thái agent, `/me` (phiên đăng nhập, 2FA, thông báo), lời mời và đặt lại mật khẩu. Danh sách tối thiểu hiện tại chưa ghi các endpoint này.
3. **Tên mã P3** trong file Phạm vi ghi "Sao lưu hằng ngày" (tên gốc); ghi chú đã sửa thành RPO ≤ 1 giờ (§22). Đề xuất đổi luôn tên mã ở bản v1.1 để vendor không hiểu nhầm.
