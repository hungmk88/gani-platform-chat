# Dàn ý prototype HTML — 4 màn Đợt 1 (chờ CĐT duyệt trước khi dựng)

Căn cứ: Brief UI v1.0 (Phần 2, 4, 5.6, 6, Phụ lục C), Phụ lục B, file 135 mã, Brief Backend v1.0 P9/P14, `QUESTIONS.md` U1–U18.
Hạn nộp wireframe: **30/11/2026** (trước S2). Tài liệu này chỉ là dàn ý; chưa dựng gì.

## 1. Phạm vi và hình thức

| Màn | Route | Ghi chú |
|---|---|---|
| Hộp thư | `/inbox` | 3 cột, Zalo OA, AI chỉ nội bộ |
| Hồ sơ khách | `/customers/{id}` + màn gộp | Danh sách `/customers` ngoài 4 màn, chỉ dùng làm điểm vào |
| Pipeline lead | `/leads` | Kanban 6 bước; Thắng/Thua tách riêng (U6) |
| Trình dựng bot | `/bots` | **Dạng form**, không vẽ canvas (U16). Canvas là Đợt 2 |

Hình thức: HTML + CSS + JS thuần, không framework, không thư viện ngoài, mở bằng trình duyệt là bấm được. Mỗi màn một file, dùng chung `tokens.css`. Hai nút chuyển ở góc: **trạng thái** (`Bình thường · Đang tải · Trống · Lỗi · AI tắt` và trạng thái riêng của màn) và **vai trò** (Owner, Manager, Sales, Support, Marketing, Viewer). Không có dữ liệu thật; tên khách là dữ liệu mẫu.

Prototype dùng font hệ thống thay Inter (tự host sẽ thêm khi dựng app). Không làm dark mode.

## 2. Token dự kiến (để CĐT kiểm không có giá trị lạ)

Giá trị là đề xuất, vendor quyết khi dựng (Brief UI §1.1). Tỉ lệ tương phản đã tính theo công thức WCAG 2.1.

| Nhóm | Token | Giá trị đề xuất | Tương phản |
|---|---|---|---|
| Nền | `--bg`, `--bg-subtle`, `--surface` | `#FFFFFF`, `#F3F4F6`, `#FFFFFF` | |
| Viền | `--border`, `--border-strong` | `#E5E7EB`, `#6B7280` | strong/bg = 4,83 |
| Chữ | `--text`, `--text-muted` | `#1F2937`, `#4B5563` | 14,68 · 7,56 (trên subtle 6,87) |
| Màu nhấn (1 màu) | `--accent`, `--accent-on` | `#1D4ED8`, `#FFFFFF` | 6,70 |
| Trạng thái OK | `--ok-bg`, `--ok-text` | `#DCFCE7`, `#166534` | 6,49 |
| Trạng thái sắp quá hạn | `--warn-bg`, `--warn-text` | `#FEF3C7`, `#854D0E` | 6,15 |
| Trạng thái quá hạn / lỗi | `--error-bg`, `--error-text` | `#FEE2E2`, `#991B1B` | 6,80 |
| Ghi chú nội bộ | `--color-note`, `--color-note-text` | `#FEF9C3`, `#1F2937` | 13,67 |
| Cỡ chữ (4) | `--fs-12/14/16/20` | 12 / 14 / 16 / 20 px | Admin 14 |
| Khoảng cách | `--sp-1…8` | 4, 8, 12, 16, 24, 32, 40, 48 px | lưới 4/8 |
| Bo góc | `--r-input/card/dialog` | 4 / 8 / 12 px | |
| Chuyển động | `--motion` | 150 ms (tối đa 200 ms) | |

Quy tắc: nút chính là màu nhấn, mỗi màn đúng 1 nút chính. Xanh/vàng/đỏ chỉ để làm nhãn trạng thái. Ghi chú nội bộ dùng `--color-note`, không dùng màu cảnh báo. Giá trị ngoài bảng này bị lint chặn khi dựng app.

## 3. Bốn trạng thái và trạng thái riêng của từng màn

Áp dụng cho cả 4 màn (hợp của §2.2 và Phụ lục C, theo M10):

| Trạng thái | Nội dung |
|---|---|
| Đang tải | Skeleton danh sách; vòng quay trên nút đang xử lý |
| Trống | 1 câu + 1 hành động **theo vai trò** (Admin: "Chưa có hội thoại — Kết nối Zalo OA"; Sales: "Chưa có hội thoại nào giao cho bạn") |
| Lỗi | Câu thường + mã `traceId` + "Thử lại" |
| AI tắt | Màn vẫn dùng đủ; phần AI thay bằng dữ liệu không-AI; Manager/Admin thấy dải "AI đang tắt — [lý do]", Sales/Support không thấy |

| Màn | Trạng thái riêng (Phụ lục C) |
|---|---|
| Hộp thư | Tin gửi lỗi (nút "Gửi lại"), "Đã được [tên] nhận" (409), ô gửi bị khóa (`api_closed`), cảnh báo có phí (`paid_only`), vượt giới hạn tải agent |
| Hồ sơ khách | SĐT bị che, "Đề xuất gộp", cờ "Chỉ người phục vụ" |
| Pipeline lead | Cột nhiều thẻ (cuộn), đang lưu (chờ máy chủ), hộp chọn lý do Thua |
| Trình dựng bot | Lỗi cấu hình node, chặn xuất bản khi thiếu câu chào bắt buộc |
| Pipeline lead / Trình dựng bot | "AI tắt": ghi **"Không áp dụng AI"** có chủ đích (không có phần AI) |

## 4. Màn 1 — Hộp thư

**Khung hình (frame):** (1) bình thường; (2) đang tải; (3) trống Sales; (4) trống Admin; (5) lỗi; (6) AI tắt, thẻ handoff dạng dữ liệu bot; (7) khóa ô gửi `api_closed` với 3 lựa chọn ZNS / gọi điện / tạo task; (8) cảnh báo `paid_only`; (9) tin gửi lỗi; (10) "Đã được [tên] nhận"; (11) hộp thoại Chuyển; (12) hộp thoại Đóng + nhắc "Cập nhật lead?"; (13) mẫu trả lời nhanh `/`; (14) bảng phím tắt `?`; (15) dưới 1280px, cột phải thành ngăn kéo.

**Bố cục:** cột trái (bộ lọc: trạng thái, kênh, workspace, người phụ trách, tag, SLA; tìm tên/SĐT; dòng hội thoại có ảnh + biểu tượng kênh, tên, tin cuối chữ thuần, nhãn trạng thái, đồng hồ SLA, số chưa đọc; tải agent "Đang xử lý 4/5 · Chờ khách 3"); cột giữa (thẻ handoff gập/mở, danh sách tin, ô soạn); cột phải (hồ sơ khách tóm tắt, tag, lead, ticket, ghi chú).

**Hai biến thể cho tính năng chờ O7 (M7):** "Đã xem" có / không; "Khách đã thu hồi tin" có / không; trích dẫn có / không. Vẽ cả hai, chốt sau S3.

**Đếm click (4 thao tác chính).** Ngưỡng: ≤ 2 click hoặc 1 phím. Định nghĩa của CĐT (M5): bước phụ trong hộp thoại tính là 1 click của hộp thoại. Bảng ghi cả số thao tác thực để CĐT thấy rõ.

| Thao tác | Bằng chuột | Số click theo định nghĩa CĐT | Bằng phím | Thao tác thực |
|---|---|---|---|---|
| Nhận | bấm "Nhận" | **1** | `A` | 1 |
| Trả lời | bấm vào ô soạn, gõ, Enter | **1** (+ gõ) | `R`, gõ, Enter | 1 + gõ |
| Chuyển | "Chuyển" → chọn người + chip lý do trong cùng hộp thoại → "Xác nhận" | **2** | `T`, chọn, Enter | 3 |
| Đóng | "Đóng" → bấm kết quả (bấm là đóng) | **2** | `E`, chọn, Enter | 2 |

Ghi chú: Chuyển có 3 thao tác thực, nằm ngoài ngưỡng nếu đếm thô. CĐT đã chấp nhận định nghĩa ở M5; bảng này giữ cả hai cột để biên bản duyệt ghi rõ. Phương án giữ 2 thao tác thật: chọn chip lý do mặc định sẵn và bấm vào tên người là xác nhận luôn (vẽ thêm biến thể B để so sánh).

**Phím tắt** (chỉ ngoài ô soạn): `A R T E N J K / ? Esc`; trong ô soạn chỉ có Enter, Shift+Enter, Esc, `/`. Không dùng Ctrl/Cmd+Shift.

**Đối chiếu mã tính năng:** C1, C2 (đang gõ, đã đọc), C3, C4 (nhãn trạng thái), C5 (nhận, chuyển), C6 (ghi chú, @mention), C7 (mẫu trả lời nhanh), C8 (SLA), C10 (agent online), C11 (thông báo, chỉ hiện chấm/tiêu đề tab), C20 (đính kèm file, "Đang kiểm tra file"), B3 (khung gửi Zalo), L1 và E1 (thẻ handoff, tag ý định; có dạng AI tắt), J1–J6 (cột phải). C9 chỉ hiện nhãn "phân bổ tự động" nếu spec M8 yêu cầu.

**Chờ:** spec M8 cho C7 (quản lý mẫu), C8 (cấu hình SLA), C9, C10 (giờ làm việc); Q7 (U18) cho giá trị SLA và giới hạn tải. Trong prototype dùng giá trị tạm, dán nhãn "chờ spec chính thức".

## 5. Màn 2 — Hồ sơ khách

**Frame:** bình thường; đang tải; trống (khách chưa có hội thoại/lead/ticket); lỗi; AI tắt (không áp dụng, ghi rõ); SĐT bị che (Marketing/Viewer); "Đề xuất gộp" (SĐT `unverified` trùng, không tự gộp); cờ "Chỉ người phục vụ" bật; màn gộp 2 hồ sơ (cạnh nhau, chọn giá trị giữ từng trường, xác nhận); hộp thoại tách hồ sơ (chỉ Owner/Admin).

**Bố cục:** thông tin cơ bản + trường tùy chỉnh (J1); định danh đa kênh (Zalo, Facebook, SĐT) mỗi cái có nhãn `verified` / `unverified` / `sales_confirmed`; tag và phân khúc (J4); cờ "Chỉ người phục vụ"; 4 tab **Hội thoại · Lead · Ticket · Ghi chú** (Báo giá và Đơn là Đợt 2, ẩn).

**Quyền:** theo Phụ lục B. Marketing/Viewer xem được, SĐT che `090***4567` (U9, chờ file xlsx sửa để kiểm). Gộp: Owner/Admin/Manager; Sales chỉ xác nhận đề xuất; tách: Owner/Admin.

**Đối chiếu mã:** J1, J2, J3, J4, J6, I2 (nhận diện qua SĐT đăng ký, trong tab Ticket), G1 (tab Lead), I1 (tab Ticket), C6 (tab Ghi chú), P7 (chỉ liên kết sang `/customers/privacy`, màn đó ngoài 4 màn). J5 (nhập/xuất) thuộc danh sách khách, không vẽ ở đợt này.

**Chờ:** M8 cho trường tùy chỉnh (J1) và quản lý tag (J4).

## 6. Màn 3 — Pipeline lead

**Frame:** bình thường (6 cột); đang tải; trống; lỗi; cột nhiều thẻ (cuộn trong cột); thẻ đang lưu (khóa kéo, chờ máy chủ); kéo sang **Thua** → hộp chọn lý do (bắt buộc, chặn nếu bỏ trống); kéo sang **Thắng**; bộ lọc (người phụ trách, bước, kênh nguồn, khoảng ngày); "Không áp dụng AI".

**Quy ước theo U6:** 6 cột là 6 bước, **tên tạm "Bước 1–6"** kèm nhãn "mặc định, chờ O1". Thắng / Thua là trạng thái kết thúc riêng (API `POST /v1/leads/{id}/close`, tách `PATCH /v1/leads/{id}/stage`). Vẽ 2 biến thể để CĐT chọn: (A) bộ lọc "Đang mở / Thắng / Thua", (B) hai cột phụ bên phải. Kéo thẻ sang cột phụ gọi `close`.

**Thẻ lead:** tên khách, công ty, người phụ trách, ngày liên hệ cuối, số ngày ở bước hiện tại, nguồn (kênh + liên kết hội thoại gốc).

**Đối chiếu mã:** G1 (lead tự tạo, nguồn), G2 (Kanban 6 bước), G3 (lý do Thua bắt buộc). G7 (điểm lead) và G8 (thẻ tóm tắt) là Đợt 2, ẩn.

**Chờ:** O1 (tên 6 bước, danh sách lý do Thua) trước S4; phụ thuộc Q9 của Backend (mặc định 6 bước).

## 7. Màn 4 — Trình dựng bot (dạng form)

Không có canvas (U16). Brief UI §5.6 và Phụ lục C đã cho phép phương án này. **Cần ghi vào phụ lục hợp đồng:** D1 trong file 135 mã ghi "Flow kéo-thả"; chuyển canvas sang Đợt 2 là đổi phạm vi nghiệm thu D1.

**Frame:** danh sách flow (mỗi kênh một flow chào bắt buộc; mẫu mặc định theo workspace, D3); trình chỉnh flow dạng form; cấu hình node; nhánh lỗi; chạy thử (D2); xuất bản; lịch sử phiên bản; lỗi cấu hình node; **chặn xuất bản khi thiếu câu chào bắt buộc**; đang tải / trống / lỗi; "Không áp dụng AI" (node `ai_answer` là Đợt 2, ẩn).

**Cách trình bày form:** danh sách bước theo thứ tự, mỗi bước là một thẻ gập mở với loại node và các ô cấu hình. Rẽ nhánh dùng khối lồng "Nếu / Thì / Ngược lại". Mỗi bước gọi tool có mục "Nếu lỗi" (mặc định thử lại 1 lần rồi chuyển người, D15). Thêm bước bằng nút "Thêm bước" chọn loại. Không kéo-thả; sắp xếp bằng nút lên/xuống.

**Loại node Đợt 1 (Backend P13):** trigger, message, question, condition, set_variable, tag, api_call (chỉ tool nội bộ), delay, handoff, jump_to_flow, end. `ai_answer` và `wait_for_event` ngoài Đợt 1.

**Phiên bản:** Nháp → Đã xuất bản (bất biến). **Không làm so sánh khác biệt 2 phiên bản** (Brief UI §5.6; Backend P13 chỉ so sánh bằng kết quả chạy cùng bộ kịch bản).

**Đối chiếu mã:** D1 (dạng form), D2 (phiên bản, chạy thử), D3 (mẫu mặc định), D4 (ngoài giờ: nhận lời nhắn, hẹn gọi lại), D6 (jump_to_flow), D15 (nhánh lỗi, thử lại). Quyền: Owner/Admin/Manager sửa và xuất bản (Phụ lục B); xuất bản ghi audit và **chờ máy chủ xác nhận**.

**Chờ:** M8 cho D4 (cấu hình giờ làm việc; Q7).

## 8. Bảng đối chiếu mã tổng

| Mã | Hộp thư | Hồ sơ khách | Pipeline | Bot |
|---|---|---|---|---|
| B3, C1–C8, C10, C11, C20 | ● | | | |
| E1, L1 | ● | | | |
| J1–J4, J6 | ● (cột phải) | ● | | |
| I1, I2 | ● (cột phải) | ● (tab) | | |
| G1–G3 | ● (cột phải) | ● (tab) | ● | |
| D1–D4, D6, D15 | | | | ● |
| C9 | chờ M8 | | | |

## 9. Quy trình duyệt và kế hoạch dựng

1. CĐT duyệt dàn ý này (hoặc yêu cầu đổi). Không dựng trước khi duyệt.
2. Dựng theo thứ tự: `tokens.css` + khung chung (trạng thái, vai trò) → Hộp thư → Pipeline → Hồ sơ khách → Trình dựng bot.
3. Mỗi màn nộp kèm 3 thứ: danh sách token, bảng đếm click (Hộp thư), bảng đối chiếu mã. Kiểm tương phản bằng công cụ trước khi nộp.
4. Biên bản duyệt ghi rõ các dòng "chờ spec chính thức" (M8, Q7, O1, O7) để không coi là đã chốt.

## 10. Việc cần CĐT quyết trước khi dựng

| # | Câu hỏi | Mặc định đề xuất |
|---|---|---|
| P1 | Duyệt định nghĩa đếm click (Chuyển = 3 thao tác thực, tính 2 theo M5) hay yêu cầu biến thể B (2 thao tác thật)? | Vẽ cả hai, CĐT chọn |
| P2 | Thắng/Thua: bộ lọc (A) hay cột phụ (B)? | Vẽ cả hai |
| P3 | Ghi thay đổi phạm vi D1 (canvas sang Đợt 2) vào phụ lục hợp đồng | Có |
| P4 | Prototype dùng font hệ thống thay Inter | Có |
