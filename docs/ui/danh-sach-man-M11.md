# Danh sách màn M11 — đối chiếu màn ↔ mã ↔ đợt

Bản nháp 1 · 13/10/2026 · Bổ sung cho Brief UI v1.0 · Đi kèm `spec-M8.md`

**Kết luận:** Đợt 1 có **30 màn chức năng** (37 đơn vị màn nếu tính từng tab) và 1 nhóm trang hệ thống, không phải 9 màn như Brief UI ghi cho riêng Admin. Cả 58 mã Đợt 1 đều đã có chỗ thể hiện hoặc được xác định là phần backend không cần màn. Đợt 2 có 17 màn mới, chỉ liệt kê tên.

Cách đếm: **Màn** = một đường dẫn riêng. **Tab** = một phần trong màn, đếm thành đơn vị riêng khi báo giá. **Drawer** = ngăn trượt trên màn danh sách, có đường dẫn riêng để mở thẳng.

## 1. Ba quyết định gộp/tách

| # | Câu hỏi | Quyết định đề xuất | Lý do |
| --- | --- | --- | --- |
| 1 | 6 màn con `/settings/*` (quick-replies, sla, routing, business-hours, customer-fields, tags): tách 6 hay gộp 1? | **Gộp thành 3 màn, 6 tab:** `/settings/workspace` (Thông tin & giờ làm việc · SLA & ưu tiên · Phân bổ), `/settings/quick-replies` (riêng), `/settings/customer-data` (Trường tùy chỉnh · Tag) | Giữ menu Cài đặt gọn (nguyên tắc 1). Gộp theo người dùng và tần suất: SLA, phân bổ, giờ làm việc Admin đặt một lần; mẫu trả lời Manager sửa thường xuyên nên để riêng; trường và tag cùng là cấu hình dữ liệu khách cấp công ty. Báo giá vẫn tính 6 tab |
| 2 | 4 màn auth tính vào phạm vi FE Đợt 1 hay coi là hạ tầng? | **Tính vào phạm vi FE Đợt 1** (5 màn nhóm Chung + bộ đổi workspace) | Đều cần thiết kế, kiểm lỗi, đủ 4 trạng thái và luồng 2FA bắt buộc (Brief-P17). Thư viện xác thực chỉ lo phần backend, giao diện FE vẫn phải làm. Quy mô nhỏ nhưng phải có trong báo giá |
| 3 | `/platform` có cần ở Đợt 1? | **Có, bản tối thiểu 3 tab:** Sức khỏe công ty · Phiên truy cập có lý do · Chính sách kênh. Tạo công ty/workspace vẫn bằng script (spec-M8 A1, A2) | Thiếu màn này, platform operator phải vào thẳng DB để hỗ trợ → vi phạm A8 (truy cập phải có lý do, ghi nhật ký). Chính sách kênh (§13) chỉ platform operator được sửa. Brief-P21 S5 đã có "platform admin" |

## 2. Danh sách màn Đợt 1

| # | Màn | Route | Mã tính năng | Bề mặt | Loại | Đợt |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Đăng nhập | `/login` | A5 | Chung | Màn | 1 |
| 2 | Xác thực 2 lớp khi đăng nhập | `/login/2fa` | A5 | Chung | Màn | 1 |
| 3 | Quên và đặt lại mật khẩu | `/reset-password` | A5 | Chung | Màn | 1 |
| 4 | Nhận lời mời, tạo mật khẩu | `/invite/[token]` | A3, A5 | Chung | Màn | 1 |
| 5 | Hồ sơ cá nhân | `/me` | A5, C11 | Chung | Màn · 3 tab (Thông tin, Bảo mật, Thông báo) | 1 |
| 6 | Hộp thư (3 cột) | `/inbox`, `/inbox/[conversationId]` | C1–C11, C20, B3, E1, L1, P6 | Inbox | Màn lớn | 1 |
| 7 | Danh sách khách | `/customers` | J1, J2, J4, J5, J6 | Khách hàng | Màn | 1 |
| 8 | Hồ sơ khách | `/customers/[id]` | J1, J2, J3, J4, J6, I2 | Khách hàng | Màn | 1 |
| 9 | Gộp khách (so sánh 2 hồ sơ) | `/customers/merge` | J3 | Khách hàng | Màn | 1 |
| 10 | Nhập khách từ file | `/customers/import` | J5 | Khách hàng | Màn · 3 bước | 1 |
| 11 | Yêu cầu dữ liệu cá nhân | `/customers/privacy` | P7, P5 (phần xóa) | Khách hàng | Màn | 1 |
| 12 | Pipeline lead | `/leads` | G1, G2, G3 | Khách hàng | Màn | 1 |
| 13 | Chi tiết lead | `/leads/[id]` | G1, G2, G3 | Khách hàng | Drawer | 1 |
| 14 | Danh sách ticket | `/tickets` | I1, I2, I3 | Khách hàng | Màn | 1 |
| 15 | Chi tiết ticket | `/tickets/[id]` | I1, I2, I3 | Khách hàng | Drawer | 1 |
| 16 | Tổng quan | `/overview` | A7, P4 | Admin | Màn | 1 |
| 17 | Danh sách bot flow | `/bots` | D2, D3 | Admin | Màn | 1 |
| 18 | Trình dựng bot | `/bots/[id]` | D1, D2, D4, D6, D15 | Admin | Màn lớn | 1 |
| 19 | Thành viên | `/settings/members` | A3, A5, C9 (giới hạn tải từng agent) | Admin | Màn | 1 |
| 20 | Team | `/settings/teams` | A4 | Admin | Màn | 1 |
| 21 | Workspace | `/settings/workspace` | A2, C8, C9, C10, D4 | Admin | Màn · 3 tab | 1 |
| 22 | Mẫu trả lời nhanh | `/settings/quick-replies` | C7 | Admin | Màn | 1 |
| 23 | Dữ liệu khách | `/settings/customer-data` | J1, J4 | Admin | Màn · 2 tab | 1 |
| 24 | Kênh | `/settings/channels` | B1, B2, B3 | Admin | Màn | 1 |
| 25 | Cấu hình Zalo OA | `/settings/channels/[id]` | B1, B2, B3 | Admin | Màn | 1 |
| 26 | AI nội bộ | `/settings/ai` | E1, E4, E5, E7, E20, L1 | Admin | Màn | 1 |
| 27 | Tự chủ & feature flag | `/settings/autonomy` | A13 | Admin | Màn | 1 |
| 28 | Audit log | `/settings/audit` | A8, A9, A17 | Admin | Màn | 1 |
| 29 | Sự cố bảo mật | `/settings/security` | P11 | Admin | Màn | 1 |
| 30 | Platform | `/platform` | A7, A8, B3 (chính sách kênh) | Admin (platform operator) | Màn · 3 tab | 1 |
| 31 | Trang hệ thống: 403, 404, Bảo trì, Lỗi chung | `/403`, `/404`, `/maintenance`, `/error` | — | Chung | 4 trang tĩnh | 1 |

**Đếm Đợt 1:** 30 màn chức năng (#1–30) · 37 đơn vị màn khi tính tab (+2 ở `/me`, +2 ở `/settings/workspace`, +1 ở `/settings/customer-data`, +2 ở `/platform`) · + 4 trang hệ thống.

### Thành phần dùng chung (không phải màn, vẫn phải thiết kế)

| Thành phần | Dùng ở | Mã |
| --- | --- | --- |
| Thanh trên cùng: bộ đổi workspace, trạng thái agent, menu cá nhân | Mọi màn | A5, C10 |
| Thông báo đẩy + dải "AI đang tắt" + dải phiên truy cập platform | Mọi màn | C11, A8 |
| Hộp thoại Chuyển hội thoại (người/team + lý do) | Inbox | C5 |
| Hộp thoại Đóng hội thoại (Đã xong / Không phản hồi / Spam) | Inbox | C4 |
| Hộp thoại Gửi ZNS / Gọi điện / Tạo task khi hết khung gửi | Inbox | B3 |
| Hộp thoại Lý do Thua | Pipeline lead | G3 |
| Hộp thoại Mời thành viên | Thành viên | A3 |
| Hộp thoại Mở phiên truy cập (bắt buộc lý do) | Platform | A8 |
| Hộp thoại Xác nhận thao tác phá hủy | Mọi màn có xóa | — |
| Bảng phím tắt (`?`) | Inbox | C1–C11 |

## 3. Đối chiếu 58 mã Đợt 1

| Mã | Thể hiện ở | Ghi chú |
| --- | --- | --- |
| A1 | Script quản trị | spec-M8 §2 |
| A2 | Script quản trị + #21 | spec-M8 §2 |
| A3 | #4, #19 | |
| A4 | #20 | |
| A5 | #1–5 | |
| A6 | Backend | Cách ly RLS, không có màn |
| A7 | #16, #30 | |
| A8 | #28, #30 | |
| A9 | #28 | |
| A13 | #27 | |
| A17 | #28 | |
| B1 | #6, #24, #25 | |
| B2 | #25 | Hiện trạng thái token, nút làm mới |
| B3 | #6, #25, #30 | |
| C1–C3 | #6 | |
| C4 | #6 | Máy trạng thái ở backend; giao diện hiện nhãn trạng thái |
| C5 | #6 | |
| C6 | #6 | |
| C7 | #6, #22 | |
| C8 | #6, #21 | |
| C9 | #19, #21 | Phần "theo kỹ năng": chờ Q-M8-1 |
| C10 | Thanh trên cùng, #21 | |
| C11 | #5, thanh trên cùng | |
| C20 | #6 | |
| D1, D2 | #18 (D2 cả #17) | |
| D3 | #17 | Flow mặc định có sẵn từ mẫu |
| D4 | #18, #21 | |
| D6, D15 | #18 | |
| E1 | #6, #26 | Tag do AI gắn trong Inbox; danh sách ý định ở #26 |
| E4 | Backend + #26 (chỉ đọc) | Router, không cần màn riêng |
| E5 | #26 | |
| E6 | Backend (CI) | Công cụ chạy test ở Đợt 1 không có màn; xem kết quả ở Đợt 2 |
| E7 | #26 (chỉ đọc) | |
| E20 | #26 (chỉ đọc) | |
| G1–G3 | #12, #13 | |
| I1–I3 | #14, #15 | I2 cả #8 |
| J1 | #7, #8, #23 | |
| J2 | #8 | |
| J3 | #8, #9 | |
| J4 | #7, #23 | Phần "lưu phân khúc": chờ Q-M8-2 |
| J5 | #7, #10 | |
| J6 | #8 | |
| L1 | #6 | |
| P1, P2, P3 | Backend | Giới hạn tần suất, mã hóa, sao lưu — không có màn |
| P4 | Backend + #16 | Giám sát qua Sentry/Grafana; tóm tắt sức khỏe ở Tổng quan |
| P6 | #6 | Trạng thái "Đang kiểm tra file" |
| P7 | #11 | |
| P11 | #29 | |

**Kết quả:** 58/58 mã đã có chỗ thể hiện. 7 mã là phần backend không cần màn: A6, E4, E6, P1, P2, P3, P4 (P4 có thêm tóm tắt ở Tổng quan). **Không có mã nào phải bổ sung màn mới hay chuyển Đợt 2.**

## 4. Màn Đợt 2 (chỉ liệt kê tên, chưa viết spec)

| # | Màn | Route | Mã tính năng | Bề mặt | Đợt |
| --- | --- | --- | --- | --- | --- |
| 32 | Cửa sổ chat Widget (nhúng website) | — (loader + widget) | B5, B6 | Widget | 2 |
| 33 | Cấu hình Widget | `/settings/widget` | B5, B6 | Admin | 2 |
| 34 | Kết nối Facebook | `/settings/channels/[id]` (thêm loại kênh) | B4 | Admin | 2 |
| 35 | Knowledge Base — danh sách | `/knowledge` | E2, F1–F4, F7, F9 | Admin | 2 |
| 36 | Knowledge Base — tài liệu (duyệt, phiên bản) | `/knowledge/[id]` | F5, F6, F13 | Admin | 2 |
| 37 | Bảng giá B2B (duyệt 2 người) | `/settings/pricing` | G4, G5 | Admin | 2 |
| 38 | Báo giá — danh sách | `/quotes` | G6 | Khách hàng | 2 |
| 39 | Báo giá — chi tiết, duyệt gửi | `/quotes/[id]` | G6 | Khách hàng | 2 |
| 40 | Automation — danh sách | `/automation` | K1–K4, I4 | Admin | 2 |
| 41 | Automation — dựng rule | `/automation/[id]` | K1–K3 | Admin | 2 |
| 42 | Báo cáo | `/reports` | M1–M7, M9, M11–M13 | Admin | 2 |
| 43 | AI trả lời khách (mở rộng `/settings/ai`) | `/settings/ai` (tab mới) | E2, E3, E6 (bộ 200 câu), E8, E9, E13, E15, E16, E19, E25, E28 | Admin | 2 |
| 44 | Catalog, khuyến mãi, vùng giao B2C | `/settings/catalog` | H1, H3, H4 | Admin | 2 |
| 45 | Đơn hàng — danh sách | `/orders` | H5–H7, H9, H13 | Khách hàng | 2 |
| 46 | Đơn hàng — chi tiết, đổi trả | `/orders/[id]` | H10, H11, H14 | Khách hàng | 2 |
| 47 | Campaign | `/campaigns` | N1–N3 | Admin | 2 |
| 48 | API key, webhook, tích hợp POS | `/settings/api-keys`, `/settings/webhooks`, `/settings/integrations` | O1, O2, O3, H8 | Admin | 2 |

Phần thêm vào màn có sẵn ở Đợt 2 (không phải màn mới): gợi ý AI, điểm lead, cảm xúc, đề xuất cập nhật CRM, ghim tin, trả lời trích dẫn, dòng thời gian, lưu bộ lọc, thao tác hàng loạt, tìm toàn văn trong Inbox; gửi ZNS giao dịch; node "AI trả lời" trong trình dựng bot; cấu hình thời hạn lưu dữ liệu (B7, B11, C12, C13, C18, C22, C24, C26, D5, G7, G8, L2–L4, J7, H2, H12, P5).

## 5. Đề xuất bổ sung

1. **Sửa Brief UI §5:** câu "Admin Đợt 1 có 9 màn" đổi thành tham chiếu tới danh sách này (30 màn chức năng Đợt 1). Phần 7 lộ trình giao diện thêm cột "màn số" theo bảng mục 2.
2. **Phụ lục C — wireframe trước S2:** giữ 4 màn chính (#6 Hộp thư, #8 Hồ sơ khách, #12 Pipeline lead, #18 Trình dựng bot). 26 màn còn lại nộp wireframe theo sprint, trước sprint làm màn đó ít nhất 1 tuần, để không dồn vào 30/11.
3. **Đếm cho báo giá FE:** dùng 37 đơn vị màn + 10 thành phần dùng chung + 4 trang hệ thống; màn lớn (#6, #18) tính riêng vì khối lượng tương đương 3–4 màn thường.
