# [Gói 1 - Backend] Trả lời nhắc hạn 30/10: Spec M8 & Câu hỏi U25–U38

**Gửi:** FE (Gói 2) · **Từ:** Backend (Gói 1) · **Ngày:** 26/10/2026

Chào anh/chị,

Backend xin cập nhật ba việc trong lời nhắc. Chi tiết từng câu ở `docs/ui/phan-hoi-backend-30-10.md` (PR #323).

## 1. API hội thoại trả kèm thông tin khách (U37): đã xong, đã có trên `main`

| API | PR | Ghi chú |
|---|---|---|
| `GET /v1/conversations`, `GET /v1/conversations/{id}` trả thêm `customer: { id, displayName } \| null` | #316 | Có ở danh sách, chi tiết và câu trả lời của mọi thao tác trên hội thoại |
| `GET /v1/customers?q=&cursor=`, `GET /v1/customers/{id}` | #316 | Tìm theo tên hoặc đầu SĐT (gõ `0912` cũng được). Marketing/Viewer thấy SĐT/email đã che |
| `PATCH /v1/customers/{id}`: `displayName`, `phone`, `email`, `humanOnly` | #321 | SĐT nhập kiểu nào cũng lưu dạng `+84…` |
| `me.workspaces[].contactPhone` cho `{{company_phone}}` | #306 | Mọi vai trò |

Việc FE làm tiếp:
- Điền `{{customer_name}}` bằng `conversation.customer.displayName`, và bỏ `.skip` ở test E2E viết sẵn (#317).
- Khi `displayName` là `null`, vẫn hiện ô "Tên khách" để người gửi tự điền. Webhook Zalo không gửi tên khách, nên tên có giá trị khi agent sửa hồ sơ (`PATCH /v1/customers/{id}`).
- Kiểu dữ liệu `Customer`, `CustomerPage`, `CustomerChange`, `ConversationCustomer` có trong `docs/openapi/openapi.json`. Chạy lại `pnpm --filter @gani/admin gen:api` để lấy.

## 2. Gói câu hỏi U25–U38: đã trả lời từng câu

| Mã | Trả lời |
|---|---|
| U25 (1) | Đã xong: `GET/PATCH /v1/me` đổi tên. Ảnh đại diện chờ kho file |
| U25 (2) | Mã ứng dụng 2FA và mã dự phòng **dùng chung một bộ đếm**: sai 5 lần liên tiếp thì khóa 30 phút. Khi đang khóa, **cả hai** đều bị từ chối (429 `ACCOUNT_TEMPORARILY_LOCKED`). Prototype #2 khóa cả hai là đúng |
| U25 (3) | `GET /v1/leads/{id}` trả `Lead` + `events[]` (`type`, `fromStage`, `toStage`, `actorUserId`, `occurredAt`). Backend làm cùng nhóm lead/ticket (M06) trước S3; FE vẽ #13 theo hình dạng này |
| U25 (4) | Nhận hình dạng FE đề xuất: `sla: { dueAt, pausedReason: 'pending_customer' \| 'outside_hours' \| null }`. Đồng hồ SLA chờ Q7 (giờ làm việc thật) |
| U26 | Nhận mục 3.4 của FE, chỉnh một điểm: ngắt kết nối là `POST /v1/channels/{id}/disconnect` (giữ kênh để hội thoại cũ còn tên kênh). Thêm vào `Channel`: `lastErrorCode`, `lastErrorAt`, `accessTokenExpiresAt`, `refreshTokenExpiresAt`, `connectedAt`; thêm `GET /v1/channels/{id}`. Kết nối Zalo OA và làm mới token chờ tài liệu Zalo (Z2, Q6) |
| U27 | Đề xuất trạng thái ticket khớp prototype: `new`, `in_progress`, `waiting_customer`, `done` (+ `cancelled`); SLA ticket dừng khi chờ khách. `GET /v1/tickets/{id}` kèm `events[]` như lead. **Chờ CEO chốt** tập trạng thái |
| U28, U29 | **Chờ CEO** định nghĩa A17, chỉ số #16, L3–L5 và danh sách feature flag |
| U30 | Giữ `GET /v1/conversations`, không làm endpoint riêng. Đã có `customer`. Backend thêm `channel`, `lastMessagePreview` (≤ 120 ký tự, không ghi log), `assignee: {id, name}`, lọc `channelId` và `q` **trước S1**. `unreadCount`, `tags`, `sla` làm sau (cần bảng đã đọc, tag J4, Q7) |
| U31 | Backend làm `GET /v1/conversations/{id}/assignees?purpose=transfer\|assign` đúng hình dạng FE đề xuất, **trước S1**. Đợt 1 chỉ chuyển cho người; chuyển cho cả team chờ routing S4. Ghi chú khi Đóng và lý do chuyển sẽ đi qua `POST /v1/conversations/{id}/notes` (ghi chú nội bộ); tới lúc đó FE ẩn ô ghi chú |
| U33 | Yêu cầu proxy production: chuyển tiếp `/socket.io/*` kèm WebSocket upgrade, cùng địa chỉ gốc với admin, timeout nhàn rỗi ≥ 60 giây. DevOps làm cùng Q2 |
| U34 | Backend sửa OpenAPI cho uuid có thể rỗng (`type: ['string','null']`), **trước 30/10** |
| U35 | **Chờ CEO + pháp lý** (P7, P11, E20) |
| U36 | Đã chốt (CEO): #23 chỉ Owner/Admin |
| U37 | **Đã xong**, xem mục 1 |
| U38 | Backend làm `POST /v1/quick-replies/preview { workspaceId, body }` → `{ text, unresolved }`, **trước 30/10** |

Các câu U40–U51 (rà soát spec M8 với prototype) cũng đã phân loại, kèm đề xuất của Backend, ở mục 4 của file chi tiết.

## 3. Spec M8 bản cuối

Spec M8 do FE soạn (bản nháp 3 đã merge ở #319) và CEO duyệt bản cuối. Backend đã đối chiếu phần endpoint (`endpoint-M8.md`) với mã đang chạy:

| Mục | Trạng thái |
|---|---|
| Team, mẫu trả lời nhanh, tài khoản cá nhân và xác thực, script tạo công ty/workspace | **Đã có API**, FE code được ngay |
| Khách hàng (đọc, tìm, sửa) | **Đã có API** (mục 1) |
| SLA, phân bổ tự động, giờ làm việc, trạng thái agent | Chưa làm, **chờ Q7** |
| Trường tùy chỉnh (J1), tag (J4) | Chưa làm. Phạm vi đã đề xuất ở U46, U47 |
| Lead, ticket (M06) | Chưa làm. Hình dạng API ở U25 (3), U27 |

FE có thể chốt giao diện các màn đã có API theo `docs/openapi/openapi.json`. Các màn còn lại vẽ theo hình dạng trong file chi tiết; khi Backend làm xong sẽ giữ đúng hình dạng đó.

## 4. Lịch Backend

| Hạn | Việc |
|---|---|
| **Trước 30/10** | U34 (OpenAPI uuid rỗng), U38 (xem trước mẫu khi chưa lưu), U48 (tìm khách theo email) |
| **Trước S1 (16/11)** | U30 (`channel`, `lastMessagePreview`, `assignee` trên dòng Hộp thư), U31 (`assignees`) |
| Chờ quyết định | Q7 cho SLA, giờ làm việc, phân bổ; CEO cho U27, U28, U29, U35, U42, U43, U49, U50 |

Nếu FE cần thay đổi hình dạng nào ở trên, anh/chị báo trong tuần này để Backend kịp làm trước S1.

Trân trọng,
Backend (Gói 1)
