# Danh sách endpoint bổ sung từ Spec M8 — để cố vấn kỹ thuật review

Bản nháp 3 · 13/10/2026 · đã sửa theo U20, Q-U20-1→6, U22 · Dùng cho Brief Backend & Core P9, mục “Endpoint bổ sung”. Quy ước chung của P9 áp dụng (tiền tố `/v1`, cursor, mã lỗi, `Idempotency-Key` cho POST, RLS theo org/workspace). Tên và schema chi tiết chốt trong OpenAPI.

**Tất cả endpoint dưới đây thuộc Đợt 1.** Phần dời Đợt 2 (phân bổ theo kỹ năng, lưu phân khúc) không có endpoint ở Đợt 1.

Quyền theo Phụ lục B bản trên main (commit 98eb712, đã có 5 dòng U20-5). “Sửa” = Owner/Admin trừ khi ghi khác.

## 1. Team (A4) — `/settings/teams`

| Method + path                 | Quyền                                  | Audit | Ghi chú                                                          |
|-------------------------------|----------------------------------------|-------|------------------------------------------------------------------|
| `GET /v1/teams`               | Owner/Admin; Manager chỉ team của mình |       | Kèm số thành viên, kênh phụ trách                                |
| `POST /v1/teams`              | Owner/Admin                            | ✓     | `name`, `description`                                            |
| `PATCH /v1/teams/{id}`        | Owner/Admin                            | ✓     | Đổi tên, mô tả, đặt `is_default` (chỉ 1 team mặc định/workspace) |
| `DELETE /v1/teams/{id}`       | Owner/Admin                            | ✓     | 409 `team_in_use` nếu là mặc định hoặc đang phụ trách kênh       |
| `PUT /v1/teams/{id}/members`  | Owner/Admin                            | ✓     | Thay toàn bộ danh sách; một người ở nhiều team                   |
| `PUT /v1/teams/{id}/channels` | Owner/Admin                            | ✓     | Gán kênh phụ trách                                               |

## 2. Mẫu trả lời nhanh (C7) — `/settings/quick-replies`

| Method + path                                                    | Quyền                          | Audit | Ghi chú                                                                                                |
|------------------------------------------------------------------|--------------------------------|-------|--------------------------------------------------------------------------------------------------------|
| `GET /v1/quick-replies` (tìm theo tên/tag, sắp theo `use_count`) | Session (mọi vai trò có Inbox) |       | Inbox dùng để gõ `/`                                                                                   |
| `POST /v1/quick-replies`                                         | Owner/Admin/Manager            |       | `shortcut`, `body`, `tags`; biến Đợt 1: `customer_name`, `agent_name`, `company_name`, `company_phone` |
| `PATCH /v1/quick-replies/{id}` · `DELETE /v1/quick-replies/{id}` | Owner/Admin/Manager            |       |                                                                                                        |
| `POST /v1/quick-replies/{id}/preview`                            | Owner/Admin/Manager            |       | Render với dữ liệu mẫu; biến thiếu → trả `unresolved: [..]`                                            |
| `POST /v1/quick-replies/{id}/used`                               | Session                        |       | Tăng `use_count`; gọi khi gửi                                                                          |

Ràng buộc: gửi tin có biến chưa điền → 422 `unresolved_variable` (không gửi chữ `{{…}}` ra khách).

## 3. SLA và ưu tiên (C8)

| Method + path                               | Quyền                      | Audit | Ghi chú                                                                                                          |
|---------------------------------------------|----------------------------|-------|------------------------------------------------------------------------------------------------------------------|
| `GET /v1/workspaces/{id}/sla-policies`      | Owner/Admin/Manager        |       | 3 mức: `normal`, `high`, `urgent`                                                                                |
| `PUT /v1/workspaces/{id}/sla-policies`      | Owner/Admin                | ✓     | Mỗi mức: `first_response_minutes`, `resolution_minutes`; cảnh báo agent (mặc định 15), báo quản lý (mặc định 30) |
| `PATCH /v1/conversations/{id}` (`priority`) | Session có quyền hội thoại |       | Đổi ưu tiên trong Inbox                                                                                          |

Quy tắc đồng hồ (đã chốt Q-M8-3): dừng ngoài giờ làm việc/ngày lễ và khi `PENDING_CUSTOMER`; chạy tiếp khi khách trả lời hoặc mở cửa. Mỗi lần dừng/chạy lại ghi `conversation_events` (`sla_paused`, `sla_resumed`). Hội thoại đang mở giữ hạn cũ khi SLA đổi. Đề nghị cố vấn xem xét: lưu `sla_elapsed_seconds` tích lũy thay vì tính lại từ đầu, và job quét quá hạn chạy theo lịch làm việc.

## 4. Phân bổ tự động (C9)

| Method + path                         | Quyền               | Audit | Ghi chú                                                                                                |
|---------------------------------------|---------------------|-------|--------------------------------------------------------------------------------------------------------|
| `GET /v1/workspaces/{id}/routing`     | Owner/Admin/Manager |       |                                                                                                        |
| `PUT /v1/workspaces/{id}/routing`     | Owner/Admin         | ✓     | Mỗi team: `mode = round_robin \| self_claim`; `default_capacity` (mặc định 5); `prefer_previous_agent` |
| `PATCH /v1/members/{userId}/capacity` | Owner/Admin         | ✓     | Giới hạn tải riêng (ở `/settings/members`)                                                             |

Đợt 1 **không** có `mode = skill` và không có trường kỹ năng của agent. Khi thêm ở Đợt 2, chỉ thêm giá trị enum và cột, không đổi endpoint.

## 5. Giờ làm việc, ngày lễ, trạng thái agent (C10, D4)

| Method + path                                                                         | Quyền                        | Audit           | Ghi chú                                                                                                                                 |
|---------------------------------------------------------------------------------------|------------------------------|-----------------|-----------------------------------------------------------------------------------------------------------------------------------------|
| `GET /v1/workspaces/{id}/business-hours`                                              | Owner/Admin/Manager          |                 | Lịch tuần, nghỉ trưa, `timezone`                                                                                                        |
| `PUT /v1/workspaces/{id}/business-hours`                                              | Owner/Admin                  | ✓               |                                                                                                                                         |
| `GET/POST /v1/workspaces/{id}/holidays` · `DELETE /v1/workspaces/{id}/holidays/{hid}` | Owner/Admin (GET: + Manager) | ✓ (POST/DELETE) | Ngày nghỉ = ngoài giờ cả ngày; hỗ trợ khoảng ngày (vd. Tết 04–10/02/2027)                                                               |
| `PUT /v1/me/presence`                                                                 | Session                      |                 | `online \| busy \| offline` (U20-4; `away` dời Đợt 2). Chỉ `online` được phân bổ tự động; `offline` kích hoạt hẹn giờ T17/T18 (10 phút) |
| `PUT /v1/members/{userId}/presence`                                                   | **Owner/Admin**              | ✓               | Đổi trạng thái người khác (Phụ lục B dòng U20-5; Manager 403)                                                                           |
| `GET /v1/workspaces/{id}/presence`                                                    | Manager trở lên              |                 | Trạng thái cả team, kèm thời điểm đổi trạng thái gần nhất (để hiện số phút “Bận” — Q-U20-5)                                             |

Realtime: sự kiện `agent.presence` (đã có trong namespace `/agent`).

**Tự chuyển Offline (Q-U20-4, chốt):** mất kết nối realtime quá 5 phút → server đặt `offline` (như `PUT /v1/me/presence`), rồi T17/T18 chạy như thường; nối lại không tự đặt `online`. Client hiện "Đã chuyển Offline do mất kết nối". "Bận" quá 30 phút: không tự đổi (Q-U20-5); `GET /v1/workspaces/{id}/presence` trả thời điểm đổi trạng thái để hiện số phút.

## 6. Trường tùy chỉnh khách (J1)

| Method + path                         | Quyền       | Audit | Ghi chú                                                                                                 |
|---------------------------------------|-------------|-------|---------------------------------------------------------------------------------------------------------|
| `GET /v1/customer-field-defs`         | Session     |       | Cấp **org**, dùng chung mọi workspace                                                                   |
| `POST /v1/customer-field-defs`        | Owner/Admin | ✓     | `name`, `type` (`text`,`number`,`date`,`select`,`multiselect`,`phone`,`email`), `required`, `sensitive` |
| `PATCH /v1/customer-field-defs/{id}`  | Owner/Admin | ✓     | Đổi tên, thứ tự, `hidden`; **không đổi** `type`**,** `sensitive` **khi đã có dữ liệu**                  |
| `DELETE /v1/customer-field-defs/{id}` | Owner/Admin | ✓     | 409 `field_has_data` nếu đã có dữ liệu — chỉ cho ẩn                                                     |

Trường `sensitive`: mã hóa cột (P8); Marketing/Viewer nhận giá trị che (`"••••"`) từ API, không che ở client.

## 7. Tag (J4)

| Method + path                                                     | Quyền               | Audit | Ghi chú                                             |
|-------------------------------------------------------------------|---------------------|-------|-----------------------------------------------------|
| `GET /v1/tags`                                                    | Session             |       | Kèm `customer_count`                                |
| `POST /v1/tags` · `PATCH /v1/tags/{id}` (đổi tên, ẩn)             | Owner/Admin/Manager |       |                                                     |
| `POST /v1/tags/{id}/merge` (`intoTagId`)                          | Owner/Admin/Manager | ✓     | Một transaction; trả `moved_count`; không mất khách |
| `PUT /v1/customers/{id}/tags` · `PUT /v1/conversations/{id}/tags` | Session             |       | Gắn/bỏ tag có sẵn; Sales/Support không tạo tag mới  |

Lọc/tìm: dùng `GET /v1/customers` đã có (P9), mở rộng tham số `fieldId:value`, `lastContactFrom/To`, `ownerId`, `channel`. Mục tiêu \< 1 giây với 10.000 khách / 2 điều kiện → cần chỉ mục tag và `last_contact_at`. **Không** có `/v1/segments` ở Đợt 1.

## 8. Tài khoản cá nhân và xác thực (A5, A3, C11) — `/me`

**Quy tắc (U22-3, CEO 13/10/2026):** đăng nhập, 2FA, phiên và đổi tổ chức đi qua **Better Auth ở `/api/auth/*`** đã chạy trong `apps/api` (PR6, `src/app-setup.ts`, `src/modules/auth/auth.config.ts`). **Không** tạo đường `/v1/auth/*` song song. Bảng dưới ghi đường của thư viện đang mở; đường đã đóng bằng `disabledPaths` không dùng.

| Việc | Đường | Quyền | Audit | Ghi chú |
|---|---|---|---|---|
| Đăng nhập · đăng xuất | `POST /api/auth/sign-in/email` · `POST /api/auth/sign-out` | Công khai / Session | Chờ N13 | Lỗi luôn chung một thông điệp; khóa 5 lần sai / 30 phút (N85). **Ghi audit đăng nhập thất bại chờ cố vấn chốt N13** (U22-4) |
| Nhập mã 2FA | `POST /api/auth/two-factor/verify-totp` · `POST /api/auth/two-factor/verify-backup-code` | Session đang chờ 2FA | | 5 mã sai liên tiếp khóa 30 phút; tắt "tin thiết bị này" (`trustDeviceMaxAge: 0`) |
| Bật 2FA | `POST /api/auth/two-factor/enable` (trả mã QR và mã dự phòng) · xác nhận bằng `verify-totp` | Session | ✓ | **10 mã dự phòng**, hiện 1 lần (Q-U20-2). Người chưa cài xong chỉ đi được các đường cài đặt và `GET /v1/me/security-status` (cổng 2FA, N93) |
| Tắt 2FA | — | — | | `/two-factor/disable` **đã đóng** (N79.4); không có đường tắt cho người dùng |
| Đặt lại 2FA của người khác | `POST /v1/members/{userId}/2fa/reset` | **Owner, Admin** (Q-U20-1) | ✓ | Bắt buộc `reason`; thu hồi mọi phiên; buộc cài lại 2FA lần đăng nhập kế tiếp. Thêm 1 dòng Phụ lục B |
| Trạng thái bảo mật | `GET /v1/me/security-status` | Session | | Đã có (PR6d-3) |
| Phiên | `GET /api/auth/list-sessions` · `POST /api/auth/revoke-session` | Session | ✓ (thu hồi) | Chỉ `createdAt`, `expiresAt`; không IP/thiết bị (N79.2). Client đánh dấu **"Phiên này"** bằng cách so với phiên hiện tại (Q-U20-3). Thu hồi = ghi `revoked_at` (N79.1) |
| Đổi tổ chức | `POST /api/auth/switch-org` | Session | | Đã có (N85): phiên mới, phiên cũ bị thu hồi |
| Đổi workspace | Chờ cố vấn (câu 2 mục 10) | Session | | Client xóa cache + ngắt realtime workspace cũ (T1) |
| Quên / đặt lại mật khẩu | **Chờ PR7** | Công khai | ✓ | Đường của thư viện đã đóng (N84). Tên đường chốt ở PR7. Yêu cầu tối thiểu: link một lần, có hạn; luôn trả 202 dù email có tồn tại hay không |
| Mời thành viên | `POST /v1/members/invite` (đã có trong Brief P9) | Owner, Admin | ✓ | **Bỏ `/v1/invitations/*`** (U22-5). Lời mời là cột trên `org_members` (S1-11, N6); hạn 7 ngày (U1). Gửi lại và nhận lời mời: tên đường chốt ở PR7 |
| Hồ sơ cá nhân | `GET/PATCH /v1/me` · `POST /api/auth/change-password` (N162) | Session | ✓ (mật khẩu) | Tên (ảnh chờ kho file); `/update-user` của thư viện đã đóng nên tên đi đường `/v1`. Đổi mật khẩu dùng đường của thư viện (bỏ `/v1/me/password`, N162): yêu cầu mật khẩu cũ, **luôn** đăng xuất các phiên khác, audit ở mỗi công ty người đó thuộc |
| Thông báo | `GET/PATCH /v1/me/notification-settings` | Session | | Thông báo trình duyệt, âm thanh |

## 9. Script quản trị (không phải endpoint)

`tenant:create-org --name --slug` và `tenant:create-workspace --org --template b2b|b2c|service --name` (A1, A2). Idempotent theo `slug`; ghi `audit_logs` và `platform_access_logs`; chạy qua pipeline có phê duyệt.

## 10. Câu hỏi cho cố vấn kỹ thuật

(Q-U20-1→6 ở `spec-M8` mục 8 đã được CEO chốt 13/10/2026; cố vấn chỉ cần xác nhận cách làm của Q-U20-4 cùng `agent.presence` ở S4. N13 — audit đăng nhập thất bại — vẫn chờ cố vấn.)

1.  Phục vụ SLA tạm dừng: lưu `sla_elapsed_seconds` + `sla_paused_at` trên hội thoại hay tính từ `conversation_events`? Đề xuất: lưu tích lũy, sự kiện chỉ để đối soát.
2.  Đổi workspace: dùng token mới theo workspace, hay một token org-wide + header `X-Workspace-Id`? Ảnh hưởng RLS O+W và test T1.
3.  `customer_field_defs` cấp org nhưng giá trị theo khách (khách thuộc workspace): xác nhận khách không dùng chung giữa workspace thì không lộ dữ liệu chéo.
4.  Gộp tag: transaction dài trên org lớn có cần job nền (như audit export) không? Ngưỡng đề xuất: \> 5.000 khách mang tag thì chạy nền.
5.  Có đồng ý bỏ hẳn `/v1/segments` khỏi OpenAPI Đợt 1 (tránh vendor làm sớm)?
