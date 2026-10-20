# apps/admin — UI Admin & Agent Inbox

Nguồn chính: **Brief UI v1.0** (12/10/2026) + Phụ lục B (ma trận quyền). Về API, FSM, quyền,
Brief Backend & Core v1.0 thắng Brief UI. Khi mâu thuẫn → ghi vào `QUESTIONS.md`, không tự đoán.

## Phạm vi theo đợt

Dự án có **2 đợt** (Đợt 1 = 58 mã, go-live 15/02/2027; Đợt 2 = 77 mã, 3 cổng). Căn cứ: file
"Phạm vi triển khai — 135 mã". Mã không có trong file thì ngoài phạm vi.

- Màn Đợt 2 được ẩn bằng feature flag ở Đợt 1; không hiện rồi báo "không có quyền".
- Không làm ở Đợt 1–2: dark mode, tiếng nước ngoài, Customer Portal, nhiều tab Inbox (dùng `J`/`K`).

## Menu (5 nhóm cố định, không thêm; tối đa 2 cấp)

1. Hộp thư — `/inbox`
2. Khách hàng — `/customers`, `/leads`, `/tickets`; `/quotes`, `/orders` (Đợt 2)
3. Tự động hóa — `/bots`; `/automation`, `/knowledge` (Đợt 2)
4. Tổng quan & Báo cáo — `/overview`; `/reports` (Đợt 2)
5. Cài đặt — `/settings/{workspace, members, teams, channels, ai, autonomy, audit, security}`;
   `/settings/widget` (Đợt 2)

`/platform` chỉ hiện với `platform_operator`. Ẩn mục theo vai trò và theo đợt.

Trang mặc định sau đăng nhập:
- Owner/Admin/Manager → `/overview`
- Sales/Support → `/inbox`
- Marketing/Viewer → `/overview` (Đợt 2: Marketing → `/reports`)
- platform_operator → `/platform`

## Nguyên tắc thẩm mỹ (Brief UI §1.2, §2.1)

- Mỗi màn **1 nút chính**; thao tác hằng ngày ≤ 2 click hoặc 1 phím tắt. Bước phụ trong hộp
  thoại (chọn lý do Chuyển, chọn kết quả Đóng) tính là 1 click của hộp thoại (CEO chốt).
- Nền trung tính + 1 màu nhấn. Xanh/vàng/đỏ **chỉ** cho trạng thái. Ghi chú nội bộ dùng `--color-note`.
- Font Inter (tự host), tối đa 4 cỡ: 12/14/16/20px (Admin 14). Lưới 4/8px. Bo góc 4/8/12.
  Chuyển động ≤ 200ms, chỉ để phản hồi.
- Mỗi màn đủ 4 trạng thái: Đang tải · Trống · Lỗi (kèm `traceId` + Thử lại) · AI tắt. Màn không có
  phần AI ghi "Không áp dụng AI" có chủ đích. Mỗi trạng thái trống/lỗi có 1 câu + 1 hành động.
- Nhãn lời đời thường, **không** hiện `HUMAN_WAITING_Q`, `Error 500`.

## State & realtime

- TanStack Query cho server state, Zustand cho UI state, Socket.IO client (`resume { lastSequenceNumber }`).
- Gửi tin, tag, ghi chú: cập nhật lạc quan. Nhận, chuyển, đóng, gộp khách, đổi quyền, xuất bản
  flow, đổi bước lead: **chờ máy chủ** (khóa nút). Mọi POST tạo dữ liệu mang `Idempotency-Key`.
- Xử lý mã lỗi theo bảng P9 (Brief Backend) / Brief UI §2.5.
- Hạn link mời và các hằng số nghiệp vụ lấy từ API, không ghi cứng (link mời: 7 ngày theo Backend).

## Bảo mật giao diện (Brief UI §2.6)

- Nội dung khách gửi luôn là **chữ thuần** (Inbox, hồ sơ, thông báo đẩy, tiêu đề tab); không render
  HTML/markdown; link không tự xem trước.
- Khóa cache gồm `orgId` + `workspaceId`; đổi workspace hoặc đăng xuất → xóa cache + ngắt realtime.
- Client không tự vào room Socket.IO theo id. File chỉ qua link ký 15 phút.
- Bản nháp lưu server (`/v1/me/drafts`), không `localStorage`.
- 2FA bắt buộc: Owner, Admin, platform_operator.
- CI bắt buộc T1 (đổi workspace), T2 (nội dung độc), T3 (room realtime), axe-core, lint token.

## Cấm

- Không dùng màu/cỡ chữ ngoài `packages/ui/tokens` (lint chặn).
- Không thêm nhóm menu thứ 6.

## Kiểm chứng

- Admin tải nội dung chính < 2,5 giây; mở khung hội thoại P95 < 500ms; danh sách 500+ hội thoại ảo hóa.
- 4 thao tác chính (nhận, trả lời, chuyển, đóng) ≤ 2 click hoặc 1 phím tắt.
- Tương phản WCAG 2.1 AA trên 100% màn.

## Chạy (F2)

- Next.js 16 (App Router) + React 19 + Tailwind 4 (`@gani/ui/theme.css`, chỉ class theo token). Font Inter tự host (`@fontsource-variable/inter`).
- `pnpm --filter @gani/admin dev` → cổng 3001. `/api/auth/*` và `/v1/*` được chuyển tiếp sang `API_ORIGIN` (mặc định `http://localhost:3000`):
  admin và API chung một địa chỉ gốc (`BETTER_AUTH_URL`, N136), production do reverse proxy làm.
- `next build` hỏng ("reading 'useContext'") nếu `NODE_ENV=development` đặt sẵn trong môi trường: bỏ biến đó khi build. CI không đặt.
- `typecheck` = `next typegen && tsc --noEmit` (`next-env.d.ts` do Next sinh, không commit).
- Import trong app không có đuôi `.js` (bundler), khác `apps/api`.

