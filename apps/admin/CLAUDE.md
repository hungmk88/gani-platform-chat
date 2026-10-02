# apps/admin — UI Admin & Agent Inbox

## Menu (5 nhóm cố định, không thêm)

1. Hộp thư — `/inbox`
2. Khách hàng — `/customers`, `/leads`, `/tickets`, `/quotes`, `/orders`
3. Tự động hóa — `/bots`, `/automation`, `/knowledge`, `/campaigns`
4. Tổng quan & Báo cáo — `/overview`, `/reports`
5. Cài đặt — `/settings/*`

`/platform` chỉ hiện với `platform_operator`.

Trang mặc định sau đăng nhập:
- Owner/Admin/Manager → `/overview`
- Sales/Support → `/inbox`
- Marketing → `/reports`
- platform_operator → `/platform`

## Nguyên tắc thẩm mỹ (P18.2 Brief)

- Mỗi màn **1 nút chính**; thao tác hằng ngày ≤ 2 click hoặc 1 phím tắt.
- Nền trung tính + 1 màu nhấn. Xanh/vàng/đỏ **chỉ** cho trạng thái.
- 1 font đủ dấu tiếng Việt, tối đa 4 cỡ (admin 14px).
- Lưới 4/8px. Chuyển động ≤ 200ms, chỉ để phản hồi.
- Nhãn dùng lời đời thường, **không** hiện `HUMAN_WAITING_Q`, `Error 500`.

## State & realtime

- TanStack Query cho server state, Zustand cho UI state.
- Socket.IO client, reconnect + `resume { lastSequenceNumber }`.
- Xử lý mã lỗi theo bảng P9 Brief (401 → về đăng nhập giữ bản nháp, v.v.).

## Cấm

- Không dùng màu/cỡ chữ ngoài `packages/ui/tokens` (lint chặn).
- Không thêm nhóm menu thứ 6.

## Kiểm chứng

- Lighthouse Performance widget mobile ≥ 90.
- Admin tải nội dung chính < 2,5 giây.
- 4 thao tác chính (nhận, trả lời, chuyển, đóng) ≤ 2 click hoặc 1 phím tắt.
