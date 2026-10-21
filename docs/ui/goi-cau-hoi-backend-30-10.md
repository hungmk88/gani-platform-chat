# Gói câu hỏi FE gửi Backend — 30/10/2026

Gửi kèm spec M8 bản cuối. Nội dung đầy đủ của từng câu nằm ở `QUESTIONS.md` (U25–U34); trang này xếp chúng theo việc FE đang
chờ, để Backend biết làm gì trước. Trạng thái FE tính tới 21/10/2026 (`main` có #197 và `GET /v1/me` của #199).

## 1. FE đã làm được với API hiện có

| Màn | Đã chạy | Dùng API |
|---|---|---|
| #1 Đăng nhập, #2 Xác thực 2 lớp, cài 2FA | Có, E2E + axe | Better Auth `/api/auth/*`, `GET /v1/me/security-status` |
| #6 Hộp thư: danh sách, mở hội thoại, đọc tin | Có | `GET /v1/conversations`, `/{id}`, `/{id}/messages` |
| #6 Hộp thư: Nhận, Chờ khách, Đóng | Có | `POST /claim`, `/wait-customer`, `/close` (Idempotency-Key, `version`) |
| #6 Hộp thư realtime | Có | Socket.IO `/agent`: `conversation.subscribe`, `resume`, 3 sự kiện của #192 |

Mọi màn trên chạy với API giả trong E2E. `GET /v1/me` (U32) Backend đã làm ở #199 (N145): FE đang thay kiểu viết tay
`apps/admin/src/me.ts` bằng kiểu sinh từ OpenAPI, để khung app chạy được với API thật.

## 2. Thứ tự đề nghị

| Ưu tiên | Mã | Cần gì | Chặn |
|---|---|---|---|
| — | U32 | **Đã xong (#199, N145).** Còn mở: danh sách công ty để chọn khi `org: null`, ảnh và `PATCH /v1/me` (ở U25) | — |
| 1 | — | `POST /v1/conversations/{id}/messages` (đã có trong P9) | Ô soạn và gửi tin của Hộp thư: chưa có luồng chat trọn từ đầu đến cuối |
| 2 | U30 | Trường của dòng Hộp thư: tên khách, kênh, đoạn trích tin cuối, số chưa đọc, tag, SLA, tên người phụ trách; bộ lọc SLA, kênh, tag, tìm kiếm, sắp xếp | Dòng danh sách đang chỉ có trạng thái, "Tôi"/"Người khác", giờ tin cuối (CEO chọn A) |
| 3 | U31 | Danh sách người nhận hợp lệ cho Chuyển/Gán lại; chuyển cho cả team hay chỉ người; nơi lưu ghi chú khi Đóng | Hộp thoại Chuyển và Gán lại |
| 4 | U34 | Mô tả uuid rỗng được trong OpenAPI bằng `anyOf` thay cho `allOf` | Kiểu sinh từ OpenAPI mất `null`; FE đang tự khai từng chỗ |
| 5 | U33 | Proxy production chuyển tiếp `/socket.io/*` kèm WebSocket; timeout nhàn rỗi > 25 giây | Realtime ở staging và production (đi cùng Q2) |
| 6 | U25 | `GET/PATCH /v1/me` (tên, ảnh); khóa 2FA đếm chung mã ứng dụng và mã dự phòng không; `GET /v1/leads/{id}` kèm lịch sử; trường SLA tạm dừng | #5 Hồ sơ cá nhân, #13 Chi tiết lead, nhãn SLA ở #6 |
| 7 | U26 | Quản lý kênh: danh sách kênh (không trả token), kết nối Zalo OA, làm mới token, ngắt kết nối | #24, #25 (S3, nộp wireframe 07/12) |
| 8 | U27 | Tập trạng thái ticket, quy tắc dừng SLA; `GET /v1/tickets/{id}` kèm lịch sử | #14, #15 (S4, nộp wireframe 21/12) |
| 9 | U28 | Định nghĩa mã A17; đọc phiên truy cập của platform theo công ty; kết thúc phiên sớm; cột chi phí AI | #28, #30 (S5, nộp wireframe 04/01) |
| 10 | U29 | Chỉ số của #16 Tổng quan và endpoint; nghĩa mức tự chủ L3–L5; danh sách feature flag và endpoint | #16, #27 (S5, nộp wireframe 04/01) |

## 3. Realtime: điều FE đã giả định

FE đọc đúng `realtime-spec.md` §3–5 và mã của worker (#192). Nếu Backend đổi các điểm dưới đây, xin báo FE:

- Khung gói `{ eventId, type, version, occurredAt, traceId, aggregateVersion, data }`.
- `conversation.state_changed`: FE chỉ áp khi `data.version` lớn hơn bản đang có.
- `message.created`: gói gửi vào phòng hội thoại có `messageId` và nội dung; gói gửi vào phòng workspace chỉ có số và loại người gửi, FE khi đó đọc lại danh sách.
- `resume`: FE gửi khi nối lại, với `lastSequenceNumber` lớn nhất đang có; `resync` hoặc `hasMore` thì FE tải lại tin qua REST.
- `session.ended`: FE chuyển về `/login`.
- Chưa dùng vì Backend chưa phát: `typing`, `agent.presence`, `message.status_changed`.

## 4. Lỗi P9 FE đang xử lý

FE có bảng đủ 15 mã của P9 (`apps/admin/src/api/errors.ts`), cộng các mã API đang trả thêm: `two_factor_setup_required`,
`invalid_assignee`, `idempotency_in_progress`, `idempotency_key_reused`, `forbidden_origin`, `service_unavailable`. Mã mới nào
Backend thêm, xin ghi vào P9 để FE có câu và hành động tương ứng; mã lạ hiện được xử lý theo HTTP status.
