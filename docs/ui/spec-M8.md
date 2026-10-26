# Spec M8 — 11 hạng mục Đợt 1 chưa có màn spec

Bản nháp 3 · 13/10/2026 · đã áp Q-M8-1→3 (U19), U20-1→6, dòng 4 Phụ lục B, Q-U20-1→6 (U21), U22, U23 · **cập nhật 26/10/2026: áp N152, N158, N162, N163, U36, U39 (mục 9)** · Bổ sung cho Brief UI v1.0 · Người duyệt: CEO HUNG MK + cố vấn kỹ thuật

**Kết luận:** 9 hạng mục có giao diện ở Đợt 1 (hướng a), 2 hạng mục tạo bằng script quản trị (hướng b), không hạng mục nào bị gỡ khỏi Đợt 1. Phạm vi Đợt 1 giữ **58 mã**. Hai phần nhỏ đã được CEO chốt dời sang Đợt 2: phân bổ theo kỹ năng (C9) và lưu phân khúc (J4). Đồng hồ SLA dừng ngoài giờ và khi chờ khách (C8). Sáu điểm lệch với backend (U20) đã sửa: `/me` chỉ bật 2FA; danh sách phiên chỉ có thời điểm tạo và hạn; `/reset-password` chờ PR7 (nay đã có, N162 — mục 9); trạng thái agent còn 3 mức; giờ làm việc, ngày lễ, team ↔ kênh chờ Q7. Sáu câu phát sinh ở mục 8 (Q-U20) đã được CEO chốt ngày 13/10/2026.

Căn cứ: Brief UI v1.0 · Brief Backend & Core v1.0 (P8, P14, P16, P17) · Phụ lục B Ma trận quyền · Phạm vi triển khai 135 mã · Phụ lục kỹ thuật v2.1–v2.3.

## 1. Bảng phân loại

| # | Mã | Hạng mục | Hướng | Màn / cách làm |
| --- | --- | --- | --- | --- |
| 1 | A1 | Tạo Organization | **(b)** Script quản trị | Lệnh CLI do platform operator chạy; không có màn |
| 2 | A2 | Tạo Workspace, chọn mẫu | **(b)** Script + sửa trên màn | Tạo bằng CLI; sửa thông tin ở `/settings/workspace` |
| 3 | A4 | Team — liên kết team ↔ kênh chờ Q7 | **(a)** | `/settings/teams` |
| 4 | C7 | Quản lý mẫu trả lời nhanh | **(a)** | `/settings/quick-replies` |
| 5 | C8 | SLA, mức ưu tiên | **(a)** | `/settings/workspace` — tab SLA & ưu tiên |
| 6 | C9 | Phân bổ tự động | **(a)**, bỏ phần theo kỹ năng (Đợt 2) | `/settings/workspace` — tab Phân bổ |
| 7 | C10 | Trạng thái agent (3 mức), giờ làm việc — giờ làm việc chờ Q7 | **(a)** | Trạng thái: thanh trên cùng · Giờ làm việc: `/settings/workspace` — tab Thông tin & giờ làm việc |
| 8 | J1 | Trường tùy chỉnh khách | **(a)** | `/settings/customer-data` — tab Trường tùy chỉnh |
| 9 | J4 | Tag, segment, tìm kiếm, lọc | **(a)**, bỏ phần lưu phân khúc (Đợt 2) | `/settings/customer-data` — tab Tag; lọc/tìm ở `/customers` |
| 10 | D4 | Xử lý ngoài giờ | **(a)** | Dùng chung giờ làm việc (mục 7) + flow mặc định "Ngoài giờ" trong `/bots` |
| 11 | A5, A3 | Đăng nhập, 2FA, đổi workspace, hồ sơ cá nhân | **(a)** — quên/đặt lại mật khẩu theo N162 | 5 màn nhóm Chung + bộ đổi workspace |

Mục 11 không phải "mã thiếu": đó là A5 (đăng nhập, 2FA, phiên) và A3 (nhận lời mời), đều thuộc Đợt 1.

## 2. Hướng (b) — tạo bằng script

### A1 — Tạo Organization

- **Cách làm:** lệnh `tenant:create-org --name --slug` trong `apps/worker` (CLI), platform operator chạy qua pipeline có phê duyệt; mỗi lần chạy ghi `audit_logs` và `platform_access_logs`.
- **Lý do:** Đợt 1 chỉ có 5 công ty, tạo một lần. Màn tự phục vụ thuộc A10 (Chờ dữ liệu).
- **Đầu ra bắt buộc:** org + Owner đầu tiên (gửi lời mời qua email) + bản ghi audit.
- **Nghiệm thu:** chạy lệnh 2 lần cùng `slug` → lần 2 báo trùng, không tạo bản ghi thứ hai.

### A2 — Tạo Workspace, chọn mẫu B2B / B2C / Service

- **Cách làm:** lệnh `tenant:create-workspace --org <slug công ty> --name --slug --template b2b|b2c|service --operator <email> [--timezone]` (N158; `--slug`, `--operator`, `--timezone` thêm so với bản 13/10), gọi `WorkspaceTemplateService.apply` (Brief-P16): tạo flow mặc định (gồm "Ngoài giờ"), pipeline 6 bước, SLA mặc định, team mặc định, giờ làm việc theo Q7.
- **Hiện trạng (N158, 24/10):** lệnh đã có, tạo workspace + đưa mọi Owner/Admin active vào workspace + audit; **nội dung mẫu (`WorkspaceTemplateService.apply`) chưa làm** vì các bảng flow, pipeline, SLA, giờ làm việc chưa có. Nghiệm thu dưới đây chỉ đạt khi phần này xong.
- **Sửa sau khi tạo:** tên, múi giờ, giờ làm việc ở `/settings/workspace` (mục 3.4).
- **Nghiệm thu:** workspace mới có đủ flow mặc định, pipeline, SLA, team mặc định ngay sau lệnh; Admin đăng nhập thấy đủ, không phải cấu hình tay.

## 3. Hướng (a) — spec ngắn

### 3.1. A4 — Team

**Màn hình:** `/settings/teams` (nhóm Cài đặt)
**Vai trò:** Owner, Admin xem và sửa. Manager **chỉ đọc** team mình thuộc về: không tạo, sửa, kết thúc, không chọn người hay kênh (theo Phụ lục B: cài đặt team chỉ Owner/Admin; U39, 26/10).
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

> **Phụ thuộc Q7 (U18, hạn 28/12/2026) — U20-6:** danh sách team, team mặc định và liên kết team ↔ kênh của từng workspace; spec chi tiết chốt sau khi có Q7. Trước Q7, FE dựng màn với dữ liệu tạm có nhãn "chờ Q7".

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
**Vai trò:** Owner, Admin sửa. Manager **không vào** `/settings/workspace` (U39, 26/10).
**Thao tác chính:**
- Đặt 3 mức ưu tiên: Thường / Cao / Khẩn
- Mỗi mức đặt 2 chỉ tiêu: thời gian phản hồi đầu tiên, thời gian xử lý xong
- Đặt mốc cảnh báo agent (mặc định 15 phút) và báo quản lý (mặc định 30 phút) — Brief-P14
- Ưu tiên mặc định của hội thoại mới: Thường; agent/Manager đổi trong Inbox
- Hiển thị quy tắc dừng đồng hồ (chỉ đọc, không cấu hình ở Đợt 1): ngoài giờ + chờ khách
**Trạng thái:**
- Đang tải: skeleton form
- Trống: không có — workspace luôn có SLA mặc định từ mẫu
- Lỗi: "Không lưu được SLA. Mã: … — Thử lại"
- AI tắt: Không áp dụng
**Nghiệm thu:**
- Đổi SLA → hội thoại mới áp dụng ngay; hội thoại đang mở giữ hạn cũ
- Đồng hồ SLA dừng ngoài giờ làm việc và ngày lễ, dừng khi hội thoại ở "Chờ khách trả lời" (PENDING_CUSTOMER), chạy tiếp khi khách trả lời hoặc khi mở cửa (quy định chốt — Q-M8-3)
- Hội thoại vào lúc 18:00 với giờ đóng cửa 17:30 → đồng hồ bắt đầu chạy từ giờ mở cửa kế tiếp, không báo quá hạn

### 3.4. C10 + D4 — Giờ làm việc, trạng thái agent, xử lý ngoài giờ

**Màn hình:** `/settings/workspace` — tab "Thông tin & giờ làm việc"; bộ chọn trạng thái agent trên thanh trên cùng (mọi màn); flow mặc định "Ngoài giờ" trong `/bots`.
**Vai trò:** Giờ làm việc: Owner, Admin sửa; Manager **không vào** `/settings/workspace` (U39, 26/10). Trạng thái: mọi người có quyền Inbox tự đổi trạng thái của mình. **Đổi trạng thái của người khác: chỉ Owner, Admin** (Phụ lục B, dòng U20-5 — khác đề xuất ban đầu "Manager trở lên"). Manager xem trạng thái cả team (chỉ đọc); muốn gỡ hội thoại khỏi một agent thì Manager dùng "Chuyển hội thoại" (Brief-P14), không đổi trạng thái của agent.
**Thao tác chính:**
- Tab Thông tin: tên, múi giờ (mặc định Asia/Ho_Chi_Minh), giới hạn tải mặc định (N157), **SĐT liên hệ** của workspace (`contactPhone`, là `{{company_phone}}` của mẫu trả lời nhanh; sửa qua `PATCH /v1/workspaces/{id}`, N163)
- Đặt lịch tuần theo ngày (giờ mở/đóng, nghỉ trưa)
- Thêm ngày nghỉ lễ (vd. Tết 04–10/02/2027); ngày nghỉ = ngoài giờ cả ngày
- Agent đổi trạng thái: **Online / Bận / Offline** (3 mức, U20-4). "Vắng" dời Đợt 2. Hành vi từng mức theo bảng dưới
- Sửa flow "Ngoài giờ" (lời nhắn, hẹn giờ liên hệ lại) trong trình dựng bot; flow có sẵn từ mẫu (D3)
**Hành vi 3 trạng thái agent (U20-4, FSM T17/T18):**

| Trạng thái | Nhận hội thoại mới tự động? | Giữ hội thoại đang xử lý? | Đẩy về hàng chờ sau 10 phút? | Dùng khi |
| --- | --- | --- | --- | --- |
| **Online** | Có | Có | Không | Đang trực |
| **Bận** | Không | Có | Không — dù quá 10 phút | Nghỉ tạm: ăn trưa, họp ngắn |
| **Offline** | Không | Không | Có — sau 10 phút, nếu khách còn tin chưa trả lời | Hết ca, đăng xuất |

Chi tiết Offline theo FSM: trong giờ làm việc → hội thoại về "Chờ nhân viên nhận", bỏ người phụ trách, báo quản lý (T17); ngoài giờ → bot giữ hội thoại, gắn cờ "Ngoài giờ", bỏ người phụ trách (T18). Khi Bận, đồng hồ SLA của hội thoại vẫn chạy và cảnh báo SLA vẫn bắn như bình thường.

**Tự chuyển Offline khi mất kết nối (Q-U20-4, chốt):** mất kết nối realtime quá 5 phút → hệ thống tự chuyển agent sang Offline, rồi T17/T18 chạy như Offline chọn tay. Kết nối lại **không** tự chuyển Online: agent tự bật lại. Thanh trên cùng hiện "Đã chuyển Offline do mất kết nối".

**"Bận" quá 30 phút (Q-U20-5, chốt theo đề xuất):** không tự đổi trạng thái, không đẩy hội thoại về hàng chờ. Sau 30 phút, chính agent thấy lời nhắc; Manager thấy số phút "Bận" ở trạng thái cả team và tự quyết nhắc agent (Manager không đổi được trạng thái người khác).

**Trạng thái màn:**
- Đang tải: skeleton form lịch
- Trống: không có — lịch mặc định từ mẫu workspace
- Lỗi: "Không lưu được giờ làm việc. Mã: … — Thử lại"
- AI tắt: Không áp dụng
**Nghiệm thu:**
- Tin đến ngoài giờ hoặc ngày lễ → hội thoại gắn cờ "Ngoài giờ", khách nhận lời nhắn; mở cửa → hội thoại vào "Chờ nhân viên nhận" (Brief-P10 F6)
- Agent chuyển "Bận" → không nhận hội thoại tự động mới, vẫn giữ hội thoại đang xử lý; sau 15 phút hội thoại vẫn thuộc agent đó
- Agent chuyển "Offline" trong giờ, khách còn tin chưa trả lời → sau 10 phút hội thoại về hàng chờ và quản lý nhận cảnh báo; Manager không có nút đổi trạng thái của agent khác
- Ngắt mạng 5 phút → agent tự thành Offline và thấy thông báo; nối lại vẫn Offline cho tới khi agent tự bật Online

> **Phụ thuộc Q7 (U18, hạn 28/12/2026) — U20-6:** giờ làm việc, ngày lễ của từng workspace; spec chi tiết chốt sau khi có Q7. Trước Q7, Hộp thư và thẻ SLA dùng giá trị tạm có nhãn "chờ Q7" (U18).

### 3.5. C9 — Phân bổ tự động

**Màn hình:** `/settings/workspace` — tab "Phân bổ"
**Vai trò:** Owner, Admin sửa. Manager **không vào** `/settings/workspace` (U39, 26/10).
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

> **Đã chốt (Q-M8-1):** phân bổ **theo kỹ năng** dời Đợt 2. Đợt 1 chỉ có xoay vòng + theo team + agent tự nhận. Màn không có trường tag kỹ năng ở thành viên.

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

> **Đã cập nhật Phụ lục B** (main, commit 98eb712) — dòng mới "Xem trường nhạy cảm" (U20-5): Owner, Admin, Manager, Sales, Support thấy đầy đủ; Marketing, Viewer: Che; Platform operator: chỉ trong phiên truy cập có lý do.

### 3.7. J4 — Tag, tìm kiếm, lọc

**Màn hình:** `/settings/customer-data` — tab "Tag" (quản lý); tìm và lọc ở `/customers` (Brief UI §6.1).
**Vai trò:** Owner, Admin quản lý tag (#23 chỉ Owner/Admin, kể cả tab Tag — U36, 26/10). Sales, Support gắn/bỏ tag có sẵn trên hồ sơ và hội thoại.
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

> **Đã chốt (Q-M8-2):** **lưu phân khúc** dời Đợt 2 cùng Campaign (N1–N3). Đợt 1 vẫn có lọc và tìm kiếm tức thời, không có nút "Lưu bộ lọc".

### 3.8. A5, A3 — Đăng nhập, 2FA, đổi workspace, hồ sơ cá nhân

**Màn hình:** `/login` · `/login/2fa` · `/forgot-password` · `/reset-password` (N162) · `/invite` (token ở fragment `#token=`, N152) · `/me` (3 tab: Thông tin · Bảo mật · Thông báo) · bộ đổi workspace trên thanh trên cùng.
**Vai trò:** mọi người dùng. 2FA bắt buộc với Owner, Admin, platform operator (Brief-P17).
**Thao tác chính:**
- Đăng nhập email + mật khẩu; bước 2FA nếu đã bật hoặc vai trò bắt buộc
- Nhận lời mời: đặt mật khẩu; vai trò bắt buộc 2FA phải cài 2FA ngay
- Quên mật khẩu (N162, PR7 đã xong): nhập email → **luôn** một câu như nhau dù email có tài khoản hay không (API luôn 202); link trong email **dùng một lần, hạn 30 phút**; đặt mật khẩu mới thì **mọi phiên bị thu hồi** và không tự đăng nhập → "Đăng nhập lại" 
- `/me` tab Bảo mật — 2FA: **chỉ bật 2FA và xem trạng thái** (Đã bật / Chưa bật). Không có nút tắt; tắt hoặc đặt lại 2FA đi qua Admin (U20-1, N79.4)
- Bật 2FA: quét mã QR, nhập mã 6 số xác nhận, rồi **hiện 10 mã dự phòng một lần duy nhất**, mỗi mã dùng 1 lần; người dùng tự lưu (tải/chép) trước khi đóng (Q-U20-2, chốt). Màn nhập mã 2FA có link "Dùng mã dự phòng"
- Đặt lại 2FA của người khác: ở `/settings/members` (#19), **chỉ Owner, Admin**, bắt buộc nhập lý do, ghi audit, thu hồi mọi phiên của người bị đặt lại; người đó phải cài lại 2FA ở lần đăng nhập kế tiếp (Q-U20-1, chốt)
- `/me` tab Bảo mật — phiên: xem danh sách phiên, mỗi phiên chỉ hiện **thời điểm tạo** và **hạn**, không có IP, không có thiết bị (U20-2, N79.2); phiên đang dùng có nhãn **"Phiên này"**, các phiên khác có nút "Đăng xuất" (Q-U20-3, chốt)
- `/me`: đổi tên (`PATCH /v1/me`, N162); **ảnh đại diện để sau**, khi có kho file (N162); đổi mật khẩu qua `/api/auth/change-password`, **luôn** đăng xuất các thiết bị khác (N162); bật thông báo trình duyệt và âm thanh (C11, chờ API)
- Danh sách phiên ở trên chờ một đường đọc phiên **không trả token** (`/api/auth/list-sessions` trả token của mọi phiên cho JavaScript, không dùng — SEC-03)
- Đổi workspace: danh sách workspace được cấp; đổi xong xóa cache và ngắt realtime của workspace cũ (Brief UI §2.6, test T1)
**Trạng thái:**
- Đang tải: nút đăng nhập hiện đang xử lý
- Trống: không áp dụng
- Lỗi: "Email hoặc mật khẩu không đúng" (không nói rõ sai cái nào); khóa tạm sau nhiều lần sai; link mời/đặt lại hết hạn → "Link đã hết hạn — Yêu cầu link mới"
- AI tắt: Không áp dụng
**Nghiệm thu:**
- Người được mời đăng nhập lần đầu và vào Inbox ≤ 3 phút
- Đổi workspace: không còn dữ liệu, thông báo hay sự kiện realtime nào của workspace cũ (test T1)
- `/me` không có nút tắt 2FA với mọi vai trò; danh sách phiên không hiện IP hay thiết bị; đúng 1 phiên mang nhãn "Phiên này" và phiên đó không có nút đăng xuất
- Bật 2FA hiện đủ 10 mã dự phòng đúng 1 lần; đăng nhập bằng 1 mã dự phòng thành công, dùng lại mã đó bị từ chối

## 4. Thay đổi phạm vi Đợt 1

| Mã | Thay đổi | Ảnh hưởng số mã |
| --- | --- | --- |
| A1, A2 | Giao bằng script quản trị, không có màn tạo | Không đổi — vẫn thuộc Đợt 1 |
| C9 | Phần "theo kỹ năng" dời Đợt 2 (CEO chốt Q-M8-1) | Không đổi — mã vẫn ở Đợt 1, giao một phần |
| J4 | Phần "lưu phân khúc" dời Đợt 2 cùng Campaign (CEO chốt Q-M8-2) | Không đổi — mã vẫn ở Đợt 1, giao một phần |

**Phạm vi Đợt 1 giữ 58 mã.** Không mã nào chuyển hẳn sang Đợt 2 hay bị bỏ.

## 5. Quyết định đã chốt (CEO, 13/10/2026)

| # | Câu hỏi | Quyết định | Hệ quả |
| --- | --- | --- | --- |
| Q-M8-1 | Phân bổ theo kỹ năng (C9) | **Dời Đợt 2** | Đợt 1: xoay vòng + theo team + tự nhận. Thêm vào Đợt 2 cùng ý định AI |
| Q-M8-2 | Lưu phân khúc (J4) | **Dời Đợt 2 cùng Campaign** | Đợt 1 không có nút "Lưu bộ lọc"; Đợt 2 bổ sung vào `/customers` |
| Q-M8-3 | Đồng hồ SLA | **Dừng ngoài giờ + dừng khi chờ khách** | Backend tính SLA theo lịch làm việc; ghi mốc dừng/chạy lại vào lịch sử hội thoại |

## 6. Đề xuất bổ sung (CEO đã đồng ý cả 3)

1. **Phụ lục B.** DEV đã thêm 5 dòng (main, commit 98eb712, U20-5); bản nháp 3 thêm dòng thứ 6 "Đặt lại 2FA của người khác" — Owner ✓, Admin ✓, còn lại — (Q-U20-1). Khác đề xuất ban đầu: "Đổi trạng thái agent của người khác" **chỉ Owner/Admin**, không phải "Manager trở lên"; thêm dòng "Xem trường nhạy cảm". Spec này đã sửa theo (mục 3.4, 3.6).
2. **Brief Backend P9 — thêm endpoint** cho các hạng mục trên (danh sách chi tiết: `endpoint-M8.md`, đã sửa theo U20, gửi cố vấn kỹ thuật review trước khi vào Brief).
3. **Tên mã P3** đổi thành "Backup & khôi phục (RPO ≤ 1h, §22)" trong file Phạm vi, Brief Backend P3.2 và danh sách M11.

## 7. Bảng áp quyết định U20 (đối chiếu nhanh)

| Quyết định | Sửa ở mục | Nội dung đã sửa |
| --- | --- | --- |
| U20-1 | 3.8 | `/me` chỉ bật 2FA + xem trạng thái; không nút tắt |
| U20-2 | 3.8 | Phiên chỉ hiện thời điểm tạo + hạn; đăng xuất từng phiên |
| U20-3 | 1, 3.8 | `/reset-password` phụ thuộc PR7 |
| U20-4 | 1, 3.4 | 3 trạng thái Online/Bận/Offline + bảng hành vi; "Vắng" dời Đợt 2 |
| U20-5 | 3.6, 6 | Ghi chú Phụ lục B đã cập nhật |
| U20-6 | 1, 3.1, 3.4 | Ghi chú phụ thuộc Q7 (hạn 28/12/2026) |
| Dòng 4 Phụ lục B | 3.4, 6 | Đổi trạng thái agent khác: chỉ Owner/Admin |

## 8. Câu hỏi phát sinh từ U20 — đã chốt (CEO 13/10/2026)

| # | Quyết định |
| --- | --- |
| Q-U20-1 | Đặt lại 2FA ở `/settings/members`: chỉ Owner/Admin, bắt buộc lý do, ghi audit. Thêm 1 dòng Phụ lục B |
| Q-U20-2 | Có mã dự phòng: 10 mã, mỗi mã dùng 1 lần, hiện 1 lần duy nhất khi bật 2FA, người dùng tự lưu |
| Q-U20-3 | Có nhãn "Phiên này"; các phiên khác có nút "Đăng xuất" |
| Q-U20-4 | Mất kết nối > 5 phút → tự Offline; nối lại không tự Online; hiện "Đã chuyển Offline do mất kết nối" |
| Q-U20-5 | Theo đề xuất: agent thấy nhắc sau 30 phút "Bận", Manager thấy số phút; không tự đổi trạng thái, không đẩy hàng chờ |
| Q-U20-6 | Q7 chỉ chặn dữ liệu khởi tạo, không chặn dựng màn và vẽ wireframe |

Bảng câu hỏi gốc (giữ để truy vết):

| # | Câu hỏi | Vì sao phải hỏi | Đề xuất |
| --- | --- | --- | --- |
| Q-U20-1 | "Tắt/đặt lại 2FA qua Admin" nằm ở màn nào, ai được làm? | Brief UI §5.4 (Thành viên) và Phụ lục B **chưa có** thao tác này; backend đã đóng route tắt 2FA. Thiếu chỗ này thì nhân viên mất điện thoại sẽ không đăng nhập lại được | Thêm thao tác "Đặt lại 2FA" vào `/settings/members` (#19): Owner/Admin đặt lại cho người khác, bắt buộc lý do, ghi audit, thu hồi mọi phiên; người bị đặt lại phải cài 2FA ở lần đăng nhập kế tiếp. 2FA của **Owner** chỉ Owner khác hoặc platform operator (trong phiên có lý do) đặt lại. Cần thêm 1 dòng Phụ lục B + 1 endpoint |
| Q-U20-2 | Khi bật 2FA có hiện mã dự phòng (backup codes) không? | Backend đã lưu `backup_codes` (N79.5). Nếu không hiện cho người dùng, cột này vô dụng và mọi ca mất điện thoại đều dồn về Admin | Hiện 1 lần sau khi bật, bắt tải/chép trước khi đóng |
| Q-U20-3 | Danh sách phiên có đánh dấu "Phiên này" không? | Không có IP/thiết bị, người dùng không phân biệt được phiên nào là máy mình → dễ tự đăng xuất nhầm | Có đánh dấu (backend biết phiên của request hiện tại, không cần lưu thêm dữ liệu cá nhân). Thêm nút "Đăng xuất mọi phiên khác" nếu backend hỗ trợ |
| Q-U20-4 | Đóng trình duyệt/mất mạng mà quên chuyển Offline thì agent tính là gì? | Bảng U20-4 chỉ nói trạng thái chọn tay. Nếu agent vẫn "Online" khi đã rời máy, hệ thống tiếp tục phân bổ hội thoại cho người không có mặt | Mất kết nối realtime quá N phút (đề xuất 5) → hệ thống tự chuyển Offline, rồi T17/T18 chạy như thường. Cố vấn xác nhận cùng `agent.presence` (realtime-spec, S4) |
| Q-U20-5 | "Bận" có giới hạn thời gian không? | "Bận" không bị đẩy về hàng chờ dù quá 10 phút → agent để "Bận" cả buổi vẫn giữ hội thoại; Manager không đổi được trạng thái (chỉ Owner/Admin) | Đợt 1 không chặn, nhưng sau 30 phút "Bận" hiện nhắc cho chính agent và hiện số phút "Bận" ở màn trạng thái team của Manager. SLA vẫn chạy nên cảnh báo SLA là lưới an toàn |
| Q-U20-6 | Q7 chặn **giá trị** hay chặn **cấu trúc màn**? | Hạn Q7 (28/12) trùng ngày bắt đầu S4 — đúng sprint FE làm các màn này. Nếu hiểu "chờ Q7" là chưa được dựng màn thì S4 trượt | Cấu trúc màn (form lịch tuần, ngày lễ, gán team ↔ kênh) chốt ngay trong spec này; Q7 chỉ quyết định **dữ liệu khởi tạo** cho từng workspace. U18 đã theo hướng này ("dùng giá trị tạm, ghi chờ Q7") — đề nghị anh xác nhận để FE không hiểu nhầm |

## 9. Cập nhật 26/10/2026 — áp quyết định sau bản nháp 3

Rà soát spec với prototype và các quyết định đã chốt sau 13/10 (FE, 26/10). Các dòng trên đã sửa theo:

| Mục | Trước | Sau | Căn cứ |
| --- | --- | --- | --- |
| A2 | Lệnh `--org --template --name`; nghiệm thu "đủ flow, pipeline, SLA, team ngay sau lệnh" | Thêm `--slug`, `--operator`, `--timezone`; nội dung mẫu chưa làm, nghiệm thu chỉ đạt khi xong | N158 |
| 3.1 | Manager xem team của mình | Manager chỉ đọc team mình thuộc về | U39 |
| 3.3, 3.4, 3.5 | Manager xem SLA, giờ làm việc, phân bổ | Manager không vào `/settings/workspace` | U39 |
| 3.4 | Tab Thông tin không có số liên hệ | Thêm SĐT liên hệ (`contactPhone`, `{{company_phone}}`) | N163 |
| 3.7 | Owner, Admin, Manager quản lý tag | Chỉ Owner, Admin (#23) | U36 |
| 3.8 | `/reset-password` chờ PR7; `/invite/[token]`; `/me` đổi tên, ảnh, mật khẩu | Quên/đặt lại mật khẩu theo N162; `/invite#token=`; đổi tên, ảnh để sau, đổi mật khẩu luôn đăng xuất thiết bị khác | N152, N162, SEC-03 |

Câu hỏi còn mở phát sinh từ cùng đợt rà soát: U40–U51 trong `QUESTIONS.md`.
