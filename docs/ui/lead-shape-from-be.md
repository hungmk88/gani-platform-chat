# Hình dạng Lead: giả định của FE (02/11) và hợp đồng planned S4 (#544)

**Nguồn: brief BE ngày 02/11, chưa có trong repo, chưa được CEO xác nhận nguyên văn.** FE soạn theo brief CEO
`2810-02112026-FE-BRIEF-30` (02/11/2026) mục 2(a). Chỉ ghi những gì FE đọc được trong brief BE, không thêm trường. Mục 3 là
những chỗ brief BE không nói, FE phải giả định để dựng #12 (12a, chỉ đọc), xin BE xác nhận hoặc sửa.

**Trạng thái (brief CEO `2810-02112026-FE-BRIEF-35`, 02/11/2026):** BE xác nhận mục 1–6 và 8–9 "ổn"; mục 7 (quyền đọc) giữ
giả định cũ, chờ CEO chốt T-2. Mục 8–9 là hai câu hỏi của #13a (mục 4); cùng brief ghi BE còn rà soát hai câu này, nên FE
chưa có đường và trường cụ thể cho #13a và chưa code #13a. Nguyên văn trả lời của BE chưa có trong repo.

**Trạng thái (brief CEO `2810-02112026-FE-BRIEF-44`, `-45`, 02/11/2026):** hợp đồng Lead đã vào `docs/openapi/planned.json` trên
`main` (#544, merge 15:57:07 UTC, squash `9e29bea`; N188). 12a dùng kiểu sinh (`apps/admin/src/api/planned.d.ts`), bỏ kiểu viết
tay. Câu 8–9 (mục 4) **đã có** trả lời trong hợp đồng. Mục 1–4 dưới giữ làm lịch sử; mục 5 đối chiếu với hợp đồng.

**T-2 (brief CEO `2810-03112026-FE-BRIEF-46`, 03/11/2026): chưa chốt.** N188 trong `QUESTIONS.md` vẫn "Chờ APPROVED". Support
vẫn ở menu `/leads` và mở được `/leads/[id]`; FE không chặn UI. CEO xác nhận thì FE làm PR riêng (bỏ Support khỏi menu, E2E
Support → 403).

## 1. Lead (`GET /v1/leads`, Brief P9 dòng 443)

Brief BE ghi (mục 2, "hợp đồng Lead đã trình (mục 1 brief Lead)"), nguyên văn danh sách trường:

```text
id, workspaceId, customer{id, displayName}, conversationId, title,
stage{id, name}, status, owner{id, name}|null, lostReason, closedAt,
score:null, version, createdAt, updatedAt
```

## 2. Các bước pipeline

Brief BE ghi: `GET /v1/workspaces/{id}/pipeline` ("endpoint bổ sung đã có trong brief CEO 02/11 [GỬI BE], mục 1 nhóm Lead").
CEO chốt FE dùng đường này, bỏ `/v1/leads/stages` (brief 30 mục 3). Chưa có trong `openapi.json` hay `planned.json` trên `main`.

## 3. FE giả định (brief BE không nói), xin BE xác nhận hoặc sửa

| # | Chỗ | FE giả định trong mã 12a |
|---|---|---|
| 1 | Kiểu từng trường | `id`, `workspaceId`, `title`, `createdAt`, `updatedAt`: chuỗi (giờ ISO 8601); `version`: số |
| 2 | Trường có thể `null` | `customer` (lead chưa gắn khách), `customer.displayName`, `conversationId`, `owner.name`, `lostReason`, `closedAt` |
| 3 | Giá trị `status` | `open` \| `won` \| `lost` (U6: Thắng/Thua là trạng thái kết thúc; `POST /v1/leads/{id}/close` nhận `won` \| `lost`, P9) |
| 4 | `stage` của lead đã đóng | bước lúc lead được đóng |
| 5 | Câu trả lời `GET /v1/leads` | `{ data: Lead[], nextCursor: string \| null }`, tham số `workspaceId`, `cursor`, `limit` (quy ước cursor của P9) |
| 6 | Câu trả lời `GET /v1/workspaces/{id}/pipeline` | `{ data: [{ id, name }] }`, các bước theo đúng thứ tự API trả |
| 7 | Quyền đọc | mọi vai trò của công ty (menu `/leads`, prototype); ghi theo Phụ lục B ở 12b |

FE không dùng ở 12a (chỉ khai báo kiểu): `conversationId`, `closedAt`, `score`, `version`, `createdAt`.

Khi BE công bố hợp đồng trong `planned.json` trên `main`: FE thay kiểu viết tay bằng kiểu sinh, giữ đường `/pipeline` (brief 30).
**Đã làm** sau #544 (mục 5).

## 4. Câu hỏi thêm cho #13a Chi tiết lead (brief CEO `2810-02112026-FE-BRIEF-33`), xin BE trả lời cùng đợt

| # | Câu hỏi | FE cần để làm gì |
|---|---|---|
| 8 | Có `GET /v1/leads/{id}` không? Nếu có, trả đúng một `Lead` như mục 1 hay thêm trường nào? (Brief P9 chưa ghi đường này) | Mở chi tiết bằng link riêng `/leads/{id}` như prototype #13, kể cả khi lead chưa nằm trong trang đã tải |
| 9 | Lịch sử lead (`lead_events`) trả ở đâu (trong chi tiết hay đường riêng), mỗi sự kiện có những trường nào? | Phần "Lịch sử" của #13: loại sự kiện (tạo, đổi bước, Thắng, Thua kèm lý do), bước trước và sau, người làm, thời điểm |

FE không tự đặt đường hay trường cho hai câu này; chưa có trả lời thì #13a chưa code.

## 5. Hợp đồng planned S4 (#544, N188) so với giả định

**5 đường** (`planned.json`):

| Đường | Thao tác | FE dùng |
|---|---|---|
| `/v1/workspaces/{id}/pipeline` | `GET` → `{ data: [{ id, name, position }], lostReasons }` | 12a (đọc) |
| `/v1/leads` | `GET` (cursor; lọc `workspaceId`, `stageId`, `status`, `owner`, `createdBy`, `customerId`; `limit` 1–100, mặc định 50); `POST` (Idempotency-Key) | `GET` ở 12a; `POST` ở 12b |
| `/v1/leads/{id}` | `GET` → `LeadDetail` = `Lead` + `events[]` cũ trước | #13a |
| `/v1/leads/{id}/stage` | `PATCH {version, stageId}` | 12b |
| `/v1/leads/{id}/close` | `POST {version, outcome, lostReason}` | 12c |

**Hợp đồng là tập lớn hơn kiểu viết tay; không trường nào FE dùng bị đổi:**

| # mục 3 | Hợp đồng | FE |
|---|---|---|
| 1 | Khớp (`Uuid`, giờ `date-time`, `version` số nguyên) | Không đổi |
| 2 | `customer` **luôn có** (FE giả định có thể `null`); `displayName`, `conversationId`, `owner`, `owner.name`, `lostReason`, `closedAt` có thể `null` | Bỏ nhánh `customer` `null` |
| 3 | Khớp (`open` \| `won` \| `lost`) | Không đổi |
| 4 | Hợp đồng không ghi riêng | Giữ giả định |
| 5 | Khớp; thêm bộ lọc; `limit` tối đa 100 | FE gửi `limit=100`, khớp; chưa dùng bộ lọc |
| 6 | Thêm `position` cho mỗi bước và `lostReasons` của workspace | Giữ thứ tự API trả (hợp đồng: "steps … in order"); chưa dùng hai trường này |
| 7 | **T-2 (N188):** Owner/Admin/Manager mọi lead của workspace; Sales lead mình tạo hoặc phụ trách (lead khác 404); Marketing/Viewer chỉ đọc (ghi 403); **Support 403** cả đọc lẫn pipeline | **Menu `/leads` vẫn cho mọi vai trò**: brief 45 chỉ bỏ Support khi CEO xác nhận T-2 đã chốt; N188 trong `QUESTIONS.md` còn "Chờ APPROVED" |

Thêm so với kiểu viết tay: `createdBy` (luật Sales), `score` luôn `null` tới Đợt 2.

**Câu 8–9 (đã có):** `GET /v1/leads/{id}` có, trả `Lead` cùng `events[]` cũ trước. Mỗi event: `type` (`created`,
`stage_changed`, `owner_changed`, `closed`), `fromStage`, `toStage` (`{ id, name }` hoặc `null`), `outcome` (`won`, `lost` hoặc
`null`), `actorUserId` (UUID hoặc `null`; FE ghi `null` là "Hệ thống" như ticket), `occurredAt`. Không có `id` của event, tên người làm hay lý do Thua trong event (lý
do Thua ở `lostReason` của lead); không chữ tự do. #13a làm ở PR riêng (brief 45 việc 3).

