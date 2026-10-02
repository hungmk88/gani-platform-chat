# apps/widget — Nhúng vào website khách

## Ràng buộc kích thước (cứng)

- `loader.js` < **5KB** gzip.
- Bundle chính < **35KB** gzip (Preact + Shadow DOM).
- Chỉ tải bundle khi tương tác hoặc sau `onload`.

## Cách ly

- Chạy trong **Shadow DOM**, không xung đột CSS với website khách.
- `session token` trong `localStorage` theo `widget key`.
- Domain allowlist theo workspace; CSP chặt.

## Thương hiệu (khác với admin)

- Widget **mang thương hiệu từng workspace** (màu, logo, lời chào).
- Admin giữ nhận diện trung tính của nền tảng.

## Kiểm chứng

- Lighthouse Performance mobile ≥ 90.
- Không làm vỡ bố cục website nhúng (test 5 loại site phổ biến).
- Thử nhúng `<script>` độc qua tin nhắn → phải bị vô hiệu (XSS).

## Cấm

- Không thêm dependency nặng (React, lodash đầy đủ).
- Không gọi API ngoài danh sách đã đăng ký.
