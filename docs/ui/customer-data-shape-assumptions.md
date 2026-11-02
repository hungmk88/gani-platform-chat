# #23 Trường tùy chỉnh và Tag: giả định của FE (02/11) và hợp đồng planned S4 (#547, #548)

**Trạng thái (brief CEO `2810-03112026-FE-BRIEF-46`, 03/11/2026): đã có hợp đồng thật** trong `docs/openapi/planned.json` trên
`main`, sớm hơn hẹn 13/11: Tag ở #547 (merge 16:08:27 UTC 02/11, squash `0f4c256`, N190), trường tùy chỉnh ở #548 (merge
16:20:40, squash `a4c883f`, N191). **Đường trường tùy chỉnh đã đổi:** `GET /v1/customer-fields`, không phải
`/v1/customer-field-defs` FE đoán theo endpoint-M8; `GET /v1/tags` giữ nguyên. 23a dùng kiểu sinh (`apps/admin/src/api/planned.d.ts`)
và đường thật; mục 1–2 dưới giữ làm lịch sử, mục 3 đối chiếu.

**Nguồn: `docs/ui/endpoint-M8.md` (bản nháp 3, 13/10/2026, trên `main`) mục 6 (J1) và mục 7 (J4); chưa có trong `openapi.json`
hay `planned.json`.** FE soạn theo brief CEO `2810-02112026-FE-BRIEF-33` mục 4, cùng cách với `docs/ui/lead-shape-from-be.md`.
23a chỉ đọc: tab "Trường tùy chỉnh" và tab "Tag" trên `/settings/customer-data` (cùng tab "Yêu cầu dữ liệu cá nhân"), Owner/Admin.

## 1. Đường FE dùng ở 23a (có trong endpoint-M8)

| Đường | endpoint-M8 ghi |
|---|---|
| `GET /v1/customer-field-defs` | Session; cấp **công ty**, dùng chung mọi workspace. Trường: `name`, `type` (`text`, `number`, `date`, `select`, `multiselect`, `phone`, `email`), `required`, `sensitive`; PATCH đổi tên, thứ tự, `hidden` |
| `GET /v1/tags` | Session; kèm `customer_count`; PATCH đổi tên, ẩn |

Các đường ghi (tạo, sửa, ẩn, xóa trường; tạo, đổi tên, ẩn, gộp tag; gắn tag) để 23b, khi có hợp đồng thật.

## 2. FE giả định (endpoint-M8 không nói), xin BE xác nhận hoặc sửa

| # | Chỗ | FE giả định trong mã 23a |
|---|---|---|
| 1 | Câu trả lời | `{ data: [...] }`, không phân trang (cả danh sách của công ty) |
| 2 | Tên trường | camelCase như các API khác: `customerCount` (endpoint-M8 viết `customer_count`) |
| 3 | Thứ tự | API trả đúng thứ tự hiển thị; FE không sắp lại. Có trường thứ tự riêng không (endpoint-M8 nói PATCH đổi "thứ tự")? |
| 4 | Trường của một trường tùy chỉnh | `id`, `name`, `type`, `required`, `sensitive`, `hidden` (boolean); lựa chọn của `select`/`multiselect` chưa hiện ở 23a |
| 5 | Trường của một tag | `id`, `name`, `customerCount` (số), `hidden` (boolean) |
| 6 | Tag thuộc cấp nào (U47) | Cấp công ty, `GET /v1/tags` không có `workspaceId`; "ẩn tag" hiện là "Đã ẩn", chưa diễn giải thêm |
| 7 | Quyền đọc | Session (mọi vai trò công ty) theo endpoint-M8; màn chỉ Owner/Admin theo menu (U36) |

Khi BE công bố hợp đồng trong `planned.json` trên `main`: FE thay kiểu viết tay (`apps/admin/src/customer-data/catalog.ts`) bằng
kiểu sinh và sửa theo; sửa lớn thì báo CEO. **Đã làm** (mục 3).

## 3. Hợp đồng planned S4 so với 7 giả định

| # | Giả định | Hợp đồng (#547 N190, #548 N191) | Kết quả |
|---|---|---|---|
| 1 | `{ data: [...] }`, không phân trang | `CustomerFieldList`, `TagList` = `{ data }`; không cursor (tối đa 50 trường, 500 tag) | Đúng |
| 2 | camelCase (`customerCount`) | `customerCount` | Đúng |
| 3 | API trả đúng thứ tự hiển thị, FE không sắp lại; có trường thứ tự riêng không? | Trường theo `position` (có trường `position`), tag theo tên | Đúng; câu hỏi có trả lời: có `position` |
| 4 | Trường: `id`, `name`, `type` (7 kiểu), `required`, `sensitive`, `hidden` | Đủ các trường đó, **thêm** `options` (2–50 lựa chọn cho `select`/`multiselect`, kiểu khác rỗng), `position`, `hasData`, `createdAt`, `updatedAt` | Đúng, hợp đồng lớn hơn; 23a hiện thêm cột Lựa chọn và Dữ liệu |
| 5 | Tag: `id`, `name`, `customerCount`, `hidden` | Đủ, **thêm** `createdAt`, `updatedAt` | Đúng |
| 6 | Tag cấp công ty, `GET /v1/tags` không có `workspaceId` | Cấp công ty, không tham số; tag ẩn không gắn mới được, khách đang mang vẫn giữ, vẫn lọc được (T-4) | Đúng |
| 7 | Quyền đọc: mọi vai trò của công ty; màn chỉ Owner/Admin theo menu (U36) | `GET` cho mọi vai trò; ghi (tạo, sửa, ẩn, gộp, xóa) Owner/Admin | Đúng; màn vẫn Owner/Admin theo menu |

**Chưa đúng:** chỉ đường trường tùy chỉnh (`/v1/customer-field-defs` → `/v1/customer-fields`). Tab Tag làm ở PR riêng sau tab
Trường tùy chỉnh (brief 46: tách khi quá 400 dòng).
