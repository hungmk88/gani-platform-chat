# Phản hồi Backend — gói câu hỏi 30/10/2026

Trả lời `goi-cau-hoi-backend-30-10.md` (FE, 26/10) và lời nhắc "[Gói 1 - Backend] Nhắc hạn 30/10". Trạng thái tính tới **26/10/2026**:
`main` có #316, và #321 đang chờ merge. Mỗi câu ghi một trong bốn trạng thái:

- **Đã xong:** có trên `main`.
- **Backend chốt:** Backend tự quyết được (hình dạng API, cách lưu); anh duyệt trước khi gửi.
- **Backend làm:** đã nhận, có thời hạn.
- **Chờ CEO:** câu hỏi nghiệp vụ, Backend chỉ đề xuất.

## 1. Việc FE đang chờ đã xong

| Việc | Đã có | FE làm tiếp |
|---|---|---|
| Hội thoại trả kèm khách (U30, U37) | `Conversation.customer: { id, displayName } \| null` ở `GET /v1/conversations`, `/{id}` và câu trả lời của mọi thao tác (#316) | Bỏ `.skip` của test E2E viết sẵn ở #317; `displayName` `null` thì vẫn hiện ô "Tên khách" |
| Khách được tạo khi nhận tin Zalo | Worker tạo khách theo UID Zalo của OA và gắn vào hội thoại (#308); hội thoại cũ được gắn ở tin kế tiếp | Không cần gì |
| Danh sách và hồ sơ khách (J1) | `GET /v1/customers?q=&cursor=` (tên hoặc đầu SĐT, gõ `0912` cũng được), `GET /v1/customers/{id}`; Marketing/Viewer thấy SĐT/email đã che (#316) | Màn #9 Khách hàng, #12 Hồ sơ khách đọc được |
| Sửa hồ sơ khách | `PATCH /v1/customers/{id}`: `displayName`, `phone` (lưu `+84…`), `email`, `humanOnly` (#321, đang chờ merge) | Ô sửa tên khách; webhook Zalo không có tên nên đây là nguồn tên chính |
| `{{company_phone}}` | `me.workspaces[].contactPhone` cho mọi vai trò (#306) | Đã dùng (#315) |

Kiểu dữ liệu: `Customer`, `CustomerPage`, `CustomerChange`, `ConversationCustomer` trong `docs/openapi/openapi.json`.

## 2. Spec M8 bản cuối — phần Backend (`endpoint-M8.md`)

Spec M8 (`spec-M8.md`) là tài liệu của FE, bản nháp 3 đã merge ở #319; CEO duyệt bản cuối. Phần Backend là `endpoint-M8.md`.
Bảng dưới là trạng thái từng mục, để bản cuối ghi đúng cái đã có:

| Mục endpoint-M8 | Trạng thái | Ghi chú |
|---|---|---|
| §1 Team (A4) | **Đã xong** | N160, N161; thêm `GET /v1/channels` cho màn chọn kênh |
| §2 Mẫu trả lời nhanh (C7) | **Đã xong**, trừ U38 | N163; U38 ở mục 3 |
| §3 SLA và ưu tiên (C8) | Chưa làm | Chờ Q7 (giờ làm việc, số agent) và U40, U41 |
| §4 Phân bổ tự động (C9) | Một phần | Có giới hạn tải riêng (`PATCH /v1/members/{id}/capacity`, N156) và mặc định workspace (N157); `routing` chờ Q7, U45 |
| §5 Giờ làm việc, ngày lễ, trạng thái agent (C10, D4) | Chưa làm | S4; chờ Q7, U42–U44 |
| §6 Trường tùy chỉnh (J1) | Chưa làm | Bảng `customers` đã có (N165); U46 ở mục 4 |
| §7 Tag (J4) | Chưa làm | U47 ở mục 4 |
| §8 Tài khoản, xác thực (A5, A3) | **Đã xong** phần lớn | Còn: danh sách phiên không có token (SEC-03), `notification-settings`, ảnh đại diện (chờ kho file) |
| §9 Script quản trị | **Đã xong** | `tenant:create-org`, `tenant:create-workspace` (N158) |

Câu §10 của endpoint-M8 (cho cố vấn): Backend trả lời được câu 2 và 3; câu 1, 4, 5 vẫn chờ cố vấn.

- **Câu 2:** không cần token mới cho mỗi workspace. Phiên giữ mọi workspace của người đó; mỗi request chọn bằng `workspaceId`, RLS O+W chặn workspace không thuộc phiên. App đã chạy theo cách này (T1, cookie `gani_ws`).
- **Câu 3:** khách nay ở cấp công ty (N165), nên định nghĩa trường dùng chung cả công ty là khớp, không lộ dữ liệu chéo công ty.

## 3. Trả lời U25–U38

| Mã | Trạng thái | Trả lời Backend | Việc tiếp |
|---|---|---|---|
| U25 (1) | **Đã xong** | `GET/PATCH /v1/me {name}` (N162). Ảnh đại diện chờ kho file | — |
| U25 (2) | **Backend chốt** | Mã ứng dụng (TOTP) và mã dự phòng dùng **chung một bộ đếm** (Better Auth 1.7.7, cùng dòng `two_factors`). Sai 5 lần liên tiếp thì khóa 30 phút. Khi đang khóa, **cả hai** đều bị từ chối: 429 `ACCOUNT_TEMPORARILY_LOCKED`. Prototype #2 khóa cả hai là đúng | FE đổi câu theo mã 429 này |
| U25 (3) | Backend làm | Bảng `leads`/`lead_events` chưa có (M06). Backend nhận hình dạng `GET /v1/leads/{id}` → `Lead` + `events: [{ type, fromStage, toStage, actorUserId, occurredAt }]` (cursor nếu dài) | Làm cùng M06 trước S3 |
| U25 (4) | Chờ Q7 | Đồng ý hình dạng FE: `sla: { dueAt, pausedReason: 'pending_customer' \| 'outside_hours' \| null }` trong dòng hội thoại. Đồng hồ SLA chưa làm vì chờ Q7 (giờ làm việc thật) | Làm ở S3 khi có Q7 |
| U26 | Backend làm | Đồng ý mục 3.4 của FE, chỉnh: ngắt kết nối là `POST /v1/channels/{id}/disconnect` → `Channel` (`status: disconnected`, giữ dòng để hội thoại cũ còn kênh), không `DELETE`. Thêm vào `Channel` các trường không bí mật: `lastErrorCode`, `lastErrorAt`, `accessTokenExpiresAt`, `refreshTokenExpiresAt`, `connectedAt`; `GET /v1/channels/{id}` (+ `oaId`, `policy`). `connect` và `refresh-token` phụ thuộc tài liệu Zalo (Z2, Q6) | Trường mới và `GET /{id}` trước 07/12 (wireframe #25); `connect` khi có Q6 |
| U27 | Chờ CEO | Bảng ticket chưa có (M06). Đề xuất tập trạng thái khớp prototype: `new`, `in_progress`, `waiting_customer`, `done` (+ `cancelled`); SLA ticket dừng khi `waiting_customer`, như hội thoại (Q-M8-3). `GET /v1/tickets/{id}` kèm `events[]` như lead | CEO chốt tập trạng thái; Backend làm ở S4 |
| U28, U29 | Chờ CEO | A17, chỉ số #16, L3–L5 và danh sách feature flag chưa có định nghĩa. Đã có `platform_access_logs` và phiên truy cập hỗ trợ (`app.support_access_ok`) để làm #30 | CEO định nghĩa A17, chỉ số #16 |
| U30 | Một phần **đã xong** | Giữ `GET /v1/conversations`, không làm endpoint riêng. **Đã có** `customer` (#316). Backend làm tiếp: `channel: {id, type, displayName}`, `lastMessagePreview` (≤ 120 ký tự, không bao giờ ghi log), `assignee: {id, name}`; bộ lọc `channelId`, `q` (tên/SĐT khách). Sau: `unreadCount` (cần bảng đánh dấu đã đọc), `tags` (J4), `sla` (Q7). `customer.companyName` chưa có cột, sẽ đi cùng trường tùy chỉnh J1 | Đợt kế tiếp: `channel`, `lastMessagePreview`, `assignee` |
| U31 | Backend làm | Làm `GET /v1/conversations/{id}/assignees?purpose=transfer\|assign` đúng hình dạng FE đề xuất (đã lọc theo luật API). **Đợt 1 chỉ chuyển cho người**: chuyển cho cả team cần routing S4 (N133). Ghi chú khi Đóng và lý do chuyển (N135): chưa có bảng ghi chú nội bộ; Backend làm `POST /v1/conversations/{id}/notes`. Tới lúc đó FE **ẩn** ô ghi chú, `CloseBody` giữ strict | `assignees` sau U30; `notes` cùng ghi chú nội bộ của Hộp thư |
| U33 | Backend chốt (DevOps làm) | Yêu cầu với proxy production: chuyển tiếp `/socket.io/*` kèm WebSocket upgrade (`Upgrade`, `Connection`), cùng địa chỉ gốc với admin; timeout nhàn rỗi ≥ 60 giây (ping của Socket.IO 25 giây) | Đi cùng Q2 |
| U34 | Backend làm | Mô tả uuid có thể rỗng bằng `type: ['string', 'null']` + `format: uuid` thay cho `allOf`, để kiểu sinh giữ `null`. Có 4 chỗ trong OpenAPI | PR nhỏ, trước 30/10 |
| U35 | Chờ CEO + pháp lý | P7, P11, E20 chưa có định nghĩa | — |
| U36 | Đã chốt (CEO) | #23 chỉ Owner/Admin. API tag/trường tùy chỉnh làm theo đó | — |
| U37 | **Đã xong** | `customer_name` = `conversation.customer.displayName` (#316); `company_phone` = `me.workspaces[].contactPhone` (#306) | FE bỏ `.skip` ở #317 |
| U38 | Backend làm | Làm `POST /v1/quick-replies/preview { workspaceId, body }` → `{ text, unresolved }`, không ghi gì; biến lạ 400 như khi lưu; Owner/Admin/Manager | PR nhỏ, trước 30/10 |

## 4. U40–U51 — phân loại

| Mã | Ai | Trả lời hoặc đề xuất của Backend |
|---|---|---|
| U40 | Backend, cần Q7 | Đề xuất: hai chỉ tiêu (phản hồi đầu, xử lý xong) tính bằng **phút làm việc**; mốc cảnh báo agent và báo quản lý tính **trước hạn** của chỉ tiêu gần nhất; mốc lớn hơn chỉ tiêu thì báo ngay khi mở. Chốt khi có Q7 |
| U41 | Backend | Đề xuất **giữ hạn cũ** cho hội thoại đang mở (endpoint-M8 §3 đã ghi "Hội thoại đang mở giữ hạn cũ khi SLA đổi"), áp cả khi đổi giờ làm việc và ngày lễ |
| U42, U43 | CEO | Endpoint đã có trong endpoint-M8 §5 (`GET /v1/workspaces/{id}/presence`, `PUT /v1/members/{userId}/presence`); màn đặt ở đâu là quyết định của CEO |
| U44 | Backend | Đề xuất: ngày lễ sửa/xóa được; khoảng ngày trùng nhau thì gộp; ngày đã qua không thêm được; nghỉ trưa đặt **riêng từng ngày** trong lịch tuần |
| U45 | Backend | Giới hạn tải là của **người**, chung mọi workspace của công ty (`agent_settings` theo người, N156). Vòng xoay chạy theo **team** của kênh |
| U46 | Backend | Chọn 1/chọn nhiều cần **≥ 2** lựa chọn; tối đa **50** trường mỗi công ty, tên ≤ 100 ký tự; không đổi kiểu hay "Nhạy cảm" khi trường đã có dữ liệu (endpoint-M8 §6) |
| U47 | Backend | Tag ở **cấp công ty** (Brief M03). "Ẩn" = không gắn thêm được; khách đang mang vẫn giữ; vẫn **lọc** được theo tag ẩn |
| U48 | Backend | Đợt 1 có tìm theo email: `q` có `@` thì tìm email **trùng khớp** (không tìm một phần, để không dò được email). Thêm vào `GET /v1/customers` |
| U49, U50 | CEO | U49: màn chọn công ty còn mở (N145). U50: API đã có (N159), chỉ cần thêm vào spec/M11 |
| U51 | Backend | **Cho trùng** tên team trong một workspace (N160, slug tự thêm `-2`); prototype bỏ chặn trùng |

## 5. Hạn

- **Trước 30/10:** U34, U38, U48 (PR nhỏ); merge #321.
- **Trước S1 (16/11):** U30 phần `channel`, `lastMessagePreview`, `assignee`; U31 `assignees`.
- **Chờ quyết định:** Q7 (SLA, giờ làm việc, phân bổ); CEO cho U27, U28, U29, U35, U42, U43, U49, U50.
