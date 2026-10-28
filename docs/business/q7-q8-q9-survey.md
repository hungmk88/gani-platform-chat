# Khảo sát Q7 · Q8 · Q9: dữ liệu vận hành từng workspace Đợt 1

Bản 30/10/2026 · Backend soạn · CEO review và gửi Thứ Sáu 30/10/2026 · Nguồn: Brief Backend & Core v1.0 (P10, P14, P22), `docs/ui/spec-M8.md` (3.1, 3.3–3.5), `QUESTIONS.md` (U18, U25, U40, N133, N172)

## 1. Mục đích

Hệ thống cần dữ liệu vận hành thật của từng workspace Đợt 1 để dựng mẫu workspace và bật phân bổ, SLA, xử lý ngoài giờ ở S4 (28/12/2026). Biểu mẫu gộp 3 nhóm câu hỏi của Brief P22:

- **Q7 (mọi workspace):** giờ làm việc, ngày lễ, team, cách phân bổ, giới hạn tải, SLA hội thoại.
- **Q8 (The Smile):** loại ticket, SLA xử lý từng loại, người phụ trách.
- **Q9 (Gani B2B):** trường bắt buộc bot thu, 6 bước pipeline, lý do Thua, ngưỡng điểm lead.

Trước khi có câu trả lời, Hộp thư và thẻ SLA dùng giá trị tạm có nhãn "chờ Q7" (U18).

## 2. Lịch

| Mốc | Việc | Ai |
|---|---|---|
| Thứ Sáu 30/10/2026 | Review biểu mẫu này, điền tên thật thay `CongTy3`–`CongTy5`, rồi gửi các công ty (người được giao chuyển bảng mục 5 sang form) | CEO |
| Thứ Năm 05/11/2026 | Mốc báo động (N172): công ty nào chưa xác nhận đã nhận thì CEO nhắc trực tiếp | CEO |
| Thứ Sáu 06/11/2026 | Các công ty trả lời xong | Quản lý workspace |
| Thứ Hai–Thứ Ba 09–10/11/2026 | Tổng hợp, chốt câu nào còn thiếu; 10/11 là hạn tổng (N172) | CEO |

- **Công ty 3–5:** Brief xếp "danh tính và mẫu của công ty 3–5" là câu không chặn, cần trước S5. Công ty nào chưa xác định thì để trống cột của công ty đó, không chặn hạn 10/11.
- **Không thu dữ liệu cá nhân:** biểu mẫu chỉ hỏi số người và vai trò, không hỏi tên, SĐT, email của nhân viên hay khách. Tài khoản nhân viên tạo sau bằng lời mời; Manager của workspace cũng được chỉ định lúc mời, không hỏi trong biểu mẫu.

## 3. Câu hỏi suy ra từ thiết kế U18/U40

Mỗi phần thiết kế dưới đây cần một dữ kiện chỉ công ty biết. Đó là lý do có các câu ở mục 4.

| Phần thiết kế | Dữ kiện cần | Câu hỏi |
|---|---|---|
| Xử lý ngoài giờ (Brief F6, FSM: cần người ngoài giờ → bot giữ, cờ "Ngoài giờ") | Lịch tuần, nghỉ trưa, ngày lễ, múi giờ | Q7.2–Q7.5 |
| Đồng hồ SLA dừng ngoài giờ và ngày lễ (spec-M8 3.3, Q-M8-3); hiện "SLA tạm dừng · ngoài giờ" (U25 câu 4) | Cùng lịch tuần và ngày lễ ở trên | Q7.3, Q7.4 |
| Phân bổ tự động (C9, Brief P14: xoay vòng trong team, theo team; theo kỹ năng dời Đợt 2) | Kênh đang dùng, team, số người, team mặc định, team ↔ kênh, cách phân bổ từng team | Q7.0, Q7.6–Q7.11 |
| Giới hạn tải agent (Brief P14: mặc định 5, theo workspace và theo agent) | Giới hạn mặc định, ngoại lệ | Q7.12 |
| Agent Offline (FSM: quá 10 phút có tin chưa trả lời → về hàng chờ) | Xác nhận 10 phút hay số khác (Brief: câu không chặn, cần trước S4) | Q7.13 |
| Phạm vi "Team" của Sales/Support (N133, CEO chốt trước S4) | Cách các team làm việc thực tế; **chỉ là dữ kiện đầu vào**, CEO quyết | Q7.14 |
| SLA hội thoại (C8: 3 mức × 2 chỉ tiêu; U18) | Thời hạn từng mức, cách xếp mức, ai nhận báo quá hạn | Q7.15–Q7.17 |
| Mốc cảnh báo SLA (U40) | **Không hỏi công ty**: câu hỏi nội bộ, xem mục 6 | — |
| Ticket The Smile (Brief F3, I1–I3) | Loại ticket, SLA từng loại, người phụ trách | Q8.1–Q8.6 |
| Lead Gani B2B (Brief F1, G1–G3) | 5 trường, 6 bước, lý do Thua, ngưỡng điểm | Q9.1–Q9.5 |

## 4. Bảng câu hỏi

Kiểu: **số**, **text**, **chọn** (một trong các lựa chọn ghi ở cột Ví dụ). "Tất cả" = mọi workspace Đợt 1.

### Q7: mọi workspace

| Mã | Câu hỏi | Kiểu | Ví dụ | Áp dụng | Lý do |
|---|---|---|---|---|---|
| Q7.0 | Các kênh khách đang liên lạc với công ty | chọn nhiều (Zalo OA / Facebook Messenger / Web chat / Email / Điện thoại) | Zalo OA, Điện thoại | Tất cả | Biết kênh nào cần cấu hình khi tạo workspace; Q7.9 cần danh sách này. Đợt 1 chỉ nối Zalo OA (B1–B3); Messenger ở Đợt 2 (B4), Web chat ở Đợt 2 (đã chốt 12/10); Email và Điện thoại chưa có trong phạm vi 135 mã, hỏi để lập kế hoạch |
| Q7.1 | Tên workspace và mẫu | text + chọn (B2B / Service) | "Gani B2B", B2B | Tất cả | Tạo workspace theo mẫu (A2, `tenant:create-workspace --template`) |
| Q7.2 | Múi giờ | chọn | Asia/Ho_Chi_Minh (mặc định) | Tất cả | Giờ làm việc và hạn SLA tính theo múi giờ workspace |
| Q7.3 | Giờ làm việc từng ngày trong tuần, kể cả nghỉ trưa | text theo mẫu | T2–T6 08:00–17:30, nghỉ 12:00–13:00; T7 08:00–12:00; CN nghỉ | Tất cả | U18; ngoài giờ (F6); SLA dừng ngoài giờ |
| Q7.4 | Ngày nghỉ lễ còn lại của 2026 và của 2027 (**ước tính**, cập nhật sau được) | danh sách ngày | 01/01/2027; 04–10/02/2027 | Tất cả | Ngày nghỉ = ngoài giờ cả ngày (spec-M8 3.4); Admin sửa được ở `/settings/workspace` |
| Q7.5 | Lời nhắn gửi khách khi nhắn ngoài giờ, và hẹn liên hệ lại lúc nào | text | "Gani đã nhận tin, sẽ liên hệ lúc 08:00 sáng mai" | Tất cả | Flow mặc định "Ngoài giờ" (D4). Lời hẹn lấy từ cấu hình, bot không tự hứa giờ (Brief P11) |
| Q7.6 | Danh sách team (tên, việc chính) | text | "Sales B2B: báo giá đại lý"; "CSKH: khiếu nại" | Tất cả | Team (A4), phân bổ theo team (C9) |
| Q7.7 | Mỗi team: số người theo vai trò | số theo vai trò | Sales B2B: 1 Manager, 4 Sales | Tất cả | U18 "số agent"; vai trò quyết ai giữ được hội thoại (Phụ lục B) |
| Q7.8 | Team mặc định (nhận hội thoại khi chưa có quy tắc khác) | chọn (một team ở Q7.6) | Sales B2B | Tất cả | A4: mỗi workspace có team mặc định |
| Q7.9 | Kênh nào do team nào phụ trách | text | Zalo OA Gani → Sales B2B | Tất cả | A4: gán team ↔ kênh (U20-6 chờ Q7) |
| Q7.10 | Cách phân bổ của từng team | chọn (Tự động xoay vòng / Agent tự nhận) | Sales B2B: tự động xoay vòng | Tất cả | C9 (mặc định "Agent tự nhận") |
| Q7.11 | Khách quay lại có ưu tiên người đã xử lý lần trước không (nếu người đó đang Online, chưa đầy tải)? | chọn (Có / Không) | Có | Tất cả | C9 |
| Q7.12 | Số hội thoại tối đa một người xử lý cùng lúc; có người nào khác mức chung không | số + text | 5; trưởng nhóm: 3 | Tất cả | Giới hạn tải (Brief P14, `max_concurrent_conversations`) |
| Q7.13 | Người xử lý Offline bao lâu thì hội thoại có tin khách chưa trả lời được đưa về hàng chờ | số (phút) | 10 (mặc định Brief) | Tất cả | FSM: Offline > 10 phút → hàng chờ; báo quản lý |
| Q7.14 | Sales/Support có cần xem và nhận hội thoại của người cùng team không (ví dụ đồng nghiệp nghỉ phép)? | chọn (Chỉ của mình + chưa ai nhận / Cả team) | Cả team | Tất cả | N133 (dữ kiện đầu vào, CEO chốt) |
| Q7.15a | SLA mức Thường: thời hạn phản hồi đầu | số + đơn vị (phút / giờ) | 15 phút | Tất cả | C8; U18; đầu vào cho U40 |
| Q7.15b | SLA mức Thường: thời hạn xử lý xong | số + đơn vị (phút / giờ) | 8 giờ | Tất cả | C8; U18 |
| Q7.15c | SLA mức Cao: thời hạn phản hồi đầu | số + đơn vị (phút / giờ) | 10 phút | Tất cả | C8; U18; đầu vào cho U40 |
| Q7.15d | SLA mức Cao: thời hạn xử lý xong | số + đơn vị (phút / giờ) | 4 giờ | Tất cả | C8; U18 |
| Q7.15e | SLA mức Khẩn: thời hạn phản hồi đầu | số + đơn vị (phút / giờ) | 5 phút | Tất cả | C8; U18; đầu vào cho U40 |
| Q7.15f | SLA mức Khẩn: thời hạn xử lý xong | số + đơn vị (phút / giờ) | 1 giờ | Tất cả | C8; U18 |
| Q7.16 | Hội thoại nào được xếp Cao hoặc Khẩn, ai đổi mức | text | Khách đại lý lớn: Cao; khiếu nại an toàn thực phẩm: Khẩn; Manager đổi | Tất cả | C8: mặc định Thường, agent/Manager đổi trong Inbox |
| Q7.17 | Ai nhận báo khi hội thoại sắp/đã quá SLA | text (vai trò, không ghi tên) | Manager của team | Tất cả | C8: báo agent và báo quản lý |

### Q8: The Smile

| Mã | Câu hỏi | Kiểu | Ví dụ | Áp dụng | Lý do |
|---|---|---|---|---|---|
| Q8.1 | Danh mục loại yêu cầu (loại ticket) | danh sách | Đặt lịch hẹn; Đổi lịch; Khiếu nại; Hỏi gói dịch vụ | The Smile | I1: ticket theo loại yêu cầu |
| Q8.2 | Thời hạn xử lý của từng loại | số + đơn vị (giờ / ngày làm việc) | Khiếu nại: 24 giờ; Đổi lịch: 4 giờ | The Smile | I3; `SlaService.schedule(dueAt)` (F3) |
| Q8.3 | Hạn tính theo giờ làm việc (dừng ngoài giờ, ngày lễ) hay theo lịch 24/7 | chọn | Theo giờ làm việc | The Smile | Cách tính `due_at`; hội thoại đã chốt dừng ngoài giờ (Q-M8-3) |
| Q8.4 | Mỗi loại do team hoặc vai trò nào phụ trách | text | Khiếu nại → CSKH; Đặt lịch → Lễ tân | The Smile | I3: giao chuyên viên phụ trách (`RoutingService.assignOwner`) |
| Q8.5 | Thông tin bắt buộc khi tạo ticket của từng loại | text | Đặt lịch: dịch vụ, ngày mong muốn | The Smile | I1: trường bắt buộc theo loại |
| Q8.6 | Mức ưu tiên mặc định của từng loại | chọn (Thường / Cao / Khẩn) | Khiếu nại: Cao | The Smile | Xếp thứ tự xử lý và cảnh báo |

### Q9: Gani B2B

| Mã | Câu hỏi | Kiểu | Ví dụ | Áp dụng | Lý do |
|---|---|---|---|---|---|
| Q9.1 | Xác nhận hoặc điều chỉnh 5 trường bot phải thu trước khi chuyển người (hồ sơ: 5 trường) | danh sách 5 trường | Tên quán; khu vực; sản phẩm quan tâm; sản lượng/tháng; SĐT | Gani B2B | Flow mặc định B2B (F1 bước 5, D3) |
| Q9.2 | Tên và thứ tự 6 bước pipeline | danh sách 6 bước | Mới → Đã liên hệ → Báo giá → Đàm phán → Thắng / Thua | Gani B2B | G2: pipeline 6 bước (Kanban) |
| Q9.3 | Danh sách lý do Thua | danh sách | Giá cao; chọn nhà cung cấp khác; không liên lạc được | Gani B2B | G3: bắt buộc chọn lý do khi Thua |
| Q9.4 | Khi nào tự tạo lead | chọn (Khách để SĐT / Khách hỏi giá / Cả hai) | Cả hai (mặc định G1) | Gani B2B | G1 |
| Q9.5 | Ngưỡng điểm lead, thang 0–100 (hồ sơ đề xuất 70) | số | 70 | Gani B2B | Chấm điểm lead là Đợt 2 (Brief F1 bước 6); hỏi luôn để không phải hỏi lại |

## 5. Bảng trả lời mẫu

Mỗi cột là một workspace, mỗi dòng một câu hỏi. `—` = không áp dụng. CEO thay `CongTy3`–`CongTy5` bằng tên thật trước khi gửi; công ty chưa xác định thì bỏ cột.

| Mã | GaniB2B | TheSmile | CongTy3 | CongTy4 | CongTy5 |
|---|---|---|---|---|---|
| Q7.0 | | | | | |
| Q7.1 | | | | | |
| Q7.2 | | | | | |
| Q7.3 | | | | | |
| Q7.4 | | | | | |
| Q7.5 | | | | | |
| Q7.6 | | | | | |
| Q7.7 | | | | | |
| Q7.8 | | | | | |
| Q7.9 | | | | | |
| Q7.10 | | | | | |
| Q7.11 | | | | | |
| Q7.12 | | | | | |
| Q7.13 | | | | | |
| Q7.14 | | | | | |
| Q7.15a | | | | | |
| Q7.15b | | | | | |
| Q7.15c | | | | | |
| Q7.15d | | | | | |
| Q7.15e | | | | | |
| Q7.15f | | | | | |
| Q7.16 | | | | | |
| Q7.17 | | | | | |
| Q8.1 | — | | — | — | — |
| Q8.2 | — | | — | — | — |
| Q8.3 | — | | — | — | — |
| Q8.4 | — | | — | — | — |
| Q8.5 | — | | — | — | — |
| Q8.6 | — | | — | — | — |
| Q9.1 | | — | — | — | — |
| Q9.2 | | — | — | — | — |
| Q9.3 | | — | — | — | — |
| Q9.4 | | — | — | — | — |
| Q9.5 | | — | — | — | — |

## 6. U40: chờ lead BE duyệt phương án A/B/C

**U40 - chờ lead BE duyệt phương án A/B/C. Không nằm trong phạm vi form gửi công ty.** Đây là câu hỏi nội bộ: mốc cảnh báo agent (mặc định 15 phút) và báo quản lý (mặc định 30 phút) tính từ đâu, áp cho chỉ tiêu nào. Backend chỉ soạn phương án, không tự quyết. Số liệu ở Q7.15 (thời hạn từng mức) là đầu vào để lead BE kiểm phương án.

| | A. Tính từ lúc đồng hồ chạy | B. Sau khi quá hạn | C. Agent trước hạn, quản lý sau khi quá hạn |
|---|---|---|---|
| Cách hiểu | Chưa phản hồi đầu sau 15 phút → báo agent; sau 30 phút → báo quản lý | Quá hạn 15 phút → báo agent; quá hạn 30 phút → báo quản lý | Còn 15 phút tới hạn → báo agent; quá hạn 30 phút → báo quản lý |
| Áp cho | Chỉ phản hồi đầu | Cả 2 chỉ tiêu | Cả 2 chỉ tiêu |
| Khớp văn bản | Đúng chữ Brief P14 ("cảnh báo 15 phút chưa phản hồi, báo quản lý ở 30 phút") | Khác Brief | Khác Brief; giống giả định của prototype (`workspace.js`) |
| Ca khó | Mức Khẩn hạn 5 phút: báo agent khi đã quá hạn 10 phút | Không báo trước nên agent không kịp cứu hạn | Hạn ≤ 15 phút: báo agent ngay lúc mở (ví dụ trong U40) |
| Tác động hệ thống | Mốc cố định, không đọc `sla_policies` | Mốc tính từ `due_at` của từng mức | Hai mốc quanh `due_at`; mốc trước hạn phải nhỏ hơn hạn, không thì báo ngay |

- **Backend đề xuất phương án A vì khớp nguyên văn Brief P14. Nếu lead BE chọn B hoặc C, cần ghi lý do vào U40.** Đây là quan điểm kỹ thuật để lead BE có cơ sở, không phải quyết định.
- **Đơn vị và giới hạn** (câu thứ hai của U40): đề xuất lưu theo phút, số nguyên; giới hạn trên dưới do lead BE chốt cùng phương án.
- Đồng hồ dừng ngoài giờ và khi "Chờ khách" (Q-M8-3) áp cho cả 3 phương án.

## 7. Sau khi thu

- Câu trả lời thành dữ liệu khởi tạo của `WorkspaceTemplateService.apply`: team, giờ làm việc, SLA, flow ngoài giờ, pipeline. Hiện mới có lệnh tạo workspace, nội dung mẫu chưa làm (N158).
- Câu nào thiếu hoặc mâu thuẫn: ghi vào `QUESTIONS.md` dưới U18 (Q7), Q8, Q9; không tự điền giá trị.
- Q7.14 chỉ là dữ kiện cho N133. Phạm vi xem hội thoại của Sales/Support do CEO chốt, không tự đổi theo câu trả lời.
