# Đề xuất sửa Brief UI, Phụ lục B, Brief Backend (sau khi CEO chốt 6 quyết định)

Bản nháp 2 · 13/10/2026 · đã sửa theo U20 · Chỉ đề xuất — chưa sửa bản v1.0 đã gửi. Gộp thành v1.1 sau khi cố vấn kỹ thuật review.

## 1. Brief UI v1.0 → v1.1

| Vị trí                                                | Hiện tại                                                                         | Đề xuất sửa                                                                                                                                                                                                                      |
|-------------------------------------------------------|----------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Phần 5 (đầu)                                          | “Admin Đợt 1 có 9 màn; …”                                                        | “Đợt 1 có 30 màn chức năng (37 đơn vị màn khi tính tab) + 10 thành phần dùng chung + 4 trang hệ thống — xem `danh-sach-man-M11` (đưa vào Phụ lục E). Màn thuộc Đợt 2 ẩn bằng feature flag, không hiện rồi báo "không có quyền".” |
| 5.1 bảng phạm vi                                      | Đợt 1 thiếu team/mẫu trả lời/tag                                                 | Thêm hàng: “Mẫu trả lời nhanh (C7), SLA/phân bổ/giờ làm việc (C8–C10, D4), trường tùy chỉnh và tag (J1, J4)”. Đợt 2 thêm: “Phân bổ theo kỹ năng, lưu phân khúc”                                                                  |
| 5.2 menu Cài đặt                                      | `/settings/{workspace, members, teams, channels, ai, autonomy, audit, security}` | Thêm `quick-replies`, `customer-data`. Ghi chú: `workspace` có 3 tab (Thông tin & giờ làm việc · SLA & ưu tiên · Phân bổ); `customer-data` có 2 tab (Trường tùy chỉnh · Tag)                                                     |
| Mục mới 5.x                                           | —                                                                                | Thêm 7 spec ngắn từ `spec-M8.md` §3 (A4, C7, C8, C10+D4, C9, J1, J4) và §3.8 (A5, A3) vào Phần 5 và Phần 2                                                                                                                       |
| Phần 7                                                | Bảng sprint không có số màn                                                      | Thêm cột “Màn số” theo bảng M11 §2; S2 ghi rõ \#1–5 (auth, `/me`); S4: \#9–11, \#14–15, \#19–23; S5: \#26–30                                                                                                                     |
| Phụ lục C                                             | Wireframe 4 màn                                                                  | Giữ 4 màn (#6, \#8, \#12, \#18); các màn còn lại nộp wireframe trước sprint làm màn đó ≥ 1 tuần                                                                                                                                  |
| Mọi nơi nhắc “phân bổ theo kỹ năng” / “lưu phân khúc” | —                                                                                | Ghi rõ “Đợt 2”                                                                                                                                                                                                                   |
| Tên mã P3                                             | “Sao lưu hằng ngày…”                                                             | “Backup & khôi phục (RPO ≤ 1h, §22)”                                                                                                                                                                                             |

## 2. Phụ lục B — đã đóng

DEV đã cập nhật 5 dòng trên main (commit 98eb712, U20-5) theo bảng CEO. Mục đề xuất 4 dòng trước đây **hết hiệu lực**. Còn thiếu 1 dòng nếu duyệt Q-U20-1: “Đặt lại 2FA của người khác”.

## 3. Brief Backend & Core v1.0 → v1.1

| Vị trí                         | Sửa                                                                                                             |
|--------------------------------|-----------------------------------------------------------------------------------------------------------------|
| P9 “Endpoint bổ sung v1.0”     | Thêm các bảng từ `endpoint-M8.md` §1–8 (sau khi cố vấn duyệt). Đổi tiêu đề thành “Endpoint bổ sung v1.1”        |
| P9 mã lỗi                      | Thêm `team_in_use`, `field_has_data`, `unresolved_variable` (409/409/422)                                       |
| P14 (SLA)                      | Thêm quy tắc đồng hồ: dừng ngoài giờ và khi `PENDING_CUSTOMER`; sự kiện `sla_paused`/`sla_resumed`              |
| P16 (WorkspaceTemplateService) | Xác nhận mẫu tạo SLA mặc định, giờ làm việc, team mặc định, flow “Ngoài giờ”                                    |
| P3.2 / bảng mã                 | Đổi tên mã P3 thành “Backup & khôi phục (RPO ≤ 1h, §22)”                                                        |
| Phạm vi Đợt 2                  | Ghi thêm “phân bổ theo kỹ năng” (C9), “lưu phân khúc” (J4)                                                      |
| P8                             | Xác nhận `customer_field_defs`, `quick_replies`, `sla_policies`, `holidays` có RLS O hoặc O+W đúng như endpoint |

## 4. Lịch (theo thư CEO 13/10/2026)

| Mốc           | Việc                                                                                                      |
|---------------|-----------------------------------------------------------------------------------------------------------|
| 13/10         | Bản nháp 2 (Q-M8 + U20) gửi CEO — sớm hơn hạn 20/10                                                       |
| Trước 20/10   | CEO trả lời Q-U20-1→6 (spec-M8 mục 8)                                                                     |
| 20–25/10      | Cố vấn kỹ thuật review `endpoint-M8` và spec-M8                                                           |
| Trước 30/10   | Bản cuối; gộp vào Brief UI v1.1 + Brief Backend v1.1                                                      |
| 30/10 → 17/11 | Đề xuất gửi FE ngay khi có bản cuối (30/10), không chờ 17/11: FE có thêm 2,5 tuần cho wireframe nộp 30/11 |
