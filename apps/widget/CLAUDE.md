# apps/widget — Nhúng vào website khách

Nguồn chính: **Brief UI v1.0 Phần 3**. Widget thuộc **Đợt 2**: wireframe duyệt trước S8
(01/03/2027), FE làm song song từ S8, go-live cùng cổng S10 (29/03/2027). Từ S10 đến cổng AI S13
(10/05/2027) widget chạy bot kịch bản + nhân viên, chưa có AI trả lời khách.

## Ràng buộc kích thước (cứng)

- `loader.js` < **5KB** gzip, async; tải bundle khi tương tác hoặc sau `onload`
  (nếu dùng `requestIdleCallback` phải có phương án dự phòng cho Safari/iPhone).
- Bundle chính < **35KB** gzip (Preact + Shadow DOM). Font hệ thống, không tải font riêng.

## Cách ly

- Chạy trong **Shadow DOM**, không xung đột CSS với website khách, không đọc dữ liệu/cookie trang chủ.
- Token phiên khách ngắn hạn trong `localStorage` theo `widget key` (chỉ token; không lưu bản nháp).
- Domain allowlist theo workspace: ngoài allowlist thì widget không tải. CSP chặt.

## Thương hiệu (khác với admin)

- Widget **mang thương hiệu từng workspace** (màu, logo, lời chào). Admin giữ nhận diện trung tính.
- Màu thương hiệu phải đạt tương phản ≥ 4,5:1 với chữ; không đạt thì chặn lưu ở màn cấu hình.
- Cỡ chữ 16px; tối đa 4 cỡ (12/14/16/20).

## Hành vi bắt buộc

- Câu "Trợ lý AI của [thương hiệu]" chỉ hiện khi workspace đã bật AI trả lời khách (feature flag,
  sau S13); không hiện trước đó hoặc khi AI tắt.
- Form trước khi chat có 1 dòng thông báo xử lý dữ liệu + link chính sách; ô "Đồng ý nhận tin ưu
  đãi" **để trống mặc định**, không tick vẫn chat được. SĐT lưu nhãn `unverified`.
- Mất mạng: xếp hàng tin, thử lại lũy thừa tối đa 5 lần với **cùng `Idempotency-Key`**, tải bù theo
  `lastSequenceNumber`. 429 → báo đợi `Retry-After`.
- Nội dung hiển thị là chữ thuần. Nút "Kết thúc & xóa trên máy này" xóa token + lịch sử hiển thị.

## Không làm

- Instagram, dark mode, ngôn ngữ ngoài tiếng Việt, theo dõi trang khách đang xem (chờ dữ liệu).

## Kiểm chứng

- Lighthouse Performance mobile ≥ 90 trên trang thử của 5 công ty.
- Không làm vỡ bố cục website nhúng có CSS mạnh (test 5 loại site phổ biến); không vỡ ngược lại.
- Thử nhúng `<script>` độc qua tin nhắn → hiện đúng chuỗi ký tự, không thực thi.
- NVDA và VoiceOver đọc được toàn bộ luồng chat (bắt buộc riêng cho Widget).

## Cấm

- Không thêm dependency nặng (React, lodash đầy đủ).
- Không gọi API ngoài danh sách đã đăng ký.
