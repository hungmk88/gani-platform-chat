# [Gói 1 - Backend] OpenAPI cho Ticket, Tổng quan, Feature flag, Tự chủ, P7, P11, E20

**Gửi:** FE (Gói 2) · **Từ:** Backend (Gói 1) · **Ngày:** 26/10/2026 · **Căn cứ:** CĐT chốt U27, U28, U29, U35 (26/10); N167 trong `QUESTIONS.md`

Chào anh/chị,

Backend gửi hợp đồng API cho các màn CĐT vừa gỡ chặn, để FE dựng UI ngay dù Backend chưa làm xong endpoint.

## 1. Hai file OpenAPI, hai vai trò

| File | Là gì | FE dùng thế nào |
|---|---|---|
| `docs/openapi/openapi.json` | **Nguồn sự thật**: chỉ gồm những gì API đang phục vụ thật. CI đỏ nếu file lệch với mã | Gọi API thật, sinh `src/api/schema.d.ts` như hiện nay |
| `docs/openapi/planned.json` | **Hợp đồng trước**: các endpoint đã chốt nhưng **chưa có**. Mỗi operation có `x-status: planned` và `x-sprint` (sprint dự kiến làm) | **Chỉ để dựng UI trước** (kiểu, API giả trong E2E). **Không gọi** các path này lên API thật: chúng sẽ trả 404 |

Sinh kiểu cho file planned:

```bash
openapi-typescript docs/openapi/planned.json -o src/api/planned.d.ts
```

Đề xuất FE thêm vào `apps/admin/package.json` một script `gen:api:planned` (chạy từ `apps/admin`):

```bash
openapi-typescript ../../docs/openapi/planned.json -o src/api/planned.d.ts
```

Không sửa tay `planned.d.ts`. Backend đã thử lệnh trên với `planned.json` và sinh kiểu được.

**Khi Backend làm xong một endpoint:**
- path chuyển từ `planned.json` sang `openapi.json` với **cùng hình dạng**;
- test của Backend đỏ nếu một path nằm ở cả hai file;
- FE đổi import từ `planned.d.ts` sang `schema.d.ts` và bỏ dữ liệu giả của màn đó.

Nếu khi làm thật phải đổi hình dạng, Backend báo trước và ghi vào `QUESTIONS.md`.

## 2. Có gì trong `planned.json`

Tất cả nằm trên `main` sau khi merge #339, #341, #344, #345.

| Màn | Endpoint | Sprint | Quyền (Phụ lục B) |
|---|---|---|---|
| #14/#15 Ticket (U27) | `GET /v1/tickets?workspaceId=&status=&assignee=me\|none\|<id>&cursor=` · `POST /v1/tickets` · `GET /v1/tickets/{id}` (kèm `events[]`) · `PATCH /v1/tickets/{id}` | S4 | Owner/Admin/Manager/Support: mọi việc. Sales: chỉ tạo và xem ticket mình tạo |
| #16 Tổng quan (U28/U29) | `GET /v1/overview?workspaceId=` | S5 | Mọi vai trò. Sales/Support nhận `scope: me` |
| #27 Feature flag (U29) | `GET /v1/feature-flags?workspaceId=` · `PATCH /v1/feature-flags/{key}` | S5 | Owner/Admin |
| #27 Mức tự chủ (U29) | `GET/PATCH /v1/workspaces/{id}/autonomy` | S5 | Đọc: Owner/Admin. Nâng mức: chỉ Owner. Hạ mức: Owner/Admin |
| #11 P7 dữ liệu cá nhân (U35) | `GET/POST /v1/privacy-requests` · `GET /v1/privacy-requests/{id}` · `POST /v1/privacy-requests/{id}/execute` | S5 | Owner/Admin |
| #29 P11 sự cố (U35) | `GET /v1/security-alerts` · `GET/POST /v1/security-incidents` · `PATCH /v1/security-incidents/{id}` | S5 | Owner/Admin, platform operator trong phiên truy cập |
| #26 E20 prompt (U35) | `GET /v1/ai/prompts` | S5 | Owner/Admin, chỉ đọc |

## 3. Điều FE cần biết theo từng màn

### Ticket (#14/#15)

- **Trạng thái và nhãn:** 5 trạng thái `new` (Mới), `in_progress` (Đang xử lý), `waiting_customer` (Chờ khách), `done` (Đã xong), `cancelled` (Đã hủy).
- **Đổi trạng thái** bằng `PATCH {status, version}`. Bảng chuyển hợp lệ:

| Từ | Sang được |
|---|---|
| `new` | `in_progress`, `cancelled` |
| `in_progress` | `waiting_customer`, `done`, `cancelled` |
| `waiting_customer` | `in_progress`, `done`, `cancelled` |
| `done` | `in_progress` (mở lại) |
| `cancelled` | không đi đâu nữa |

- **Nút theo trạng thái:** chỉ hiện các nút có trong bảng trên.
- **Nút Hủy:** chỉ Owner/Admin/Manager thấy. Support bấm thì API trả 403.
- **Lỗi khi đổi trạng thái:**
  - 409 `invalid_transition`: đọc lại ticket.
  - 409 `version_conflict`: ticket vừa bị người khác sửa, đọc lại.
- **Mức ưu tiên** (C8): `normal` / `high` / `urgent` = Thường / Cao / Khẩn.
- **Trường còn `null`:**
  - `type`: chờ The Smile (Q8).
  - `sla`: chờ Q7/Q8. Khi có SLA, `sla.pausedReason = 'waiting_customer'` nghĩa là đồng hồ đang dừng vì chờ khách (U27).
- **Lịch sử:** `events[]` có cùng khuôn với lead (U25(3)), cũ trước.
- **Tạo ticket:** `POST` mang `Idempotency-Key` như mọi POST tạo dữ liệu.

### Tổng quan (#16)

- **5 thẻ:**
  - `openConversations`
  - `waitingForAgent`
  - `firstResponseP90Seconds`: hôm nay, theo múi giờ của workspace; `null` = chưa có dữ liệu → hiện "—"
  - `overSla`: `null` tới khi có Q7 → hiện "Chưa có SLA"
  - `agentsOnline` / `agentsTotal`: online = trạng thái Online của C10
- **Sales/Support:** nhận `scope: me` (số của hội thoại mình giữ) và hai thẻ agent là `null`. Không hiện hai thẻ đó.
- **CSAT và chỉ số AI:** để Đợt 2.

### Feature flag và mức tự chủ (#27)

- **Các cờ:**
  - `ai.internal`, `channel.zalo`: bật/tắt được.
  - `ai.customer_reply`, `channel.webchat`: `locked: true`, `lockedReason: 'phase_2'` → hiện xám, nhãn "Chờ Đợt 2".
  - Bật một cờ đang khóa → 409 `not_in_phase`.
- **Mức tự chủ:**
  - Hiện đủ L0–L5; chỉ các mức trong `available` (Đợt 1: `L0`, `L1`) bấm được.
  - Đổi mức bắt buộc có `reason` (1–500 ký tự).
  - Admin nâng mức → 403. L2 trở lên → 409 `not_in_phase`.

### P7 — yêu cầu dữ liệu cá nhân (#11)

1. **Tìm khách theo SĐT:** dùng `GET /v1/customers?q=<SĐT>`, đã có. Owner/Admin thấy SĐT đầy đủ.
2. **Tạo yêu cầu:** `POST /v1/privacy-requests {customerId, kind: 'export'|'erase', reason}`. Yêu cầu ở `pending`. Trùng một yêu cầu đang chờ cùng loại → 409 `duplicate_resource`.
3. **Thực hiện:** `POST /v1/privacy-requests/{id}/execute` là bước riêng, FE hỏi lại trước khi gọi.
   - `export` trả JSON (`PrivacyExport`) để tải về.
   - `erase` **không làm lại được**: xóa tên, SĐT, email, danh tính kênh và nội dung tin của khách; hội thoại và ticket giữ lại ở dạng ẩn danh. Kết quả trả `PrivacyErasure` (đã xóa gì).
   - Thực hiện lần hai → 409 `request_not_pending`.
- **Thời hạn xử lý theo luật:** chờ luật sư (U24 (d)). FE chưa hiện hạn.

### P11 — sự cố bảo mật (#29)

- **Cảnh báo:**
  - `kind`: `login_failures`, `two_factor_locked`, `two_factor_reset`, `platform_access`, `webhook_signature_invalid`, `bulk_export`. FE đặt nhãn lời thường cho từng loại.
  - `severity`: `low` / `medium` / `high` / `critical`.
  - Cảnh báo chỉ mang id (`subjectUserId`, `channelAccountId`); tên người lấy từ `GET /v1/members`.
- **Nút "Mở sự cố":**
  - Gửi `{title, severity, handlerUserId, alertIds?}`.
  - Người xử lý phải là Owner/Admin đang hoạt động, sai → 422 `invalid_handler`.
  - Cảnh báo không thuộc công ty → 422 `invalid_alert`.
- **Sự cố:** chỉ `open` / `closed`. `PATCH` để đóng hoặc giao người khác; đã đóng → 409 `incident_closed`.

### E20 — prompt (#26)

- **Dữ liệu:** `GET /v1/ai/prompts` trả `key`, `version`, `active`, `approvedAt`, `approvedBy`.
- **Chỉ đọc**, không có nút sửa (U35).

## 4. Mã lỗi mới

Các mã dưới đây chưa có trong `src/api/errors.ts`. FE thêm câu P9 cho từng mã:

| Mã | HTTP | Ở đâu | Câu gợi ý |
|---|---|---|---|
| `invalid_transition` | 409 | Ticket | Trạng thái này không chuyển được từ trạng thái hiện tại. |
| `not_in_phase` | 409 | Feature flag, mức tự chủ | Tính năng này mở ở Đợt 2. |
| `request_not_pending` | 409 | P7 | Yêu cầu này đã được thực hiện. |
| `incident_closed` | 409 | P11 | Sự cố này đã đóng. |
| `invalid_handler` | 422 | P11 | Người xử lý phải là Owner hoặc Admin đang hoạt động. |
| `invalid_alert` | 422 | P11 | Có cảnh báo không thuộc công ty này. |

## 5. Lịch

| Hạn | Việc |
|---|---|
| 30/10 | `planned.json` đầy đủ trên `main` (bốn PR #339, #341, #344, #345) |
| S4 | Backend làm thật Ticket → chuyển sang `openapi.json` |
| S5 | Backend làm thật Tổng quan, feature flag, tự chủ, P7, P11, E20 |
| Chờ quyết định | Q7 (SLA, giờ làm việc, trạng thái agent), Q8 (loại ticket), luật sư (thời hạn P7) |

Nếu FE thấy hình dạng nào chưa đủ để vẽ màn, anh/chị báo trước 30/10 để Backend sửa `planned.json` trước khi làm thật.

Trân trọng,
Backend (Gói 1)
