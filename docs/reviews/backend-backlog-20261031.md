# Việc còn lại tới hết dự án, góc nhìn Backend (31/10/2026)

Người soạn: nhóm Backend · `main` lúc đối chiếu: `7ac7881` (30/10/2026 17:20 UTC) · Trạng thái Đợt 1 lấy theo
`docs/reviews/backend-progress-20261030.md` (không đổi tới `7ac7881`, vì không có tính năng mới). Lịch theo Brief v1.0 P21.

## Mẫu số

Repo có hai cách đếm mã. **Brief v1.0 là chuẩn**; danh sách 109 (cột theo Brief v0.4) chỉ dùng để so với báo cáo 30/10.

| Nguồn | Đợt 1 | Đợt 2 | Chờ dữ liệu |
|---|---|---|---|
| `docs/danh-sach-109-tinh-nang.md`, cột "Đợt (Brief v0.4)" | 50 | (v0.4 chia Đợt 2, Đợt 3, Sau) | — |
| Brief v1.0 P7 + QĐ4 (file "Phạm vi triển khai — 135 mã", 12/10/2026) | **58** | **77** | **12** |

1. **Mẫu số Đợt 1 chuẩn là 58** (Brief v1.0 QĐ4: "Phạm vi 135 mã (Đợt 1 = 58, Đợt 2 = 77)"). Brief v0.4 đã bị thay thế
   (`CLAUDE.md`). Số 50 chỉ dùng khi so với báo cáo 30/10, vốn chấm trên danh sách 109.
2. **12 mã "chờ dữ liệu" nằm ngoài 135.** 58 + 77 = 135 đúng bằng phạm vi; QĐ4 ghi riêng "12 mã chờ dữ liệu". Tổng mã có tên trong
   bảng P7 là 135 + 12 = 147. Đếm lại bảng P7 từng module: Đợt 1 = 58; Đợt 2 = 78 lượt mã, trong đó E6 xuất hiện cả hai đợt (Đợt 1:
   công cụ chạy test; Đợt 2: bộ 200 câu), nên 77 mã mới; chờ dữ liệu = 12.
3. **8 mã chênh giữa 50 và 58:** A13, A17, C20, D6, D15, E20, P7, P11. Nguồn: Brief v1.0 P7, "Mã bổ sung bắt buộc: Đợt 1 — A13, A17,
   C20, D15, E20, P7, P11 (D6 đã có trong S4)". Cả 50 mã Đợt 1 của danh sách 109 đều nằm trong 58.

Đối chiếu ngược: 109 = 50 (Đợt 1) + 55 (Đợt 2 v1.0) + 4 (chờ dữ liệu: A10, A11, B8, M8). Brief v1.0 thêm 38 mã: 8 ở Đợt 1, 22 ở
Đợt 2, 8 chờ dữ liệu. 109 + 38 = 147.

**Giới hạn:** file "Phạm vi triển khai — 135 mã" không có trong repo. Tên của các mã thêm ở v1.0 chỉ biết khi
`docs/ui/danh-sach-man-M11.md` nhắc tới (A13, A17, C20, E20, P7, P11); mã khác ghi "(tên chưa có trong repo)", không đoán.

## Tiến độ Đợt 1 trên mẫu số 58

Cách chấm như báo cáo 30/10: có code + test trên `main` = 1; một phần = 0,5; chưa có = 0.

| Nhóm | Số mã | Mã |
|---|---|---|
| Xong | 10 | A1–A6, C1, C4, C7, P2 |
| Một phần | 15 | A8, A9, B1, B3, C2, C3, C5, C9, I2, J1, J2, J4, P1, P4; **A13** (mới chấm: có bảng `feature_flags_*` + spec, API mới ở `planned.json`) |
| Chưa | 30 | A7, B2, C6, C8, C10, C11, D1–D4, E1, E4–E7, G1–G3, I1, I3, J3, J5, J6, L1, P3, P6; D6, E20, P7, P11 |
| Chưa chấm được | 3 | A17, C20, D15: repo không có định nghĩa |

- **17,5/58 ≈ 30 %** nếu 3 mã chưa chấm tính 0; **17,5/55 ≈ 32 %** trên 55 mã chấm được.
- So với 17/50 = 34 % (báo cáo 30/10): giảm vì mẫu số tăng 8 mã, chủ yếu chưa làm; code không đổi.

## Phần 1. Đợt 1 (S1 16/11/2026 → go-live 15/02/2027)

### 1.1 Hạ tầng và điều kiện đóng cổng

| Việc | Sprint | Chặn bởi |
|---|---|---|
| Staging; Terraform `plan`/`apply` thật (hiện khung 8 module) | S1 | Q2 (sau Q1) |
| Đẩy image lên registry | S1 | Q2 |
| Sao lưu hằng ngày, PITR, diễn tập khôi phục (P3: RPO ≤ 1 giờ, RTO ≤ 4 giờ) | S1–S6 | Q2 |
| Ký hợp đồng pentest | S3 (14/12) | — |
| Chốt bản build S4 cho pentest; pentest vòng 1 (05/01 – 16/01) | S4, S5 | — |
| Sửa lỗi pentest, kiểm tra lại; tải, chaos, UAT; tài liệu vận hành; đào tạo key user | S6 (25/01 – 03/02) | — |
| Go-live Gani, The Smile (+ công ty 3–5 ở L0), hỗ trợ sát 2 tuần | S7 (15/02/2027) | — |

### 1.2 Chưa bắt đầu (30 mã) và chưa chấm được (3 mã)

| Mã | Tính năng | Backend còn phải làm | Chặn bởi | Sprint |
|---|---|---|---|---|
| B2 | Tự làm mới token Zalo, cảnh báo sắp hết hạn | Job làm mới, cảnh báo | Đi cùng gửi ra (U57) | S3 |
| C6 | Ghi chú nội bộ, @mention | Bảng, API, sự kiện realtime | — | S3–S4 |
| C11 | Thông báo đẩy cho agent | Kênh đẩy, đăng ký thiết bị | — | S3–S4 |
| P6 | Quét virus file khách gửi | Pipeline quét file | Cần B1 phần ảnh/file | S3–S4 |
| C8 | SLA, ưu tiên, cảnh báo chưa phản hồi | Đồng hồ SLA, cảnh báo | Q7, U40, U41 | S4 |
| C10 | Online/offline, giờ làm việc | Lịch làm việc, ngày lễ | Q7, U44 | S4 |
| D1 | Flow kéo-thả | Toàn bộ bot engine | — | S4 |
| D2 | Phiên bản flow, chạy thử | Versioning, dry-run | — | S4 |
| D3 | Flow mặc định theo mẫu | Seed flow | — | S4 |
| D4 | Xử lý ngoài giờ | Logic ngoài giờ (hiện chỉ có cột `after_hours_hold`) | Q7 | S4 |
| D6 | `jump_to_flow` | Node chuyển flow | — | S4 |
| G1, G2, G3 | Lead tự tạo; pipeline 6 bước; lý do Lost | Module `leads` | — | S4 |
| I1, I3 | Ticket theo loại; giao chuyên viên, SLA xử lý | Code (hợp đồng `/v1/tickets` đã có) | U60; I3 cần Q7 | S4 (28/12) |
| J3, J5, J6 | Gộp khách (OTP); CSV; hồ sơ gom mọi thứ | CRM | J6 cần G1, I1 | S4 |
| E1, E4, E5, E7, L1 | Phân loại; router; hạn mức chi phí; che PII; tóm tắt | `packages/ai-core` (chưa có `src`) | Q1 | S5 (11/01) |
| E6 | Công cụ chạy test AI | `evals/` | — | S5 |
| E20 | Phiên bản prompt | Code (chỉ có `/v1/ai/prompts` ở `planned.json`) | Q1 | S5 |
| A7 | Bảng điều khiển vận hành | Code (chỉ có `/v1/overview` ở `planned.json`) | — | S5 |
| P7 | Yêu cầu dữ liệu cá nhân | Code (chỉ có `/v1/privacy-requests` ở `planned.json`) | — | S5 |
| P11 | Sự cố bảo mật | Code (chỉ có `/v1/security-incidents`, `/security-alerts` ở `planned.json`) | — | S5–S6 |
| P3 | Sao lưu, khôi phục thử | Mục 1.1 | Q2 | S1–S6 |
| A17, C20, D15 | (tên chưa có trong repo; màn #28 Audit log, #6 Hộp thư, #18 Trình dựng bot) | Chưa chấm được | Cần file 135 mã | — |

### 1.3 Một phần (15 mã)

| Mã | Đã có | Còn thiếu | Chặn bởi |
|---|---|---|---|
| B1 Zalo nhận/gửi, ảnh, file | Nhận tin (webhook) | Gửi ra (outbound worker 8b), ảnh, file | **U57 (blocker S3)** |
| B3 Khung gửi Zalo | `channel_policies`, `ChannelPolicyService.check` | ZNS | U57 |
| C2 Realtime | Tin mới, `conversation.*` | Đang gõ, đã đọc | — |
| C3 Lọc Hộp thư | Kênh, workspace, trạng thái, người phụ trách | Tag | U47 |
| C5 Nhận, chuyển | Claim, chuyển người | Chuyển team (N133) | — |
| C9 Phân bổ tự động | Giới hạn tải agent, mặc định workspace | Round-robin, theo team, theo kỹ năng | U45 |
| J1 Hồ sơ khách | Hồ sơ cơ bản | Trường tùy chỉnh | U46 |
| J2 Hợp nhất định danh | Zalo UID, SĐT | PSID Facebook (kênh Đợt 2) | — |
| J4 Tag, segment, tìm | Tìm theo email, SĐT, tên NFC | Tag, segment | U47 |
| I2 Nhận diện khách qua SĐT | Tìm theo SĐT | Gắn vào ticket | Cần I1 |
| A8 Nhật ký truy cập tenant | Bảng `platform_access_logs` | API, màn đọc | — |
| A9 Audit log quản trị | Bảng `audit_logs` | API đọc; test RLS cả bảng cha (plan chờ duyệt) | — |
| A13 Tự chủ, feature flag | Bảng `feature_flags_*`, spec | API `/v1/feature-flags`, `/v1/workspaces/{id}/autonomy` | — |
| P1 Giới hạn tần suất | `token-bucket.ts`, giới hạn đăng nhập | Phủ rộng hơn; IP sau proxy (C-01) | N112 |
| P4 Giám sát, uptime, cảnh báo | Metrics worker | Uptime, cảnh báo sự cố, Sentry | Q2 |

### 1.4 Nợ kỹ thuật và kiểm chứng (không phải mã tính năng)

| Việc | Hạn / điều kiện |
|---|---|
| C-01 (HIGH): nguồn IP cho giới hạn đăng nhập, viết lại 4 ca | Chốt sơ đồ proxy (N112), trước go-live |
| N116: hai truy vấn dòng bẩn trên staging | Trước go-live; cần staging |
| RLS bước 2: `audit_logs` (bảng cha) + 4 bảng một phần | Chờ brief |
| Nợ coverage 7 file (#433) | 28/12 |
| E-01, E-02, G-01…G-06 (review M1.1–M1.3) | Theo kế hoạch sprint |
| #386 `DROP` hàm cũ | Anh xác nhận |
| N171 đếm tin chưa đọc | Chưa xếp sprint |
| 30 câu ResponseGuard (0 số sai); claim race 50 agent trên bản build S4 | S4–S6 |
| 16 hàm SECURITY DEFINER chưa có cố vấn xác nhận (N35) | Chủ đầu tư quyết |

## Phần 2. Đợt 2 (S8 01/03/2027 → cổng cuối khoảng giữa 09/2027): 77 mã, chưa mã nào bắt đầu

| Module | Mã | Nội dung chính | Sprint |
|---|---|---|---|
| 02 Knowledge Base | E2, F1, F2, F3, F4, F5, F6, F7, F9, F13 | RAG có nguồn; nạp PDF/DOCX/URL + OCR; chunking, embedding, re-index; hybrid search tiếng Việt, từ điển viết tắt; phân quyền; duyệt + phiên bản + hạn tài liệu (F5–F7). F9, F13: tên chưa có trong repo | S8 |
| 11 Guardrails | E3, E8, E9, E25 | ResponseGuard chống bịa, chống prompt injection, chế độ gợi ý/tự động. E25: tên chưa có trong repo | S9 |
| 12 Tool & Data | G4, H6, H7, H8, O1, O2, O3 | Bảng giá theo bậc (duyệt 2 người); COD/QR; đối soát; đồng bộ POS/kho; Public API; webhook ra HMAC | S9, S15–S17 |
| 05 AI Action | G5, G6, H2, H3, H4, H5, H11 | `get_price`, báo giá PDF, giỏ hàng, khuyến mãi, vùng/phí ship, tính tổng + đơn, chuyển B2B | S9–S10, S14–S15 |
| 06 Kênh | B4, B5, B6, B7, B11 | Facebook Messenger + khung 24 giờ; widget website; ZNS giao dịch. B11: tên chưa có trong repo | S10 |
| 08 CRM | J7, G7 | Đồng ý tiếp thị theo kênh; lead scoring | S10 |
| 07 Inbox & Co-pilot | G8, L2, L3, L4, C12, C13, C18, C22, C24, C26 | Thẻ tóm tắt khi chuyển Sales; gợi ý trả lời; cảm xúc; đề xuất cập nhật CRM. Mã C: tên chưa có trong repo | S11 |
| 09 Automation & Campaign | K1–K4, N1–N3 | Builder WHEN–IF–THEN, rule mặc định, chạy thử + chống vòng lặp, task; trigger website, popup, chiến dịch | S11, S16 |
| 10 Analytics | M1–M7, M9, M11, M12, M13 | Hội thoại, B2B, B2C, Service, Bot, Agent, bộ lọc, lỗ hổng kiến thức. M11–M13: tên chưa có trong repo | S11 |
| 01 AI Brain | D5, E13, E15, E16 | Tên chưa có trong repo | S8–S12 |
| 14 Eval & Security | P5, E19, E28 (+ E6 bộ 200 câu) | Hạn lưu trữ, quyền xem/xóa của khách; Test Specification ≥ 95 %, 0 số sai | S12 |
| 03 AI Sales, 04 Service | H1, H12, H9, H10, H13, H14, I4 | Catalog, upsell theo luật, tra đơn, đánh giá sau giao, tra vận chuyển, đổi trả → ticket, nhắc hạn | S14–S17 |

- **Cổng:** Cổng 1 (S10, 29/03) Facebook + Webchat vào/ra, báo giá PDF 20/20, chọn model trả lời khách; Cổng 2 (S13, 10/05) go-live AI
  sau chạy song song ≥ 300 hội thoại/workspace hoặc 4 tuần; S18 go-live mềm B2C; Cổng 3 khoảng giữa 09/2027.
- **Chặn:** Q1 (AI trả lời khách); Meta duyệt (Facebook); dịch vụ đối soát (S15); thông tin POS (S16). PM-3 (bỏ partition cũ, F-01)
  sau 15/05/2027.

## Phần 3. Chờ dữ liệu: 12 mã, ngoài 135, chưa xếp lịch

A10 (onboarding tự phục vụ), A11 (phân bổ phí nội bộ), A18, B8 (Email, Instagram, TikTok), B18, C17, D8, D22, F14, I5, K5,
M8 (phân tích nâng cao OLAP). A18, B18, C17, D8, D22, F14, I5, K5: tên chưa có trong repo.

## Tóm tắt

- Đợt 1: 58 mã; 10 xong, 15 một phần, 30 chưa, 3 chưa chấm được. Nặng nhất là S4 (bot, lead, ticket, SLA, routing, CRM) và S5 (AI
  nội bộ, admin nền tảng).
- Đợt 2: 77 mã, chưa bắt đầu. Ngoài phạm vi: 12 mã chờ dữ liệu.
- Chặn lớn nhất theo thời gian: U57 (Zalo gửi ra, đóng S3); Q1/Q2 (staging, sao lưu, AI); Q7 và U40–U47 (SLA, giờ làm việc, routing,
  tag).
