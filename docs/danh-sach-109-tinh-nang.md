# Danh sách 109 tính năng có mã (A1…P6)

**Dự án:** Nền tảng Chat & AI Chatbot đa tenant (Gani Foods, The Smile và 3 công ty)
**Bản ngày:** 02/10/2026 · trích từ hồ sơ "Gani Foods — Nền tảng Chat & AI Chatbot: Phân tích trước khi code"

109 tính năng trong 16 nhóm. Mã tính năng dùng để giao việc, báo giá theo hạng mục và nghiệm thu với vendor.

**Cách đọc các cột:**

- **MVP (gốc):** cách đánh số trong hồ sơ phân tích ban đầu (1, 2, 3, 4, Sau).
- **Đợt (Brief v0.4):** đợt triển khai chính thức theo Implementation Brief v0.4, phần P7. Quy đổi: Đợt 1 = MVP1 + AI nội bộ (E1 phân loại, L1 tóm tắt, E4 router) + E5, E7 (vì AI nội bộ đã gửi dữ liệu cho nhà cung cấp AI); Đợt 2 = MVP2 trừ nhóm B2C; Đợt 3 = nhóm B2C của MVP2 (H1–H12, H14, B7, O3) + MVP3; MVP4 làm sau đợt 3.
- **Module:** 01 AI Brain & Flow · 02 Knowledge Base · 03 AI Sales · 04 AI Customer Service · 05 AI Action · 06 Omnichannel · 07 Handoff, Inbox & Co-pilot · 08 CRM · 09 Automation & Campaign · 10 AI Analytics · 11 Guardrails & Governance · 12 Tool & Data Integration · 13 Multi-tenant & Admin · 14 AI Evaluation & Security.

> Mô tả từng tính năng được bổ sung và siết thêm bởi Phụ lục kỹ thuật v2.1–v2.3. Ví dụ: P3 phải đạt RPO ≤ 1 giờ, RTO ≤ 4 giờ theo v2.3 mục 22; E3 phải theo đặc tả ResponseGuard (Brief P11.1).

| Mã | Nhóm | Tính năng | Áp dụng | MVP (gốc) | Module | Đợt (Brief v0.4) |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | Nền tảng | Tạo Organization (công ty) | Tất cả | 1 | 13 | 1 |
| A2 | Nền tảng | Tạo Workspace, chọn mẫu B2B Sales / B2C Order / Service | Tất cả | 1 | 13 | 1 |
| A3 | Nền tảng | Mời người dùng, 7 vai trò (Owner, Admin, Manager, Sales, Support, Marketing, Viewer) | Tất cả | 1 | 13 | 1 |
| A4 | Nền tảng | Team và phân quyền theo workspace | Tất cả | 1 | 13 | 1 |
| A5 | Nền tảng | Đăng nhập, 2FA cho Owner/Admin, quản lý phiên | Tất cả | 1 | 13 | 1 |
| A6 | Nền tảng | Cách ly dữ liệu 5 công ty (RLS + khóa ngoại kép) | Tất cả | 1 | 13 | 1 |
| A7 | Nền tảng | Bảng điều khiển vận hành: sức khỏe, lỗi kênh, chi phí từng công ty | Tất cả | 1 | 13 | 1 |
| A8 | Nền tảng | Nhật ký truy cập dữ liệu tenant (bắt buộc ghi lý do) | Tất cả | 1 | 13 | 1 |
| A9 | Nền tảng | Audit log thao tác quản trị | Tất cả | 1 | 13 | 1 |
| A10 | Nền tảng | Onboarding tự phục vụ: công ty mới go-live trong 1 ngày | Tất cả | 4 | 13 | Sau đợt 3 |
| A11 | Nền tảng | Phân bổ phí, báo cáo chi phí và hóa đơn nội bộ giữa 5 công ty | Tất cả | 4 | 13 | Sau đợt 3 |
| B1 | Kênh | Zalo OA: nhận/gửi tin, ảnh, file | Tất cả | 1 | 06 | 1 |
| B2 | Kênh | Tự làm mới token Zalo, cảnh báo sắp hết hạn | Tất cả | 1 | 06 | 1 |
| B3 | Kênh | Quản lý khung gửi tin Zalo (trong khung, ngoài khung, ZNS) | Tất cả | 1 | 06 | 1 |
| B4 | Kênh | Facebook Messenger + khung 24 giờ | Tất cả | 2 | 06 | 2 |
| B5 | Kênh | Widget website: nhúng 1 đoạn JS, Shadow DOM, tùy chỉnh thương hiệu | Tất cả | 3 | 06 | 3 (đang xem xét đưa lên 2) |
| B6 | Kênh | Widget: form thu thông tin, upload file, emoji, đánh giá sau chat | Tất cả | 3 | 06 | 3 (đang xem xét đưa lên 2) |
| B7 | Kênh | ZNS thông báo giao dịch (trạng thái đơn) | B2C | 2 | 06 | 3 |
| B8 | Kênh | Kênh khác (Email, Instagram, TikTok) qua connector | Tất cả | Sau | 06 | Sau |
| C1 | Inbox | Gom hội thoại mọi kênh, mọi workspace được cấp quyền | Tất cả | 1 | 07 | 1 |
| C2 | Inbox | Realtime: tin mới, đang gõ, trạng thái đã đọc | Tất cả | 1 | 07 | 1 |
| C3 | Inbox | Lọc theo kênh, workspace, trạng thái, người phụ trách, tag | Tất cả | 1 | 07 | 1 |
| C4 | Inbox | Máy trạng thái hội thoại: Bot / Chờ người / Người xử lý / Chờ khách / Đóng | Tất cả | 1 | 07 | 1 |
| C5 | Inbox | Nhận hội thoại không tranh chấp; chuyển người, chuyển team | Tất cả | 1 | 07 | 1 |
| C6 | Inbox | Ghi chú nội bộ, @mention đồng nghiệp | Tất cả | 1 | 07 | 1 |
| C7 | Inbox | Trả lời nhanh, mẫu tin soạn sẵn | Tất cả | 1 | 07 | 1 |
| C8 | Inbox | SLA, mức ưu tiên, cảnh báo chưa phản hồi | Tất cả | 1 | 07 | 1 |
| C9 | Inbox | Phân bổ tự động: round-robin, theo team, theo kỹ năng | Tất cả | 1 | 07 | 1 |
| C10 | Inbox | Trạng thái agent online/offline, giờ làm việc | Tất cả | 1 | 07 | 1 |
| C11 | Inbox | Thông báo đẩy cho agent trên trình duyệt và điện thoại | Tất cả | 1 | 07 | 1 |
| D1 | Bot kịch bản | Flow kéo-thả: trigger, tin, câu hỏi, nút, điều kiện, thu dữ liệu, tag, chuyển agent, gọi API, delay, kết thúc | Tất cả | 1 | 01 | 1 |
| D2 | Bot kịch bản | Phiên bản flow, chạy thử trước khi bật | Tất cả | 1 | 01 | 1 |
| D3 | Bot kịch bản | Flow mặc định theo từng mẫu | Tất cả | 1 | 01 | 1 |
| D4 | Bot kịch bản | Xử lý ngoài giờ: nhận lời nhắn, hẹn gọi lại | Tất cả | 1 | 07 | 1 |
| E1 | AI | Phân loại ý định + trích thông tin (sản phẩm, số lượng, khu vực, SĐT) | Tất cả | 2 | 01 | 1 (chỉ nội bộ) |
| E2 | AI | Trả lời theo Knowledge Base (RAG), có nguồn nội bộ | Tất cả | 2 | 02 | 2 |
| E3 | AI | Chống bịa: kiểm mọi con số, từ chối/chuyển người khi thiếu dữ liệu | Tất cả | 2 | 11 | 2 |
| E4 | AI | Model router theo tầng năng lực, dự phòng nhà cung cấp | Tất cả | 2 | 01 | 1 |
| E5 | AI | Hạn mức chi phí AI theo workspace, cảnh báo 80% | Tất cả | 2 | 11 | 1 |
| E6 | AI | Bộ test 200 câu/workspace, chạy kiểm thử tự động | Tất cả | 2 | 14 | 1 (công cụ chạy test) · 2 (bộ 200 câu) |
| E7 | AI | Che dữ liệu nhạy cảm trước khi gửi model | Tất cả | 2 | 11 | 1 |
| E8 | AI | Chống prompt injection | Tất cả | 2 | 11 | 2 |
| E9 | AI | Chế độ "AI gợi ý – người gửi" và chế độ tự động | Tất cả | 2 | 11 | 2 |
| F1 | Knowledge Base | Nạp PDF, DOCX, TXT, URL, FAQ | Tất cả | 2 | 02 | 2 |
| F2 | Knowledge Base | Tách đoạn, embedding, re-index, phiên bản, xóa | Tất cả | 2 | 02 | 2 |
| F3 | Knowledge Base | Tìm kiếm kết hợp từ khóa + vector cho tiếng Việt, từ điển viết tắt ngành | Tất cả | 2 | 02 | 2 |
| F4 | Knowledge Base | Phân quyền tài liệu theo workspace | Tất cả | 2 | 02 | 2 |
| G1 | B2B Sales | Tự tạo lead khi khách để SĐT hoặc hỏi giá | B2B | 1 | 03 | 1 |
| G2 | B2B Sales | Pipeline 6 bước, xem dạng Kanban | B2B | 1 | 03 | 1 |
| G3 | B2B Sales | Bắt buộc chọn lý do khi Lost | B2B | 1 | 03 | 1 |
| G4 | B2B Sales | Bảng giá theo bậc số lượng, vùng giao, ngày hiệu lực | B2B | 2 | 12 | 2 |
| G5 | B2B Sales | Tool tra giá, MOQ, quy cách | B2B | 2 | 05 | 2 |
| G6 | B2B Sales | Báo giá PDF tự soạn, chờ Sales duyệt | B2B | 2 | 05 | 2 |
| G7 | B2B Sales | Lead scoring cấu hình được | B2B | 2 | 08 | 2 |
| G8 | B2B Sales | Thẻ tóm tắt khi chuyển Sales | B2B, Service | 2 | 07 | 2 |
| H1 | B2C Order | Danh mục sản phẩm, ảnh, thẻ sản phẩm trong chat | B2C | 2 | 03 | 3 |
| H2 | B2C Order | Giỏ hàng trong chat | B2C | 2 | 05 | 3 |
| H3 | B2C Order | Khuyến mãi có thời hạn hiệu lực | B2C | 2 | 05 | 3 |
| H4 | B2C Order | Vùng giao, phí ship, khung giờ giao | B2C | 2 | 05 | 3 |
| H5 | B2C Order | Tính tổng tiền bằng tool; đơn nháp → khách xác nhận → đơn | B2C | 2 | 05 | 3 |
| H6 | B2C Order | Thanh toán COD và QR chuyển khoản có mã đơn | B2C | 2 | 12 | 3 |
| H7 | B2C Order | Đối soát thanh toán tự động | B2C | 2 | 12 | 3 |
| H8 | B2C Order | Đồng bộ đơn sang phần mềm bán hàng/kho qua API | B2C | 2 | 12 | 3 |
| H9 | B2C Order | Khách tra cứu trạng thái đơn qua chat | B2C | 2 | 04 | 3 |
| H10 | B2C Order | Đánh giá sau giao, nhắc mua lại | B2C | 2 | 04 | 3 |
| H11 | B2C Order | Chuyển sang workspace B2B khi khách mua số lượng lớn | B2C | 2 | 05 | 3 |
| H12 | B2C Order | Upsell/cross-sell theo luật doanh nghiệp định sẵn (combo, khuyến mãi); AI chỉ diễn đạt | B2C | 2 | 03 | 3 |
| H13 | B2C Order | Tra cứu vận chuyển qua tích hợp hãng giao hàng | B2C | 3 | 04 | 3 |
| H14 | B2C Order | Luồng đổi trả/hoàn tiền: thu thông tin, ảnh, mã đơn → tạo ticket → người duyệt | B2C | 2 | 04 | 3 |
| I1 | Service | Ticket theo loại yêu cầu | Service | 1 | 04 | 1 |
| I2 | Service | Nhận diện khách hiện hữu qua SĐT đã đăng ký | Service | 1 | 04 | 1 |
| I3 | Service | Giao chuyên viên phụ trách, SLA xử lý | Service | 1 | 04 | 1 |
| I4 | Service | Nhắc hạn tự động (ví dụ hạn nộp tờ khai, bổ sung chứng từ) | Service | 2 | 04 | 2 |
| J1 | CRM | Hồ sơ khách cấp công ty, trường tùy chỉnh | Tất cả | 1 | 08 | 1 |
| J2 | CRM | Hợp nhất định danh: Zalo UID, Facebook PSID, SĐT chuẩn +84 | Tất cả | 1 | 08 | 1 |
| J3 | CRM | Gộp khách trùng (agent thấy; khách xem lịch sử cần OTP) | Tất cả | 1 | 08 | 1 |
| J4 | CRM | Tag, segment, tìm kiếm, lọc | Tất cả | 1 | 08 | 1 |
| J5 | CRM | Import/Export CSV | Tất cả | 1 | 08 | 1 |
| J6 | CRM | Một hồ sơ gom hội thoại, lead, đơn, ticket | Tất cả | 1 | 08 | 1 |
| J7 | CRM | Lưu đồng ý tiếp thị theo kênh, cho hủy nhận tin | Tất cả | 2 | 08 | 2 |
| K1 | Automation | Builder WHEN–IF–THEN: trigger, điều kiện, hành động, delay, nhánh | Tất cả | 2 | 09 | 2 |
| K2 | Automation | Rule mặc định theo mẫu (lead nóng, chưa phản hồi, nuôi lead, nhắc đơn) | Tất cả | 2 | 09 | 2 |
| K3 | Automation | Chạy thử, nhật ký chạy, chống vòng lặp | Tất cả | 2 | 09 | 2 |
| K4 | Automation | Tạo task follow-up cho agent | Tất cả | 2 | 09 | 2 |
| L1 | AI Co-pilot | Tóm tắt hội thoại 1 click | Tất cả | 2 | 07 | 1 (chỉ nội bộ) |
| L2 | AI Co-pilot | Gợi ý câu trả lời cho agent | Tất cả | 2 | 07 | 2 |
| L3 | AI Co-pilot | Phân tích cảm xúc, gợi ý câu hỏi tiếp theo | Tất cả | 2 | 07 | 2 |
| L4 | AI Co-pilot | Đề xuất cập nhật CRM từ hội thoại, agent duyệt | Tất cả | 2 | 07 | 2 |
| M1 | Báo cáo | Hội thoại: tổng, mới, đã giải quyết, thời gian phản hồi/giải quyết | Tất cả | 2 | 10 | 2 |
| M2 | Báo cáo | B2B: số lead, tỷ lệ chuyển đổi theo bước, nguồn lead | B2B | 2 | 10 | 2 |
| M3 | Báo cáo | B2C: số đơn, tỷ lệ chốt trong chat, giá trị đơn trung bình, mua lại | B2C | 2 | 10 | 2 (có dữ liệu khi đợt 3 go-live) |
| M4 | Báo cáo | Service: thời gian xử lý, CSAT | Service | 2 | 10 | 2 |
| M5 | Báo cáo | Bot: tỷ lệ tự giải quyết, chuyển người, chi phí AI/hội thoại | Tất cả | 2 | 10 | 2 |
| M6 | Báo cáo | Agent: số hội thoại, tốc độ phản hồi, CSAT, chuyển đổi | Tất cả | 2 | 10 | 2 |
| M7 | Báo cáo | Bộ lọc ngày, kênh, workspace, agent, team, tag, chiến dịch | Tất cả | 2 | 10 | 2 |
| M8 | Báo cáo | Phân tích nâng cao (kho dữ liệu OLAP) | Tất cả | 4 | 10 | Sau đợt 3 |
| M9 | Báo cáo | Câu hỏi chưa trả lời được và lỗ hổng kiến thức → danh sách việc cập nhật Knowledge Base | Tất cả | 2 | 10 | 2 |
| N1 | Campaign | Trigger website: URL, thời gian trên trang, cuộn trang, exit intent, UTM, thiết bị | Tất cả | 3 | 09 | 3 |
| N2 | Campaign | Popup/tin chủ động trên widget | Tất cả | 3 | 09 | 3 |
| N3 | Campaign | Chiến dịch: đối tượng → trigger → tin → CTA → đo lường, chỉ gửi khách đã đồng ý | Tất cả | 3 | 09 | 3 |
| O1 | Tích hợp | Public REST API, API key có phạm vi quyền | Tất cả | 3 | 12 | 3 |
| O2 | Tích hợp | Webhook ra: ký HMAC, gửi lại khi lỗi, nhật ký | Tất cả | 3 | 12 | 3 |
| O3 | Tích hợp | Kết nối phần mềm bán hàng/kho cho đơn B2C | B2C | 2 | 12 | 3 |
| P1 | Bảo mật & vận hành | Giới hạn tần suất, chống spam | Tất cả | 1 | 14 | 1 |
| P2 | Bảo mật & vận hành | Mã hóa token kênh, quản lý secret | Tất cả | 1 | 14 | 1 |
| P3 | Bảo mật & vận hành | Sao lưu hằng ngày, khôi phục thử định kỳ | Tất cả | 1 | 14 | 1 |
| P4 | Bảo mật & vận hành | Giám sát lỗi, uptime, cảnh báo sự cố | Tất cả | 1 | 14 | 1 |
| P5 | Bảo mật & vận hành | Thời hạn lưu trữ, quyền xem/xóa dữ liệu của khách | Tất cả | 2 | 14 | 2 |
| P6 | Bảo mật & vận hành | Quét virus file khách gửi | Tất cả | 1 | 14 | 1 |
