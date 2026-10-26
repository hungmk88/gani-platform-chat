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

## Chạy (W1, 26/10/2026)

- Preact 10 + TypeScript, build bằng Vite (`scripts/build.mjs`): `dist/loader.js` (IIFE, script thường, không có Preact) và `dist/widget.js` (ES module một file, loader `import()` khi người xem bấm nút chat hoặc 2 giây sau `load`, dùng `setTimeout` vì Safari không có `requestIdleCallback`). Bundle nằm cạnh loader (`new URL('widget.js', script.src)`).
- `pnpm --filter @gani/widget build` chạy luôn `scripts/size.mjs`: đo gzip, vượt 5KB (loader) hoặc 35KB (bundle) thì build lỗi, CI đỏ (`pnpm build`).
- Nhúng: `<script async src=".../loader.js" data-brand-name data-brand-color data-greeting>`. Đây là cách tạm cho W1: cấu hình thật lấy theo widget key khi có API `/v1/widget/*` (S10). Màu thương hiệu không đủ 4,5:1 với chữ trắng (hoặc sai dạng `#rrggbb`) thì widget dùng màu trung tính (`src/brand.ts`). Màn cấu hình (#33) vẫn phải chặn lưu.
- Trang thử: `pnpm --filter @gani/widget build`, rồi mở `apps/widget/demo/index.html?brand=a|b|light` qua một máy chủ tĩnh bất kỳ, chạy từ `apps/widget`. Không mở bằng `file://`, vì `import()` cần http. Trang có CSS mạnh để thử cách ly.
- Shadow DOM `mode: 'open'`, `:host { all: initial }`, CSS là chuỗi trong `src/styles.ts`. Lint chặn `innerHTML` và `dangerouslySetInnerHTML` (chữ thuần).
- W1: nút chat và khung chat (thương hiệu, lời chào, Thu gọn, Esc).
- W2 (`src/chat.ts`, `prechat.tsx`, `conversation.tsx`, `widget.tsx`): **form trước khi chat** (tên bắt buộc ≤ 100, SĐT không bắt buộc kiểm dạng Việt Nam, ô "Đồng ý nhận tin ưu đãi" để trống, dòng thông báo dữ liệu + link `data-policy-url` chỉ nhận https; câu chữ chờ U24 (b), trường chờ wireframe) → **hội thoại** (chữ thuần, `aria-live`, Enter gửi, Shift+Enter xuống dòng; tin "Đang gửi…", gửi lại tối đa 5 lần chờ 1/2/4/8 giây hoặc `Retry-After`, cùng một `Idempotency-Key`, hết lượt thì "Chưa gửi được" + "Gửi lại" với khóa cũ: `sendWithRetry`) → **"Kết thúc & xóa trên máy này"** (hỏi lại, rồi xóa tin, về form). Thu gọn khung không mất hội thoại.
- **Chưa có API widget** (`/v1/widget/*` chưa có trong OpenAPI): màn chỉ biết `Transport` (`src/transport.ts`); W2 chạy `demoTransport` (trong trình duyệt, không gọi mạng, một câu trả lời mẫu của nhân viên; CEO 26/10 "dùng mock data trước"). Token phiên, tải bù theo `lastSequenceNumber`: khi có API.
- W3 (`src/rating.tsx`): "Kết thúc" → **đánh giá** 1–5 sao (radio "n sao", góp ý ≤ 500 không bắt buộc, "Gửi đánh giá" khóa tới khi chọn sao, "Bỏ qua") → `Transport.rate` (lỗi thì bỏ qua) → `end` → xóa tin, về form với câu "Cảm ơn bạn. Tin nhắn đã được xóa khỏi máy này."
- **E2E + axe** (`e2e/widget.spec.ts`, Playwright + `@axe-core/playwright` chỉ trong Shadow DOM của widget): `pnpm --filter @gani/widget build`, rồi `pnpm --filter @gani/widget e2e` (`scripts/serve.mjs` mở trang thử ở cổng 4173; `CHROMIUM_PATH` như admin). CI chạy trong job `admin (e2e, axe)`, sau E2E của admin, dùng chung Chromium.
