# Danh sách endpoint bổ sung từ Spec M8 — để cố vấn kỹ thuật review

Bản nháp 2 · 13/10/2026 · đã sửa theo U20 · Dùng cho Brief Backend & Core P9, mục “Endpoint bổ sung”. Quy ước chung của P9 áp dụng (tiền tố `/v1`, cursor, mã lỗi, `Idempotency-Key` cho POST, RLS theo org/workspace). Tên và schema chi tiết chốt trong OpenAPI.

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

| Method + path                                                                               | Quyền                                                                                 | Audit                            | Ghi chú                                                                                                                                                  |
|---------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------|----------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------|
| `POST /v1/auth/login` · `POST /v1/auth/2fa/verify` · `POST /v1/auth/logout`                 | Công khai / Session                                                                   | ✓ (đăng nhập thất bại, khóa tạm) | Lỗi đăng nhập luôn chung một thông điệp                                                                                                                  |
| `POST /v1/auth/password-reset/request` · `POST /v1/auth/password-reset/confirm`             | Công khai                                                                             | ✓                                | **Chờ PR7** (N84; đường của thư viện đã đóng). Tên đường chốt ở PR7. Yêu cầu tối thiểu: link một lần, có hạn; luôn trả 202 dù email có tồn tại hay không |
| `GET /v1/invitations/{token}` · `POST /v1/invitations/{token}/accept`                       | Công khai (token)                                                                     | ✓                                | Đặt mật khẩu; vai trò bắt buộc 2FA → bước cài 2FA                                                                                                        |
| `POST /v1/invitations` · `POST /v1/invitations/{id}/resend` · `DELETE /v1/invitations/{id}` | Owner/Admin                                                                           | ✓                                |                                                                                                                                                          |
| `GET/PATCH /v1/me`                                                                          | Session                                                                               |                                  | Tên, ảnh                                                                                                                                                 |
| `POST /v1/me/password`                                                                      | Session                                                                               | ✓                                | Yêu cầu mật khẩu cũ; đăng xuất các phiên khác                                                                                                            |
| `GET /v1/me/2fa` · `POST /v1/me/2fa/setup` · `POST /v1/me/2fa/enable`                       | Session                                                                               | ✓ (enable)                       | Chỉ xem trạng thái và bật (U20-1). **Không có** đường tắt 2FA cho người dùng (N79.4)                                                                     |
| `POST /v1/members/{userId}/2fa/reset`                                                       | **Chờ Q-U20-1** (đề xuất Owner/Admin; 2FA của Owner chỉ Owner khác/platform operator) | ✓                                | Bắt buộc `reason`; thu hồi mọi phiên; buộc cài lại 2FA lần đăng nhập kế tiếp                                                                             |
| `GET /v1/me/sessions` · `DELETE /v1/me/sessions/{id}`                                       | Session                                                                               | ✓ (DELETE)                       | Chỉ trả `id`, `createdAt`, `expiresAt` (+ `isCurrent` nếu duyệt Q-U20-3); không có IP/thiết bị (N79.2). DELETE = ghi `revoked_at` (N79.1)                |
| `GET/PATCH /v1/me/notification-settings`                                                    | Session                                                                               |                                  | Thông báo trình duyệt, âm thanh                                                                                                                          |
| `GET /v1/me/workspaces` · `POST /v1/me/workspaces/{id}/switch`                              | Session                                                                               |                                  | Trả token/ngữ cảnh mới; client xóa cache + ngắt realtime workspace cũ (T1)                                                                               |

## 9. Script quản trị (không phải endpoint)

`tenant:create-org --name --slug` và `tenant:create-workspace --org --template b2b|b2c|service --name` (A1, A2). Idempotent theo `slug`; ghi `audit_logs` và `platform_access_logs`; chạy qua pipeline có phê duyệt.

## 10. Câu hỏi cho cố vấn kỹ thuật

(Thêm các câu Q-U20-1→6 ở `spec-M8` mục 8; Q-U20-4 — tự chuyển Offline khi mất kết nối — là câu cần cố vấn trả lời nhất.)

1.  Phục vụ SLA tạm dừng: lưu `sla_elapsed_seconds` + `sla_paused_at` trên hội thoại hay tính từ `conversation_events`? Đề xuất: lưu tích lũy, sự kiện chỉ để đối soát.
2.  Đổi workspace: dùng token mới theo workspace, hay một token org-wide + header `X-Workspace-Id`? Ảnh hưởng RLS O+W và test T1.
3.  `customer_field_defs` cấp org nhưng giá trị theo khách (khách thuộc workspace): xác nhận khách không dùng chung giữa workspace thì không lộ dữ liệu chéo.
4.  Gộp tag: transaction dài trên org lớn có cần job nền (như audit export) không? Ngưỡng đề xuất: \> 5.000 khách mang tag thì chạy nền.
5.  Có đồng ý bỏ hẳn `/v1/segments` khỏi OpenAPI Đợt 1 (tránh vendor làm sớm)?
