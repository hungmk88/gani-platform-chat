# [Gói 1 - Backend] U31: danh sách người nhận cho Chuyển / Gán lại

**Gửi:** FE (Gói 2) · **Từ:** Backend (Gói 1) · **Ngày:** 27/10/2026 · **Căn cứ:** U31, N166, N168 trong `QUESTIONS.md`

Chào anh/chị,

Endpoint cho ô "Người nhận" của hộp thoại **Chuyển** và **Gán lại** đi cùng thư này. Khi PR này merge, đường mới nằm trong `docs/openapi/openapi.json`, và `apps/admin/src/api/schema.d.ts` đã sinh lại sẵn trong cùng PR, có kiểu `Assignee`, `AssigneeList`.

## 1. Gọi thế nào

`GET /v1/conversations/{id}/assignees?purpose=transfer|assign` → `200 { data: Assignee[] }`

| `purpose`  | Hộp thoại | Ai gọi được                                                                                  |
| ---------- | --------- | -------------------------------------------------------------------------------------------- |
| `transfer` | Chuyển    | Owner/Admin/Manager: mọi hội thoại thấy được. Sales/Support: **chỉ hội thoại mình đang giữ** |
| `assign`   | Gán lại   | Owner/Admin/Manager                                                                          |

**Danh sách đã lọc đúng theo luật mà `POST .../transfer` và `.../assign` kiểm.** Người có trong danh sách sẽ không gây 422 `invalid_assignee`; người không có trong danh sách thì hành động từ chối. Test của Backend kiểm hai bên khớp nhau.

Một người có trong danh sách khi:

- là thành viên active của công ty và thuộc workspace của hội thoại;
- có vai trò giữ được hội thoại (Owner, Admin, Manager, Sales, Support);
- **không** phải người đang giữ hội thoại;
- và, khi Sales/Support **chuyển**: chung ít nhất một team với người chuyển.

## 2. Hình dạng `Assignee`

| Trường               | Kiểu                                            | Lưu ý cho FE                                                                                                                                                     |
| -------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `userId`             | uuid                                            | Gửi vào `toUserId` của `transfer`/`assign`                                                                                                                       |
| `name`               | `string \| null`                                | **Có thể `null`** (khác đề xuất `string` của FE): người nhận lời mời không bắt buộc nhập tên. FE hiện nhãn thay thế, không để ô trống                            |
| `role`               | `owner \| admin \| manager \| sales \| support` | Không bao giờ có `marketing`, `viewer`                                                                                                                           |
| `teamId`, `teamName` | `uuid \| null`, `string \| null`                | Team của người đó **trong workspace này**. Một người có thể ở nhiều team: Backend chọn team chung với người xem trước, rồi theo tên. `null` khi không ở team nào |
| `openCount`          | integer ≥ 0                                     | Số hội thoại người đó **đang giữ trên toàn công ty** (mọi workspace), không chỉ workspace này. Lý do: giới hạn tải là của người (U45)                            |
| `maxConcurrent`      | integer ≥ 1                                     | **Giới hạn hiệu lực**, luôn là số (hẹp hơn `integer \| null` FE đề xuất): giới hạn riêng của người đó, không có thì mặc định của workspace                       |

- **Thứ tự:** theo tên, người không có tên đứng cuối.
- **Không phân trang:** danh sách chỉ dài bằng số thành viên của một workspace.

## 3. Những điểm dễ hiểu nhầm

- **`openCount` và `maxConcurrent` chỉ để hiển thị.** Đợt 1 **chưa** chặn chuyển khi người nhận đã đủ tải (áp giới hạn khi phân bổ là S4). FE có thể hiện "3/5", nhưng không nên tắt lựa chọn khi `openCount ≥ maxConcurrent`.
  Nếu muốn, FE có thể cảnh báo người đã đủ tải (màu, tooltip "đã nhận 5/5") nhưng **vẫn cho chọn**; chặn thật là việc của S4 (U45).
- **Danh sách không theo trạng thái online.** Trạng thái online là S4.
- **Lỗi của endpoint đi theo đúng lỗi của hành động:**
  - 403: vai trò không có hành động, hoặc Sales/Support xin danh sách `transfer` cho hội thoại họ không giữ;
  - 404: hội thoại không thấy;
  - 400: thiếu `purpose` hoặc giá trị lạ.
- **Danh sách là ảnh chụp lúc mở hộp thoại.** Nếu giữa chừng có người rời workspace hay hội thoại đổi người giữ, hành động vẫn có thể trả 422 hoặc 409 như cũ. FE giữ cách xử lý lỗi đang có.
- **Chuyển cho cả team, ghi chú khi Đóng, lý do chuyển:** vẫn như N166 (Đợt 1 chỉ chuyển cho người; ô ghi chú ẩn tới khi có ghi chú nội bộ).
- **Màn Tạo ticket:** endpoint này **không** dùng cho ô người nhận của ticket. Người nhận ticket sẽ có luật và endpoint riêng cùng ticket thật ở S4 (CĐT chốt 27/10). Tới lúc đó FE giữ cách tạm `GET /v1/members` (Owner/Admin).

Trân trọng,
Backend (Gói 1)
