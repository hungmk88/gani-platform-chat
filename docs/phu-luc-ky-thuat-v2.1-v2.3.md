# Phụ lục kỹ thuật bắt buộc v2.1 – v2.2 – v2.3

**Dự án:** Nền tảng Chat & AI Chatbot đa tenant (Gani Foods, The Smile và 3 công ty)
**Bản ngày:** 02/10/2026 · trích từ hồ sơ "Gani Foods — Nền tảng Chat & AI Chatbot: Phân tích trước khi code"

> **Cách đọc:** v2.1 sửa các lỗi của tài liệu kiến trúc Convexa. v2.2 và v2.3 **bổ sung, không thay thế** các bản trước. Ba phụ lục đánh số liên tục từ mục 1 đến mục 29. Implementation Brief v0.4 (phần P3.2) ánh xạ từng mục vào nơi triển khai và test chứng minh. Vendor **không được vi phạm** mục nào; mục nào không thể tuân thủ phải nêu lý do, đề xuất phương án thay thế và chờ chủ đầu tư + cố vấn kỹ thuật duyệt trước khi code.
>
> Ghi chú thuật ngữ: "MVP" trong v2.1 tương ứng với "đợt" trong lộ trình hiện hành (3 đợt).

---

## PHỤ LỤC KỸ THUẬT BẮT BUỘC v2.1 (áp dụng trên nền tài liệu Convexa)

**GIỮ:** FSM Bot↔Agent, Silent Co-pilot, defense-in-depth 3 tầng, customer_identities, sequence_number, widget loader + Preact + Shadow DOM, hạn mức AI theo tenant.

**SỬA BẮT BUỘC:**

1. Khóa ngoại kép (tenant_id, id) cho mọi quan hệ giữa bảng nghiệp vụ.
2. ENABLE + FORCE RLS + POLICY trên mọi bảng có tenant_id; role app không owner, không BYPASSRLS; worker set tenant từ payload job.
3. Nhận hội thoại bằng UPDATE có điều kiện + cột version; không dùng Redlock.
4. Không cache câu trả lời có kết quả tool; khóa cache gồm tenant + phiên bản KB + phiên bản bảng giá.
5. Câu trả lời có số liệu: sinh xong → guard kiểm số → mới gửi; chỉ stream FAQ trên web widget.
6. Model theo tầng năng lực trong config; lưu embedding_model + dimension theo KB.
7. Zalo OA lên đợt 1; tôn trọng khung gửi tin Zalo; job làm mới token kênh.
8. Identity: chuẩn hóa SĐT +84; gộp chỉ hiển thị cho agent; OTP trước khi cho khách xem lịch sử.
9. FSM thêm PENDING_CUSTOMER, xử lý ngoài giờ, mở lại; mọi chuyển trạng thái ghi conversation_events.
10. messages: UUIDv7 + partition theo tháng; xóa tenant bằng soft delete + job nền.
11. Mỗi MVP có 2 tuần cổng kiểm thử: bộ test AI 200 câu/tenant, test chéo tenant, test tranh chấp nhận hội thoại (50 agent đồng thời), quét bảo mật.

---

## PHỤ LỤC KỸ THUẬT v2.2 (bổ sung, không thay thế v2.1)

### 12. Xác thực số điện thoại

- customer_identities có cột verification: verified | unverified | sales_confirmed.
- verified = SĐT lấy qua cơ chế chia sẻ có xác thực của nền tảng (vendor xác minh API Zalo/Meta hiện hành) hoặc OTP. unverified = khách tự gõ.
- SĐT unverified KHÔNG gộp hồ sơ tự động, KHÔNG liên kết đơn/công nợ B2B; chỉ tạo "đề xuất gộp" để Sales xác nhận trên Inbox.

### 13. Bảng chính sách kênh (cấu hình, không hard-code)

- Mỗi kênh có: khung gửi miễn phí, khung gửi có phí, khung gửi qua API, loại tin được phép ngoài khung, đơn giá. Giá trị lấy từ bảng channel_policies, cập nhật khi nền tảng đổi chính sách.
- Mỗi conversation có window_state: open | paid_only | api_closed.
- api_closed → khóa ô gửi tin thường, hiện lựa chọn: gửi ZNS (mẫu đã duyệt), gọi điện, tạo task.
- Automation kiểm window_state trước khi gửi; không bắn tin sẽ bị nền tảng từ chối.

### 14. Webhook vào bền vững + dead-letter

- Endpoint webhook chỉ: xác minh chữ ký → ghi payload thô vào bảng inbound_events (PostgreSQL) → trả 200 trong < 100ms. Xử lý ở worker.
- Chống trùng theo (channel_account_id, platform_message_id) UNIQUE.
- Lỗi xử lý quá 5 lần → trạng thái dead_letter, cảnh báo trên bảng điều khiển vận hành, có nút xử lý lại.
- Nếu dùng Redis làm hàng đợi: bật lưu bền (AOF); không dùng Redis làm nơi lưu duy nhất của tin khách.

### 15. Công bằng giữa các workspace

- Hàng đợi riêng theo workspace (hoặc worker có trọng số); không dùng chung một hàng đợi FIFO.
- Test nghiệm thu: dồn 300 hội thoại B2C trong 10 phút vào Lộc Thủy; thời gian phản hồi đầu tiên của Gani B2B vẫn < 1 phút (P90).

### 16. Cắt ngữ cảnh có kiểm soát

- Generator nhận: system prompt + định nghĩa tool (đặt đầu để dùng prompt caching) + khối JSON conversation_state + 6–8 lượt gần nhất.
- conversation_state lưu bền trong DB, gồm: collected_fields, mã báo giá/đơn đã tạo, giá đã báo kèm ngày hiệu lực, cam kết đã nói với khách, trạng thái xác nhận.
- Test: hội thoại 100 tin, bot vẫn nêu đúng giá đã báo ở lượt đầu.

### 17. Số liệu tải thiết kế (tối thiểu vendor phải đáp ứng)

- 5 công ty, ~9.200 hội thoại/tháng, ~75.000 tin/tháng; tăng 5 lần trong 24 tháng.
- Cao điểm: 50 tin/giây webhook trong 5 phút; 300 hội thoại mới trong 10 phút ở một workspace.
- 30 agent đồng thời; 500 kết nối realtime đồng thời.
- Test: khởi động lại server khi đang nhận 50 tin/giây → 0 tin mất.

### 18. Kế hoạch rút lui (exit)

- Xuất toàn bộ dữ liệu của từng công ty (khách, hội thoại, đơn, lead, ticket, KB, cấu hình bot) ở định dạng CSV/JSON + bản sao lưu DB + tài liệu schema, trong 10 ngày làm việc kể từ yêu cầu.
- Vendor hỗ trợ bàn giao cho bên thay thế 30 ngày.

### 19. Dữ liệu kiểm thử

- Bộ test lấy từ tin nhắn thật phải ẩn danh (tên, SĐT, địa chỉ, số liệu tài chính) trước khi giao vendor; dữ liệu The Smile ẩn danh bắt buộc.

### Mẫu dữ liệu chủ đầu tư cung cấp (kèm v2.2)

| Mẫu | Cột bắt buộc |
| --- | --- |
| Bảng giá Gani B2B | Mã SP · Tên · Quy cách đóng gói · Đơn vị tính · MOQ · Bậc sản lượng (từ–đến) · Vùng giao · Đơn giá · Giá đã gồm VAT (có/không) · Thuế suất VAT · Phí giao · Hiệu lực từ–đến |
| Catalog Lộc Thủy B2C | Mã SP · Tên · Quy cách · Đơn vị · Ảnh · Giá niêm yết (gồm VAT) · Tồn khả dụng · Khuyến mãi (mã, mức, hiệu lực) · Phí ship theo vùng · Khung giờ giao · Hạn sử dụng · Bảo quản |
| Gói dịch vụ The Smile | Mã gói · Tên · Đối tượng (loại hình, quy mô) · Phạm vi công việc · Phí · Điều kiện · Hiệu lực |
| Bảng chính sách kênh | Kênh · Khung miễn phí · Khung có phí · Khung gửi qua API · Loại tin ngoài khung · Đơn giá · Ngày cập nhật · Nguồn |

---

## PHỤ LỤC KỸ THUẬT v2.3 (bổ sung, không thay thế v2.1, v2.2)

### 20. Cách ly theo workspace ở tầng database

- RLS theo cả org_id VÀ workspace_id cho các bảng: conversations, messages, documents, document_chunks, orders, order_items, quotes, tickets.
- Người dùng nhiều workspace: policy dựa trên danh sách workspace được cấp trong phiên.
- Test chéo workspace cho mọi endpoint là điều kiện Definition of Done.

### 21. Outbox pattern

- Mọi sự kiện nghiệp vụ ghi vào bảng outbox_events trong CÙNG transaction với dữ liệu; worker riêng đẩy lên hàng đợi. Không mất sự kiện khi DB commit xong mà hàng đợi lỗi.

### 22. Sao lưu & khôi phục

- RPO ≤ 1 giờ (sao lưu liên tục / khôi phục theo thời điểm), RTO ≤ 4 giờ.
- Diễn tập khôi phục mỗi quý, có biên bản.
- Nếu nhà cung cấp cloud không có khôi phục theo thời điểm: vendor tự cài công cụ tương đương.

### 23. Tải file chống IDOR

- Link tải ký theo người dùng + file + thời hạn 15 phút; kiểm quyền org/workspace mỗi lần tải.

### 24. Bảo mật trong CI/CD

- Quét thư viện phụ thuộc (SCA), quét secret trước commit và trong CI, kiểm theo OWASP API Top 10.
- Triển khai không gián đoạn: rolling update + feature flag.

### 25. Vận hành automation và prompt

- Mỗi rule automation có nút tắt tức thì, không cần deploy.
- Prompt có phiên bản; tham số model (temperature, max tokens, schema đầu ra) nằm trong config theo từng model, không nằm trong nội dung prompt.
- Cải tiến prompt bằng đánh giá offline trên bộ test + chạy ẩn trên dữ liệu thật; không A/B test.
- Ngưỡng "chậm" theo tác vụ: phân loại > 2 giây, trả lời FAQ > 6 giây, tóm tắt nền > 20 giây → chuyển nhà cung cấp dự phòng.

### 26. Ngưỡng tắt khẩn tự động

- 1 lần số liệu sai lọt tới khách (khác kết quả tool hoặc nguồn) → workspace tự hạ về "AI gợi ý – người gửi", báo CEO và cố vấn kỹ thuật; điều tra xong mới nâng lại.

### 27. Định nghĩa KPI AI (dùng thống nhất cho mọi workspace)

- Bot tự giải quyết = hội thoại đóng, không có tin của người, không handoff, và khách không hỏi lại cùng việc trong 72 giờ.
- Chạy song song trước khi nâng mức tự chủ = ≥ 300 hội thoại/workspace hoặc 4 tuần, lấy mốc nào đến sau.

### 28. Minh bạch với khách

- Câu chào luôn ghi rõ "trợ lý AI của [thương hiệu]".
- Khách có thể yêu cầu "chỉ người phục vụ" → cờ trên hồ sơ, bot không xử lý nội dung.
- Không dùng hội thoại thật để huấn luyện thêm model ở giai đoạn này.

### 29. AI nội bộ ở đợt 1

- Phân loại ý định (tự gắn tag, chia hội thoại) và tóm tắt cho nhân viên.
- Không gửi bất kỳ nội dung AI nào trực tiếp cho khách ở đợt 1.
