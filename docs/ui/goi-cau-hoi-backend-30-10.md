# Gói câu hỏi FE gửi Backend — 30/10/2026

Gửi kèm spec M8 bản cuối. Nội dung đầy đủ của từng câu nằm ở `QUESTIONS.md`; trang này xếp chúng theo việc FE đang chờ, kèm
**endpoint và kiểu dữ liệu FE mong đợi**, để Backend biết làm gì trước. Trạng thái FE tính tới **26/10/2026** (`main` có #305).

Các hình dạng ở mục 3 là **đề xuất của FE để Backend dễ chốt**, không phải quyết định: Backend chọn tên đường, tên trường và chỗ
đặt (thêm vào schema có sẵn hay endpoint riêng). Điều FE cần là **dữ liệu** trong mỗi bảng, đọc được bằng một lần gọi cho mỗi màn.

## 1. FE đã làm được với API hiện có

| Màn | Đã chạy (E2E + axe) | Dùng API |
|---|---|---|
| #1 Đăng nhập, #2 2FA, cài 2FA, Quên mật khẩu | Có | Better Auth `/api/auth/*`, `/password/forgot`, `/password/reset`, `GET /v1/me/security-status` |
| #4 Nhận lời mời | Có | `/api/auth/invite/lookup`, `/invite/accept` (N151) |
| #5 Hồ sơ cá nhân | Có | `GET/PATCH /v1/me`, `/api/auth/change-password`, `/revoke-other-sessions` |
| #6 Hộp thư | Có | `GET /v1/conversations`, `/{id}`, `/{id}/messages`; `POST /claim`, `/wait-customer`, `/close`, `/assign`, `/messages`; Socket.IO `/agent` |
| #6 Mẫu trả lời trong Hộp thư | Có | `GET /v1/quick-replies`, `POST /{id}/used`, 422 `unresolved_variable`, `me.workspaces[].contactPhone` (N164, #306) |
| #19 Thành viên | Có | `GET /v1/members`, `POST /invite`, `/{id}/resend-invite`, `/{id}/2fa/reset`, `PATCH /{id}/role`, `/{id}/capacity` |
| #20 Team | Có | `GET/POST /v1/teams`, `PATCH/DELETE /{id}`, `GET/PUT /{id}/members`, `PUT /{id}/channels` |
| #21 Workspace (tab Thông tin) | Có | `GET /v1/workspaces`, `PATCH /{id}`, `GET/PUT /{id}/members` |
| #22 Mẫu trả lời nhanh | Có | `GET/POST /v1/quick-replies`, `PATCH/DELETE /{id}`, `POST /{id}/preview` |
| #24 Kênh (chỉ đọc) | Có | `GET /v1/channels?workspaceId=` |

## 2. Thứ tự đề nghị

| Ưu tiên | Mã | Cần gì | Chặn |
|---|---|---|---|
| 1 | U30 | Trường của dòng Hộp thư và bộ lọc (mục 3.1) | Dòng Hộp thư đang chỉ có trạng thái, "Tôi"/"Người khác", giờ tin cuối (CEO chọn A) |
| 2 | U31 | Danh sách người nhận hợp lệ; chuyển cho team; ghi chú khi Đóng (mục 3.2) | Nút Chuyển; Gán lại cho Manager |
| 3 | U37 | `{{customer_name}}` của hội thoại (mục 3.3). `company_phone` đã xong ở N164 (#306) | Người gửi phải tự gõ tên khách |
| 4 | U26 | Quản lý kênh: kết nối Zalo OA, làm mới token, ngắt kết nối, lỗi gần nhất (mục 3.4) | #24 thao tác, #25 (S3, nộp wireframe 07/12) |
| 5 | U38 | Xem trước mẫu khi chưa lưu (mục 3.5) | Form tạo/sửa mẫu #22 chưa có xem trước |
| 6 | U34 | Mô tả uuid rỗng được bằng `anyOf` thay cho `allOf` | Kiểu sinh từ OpenAPI mất `null`; FE tự khai từng chỗ |
| 7 | U33 | Proxy production chuyển tiếp `/socket.io/*` kèm WebSocket; timeout nhàn rỗi > 25 giây | Realtime ở staging và production (đi cùng Q2) |
| 8 | U25 | (2) khóa 2FA đếm chung mã ứng dụng và mã dự phòng không; (3) `GET /v1/leads/{id}` kèm lịch sử; (4) trường SLA tạm dừng. Câu (1) `PATCH /v1/me` đã xong (N162) | #2, #13, nhãn SLA ở #6 |
| 9 | U27 | Tập trạng thái ticket, quy tắc dừng SLA; `GET /v1/tickets/{id}` kèm lịch sử | #14, #15 (S4, nộp wireframe 21/12) |
| 10 | U28, U29 | A17; phiên truy cập platform; chỉ số #16; L3–L5; danh sách feature flag | #28, #30, #16, #27 (S5, nộp wireframe 04/01) |

## 3. Endpoint và kiểu dữ liệu FE mong đợi

Quy ước chung FE đang dùng, đề nghị giữ: `id` là UUIDv7; thời điểm là chuỗi ISO 8601 UTC; trường không có giá trị là `null`
(không bỏ trường); danh sách dài dùng cursor `{ data, nextCursor }`; lỗi RFC 9457 với `code` của bảng P9.

### 3.1 U30 — dòng Hộp thư (`GET /v1/conversations` hoặc endpoint riêng cho Hộp thư)

| Dữ liệu | Kiểu FE mong đợi | Ghi chú |
|---|---|---|
| Khách | `customer: { id: uuid, displayName: string, companyName: string \| null } \| null` | Đi cùng hồ sơ khách N165 (#307, #308); `null` khi chưa gắn khách |
| Kênh | `channel: { id: uuid, type: 'zalo_oa' \| 'facebook' \| 'webchat', displayName: string }` | Cùng kiểu với `Channel` của `GET /v1/channels` |
| Đoạn trích tin cuối | `lastMessagePreview: string \| null` (đã cắt, ví dụ ≤ 120 ký tự) | Nội dung tin là PII: xin xác nhận được trả trong danh sách và **không ghi log** |
| Chưa đọc | `unreadCount: integer` (của người xem) | |
| Tag | `tags: string[]` | Tag khách (J4), không phải tag của mẫu trả lời |
| SLA | `sla: { dueAt: string \| null, pausedReason: 'pending_customer' \| 'outside_hours' \| null }` | U25 câu 4 |
| Người phụ trách | `assignee: { id: uuid, name: string } \| null` | Sales/Support không đọc được `GET /v1/members` nên không tự ghép tên được |
| Bộ lọc | `sla=due_soon\|overdue`, `channelId`, `tag`, `q` (tên hoặc SĐT), `sort=recent\|sla\|unread` | "Team của tôi" chờ N133 |

### 3.2 U31 — Chuyển, Gán lại, Đóng

| Việc | Đề xuất | Kiểu FE mong đợi |
|---|---|---|
| Người nhận hợp lệ cho một hội thoại | `GET /v1/conversations/{id}/assignees?purpose=transfer\|assign` | `{ data: [{ userId: uuid, name: string, role: Role, teamId: uuid \| null, teamName: string \| null, openCount: integer, maxConcurrent: integer \| null }] }`: đã lọc theo luật của API (Sales/Support cùng team; Manager trở lên cả workspace; chỉ vai trò giữ được hội thoại; trừ người đang giữ) |
| Chuyển cho cả team (vào hàng chờ của team) | Thêm `toTeamId` vào `transfer`, loại trừ với `toUserId` | Câu trả lời như `transfer` hiện nay; Đợt 1 có làm không là quyết định của Backend/CEO (phụ thuộc routing S4, N133) |
| Ghi chú khi Đóng | `note?: string` (≤ 500) trong `CloseBody`, **hoặc** `POST /v1/conversations/{id}/notes` | `CloseBody` đang strict, gửi thêm trường là 400; nếu bỏ ô ghi chú thì FE bỏ khỏi hộp thoại |
| Lý do chuyển (N135) | `reason?: string` trong `transfer`, lưu như ghi chú nội bộ (có RLS, che PII khi log) | `transfer` đang chỉ nhận `{version, toUserId}`; xin chốt lưu ở đâu, ai xem, có bắt buộc không |

### 3.3 U37 — `{{customer_name}}` khi dùng mẫu trong Hộp thư

| Dữ liệu | Kiểu FE mong đợi | Ghi chú |
|---|---|---|
| Tên khách của hội thoại đang mở | `customer.displayName` trong `GET /v1/conversations/{id}` (cùng trường với 3.1) | FE điền sẵn khi chèn mẫu; `null` thì vẫn hiện ô để người gửi điền (spec-M8 §3.2) |
| `company_phone` | **Đã xong:** `me.workspaces[].contactPhone` (N164, #306) | FE đọc theo workspace của hội thoại, mọi vai trò |

### 3.4 U26 — Quản lý kênh (#24, #25)

| Việc | Đề xuất | Kiểu FE mong đợi |
|---|---|---|
| Thêm vào `Channel` của `GET /v1/channels` | Trường mới, **không bao giờ** token hay khóa | `lastErrorCode: string \| null`, `lastErrorAt: string \| null`, `accessTokenExpiresAt: string \| null`, `refreshTokenExpiresAt: string \| null`, `connectedAt: string \| null` |
| Chi tiết một kênh (#25) | `GET /v1/channels/{id}` | `Channel` + `oaId: string` (mã OA công khai) + `policy` đang áp dụng (khung gửi tin) |
| Bắt đầu kết nối Zalo OA | `POST /v1/channels/zalo/connect { workspaceId }` → `{ authorizeUrl: string }`; Zalo gọi lại vào API, API chuyển về `/settings/channels/{id}` | Phụ thuộc tài liệu Zalo (Z2, Q6); `Idempotency-Key` |
| Làm mới token ngay | `POST /v1/channels/{id}/refresh-token` → `Channel` | Cùng `ChannelTokenRefreshJob` (`zalo-channel-spec.md` §4); 409 khi job đang chạy |
| Ngắt kết nối | `DELETE /v1/channels/{id}` hoặc `POST /{id}/disconnect` → 204 | Xóa mềm, audit; hội thoại cũ giữ nguyên |
| Quyền | Owner, Admin | Phụ lục B "Cài đặt workspace, kênh, team" |

### 3.5 U38 — Xem trước mẫu khi chưa lưu

| Việc | Đề xuất | Kiểu FE mong đợi |
|---|---|---|
| Xem trước nội dung đang soạn | `POST /v1/quick-replies/preview { workspaceId: uuid, body: string }`, không ghi gì | `QuickReplyPreview` như `POST /{id}/preview`: `{ text: string, unresolved: string[] }`; biến lạ → 400 như khi lưu |
| Quyền | Owner, Admin, Manager | Như `POST /{id}/preview` |
| Nếu không làm | CEO chấp nhận "xem sau khi lưu" | FE giữ nút "Xem trước" trên dòng mẫu như hiện nay |

## 4. Realtime: điều FE đã giả định

FE đọc đúng `realtime-spec.md` §3–5 và mã của worker (#192). Nếu Backend đổi các điểm dưới đây, xin báo FE:

- Khung gói `{ eventId, type, version, occurredAt, traceId, aggregateVersion, data }`.
- `conversation.state_changed`: FE chỉ áp khi `data.version` lớn hơn bản đang có.
- `message.created`: gói gửi vào phòng hội thoại có `messageId` và nội dung; gói gửi vào phòng workspace chỉ có số và loại người gửi, FE khi đó đọc lại danh sách.
- `resume`: FE gửi khi nối lại, với `lastSequenceNumber` lớn nhất đang có; `resync` hoặc `hasMore` thì FE tải lại tin qua REST.
- `session.ended`: FE chuyển về `/login`.
- Chưa dùng vì Backend chưa phát: `typing`, `agent.presence`, `message.status_changed`. Khi U30 có `unreadCount`, FE cần một sự kiện để cập nhật số chưa đọc.

## 5. Lỗi P9 FE đang xử lý

FE có bảng đủ 15 mã của P9 (`apps/admin/src/api/errors.ts`), cộng các mã API đang trả thêm: `two_factor_setup_required`,
`invalid_assignee`, `conversation_not_active`, `unresolved_variable`, `idempotency_in_progress`, `idempotency_key_reused`,
`forbidden_origin`, `service_unavailable`. Mã mới nào Backend thêm (ví dụ cho U26, U31), xin ghi vào P9 để FE có câu và hành
động tương ứng; mã lạ hiện được xử lý theo HTTP status.
