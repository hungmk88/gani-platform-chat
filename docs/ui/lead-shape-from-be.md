# Hình dạng Lead FE đọc được từ brief BE (bản nháp, chờ BE xác nhận)

**Nguồn: brief BE ngày 02/11, chưa có trong repo, chưa được CEO xác nhận nguyên văn.** FE soạn theo brief CEO
`2810-02112026-FE-BRIEF-30` (02/11/2026) mục 2(a). Chỉ ghi những gì FE đọc được trong brief BE, không thêm trường. Mục 3 là
những chỗ brief BE không nói, FE phải giả định để dựng #12 (12a, chỉ đọc), xin BE xác nhận hoặc sửa.

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
