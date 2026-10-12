# PHỤ LỤC B — MA TRẬN QUYỀN

**Brief UI v1.0 · 12/10/2026 · sửa 13/10/2026 (thêm 2 dòng M9)**

Nguồn đối chiếu quyền cho FE. Bản dạng văn bản do CĐT gửi 13/10/2026; file `.xlsx` không lưu vào repo. Khi Brief UI và Brief Backend mâu thuẫn về quyền, Brief Backend thắng (P9, P17); server kiểm quyền theo ma trận này.

✓ = được · — = không · Team = trong team của mình · Mình = bản ghi của mình · Che = SĐT bị che · Phiên = chỉ trong phiên truy cập có lý do (A8)

| Nhóm | Thao tác | Owner | Admin | Manager | Sales | Support | Marketing | Viewer | Platform op |
|---|---|---|---|---|---|---|---|---|---|
| Hộp thư | Xem hội thoại của mình + chưa ai nhận | ✓ | ✓ | ✓ | Team | Team | — | — (Owner bật được) | Phiên |
| Hộp thư | Xem tất cả hội thoại workspace | ✓ | ✓ | ✓ | — | — | — | — | Phiên |
| Hộp thư | Nhận hội thoại | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — |
| Hộp thư | Trả lời khách, ghi chú nội bộ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — |
| Hộp thư | Chuyển hội thoại | ✓ | ✓ | ✓ | Team | Team | — | — | — |
| Hộp thư | Phân công lại hội thoại của người khác | ✓ | ✓ | ✓ | — | — | — | — | — |
| Hộp thư | Đóng hội thoại | ✓ | ✓ | ✓ | Mình | Mình | — | — | — |
| Hộp thư | Chặn spam | ✓ | ✓ | ✓ | — | — | — | — | — |
| Hộp thư | Bật cờ "chỉ người phục vụ" | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — |
| Khách hàng | **Xem danh sách khách** ⬅ MỚI | ✓ | ✓ | ✓ | ✓ | ✓ | Che | Che | Phiên |
| Khách hàng | **Xem hồ sơ khách** ⬅ MỚI | ✓ | ✓ | ✓ | ✓ | ✓ | Che | Che | Phiên |
| Khách hàng | Xem SĐT đầy đủ | ✓ | ✓ | ✓ | ✓ | ✓ | Che | Che | Phiên |
| Khách hàng | Sửa hồ sơ khách | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — |
| Khách hàng | Gộp khách | ✓ | ✓ | ✓ | Xác nhận đề xuất (§12) | — | — | — | — |
| Khách hàng | Tách hồ sơ đã gộp | ✓ | ✓ | — | — | — | — | — | — |
| Khách hàng | Lead: tạo, đổi bước, Thắng/Thua | ✓ | ✓ | ✓ | Mình | — | — | — | — |
| Khách hàng | Ticket: tạo, xử lý | ✓ | ✓ | ✓ | Tạo | ✓ | — | — | — |
| Khách hàng | Nhập khách từ file | ✓ | ✓ | — | — | — | — | — | — |
| Dữ liệu | Xuất dữ liệu (khách, hội thoại, audit) | ✓ | ✓ | — | — | — | — | — | — |
| Dữ liệu | Xử lý yêu cầu dữ liệu cá nhân (P7) | ✓ | ✓ | — | — | — | — | — | — |
| Tổng quan | Xem Tổng quan / báo cáo | ✓ | ✓ | ✓ | Mình | Mình | ✓ | ✓ | Sức khỏe tenant |
| Tự động hóa | Sửa, xuất bản bot flow | ✓ | ✓ | ✓ | — | — | — | — | — |
| Cài đặt | Cài đặt workspace, kênh, team | ✓ | ✓ | — | — | — | — | — | — |
| Cài đặt | Mời thành viên, đổi vai trò | ✓ | ✓ (không nâng lên Owner) | — | — | — | — | — | — |
| AI | Bật/tắt AI nội bộ, ngân sách AI | ✓ | ✓ | — | — | — | — | — | — |
| AI | Chuyển AI sang Production | ✓ | — | — | — | — | — | — | — |
| AI | Hạ mức tự chủ, tắt feature flag | ✓ | ✓ | — | — | — | — | — | — |
| AI | Nâng mức tự chủ | ✓ | — | — | — | — | — | — | — |
| Bảo mật | Xem audit log công ty | ✓ | ✓ | — | — | — | — | — | Audit nền tảng |
| Bảo mật | Mở sự cố bảo mật | ✓ | ✓ | — | — | — | — | — | ✓ |
| Nền tảng | Sửa bảng chính sách kênh (§13) | — | — | — | — | — | — | — | ✓ |
| Nền tảng | Mở phiên truy cập dữ liệu công ty | — | — | — | — | — | — | — | ✓ (bắt buộc lý do, 60 phút) |

---

## Ghi chú

- Ô vàng = được có điều kiện (xem chữ trong ô).
- Viewer không xem Inbox theo mặc định; Owner có thể bật cho từng người.
- **Marketing/Viewer xem danh sách và hồ sơ khách, nhưng SĐT bị che (M9 — bổ sung 13/10/2026).**
- Mọi thao tác ở dòng Xuất dữ liệu, Gộp/Tách khách, Mời/đổi vai trò, AI Production, mức tự chủ, phiên truy cập đều ghi audit.

---

## Nguồn

Brief UI v1.0 Phụ lục B; Brief-P9 (quyền endpoint). Sửa lần 2 ngày 13/10/2026.

## Thay đổi so với bản gốc 12/10/2026

Thêm 2 dòng vào mục Khách hàng, ngay trên "Xem SĐT đầy đủ":

- `Xem danh sách khách` — Marketing: Che, Viewer: Che
- `Xem hồ sơ khách` — Marketing: Che, Viewer: Che

Đã đối chiếu 13/10/2026 với file `.xlsx` bản 12/10: 30 dòng cũ giữ nguyên nội dung và thứ tự, chỉ thêm đúng 2 dòng trên (`QUESTIONS.md` U9).
