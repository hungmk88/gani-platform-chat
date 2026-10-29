# Phân công trách nhiệm xử lý rủi ro, Đợt 1

29/10/2026 · Người soạn: nhóm Backend · CEO và lead BE xác nhận ở mục cuối · Nguồn: `QUESTIONS.md` (Q2, N35, N172), `docs/business/staging-options.md` (#402), ADR-004, PR #406

## Mục đích

Ghi rõ ai cần hành động, khi nào, cho từng rủi ro chính của Đợt 1, để không rủi ro nào thành hiện thực mà không ai xử lý. Văn bản không nhằm đổ lỗi. Dev chỉ ghi nhận sự kiện; việc đánh giá trách nhiệm do người có thẩm quyền quyết định.

## Rủi ro 1: Q1/Q2 trễ hạn 10/11, S1 trượt theo

**Bối cảnh**

- **Q1 (pháp lý):** được gửi nội dung hội thoại đã che PII cho provider AI ở nước ngoài hay không. Câu hỏi về staging ở nước ngoài là câu 2–3 trong `staging-options.md` (#402), không phải Q1.
- **Q2 (cloud, vùng):** chờ Q1 phần lưu trữ dữ liệu.
- **Hạn CEO trả lời Q1/Q2: 10/11/2026**, mốc báo động 05/11/2026 (N172).
- S1 (16/11/2026) có điều kiện xong "staging lên" (Brief dòng 905). Staging phụ thuộc Q2 (phương án A) hoặc quyết định dùng staging tạm (phương án B), xem `staging-options.md`.

**Chính: CEO.** Q1, Q2 là việc đối ngoại (luật sư, nhà cung cấp cloud); dev không có thẩm quyền và thông tin để tự giải quyết.

| Ai | Làm gì |
|---|---|
| CEO | Trả lời Q1 với luật sư trước 10/11; chọn Q2 sau khi có Q1. Đến 05/11 chưa có Q1/Q2 thì quyết A hay B; chọn B thì chọn nơi tạm, tài khoản, ngân sách, và có câu trả lời của luật sư cho câu 2–3 trước khi bật staging |
| Dev | Đã soạn so sánh A/B (#402). Nhắc CEO theo các mốc dưới. Thực thi quyết định A hoặc B. Không tự chọn A hay B. Tiếp tục các việc không phụ thuộc Q1/Q2 (Dockerfile #406, khung Terraform) |

**Leo thang** (lịch nhắc đã đặt, 08:00 giờ VN)

- **05/11:** Dev nhắc CEO lần 1.
- **06/11:** chưa có quyết định thì Dev nhắc lần 2: S1 sẽ trượt điều kiện "staging lên" nếu không có quyết định trong 48 giờ.
- **08/11:** vẫn chưa có thì Dev đề xuất ghi nhận sự kiện vào `QUESTIONS.md` (N172), ghi khi CEO đồng ý: chưa có quyết định A/B, S1 sẽ trượt điều kiện staging. Việc đánh giá trách nhiệm do người có thẩm quyền quyết định.

## Rủi ro 2: image `api` vượt ngưỡng kích thước

**Trạng thái: đã đóng** (#406 merge 28/10/2026): 129 MB nén / 353 MB giải nén (đo trên CI, job `docker`), dưới ngưỡng đỏ 150 MB (nén). CI job `docker` đỏ nếu một image vượt 150 MB nén.

- **Nguyên nhân cũ** (đo ở máy: 1165 MB giải nén / 254 MB nén): `better-auth` khai báo `next`, `react`, `vitest` là peer tùy chọn; lockfile gắn các peer đó và `pnpm deploy` kéo khoảng 480 MB không dùng vào image.
- **Cách đã làm** (nhánh dự phòng CEO đã duyệt): deploy với cả `--config.auto-install-peers=false` và `--config.dedupe-peer-dependents=false`, chỉ trong Dockerfile, `.npmrc` của repo không đổi; khai báo `socket.io-adapter` (peer của `@socket.io/redis-adapter`) trực tiếp trong `apps/api`. Chỉ tắt dedupe thì vẫn còn Next (đã đo).
- **Ngưỡng (CEO chốt):** chỉ **bản nén > 150 MB** mới đỏ; bản nén > 100 MB cảnh báo. Bản giải nén **chỉ cảnh báo** (> 400 MB), không đỏ kể cả trên 600 MB. CI job `docker` kiểm cả hai.

**Chính: Dev (BE).** Việc kỹ thuật thuần, đã làm trong PR.

## Rủi ro 3: lead BE chưa xác nhận mốc 30/10

**Bối cảnh**

- U48 (tìm khách theo email): đã xong 26/10 (#337), không phụ thuộc lead BE.
- Spec M8: vẫn "Bản nháp 3" (sửa lần cuối 26/10). Cần lead BE xác nhận là bản cuối, hoặc chỉ rõ còn gì phải sửa.

**Chính: lead BE.** Dev không có thẩm quyền xác nhận thay.

| Ai | Làm gì |
|---|---|
| Lead BE | Xác nhận mốc 30/10 |
| Dev | Nhắc CEO 30/10 01:00 UTC (08:00 VN) nếu lead BE chưa phản hồi; báo cáo tiến độ 30/10 02:00 UTC ghi trạng thái xác nhận. Không xác nhận thay |
| CEO | Lead BE chưa phản hồi thì liên hệ trực tiếp trong ngày 30/10; có thể chấp nhận mốc nếu thấy đủ căn cứ, hoặc dời mốc |

## Rủi ro 4: 16 hàm SECURITY DEFINER chưa có xác nhận của cố vấn

**Bối cảnh**

- Repo có 16 hàm SECURITY DEFINER, còn 15 sau khi bỏ hàm cũ (issue #386). Chưa hàm nào có xác nhận của cố vấn độc lập.
- N35 (03/10/2026): chủ đầu tư quyết làm tiếp không chờ cố vấn kỹ thuật độc lập và chấp nhận rủi ro. Rà soát nội bộ (người trong nhóm hoặc người CEO chỉ định) là việc khác, không mâu thuẫn N35, chưa được quyết.
- ADR-004 có, cho từng hàm: tên, migration tạo, mục đích. **Không có** input/output.
- Tài liệu input/output và quy trình review: **chưa làm**, CEO đã quyết không làm lúc này (làm khi có người rà).

**Chính: chủ đầu tư** (quyết định N35).

| Ai | Làm gì |
|---|---|
| Chủ đầu tư / CEO | Quyết có rà soát nội bộ hay không, và ai rà |
| Dev | Đã báo cáo những gì có trong ADR-004, đã ghi nhận rủi ro vào `QUESTIONS.md` (N35). Làm tài liệu rà soát khi có quyết định và có người rà. Hỗ trợ điều tra, khắc phục nếu có sự cố |

## Tóm tắt

| Rủi ro | Chính | Hỗ trợ | Quyết định |
|---|---|---|---|
| 1. Q1/Q2 trễ, S1 trượt | CEO | Dev (tài liệu, nhắc mốc) | CEO |
| 2. Image `api` vượt ngưỡng | Dev (BE) | — | **Đã đóng** (#406 merge 28/10) |
| 3. Lead BE chưa xác nhận 30/10 | Lead BE | Dev (nhắc), CEO (liên hệ) | Lead BE; CEO nếu lead BE không phản hồi |
| 4. 16 hàm SECURITY DEFINER | Chủ đầu tư (N35) | Dev (ADR-004, `QUESTIONS.md`) | Chủ đầu tư |

## Xác nhận

Đề nghị CEO và lead BE xác nhận đã đọc và đồng ý. Có điều chỉnh thì ghi rõ trong phản hồi.

| Người xác nhận | Họ tên | Ngày |
|---|---|---|
| CEO | | |
| Lead BE | | |
