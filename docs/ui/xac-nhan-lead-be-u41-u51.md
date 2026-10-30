# Gói xác nhận cho lead BE: U41, U44, U45, U46, U47, U51

30/10/2026 · Người soạn: nhóm Backend · Lead BE xác nhận hoặc bác từng đề xuất ở mục cuối.

Các đề xuất dưới đây đã gửi FE ngày 26/10 (`docs/ui/phan-hoi-backend-30-10.md` mục 4, #323, N166), sau khi anh duyệt. Gói này không
có đề xuất mới. Mỗi câu ghi lại đề xuất đó, bằng chứng trong repo, phương án khác (nếu thật sự có), ảnh hưởng mốc, và câu con còn mở.
Không câu nào chặn S1 (16/11); tất cả phải chốt trước S4 (28/12), vì routing, giới hạn tải, CRM và handoff nằm ở S4 (Brief dòng 908).

## U45: giới hạn tải và vòng xoay khi agent ở nhiều team / workspace

- **Đề xuất 26/10 (dòng 73):** giới hạn tải là của **người**, chung mọi workspace của công ty; vòng xoay chạy theo **team** của kênh.
- **Bằng chứng:**
  - `agent_settings` có `UNIQUE (org_id, user_id)` (`202610031820_create_agent_settings.sql`), tức một giới hạn riêng cho cả công ty.
  - `workspaces.default_max_concurrent` (N157). Tải đếm toàn công ty qua `app.held_conversation_counts_by_state` (N168, #385).
  - `packages/db/src/assignee-read.ts:56,66`: giới hạn hiệu lực = giới hạn riêng, không có thì mặc định của **workspace chứa hội thoại**.
  - Brief dòng 712 (round-robin trong team), 718 (giới hạn "cấu hình theo workspace và theo agent", chỉ đếm `HUMAN_ACTIVE`).
- **A/B** khi người không có giới hạn riêng (ví dụ đang giữ 4; W1 mặc định 3, W2 mặc định 10: "đầy" ở W1, "còn chỗ" ở W2):
  - **A (code hiện tại):** mặc định theo workspace của hội thoại. Khớp chữ Brief dòng 718.
  - **B:** lấy mặc định nhỏ nhất trong các workspace người đó thuộc. Chọn B thì phải nói rõ "thuộc" là membership **hiện tại** hay
    **lịch sử**: người rời workspace có thể làm đổi giới hạn hồi tố, dễ sinh lỗi khó tìm.
  - Backend nghiêng A (không đổi code; ai cần một giới hạn chung thì đặt giới hạn riêng).
- **Chờ lead BE:** chọn A hay B; người ở 2 team có lượt ở cả hai vòng xoay, chỉ giới hạn tải chặn quá tải, có chấp nhận không;
  "agent offline không nhận" phụ thuộc trạng thái online (U42/U43, chưa làm).

## U41: đổi giờ làm việc / thêm ngày lễ khi hội thoại đang mở

- **Đề xuất 26/10 (dòng 70):** **giữ hạn cũ**, áp cả khi đổi giờ làm việc và ngày lễ.
- **Bằng chứng:** chưa có code SLA, giờ làm việc hay ngày lễ (`git grep` trong `*.ts`, `*.sql` không có). Chỉ có tài liệu:
  `docs/ui/endpoint-M8.md:40` ("Hội thoại đang mở giữ hạn cũ khi SLA đổi"; đồng hồ dừng ngoài giờ/ngày lễ, ghi `sla_paused`/`sla_resumed`;
  đề nghị cố vấn xem lưu `sla_elapsed_seconds` tích lũy), `docs/ui/spec-M8.md:101–102`.
- **A/B (thật sự khác nhau, do cách lưu hạn):**
  - **A: lưu hạn là một mốc thời gian** tính lúc mở. Đổi lịch hay thêm ngày lễ sau đó không ảnh hưởng: đúng nghĩa đen "giữ hạn cũ".
  - **B: lưu số giây đã chạy** (`sla_elapsed_seconds`, gợi ý ở endpoint-M8:40). Đồng hồ đọc lịch hiện tại, nên ngày lễ thêm sau vẫn
    dừng đồng hồ: hạn của phần còn lại thực chất được tính lại.
  - "Giữ hạn cũ" chỉ đúng hoàn toàn với A. Backend chưa nghiêng bên nào: đây là thiết kế lưu SLA.
- **Chờ lead BE:** chọn A hay B; nếu B, câu "giữ hạn cũ" trong spec-M8:101 phải sửa cho khớp.
- **Câu đi kèm, không tách rời:** nếu chọn B (`sla_elapsed_seconds`), phải trả lời luôn: khi đổi giờ làm việc, các hạn đã tính trước
  đó có được tính lại không? B mới có khả năng tính lại, A thì không.

## U44: ngày lễ và nghỉ trưa

- **Đề xuất 26/10 (dòng 72):** ngày lễ sửa/xóa được; khoảng ngày trùng thì gộp; ngày đã qua không thêm được; nghỉ trưa đặt **riêng
  từng ngày** trong lịch tuần.
- **Bằng chứng:** chưa có code. `docs/ui/endpoint-M8.md:56–58`: `GET/PUT …/business-hours` (lịch tuần, nghỉ trưa), `GET/POST …/holidays`,
  `DELETE …/holidays/{hid}`, hỗ trợ khoảng ngày. `docs/ui/spec-M8.md:111`: lịch tuần theo ngày, có nghỉ trưa.
- **Lệch cần chốt:** đề xuất 26/10 nói ngày lễ "sửa được", nhưng `docs/ui/endpoint-M8.md:58` **không có** `PATCH`.
- **Chờ lead BE:**
  - Chọn (a) bỏ "sửa được" khỏi đề xuất, hay (b) thêm `PATCH …/holidays/{hid}` vào endpoint? Backend không tự quyết.
  - Khoảng ngày trùng nhau: gộp hay từ chối (409)?

## U47: phạm vi và "Ẩn" của tag

- **Đề xuất 26/10 (dòng 75):** tag ở **cấp công ty**; "Ẩn" = không gắn thêm được, khách đang mang vẫn giữ; vẫn **lọc** được theo tag ẩn.
- **Bằng chứng:** chưa có bảng tag. Brief dòng 362 (`tags`, `customer_tags`: phạm vi O, tức công ty) và 365 (`conversation_tags`).
  `docs/ui/endpoint-M8.md` §7: `PATCH /v1/tags/{id}` (đổi tên, ẩn), merge, `PUT /v1/customers/{id}/tags`, `PUT /v1/conversations/{id}/tags`.
- **Chờ lead BE:**
  - Tag trên dòng Hộp thư (chuyển từ U30) là tag của **khách** (`customer_tags`) hay của **hội thoại** (`conversation_tags`)?
  - `PUT …/tags` thay cả bộ: gửi lại bộ có tag ẩn mà khách đang mang thì giữ, chỉ chặn gắn **mới** tag ẩn. Có đúng ý không?

## U46: trường tùy chỉnh

- **Đề xuất 26/10 (dòng 74):** chọn 1/chọn nhiều cần **≥ 2** lựa chọn; tối đa **50** trường mỗi công ty; tên ≤ 100 ký tự; không đổi kiểu
  hay "Nhạy cảm" khi trường đã có dữ liệu.
- **Bằng chứng:** chưa có bảng. `docs/ui/endpoint-M8.md` §6: field defs cấp công ty; `PATCH` **không đổi** `type`, `sensitive` khi đã có
  dữ liệu; `DELETE` → 409 `field_has_data`, chỉ cho ẩn. Vì không bật "Nhạy cảm" khi đã có dữ liệu, không bao giờ phải mã hóa lại dữ liệu cũ.
- **Chờ lead BE:** con số 2 / 50 / 100 (Backend tự đặt, endpoint-M8 không có); bỏ một lựa chọn đang có khách dùng thì xử lý thế nào.

## U51: tên team trùng trong một workspace

- **Đề xuất 26/10 (dòng 78):** **cho trùng** tên; prototype bỏ chặn.
- **Bằng chứng (đã làm, N160):** `202610031400_create_teams.sql:18` chỉ ràng buộc duy nhất `(org_id, workspace_id, slug)`, không ràng
  buộc tên; `packages/db/src/team-store.ts:101,114` sinh slug từ tên, trùng thì `-2`, `-3`…
- **Chờ lead BE:** xác nhận giữ như vậy (nếu muốn chặn thì cần migration + đổi API).

## Xác nhận

| Câu | Lead BE: đồng ý / bác / sửa | Ghi chú | Ngày |
|---|---|---|---|
| U45 | | A hay B | |
| U41 | | A hay B; nếu B: đổi giờ làm việc có tính lại hạn cũ không | |
| U44 | | (a) bỏ "sửa được" hay (b) thêm PATCH; gộp hay 409 | |
| U47 | | tag khách hay tag hội thoại trên Hộp thư | |
| U46 | | 2 / 50 / 100 | |
| U51 | | | |

<!-- tạm: kiểm bộ lọc docker (PR nháp, sẽ xóa) -->
