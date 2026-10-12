# Brief triển khai Backend & Core v1.0 — Nền tảng Chat & AI Chatbot đa tenant

12/10/2026 · Chủ đầu tư: HUNG MK

**Mục lục:** P0 · P1 · P2 · P3 · P4 · P5 · P6 · P7 · P8 · P9 · P10 · P11 · P12 · P13 · P14 · P15 · P16 · P17 · P18 (ranh giới với Brief UI) · P19 · P20 · P21 · P22

> **Bộ tài liệu gửi DEV gồm 2 brief.** Brief này dành cho Backend, AI, DevOps, QA, Security và Tech Lead. Toàn bộ giao diện (Inbox, Admin, Khách hàng, Widget) nằm trong **Brief UI v1.0**, giao cho DEV Frontend. Hai bên làm việc qua OpenAPI (đầu ra thiết kế #6), sự kiện realtime và mã lỗi ở P9.

Hồ sơ gốc: "Gani Foods — Nền tảng Chat & AI Chatbot: Phân tích trước khi code" — chủ đầu tư cung cấp bản PDF/DOCX kèm brief.

## P0 — Cheat Sheet (đọc trong 15 phút, in dán mỗi squad)

**5 điều phải nhớ**

1. Mọi truy vấn chạy trong transaction có tenant; `org_id` không bao giờ lấy từ client; bảng nhạy cảm cách ly thêm theo workspace.
2. Giá, tổng tiền, cam kết thời gian chỉ đến từ tool; model chèn qua ô giữ chỗ (`{{price_1}}`), không tự viết số nghiệp vụ.
3. Câu có số liệu không cache, không stream; qua `ResponseGuard` rồi mới gửi.
4. Đợt 1: AI chỉ dùng nội bộ (phân loại, tóm tắt), không gửi gì cho khách.
5. Chỉ `ConversationStateMachine` được đổi trạng thái hội thoại; bot im lặng khi trạng thái là `HUMAN_ACTIVE` hoặc `PENDING_CUSTOMER`.

**3 điều không được làm:** hard-code secret/model/ngưỡng kênh hay commit `.env` · log PII hoặc dùng `any` trong lõi · tự mở rộng phạm vi khi chưa hỏi (P22).

| Vai trò | Đọc trước | Đọc khi cần |
| --- | --- | --- |
| Backend | P4, P7, P8, P9, P10, P14, P16 | P13, P15 |
| Frontend | **Brief UI v1.0** + P4, P9 (Realtime, mã lỗi), P14 của brief này | P7 |
| AI Engineer | P4, P10, P11, P12, P20 (bộ test, bake-off) | P16 |
| DevOps | P4, P5, P19 | P16, P17 |
| QA | P3.2, P8, P9, P14, P20 + Brief UI Phần 8 | Tất cả |
| Security | P16, P17 | P8, P9 |

**9 câu hỏi chặn code:** xem P22 (Q1 pháp lý có hạn trước 14/12/2026; Q2–Q5 trước S1; Q6 trước S3; Q7–Q9 trước S4).

### Onboarding cho DEV mới (1 ngày với senior · 1,5 ngày với junior chưa quen multi-tenant)

- [ ] Sáng: đọc P0 + P4 + P7 + phần theo vai trò ở bảng trên
- [ ] Sáng: chạy môi trường dev bằng docker compose, chạy toàn bộ test, xem isolation test chạy
- [ ] Chiều: pair 2 giờ với một DEV hiện tại trên ticket đang làm
- [ ] Chiều: mở PR đầu tiên (sửa nhỏ hoặc thêm test), đi qua checklist PR ở P6
- [ ] Cuối ngày: Tech Lead xác nhận đã hiểu tenant isolation, FSM, ResponseGuard

## P1 — Trang bìa & kiểm soát phiên bản

| Mục | Nội dung |
| --- | --- |
| Tên | Brief triển khai Backend & Core — Nền tảng Chat & AI Chatbot đa tenant |
| Phiên bản | v1.0 — bản phát hành cho DEV |
| Ngày phát hành | 12/10/2026 |
| Người phát hành | HUNG MK — CEO, chủ đầu tư |
| Người duyệt | Cố vấn kỹ thuật độc lập · CEO (chủ đầu tư) |
| Trạng thái | Phát hành để vendor lập kế hoạch, báo giá theo mã và chuẩn bị S1. **Được code từ S1 (16/11/2026)** khi đạt "Điều kiện bắt đầu code" ở cuối P22 |

### Đọc gì trước (bắt buộc, \~2 giờ)

| # | Tài liệu | Phần cần đọc |
| --- | --- | --- |
| 1 | Hồ sơ "Gani Foods — Nền tảng Chat & AI Chatbot" | Bản chốt phát triển v1.1 |
| 2 | Cùng hồ sơ | Phụ lục kỹ thuật v2.1, v2.2, v2.3 (mục 1–29) |
| 3 | file "Phạm vi triển khai — 135 mã" (12/10/2026) | Danh sách mã theo đợt — căn cứ báo giá và nghiệm thu |
| 4 | Cùng hồ sơ | Test Specification + Runbook sự cố |
| 5 | Cùng hồ sơ | Prompt 2–6 |
| 6 | Brief UI v1.0 | Phần 1, 2 (đọc để biết giao diện cần gì từ API) |

### Quan hệ với tài liệu khác

| Tài liệu | Quan hệ |
| --- | --- |
| Hồ sơ phân tích + Phụ lục v2.1–v2.3 | Brief **không thay thế**, chỉ chuyển thành chỉ dẫn triển khai. Mâu thuẫn → hồ sơ gốc thắng, ghi vào P22 |
| Brief UI v1.0 | Đặc tả giao diện; khi Brief UI và brief này mâu thuẫn về API, FSM, quyền → brief này thắng |
| 21 đầu ra thiết kế của vendor | Brief là đầu vào; ERD chi tiết, OpenAPI đầy đủ, wireframe là đầu ra vendor nộp theo checklist duyệt thiết kế |
| Hợp đồng + phụ lục từng đợt | Phạm vi pháp lý của từng đợt; brief không mở rộng phạm vi |

### Changelog

| Phiên bản | Ngày | Thay đổi |
| --- | --- | --- |
| v1.0 | 12/10/2026 | Bản phát hành cho DEV. Dự án 2 đợt (Đợt 2 qua 3 cổng); phạm vi 135 mã; Webchat ở Đợt 2 (S10); tách giao diện sang Brief UI v1.0; bổ sung endpoint phục vụ giao diện (P9); thống nhất kết quả đóng hội thoại và lead (P14) |
| v0.1–v0.5 | 02–12/10/2026 | Các bản làm việc nội bộ |

> **Quy ước callout:** **BẮT BUỘC** — không được vi phạm · **CẦN QUYẾT ĐỊNH** — chưa chốt, có default và người duyệt · **RỦI RO CAO** — đường găng hoặc pháp lý · **HỎI LẠI** — hồ sơ gốc chưa đủ.

## P2 — Executive Summary cho DEV

**Xây một nền tảng inbox + chatbot AI đa tenant cho 5 công ty, mô hình Organization → Workspace, 3 mẫu B2B Sales / B2C Order / Service + Support, 14 module, 135 mã tính năng trong 2 đợt (Đợt 2 qua 3 cổng) \~10–11 tháng.** Thành công đo bằng cổng nghiệm thu, không bằng lịch.

Người mới vào dự án đọc **P0 Cheat Sheet** trước (15 phút), sau đó đọc phần theo vai trò.

| Đợt | Nội dung chính | Go-live | Cổng |
| --- | --- | --- | --- |
| 1 — Nền tảng (58 mã) | Tenant 2 tầng, RBAC, Zalo OA, Inbox realtime, bot kịch bản, handoff, CRM, lead, ticket, AI nội bộ (phân loại + tóm tắt); feature flag, xem audit, gửi file, quyền chủ thể dữ liệu, xử lý sự cố | Gani B2B, The Smile; công ty 3–5 dạng B2B/Service ở L0 — S7 (15/02/2027) | Test chéo tenant + workspace 100%; 50 agent nhận đồng thời → 1 thắng; 0 tin mất khi restart |
| Cổng pháp lý | Văn bản ý kiến pháp lý về lưu trữ/chuyển dữ liệu | — | Có văn bản trước 14/12/2026 (Q1); bắt buộc trước khi bật AI nội bộ ở production và trước khi kích hoạt điều khoản AI trả lời khách của phụ lục Đợt 2. Phần không dùng AI của Đợt 2 không bị chặn |
| 2 · Cổng 1 (S10) | KB/RAG, tool tra giá B2B, báo giá PDF, lead scoring, Facebook, Webchat | Facebook + Webchat cho 5 công ty — 29/03/2027 | Tin Facebook/Webchat vào/ra; widget đạt Brief UI §3.9; PDF đúng 20/20 |
| 2 · Cổng 2 (S13) | Automation, co-pilot đầy đủ, analytics, AI trả lời khách | Bật AI trả lời khách — 10/05/2027 | Test 200 câu/workspace đạt; chạy song song ≥ 300 hội thoại hoặc 4 tuần |
| 2 · Cổng 3 (cuối đợt) | Đặt hàng B2C, COD/QR, đối soát, đồng bộ POS, campaign, public API, tiện ích Inbox còn lại | Lộc Thủy + công ty B2C — khoảng giữa 09/2027 (vendor xác nhận) | 20/20 đơn thử đúng tiền; đối soát QR đúng 100% |
| Chờ dữ liệu (12 mã) | A10, A11, A18, B8, B18, C17, D8, D22, F14, I5, K5, M8 | Khi có số liệu chứng minh nhu cầu | CEO duyệt từng mã |
| Tùy chọn hợp đồng (9 mã) | B16, D19, E14, E21, E26, H22, J11, L7, O7 | Vendor báo giá và khóa giá, chưa làm | Chỉ kích hoạt khi có văn bản luật sư hoặc quyết định CEO |

Danh sách mã từng đợt: file "Phạm vi triển khai — 135 mã" (12/10/2026). Webchat thuộc Đợt 2, go-live S10 (CEO chốt 12/10/2026). Thanh toán Đợt 2 theo 3 cổng, không trả theo cả đợt.

**Số liệu tải phải đáp ứng (Phụ lục v2.2 mục 17):** \~9.200 – 12.000 hội thoại/tháng, \~75.000 tin/tháng, thiết kế cho ×5 trong 24 tháng; cao điểm 50 tin/giây webhook trong 5 phút, 300 hội thoại mới/10 phút/workspace; 30 agent đồng thời; 500 kết nối realtime.

### 5 điều DEV phải nhớ suốt dự án

1. **Cách ly 2 tầng:** mọi truy vấn chạy trong transaction có `app.current_org` (+ `app.current_workspace` với bảng nhạy cảm); `org_id` không bao giờ lấy từ client.
2. **Giá và tổng tiền chỉ qua tool** do server tính; model chỉ diễn đạt.
3. **Câu có số liệu không cache, không stream**; sinh xong → guard kiểm số → mới gửi.
4. **Đợt 1 AI không gửi gì cho khách** — chỉ phân loại và tóm tắt nội bộ.
5. **Mọi thay đổi trạng thái hội thoại đi qua một module FSM duy nhất** và ghi `conversation_events`.

### 3 điều DEV không được làm

1. Không hard-code secret, model name, ngưỡng kênh; không commit `.env`.
2. Không log PII, không dùng `any` trong code lõi (`packages/*`, `apps/api/src/modules/*`).
3. Không tự mở rộng phạm vi hay sáng tạo nghiệp vụ — chưa rõ thì hỏi (P22).

## P3 — Bản đồ tài liệu & truy vết

**QA và audit chỉ cần tra 2 bảng dưới: phần brief ↔ hồ sơ gốc ↔ mã tính năng ↔ đầu ra thiết kế, và mục Phụ lục ↔ nơi triển khai ↔ test.**

### P3.1 Truy vết phần brief

| Phần brief | Mục hồ sơ gốc | Mã tính năng | Đầu ra thiết kế # |
| --- | --- | --- | --- |
| P4 | Bản chốt v1.1 §1 | — | 14 |
| P5 | §14–15 Tech stack & hạ tầng; Phụ lục v2.2 §17, v2.3 §22, §24 | P3, P4 | 4, 15 |
| P6 | Prompt 1 v3 (Quy tắc coding) | — | 14 |
| P7 | Bản chốt §2 (14 module); file "Phạm vi triển khai — 135 mã" (12/10/2026) | Toàn bộ 135 mã | 2, 12, 19 |
| P8 | §5 ERD + bổ sung 5 công ty; v2.1 §1, §10; v2.3 §20, §23 | A6, J1–J3, P2 | 5 |
| P9 | §6 API Architecture; v2.2 §14 | O1, O2, B1–B6 | 6 |
| P10 | §3 User Flow; Prompt 2, 5, 6 | G1–G8, H1–H14, I1–I4, K1–K4 | 3 |
| P11 | §7 AI Architecture; v2.1 §4–6; v2.3 §25–26 | E1–E9, E13, E15, E16, E20, E25, L1–L4 | 7 |
| P12 | §7; v2.1 Vấn đề mức cao (pgvector, hybrid search) | E2, F1–F4 | 7 |
| P13 | §4 Bot; User Flow | D1–D4 | 3, 8 |
| P14 | Phản biện Convexa (FSM, claim); v2.1 §3, §9 | C1–C11, G8, L1–L4 | 3, 11 |
| P15 | §8 Automation; v2.2 §13; v2.3 §25 | K1–K4, N1–N3 | 8 |
| P16 | §9 Multi-tenant; v2.1 §2; v2.2 §15; v2.3 §20 | A1–A11 | 9 |
| P17 | §10 Security; v2.3 §23–24 | P1–P6, A5, A8, A9 | 10 |
| P18 | Ranh giới với Brief UI v1.0 | — | 11 |
| P19 | Runbook sự cố; v2.3 §26 | A7, P4, M5 | 15, 16 |
| P20 | Test Specification; v2.1 §11; v2.2 §17 | E6 | 13 |
| P21 | Bản chốt §4 Lộ trình; mục 13 Roadmap | — | 13 |
| P22 | Câu hỏi mở hồ sơ gốc | — | 16, 17, 21 |
| P0 | Tổng hợp từ P2, P4, P22 | — | — |

### P3.2 Tuân thủ Phụ lục (mục 1–29)

> **BẮT BUỘC:** không mục nào được bỏ. Mục nào không thể tuân thủ → ghi ngoại lệ ở P22 và chờ chủ đầu tư + cố vấn duyệt trước khi code. Hiện tại **không có ngoại lệ**.

| # | Yêu cầu (rút gọn) | Triển khai ở | Test chứng minh |
| --- | --- | --- | --- |
| 1 | Khóa ngoại kép `(org_id, id)` | `packages/db` schema; P8 | `tenant-isolation.spec`: ghi chéo tenant → DB từ chối |
| 2 | ENABLE + FORCE RLS + policy; role app không BYPASSRLS; worker set tenant từ job | `packages/db/policies`; `TenantContext` trong `apps/worker`; P16 | Query bằng role ứng dụng không set tenant → báo lỗi (fail-loud), không trả dữ liệu; job thiếu `orgId` → fail |
| 3 | Claim bằng UPDATE có điều kiện + `version` | `ConversationStateService.claim`; P14 | `claim-race.spec`: 50 agent → đúng 1 thắng |
| 4 | Không cache câu có kết quả tool; cache key gồm KB + price version | `packages/ai-core/cache`; P11 | Đổi giá → lần hỏi đầu trả giá mới |
| 5 | Câu có số: sinh xong → guard → gửi; chỉ stream FAQ trên widget | `ResponseGuard`; P11 | Bộ test: 0 số sai lọt ra |
| 6 | Model theo tầng trong config; `embedding_model` + `dimension` theo KB | `model_routes` config; `knowledge_bases`; P11, P12 | Đổi model qua config, test vẫn đạt |
| 7 | Zalo OA đợt 1; khung gửi tin; job làm mới token | `packages/channels/zalo`; `ChannelTokenRefreshJob`; P9 | Token hết hạn giả lập → tự làm mới, không mất tin |
| 8 | SĐT chuẩn +84; gộp chỉ agent thấy; OTP | `IdentityResolutionService`; P8 | Gộp không lộ lịch sử ra widget |
| 9 | FSM đủ trạng thái; ghi `conversation_events`; một module duy nhất | `ConversationStateMachine`; P14 | Transition không hợp lệ → lỗi |
| 10 | `messages` UUIDv7 + partition tháng; xóa tenant soft + job nền | `packages/db` migrations; `TenantPurgeJob`; P8 | Migration tạo partition tự động tháng kế |
| 11 | 2 tuần cổng kiểm thử mỗi đợt | P21 sprint plan | Biên bản cổng |
| 12 | Xác thực SĐT: verified / unverified / sales\_confirmed | `customer_identities.verification`; P8 | Unverified không tự gộp, không liên kết công nợ |
| 13 | Bảng `channel_policies`; `window_state`; khóa ô gửi | `ChannelPolicyService`; P15, Brief UI §4.5 | Hết khung → UI khóa, automation không gửi |
| 14 | Webhook: verify → `inbound_events` → 200 < 100ms; chống trùng; dead-letter | `WebhookIngressController`; P9 | Chaos: restart lúc 50 tin/s → 0 mất |
| 15 | Hàng đợi theo workspace | `QueueRouter`; P16 | Dồn 300 hội thoại B2C, B2B FRT < 1 phút P90 |
| 16 | `conversation_state` + 6–8 lượt gần nhất; prompt tĩnh ở đầu | `ContextBuilder`; P11 | Hội thoại 100 tin vẫn nêu đúng giá lượt đầu |
| 17 | Số liệu tải | P5, P20 load test | Báo cáo load test |
| 18 | Kế hoạch rút lui: xuất dữ liệu ≤ 10 ngày | `TenantExportJob`; P19 | Diễn tập xuất 1 tenant |
| 19 | Ẩn danh dữ liệu test | `evals/` pipeline ẩn danh; P20 | Quét PII trên dataset trước khi vào repo vendor |
| 20 | RLS org + workspace cho bảng nhạy cảm | `packages/db/policies`; P8, P16 | `workspace-isolation.spec` |
| 21 | Outbox pattern | `outbox_events` + `OutboxRelayWorker`; P9 | Kill queue sau commit → sự kiện vẫn đi |
| 22 | RPO ≤ 1h, RTO ≤ 4h, diễn tập quý | Terraform DB module (PITR); P5, P19 | Biên bản restore |
| 23 | Link tải ký theo user + file + 15 phút | `FileAccessService`; P8, P16 | User khác dùng link → 403 |
| 24 | SCA, secret scan, OWASP API Top 10; rolling + feature flag | CI pipeline; P5, P17 | CI đỏ → không deploy |
| 25 | Nút tắt từng rule; prompt có version; tham số model trong config; ngưỡng chậm theo tác vụ | `AutomationRule.enabled`; `prompt_versions`; `model_routes`; P11, P15 | Tắt rule không cần deploy |
| 26 | 1 lần số sai lọt khách → tự hạ autonomy | `AutonomyGuard` + `workspace_autonomy`; P10, P19 | Giả lập mismatch → workspace về "AI gợi ý" |
| 27 | Định nghĩa KPI AI (tự giải quyết 72h; chạy song song ≥ 300 hoặc 4 tuần) | `analytics` module; P19 | So số dashboard với truy vấn tay |
| 28 | Công bố AI; cờ "chỉ người phục vụ"; không fine-tune | Prompt + `customers.human_only`; P11 | Khách có cờ → bot không xử lý |
| 29 | AI nội bộ đợt 1 không gửi khách | Feature flag `ai.customer_reply=false` ở đợt 1; P11 | Không có đường code gửi AI ra kênh khi flag tắt |

## P4 — Quyết định đã chốt (không bàn lại)

| Quyết định | Nguồn |
| --- | --- |
| Stack: Next.js + TS + Tailwind + shadcn/ui · NestJS · PostgreSQL 16 + pgvector (managed, PITR) · Redis + BullMQ · Socket.IO + Redis adapter · S3-compatible · Docker + Terraform · Sentry + Grafana/Prometheus · AI Gateway tự host | Bản chốt v1.1 §1; Prompt 1 v3 |
| Tự xây trên khung Convexa đã sửa; Chatwoot chỉ tham khảo | Bản chốt v1.1 §1 |
| Tenant 2 tầng Organization → Workspace; khách hàng thuộc Organization; không gộp khách giữa công ty | Bản chốt §1; Đề xuất 5 công ty |
| RLS theo `org_id` mọi bảng nghiệp vụ; theo `org_id` + `workspace_id` cho: `conversations`, `messages`, `documents`, `document_chunks`, `orders`, `order_items`, `quotes`, `tickets` | v2.1 §2; v2.3 §20 |
| Khóa ngoại kép `(org_id, id)` | v2.1 §1 |
| Outbox pattern cho mọi sự kiện nghiệp vụ | v2.3 §21 |
| FSM hội thoại: `BOT_ACTIVE`, `HUMAN_WAITING_Q`, `HUMAN_ACTIVE`, `PENDING_CUSTOMER`, `CLOSED` (+ cờ `after_hours_hold`) | v2.1 §9; Phản biện Convexa |
| Webhook vào bền (`inbound_events`) + dead-letter; chống trùng theo `(channel_account_id, platform_message_id)` | v2.2 §14 |
| Không cache, không stream câu có số liệu; chỉ stream FAQ trên widget | v2.1 §4–5 |
| Router AI theo tầng nhỏ / vừa / cao; model trong config; model trả lời khách chốt bằng bake-off | v2.1 §6 |
| Cổng pháp lý cứng trước khi bật AI ở production và kích hoạt điều khoản AI trả lời khách của phụ lục Đợt 2 | Bản chốt §1; Quyết định CEO 12/10/2026 |
| Mức tự chủ L0–L5; Đợt 1 = L0 + AI nội bộ | Bản chốt §3; v2.3 §29 |
| Dự án 2 đợt + nhóm Chờ dữ liệu; Webchat ở Đợt 2 (S10); 9 hạng mục tùy chọn chỉ làm khi được kích hoạt | Quyết định CEO 12/10/2026 |
| 1 lần số liệu sai lọt tới khách → tự hạ workspace về "AI gợi ý – người gửi" | v2.3 §26 |
| RPO ≤ 1 giờ, RTO ≤ 4 giờ, diễn tập quý | v2.3 §22 |
| Không dùng Zalo cá nhân (chỉ Zalo OA chính thức) | §16–17 Rủi ro; Adoption |
| Không fine-tune model ở giai đoạn này | v2.3 §28 |
| Modular monolith giai đoạn đầu | §4 System Architecture |
| Hợp đồng khung + phụ lục từng đợt; thanh toán gắn nghiệm thu: Đợt 1 + 3 cổng của Đợt 2 | Hồ sơ mời thầu; Quyết định CEO 12/10/2026 |

## P5 — Deployment Architecture

```text
                 Internet
                    │
            [Load Balancer + TLS]  ── CDN (widget bundle, static admin)
                    │
       ┌────────────┴─────────────┐
   [apps/api] ×N (HTTP + Socket.IO)      [apps/admin] Next.js (SSR)
       │   │            │
       │   │      [Redis 7] ── Socket.IO adapter · BullMQ queues · cache
       │   │            │
       │  [apps/worker] ×N ── outbox relay · inbound processor · automation
       │        │             · kb-index · webhook-out · schedulers · eval-batch
       │        │
   [PostgreSQL 16 + pgvector, managed, PITR] ── read replica (đợt 2+)
       │
   [S3-compatible bucket]  /{org_id}/{workspace_id}/...
       │
   [AI Gateway (LiteLLM-compatible)] ──► provider APIs (theo config)

   Observability: Sentry · Prometheus/Grafana · OpenTelemetry collector · log tập trung
```

### Số máy tối thiểu

| Thành phần | Đợt 1 | Đợt 2 | Đợt 2 · cổng 3 (B2C) |
| --- | --- | --- | --- |
| App (api + worker + ai-gateway container) | 1 VM 4 vCPU/8GB | 2 VM 4 vCPU/8GB sau LB (tách api / worker) | 2–3 VM, worker scale theo hàng đợi |
| PostgreSQL managed | 2 vCPU/4GB, 50GB | 4 vCPU/8GB, 100GB + read replica | Như đợt 2 |
| Redis | 1GB | HA | HA |
| Staging | 1 VM 2 vCPU/4GB + DB nhỏ | Như đợt 1 | Như đợt 1 |

### Môi trường

- `dev` (máy dev + docker compose), `staging` (dữ liệu **ẩn danh** hoặc seed), `production`.
- Không copy dữ liệu production xuống staging khi chưa chạy pipeline ẩn danh (v2.2 §19).

### Deploy & migration

- **Rolling update + feature flag**; không downtime. Feature mới mặc định tắt ở production.
- **Migration forward-only**; mỗi migration có kế hoạch rollback bằng migration bù. Thay đổi phá vỡ theo mẫu expand → migrate → contract qua ≥ 2 release.
- Migration nặng (backfill, index lớn) chạy bằng job nền, `CREATE INDEX CONCURRENTLY`; không khóa bảng `messages`.

### Secrets

- Secret manager của cloud được chọn; app đọc lúc khởi động. Token kênh mã hóa envelope (khóa trong KMS/secret manager).
- Không `.env` trong Git; `.env.example` chỉ có tên biến.

> **CẦN QUYẾT ĐỊNH:** nhà cung cấp cloud/vùng (phụ thuộc cổng pháp lý về lưu trữ dữ liệu) — quyết định secret manager, KMS, managed PG có PITR. Xem P22-Q2.

### Terraform modules

| Module | Quản lý |
| --- | --- |
| `network` | VPC/subnet, security group, LB |
| `compute` | VM/instance group cho api, worker, ai-gateway |
| `database` | PostgreSQL managed, PITR, replica, extension `vector`, `pg_trgm`, `unaccent` |
| `cache` | Redis (AOF bật) |
| `storage` | Bucket, lifecycle, CORS cho upload widget |
| `dns_tls` | Domain, chứng chỉ |
| `secrets` | Secret manager, KMS key |
| `monitoring` | Alert rule, dashboard, uptime check |

## P6 — Cấu trúc repository & quy ước

**Chốt: monorepo (pnpm workspaces + Turborepo), trunk-based.** Lý do: một ngôn ngữ (TypeScript), type và Zod schema dùng chung giữa api/worker/admin/widget, một CI, vendor thay thế tiếp quản một repo duy nhất.

```text
apps/
  api/            NestJS: HTTP + Socket.IO gateway (modules/ theo domain)
  worker/         NestJS standalone: queue processors, outbox relay, schedulers
  admin/          Next.js: Admin + Agent Inbox
  widget/         Preact: loader + bundle (Shadow DOM)
packages/
  domain/         types, Zod schemas, event contracts, error codes
  db/             schema, migrations, RLS policies, seed (không dữ liệu thật)
  ai-core/        task router, prompt registry, context builder, guard, PII masking
  channels/       connector SDK + zalo/, facebook/, webchat/
  ui/             component dùng chung (trên shadcn/ui)
  testing/        testcontainers, tenant/workspace isolation harness, factories
  config/         eslint, tsconfig, prettier
prompts/          prompt theo template + version (Markdown + front-matter)
evals/            runner Test Specification (dataset KHÔNG nằm trong repo vendor)
infra/            terraform/, docker/, ai-gateway/ (config gateway)
docs/             adr/, runbooks/, openapi/, events/
```

Module domain trong `apps/api/src/modules/`: `tenancy`, `identity`, `channels`, `conversations`, `inbox`, `bot`, `ai`, `knowledge`, `crm`, `leads`, `quotes`, `orders`, `payments`, `tickets`, `automation`, `campaigns`, `analytics`, `platform-admin`, `audit`, `files`, `webhooks-out`, `public-api`.

### Quy ước tên

| Đối tượng | Quy ước | Ví dụ |
| --- | --- | --- |
| File | kebab-case | `conversation-state.service.ts` |
| Class | PascalCase + hậu tố vai trò | `ConversationStateService`, `ZaloWebhookController` |
| Bảng/cột DB | snake\_case số nhiều | `conversation_events.occurred_at` |
| Migration | `YYYYMMDDHHmm_<verb>_<object>` | `202611160900_create_conversations` |
| Event | `<aggregate>.<past_tense>` | `conversation.state_changed`, `order.confirmed` |
| Queue | `q.<domain>.<purpose>[.ws.<workspaceId>]` | `q.conversations.process.ws.<id>`, `q.webhooks.out` |
| Cache key | `org:{orgId}:ws:{wsId}:<name>` | `org:…:ws:…:faq:<hash>:kb<v>` |
| Feature flag | `<area>.<feature>` | `ai.customer_reply`, `channel.webchat` |

### Git, PR, phiên bản

- **Conventional Commits** (`feat(inbox): …`, `fix(db): …`). Trunk-based: nhánh ngắn ≤ 2 ngày, merge vào `main` sau khi CI xanh; tính năng dở dang nằm sau feature flag.
- **PR ≤ 400 dòng thay đổi** (không tính file sinh tự động). 1 reviewer; PR chạm `packages/db`, `packages/ai-core`, policy RLS, auth → bắt buộc thêm Tech Lead duyệt (CODEOWNERS).
- Checklist PR: test pass · isolation test pass · không secret/PII trong log · migration có rollback path · cập nhật OpenAPI/event schema nếu đổi contract.
- **Phiên bản:** API `/v1`; event `version` trong envelope; prompt `prompts/<template>/<task>@<semver>`; bot flow `bot_flow_versions.version` (bất biến sau khi publish).

## P7 — Module map theo đợt

**Đường găng (★) chạy qua 13 → 06 → 07 → 01 (đợt 1), rồi 11 → 02 → 12 → 05 (Đợt 2).** Module không ★ có thể chạy song song khi đã có 13.

| # | Module | Mã tính năng (theo đợt) | Phụ thuộc | Được phụ thuộc bởi | ★ | Nhóm | Bàn giao |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 13 | Multi-tenant & Admin | Đợt 1: A1, A2, A3, A4, A5, A6, A7, A8, A9, A13, A17 · Chờ dữ liệu: A10, A11, A18 | — | Tất cả | ★ | BE, DevOps, FE | `tenancy`, `identity`, `platform-admin`, policies, màn Admin |
| 06 | Omnichannel | Đợt 1: B1, B2, B3 · Đợt 2: B4, B5, B6, B7, B11 · Chờ dữ liệu: B8, B18 | 13 | 07, 09 | ★ | BE, DevOps | `packages/channels/*`, webhook ingress, `channel_policies` |
| 07 | Handoff, Inbox & Co-pilot | Đợt 1: C1, C2, C3, C4, C5, C6, C7, C8, C9, C10, C11, C20, D4, L1 · Đợt 2: C12, C13, C18, C22, C24, C26, G8, L2, L3, L4 · Chờ dữ liệu: C17 | 13, 06, 01 | 03, 04, 09, 10 | ★ | BE, FE, AI | `conversations`, `inbox`, Inbox UI, Socket.IO events |
| 01 | AI Brain & Flow | Đợt 1: D1, D2, D3, D6, D15, E1, E4 · Đợt 2: D5, E13, E15, E16 · Chờ dữ liệu: D8, D22 | 13, 07 | 02, 03, 04, 05 | ★ | BE, AI | `bot`, `ai` (router, classifier), flow builder UI |
| 08 | CRM | Đợt 1: J1, J2, J3, J4, J5, J6 · Đợt 2: J7, G7 | 13 | 03, 04, 09 |  | BE, FE | `crm`, identity resolution, màn Khách hàng |
| 03 | AI Sales | Đợt 1: G1, G2, G3 · Đợt 2: H1, H12 | 08, 01 | 05, 10 |  | BE, FE | `leads`, pipeline Kanban |
| 04 | AI Customer Service | Đợt 1: I1, I2, I3 · Đợt 2: H9, H10, H13, H14, I4 · Chờ dữ liệu: I5 | 07, 08 | 10 |  | BE, FE | `tickets`, SLA, đổi trả |
| 14 | AI Evaluation & Security | Đợt 1: P1, P2, P3, P4, P6, P7, P11, E6 (harness) · Đợt 2: P5, E6 (bộ 200 câu), E19, E28 | 13 | Cổng mọi đợt | ★ (cổng) | QA, DevOps, AI | `evals/`, CI security, backup drill |
| 11 | Guardrails & Governance | Đợt 1: E5, E7 (vì AI nội bộ đã gửi dữ liệu cho provider), E20 · Đợt 2: E3, E8, E9, E25 | 13, 01 | 02, 05 | ★ | AI, BE | `ai-core/guard`, PII masking, autonomy |
| 02 | Knowledge Base | Đợt 2: E2, F1, F2, F3, F4, F5, F6, F7, F9, F13 · Chờ dữ liệu: F14 | 13, 11 | 03, 04 | ★ | BE, AI | `knowledge`, pipeline index, màn KB |
| 12 | Tool & Data Integration | Đợt 2: G4, H6, H7, H8, O1, O2, O3 | 13 | 05 | ★ | BE | `quotes` (bảng giá), `payments`, `public-api`, `webhooks-out`, POS adapter |
| 05 | AI Action | Đợt 2: G5, G6, H2, H3, H4, H5, H11 | 12, 11, 01 | 10 | ★ | BE, AI | tool `get_price`, `generate_quote`, `calculate_order`, `create_order` |
| 09 | Automation & Campaign | Đợt 2: K1, K2, K3, K4, N1, N2, N3 · Chờ dữ liệu: K5 | 07, 08, 06 | 10 |  | BE, FE | `automation`, `campaigns`, rule builder |
| 10 | AI Analytics | Đợt 2: M1, M2, M3, M4, M5, M6, M7, M9, M11, M12, M13 · Chờ dữ liệu: M8 | 07, 08, 03, 04, 05 | — |  | BE, FE | `analytics`, dashboard |

**Phạm vi v1.0:** mã theo đợt ở bảng trên khớp file "Phạm vi triển khai — 135 mã" (12/10/2026). Mã bổ sung bắt buộc: Đợt 1 — A13, A17, C20, D15, E20, P7, P11 (D6 đã có trong S4); Đợt 2 — D5, E13, E15, E16, E25, F5, F6, F7, F13. Mã bổ sung ở Đợt 2: B11, C12, C13, C18, C22, C24, C26, E19, E28, F9, M11, M12, M13. 9 hạng mục tùy chọn không nằm trong bảng (xem P22).

> **RỦI RO CAO:** AI nội bộ ở đợt 1 (E1, L1) đã gửi nội dung hội thoại cho provider AI ở nước ngoài. Vì vậy E7 (che PII) và E5 (hạn mức) phải có ngay đợt 1, và ý kiến pháp lý nên có **trước khi bật AI nội bộ ở production**, không chỉ trước đợt 2. Xem P22-Q1.

## P8 — Cấu trúc dữ liệu triển khai

**Cột chuẩn mọi bảng nghiệp vụ:** `id` (UUIDv7), `org_id`, `workspace_id` (nếu thuộc workspace), `created_at`, `updated_at`, `created_by`. Khóa ngoại tới bảng nghiệp vụ khác luôn là cặp `(org_id, <x>_id)` → `UNIQUE(org_id, id)` ở bảng cha (v2.1 §1). ERD chi tiết từng cột là đầu ra thiết kế #5 của vendor.

Ký hiệu RLS: **O** = theo `org_id` · **O+W** = theo `org_id` + `workspace_id` (v2.3 §20) · **—** = không RLS (bảng toàn cục, chỉ đọc hoặc chỉ platform).

Ô trống ở cột `version` / Soft delete / Partition nghĩa là **không áp dụng**, không phải chưa rõ.

| Nhóm migration (đợt) | Bảng | RLS | `version` | Soft delete | Index bắt buộc (ngoài PK) | Partition |
| --- | --- | --- | --- | --- | --- | --- |
| M01 Tenancy & identity (1) | `organizations` | theo `id` |  | ✓ | `(slug)` unique |  |
|  | `users` | — (truy cập qua membership) |  | ✓ | `(email)` unique |  |
|  | `org_members`, `workspaces`, `workspace_members`, `teams`, `team_members` | O |  | ✓ | `(org_id, user_id)`; `(org_id, slug)` |  |
|  | `api_keys` (chỉ lưu hash) | O |  | ✓ | `(key_prefix)` unique |  |
|  | `audit_logs`, `platform_access_logs` | O |  |  | `(org_id, created_at)` | Tháng |
|  | `feature_flags` | Tách 2 bảng: feature\_flags\_global (—) + feature\_flags\_overrides (O, có workspace\_id) |  |  | `(org_id, key)` |  |
| M02 Channels & ingress (1) | `channel_accounts` (token mã hóa envelope) | O |  | ✓ | `(org_id, workspace_id, type)`; `(type, external_account_id)` unique |  |
|  | `channel_policies` | — (platform quản trị) |  |  | `(channel_type, effective_from)` |  |
|  | `inbound_events` | O |  |  | `(channel_account_id, platform_message_id)` unique; `(status, received_at)` | Tháng |
|  | `outbox_events` | O |  |  | `(status, created_at)` | Tháng |
| M03 CRM (1) | `customers` (cờ `human_only`) | O |  | ✓ | `(org_id, phone_e164)`; `(org_id, email)` |  |
|  | `customer_identities` (`verification`: verified · unverified · sales\_confirmed) | O |  |  | `(org_id, identity_type, external_id)` unique |  |
|  | `customer_field_defs`, `customer_field_values`, `consents`, `tags`, `customer_tags` | O |  | ✓ (defs, tags) | `(org_id, customer_id)` |  |
| M04 Conversations (1) | `conversations` (`state`, `window_state`, `after_hours_hold`) | **O+W** | ✓ |  | `(org_id, workspace_id, state, last_message_at DESC)`; `(org_id, assigned_user_id, state)` |  |
|  | `messages` (`sequence_number`, `platform_message_id`, `platform_sent_at`) | **O+W** |  |  | `(org_id, conversation_id, sequence_number)` | Tháng |
|  | `conversation_events`, `conversation_participants`, `conversation_tags` | O |  |  | `(org_id, conversation_id, occurred_at)` | Tháng (events) |
|  | `conversation_ai_state` (collected\_fields, quotes đã báo, cam kết) | O | ✓ |  | `(org_id, conversation_id)` unique |  |
| M05 Bot (1) | `bot_flows`, `bot_flow_versions` (bất biến sau publish), `bot_nodes`, `bot_edges` | O | ✓ (flows) | ✓ (flows) | `(org_id, workspace_id, status)` |  |
|  | `bot_sessions` | O |  |  | `(org_id, conversation_id)` unique khi active |  |
| M06 Leads & tickets (1) | `pipeline_stages`, `leads`, `lead_events` | O | ✓ (leads) | ✓ (leads) | `(org_id, workspace_id, stage, score DESC)` |  |
|  | `tickets`, `ticket_events`, `sla_policies` | **O+W** (tickets) | ✓ |  | `(org_id, workspace_id, status, due_at)` |  |
| M07 AI & files (1) | `model_routes`, `prompt_versions` | Tách 2 bảng: model\_routes\_global / prompt\_versions\_global (—) + model\_routes\_overrides / prompt\_overrides (O, có workspace\_id) | ✓ |  | `(task, tier, active)` |  |
|  | `ai_usage_logs` (token, model, chi phí theo đơn giá provider) | O |  |  | `(org_id, workspace_id, created_at)` | Tháng |
|  | `workspace_autonomy` (mức L0–L5, lý do, người đổi) | O | ✓ |  | `(org_id, workspace_id)` unique |  |
|  | `eval_runs`, `eval_results` | O |  |  | `(org_id, workspace_id, run_at)` |  |
|  | `files` (path, owner, sha256, scan\_status) | O |  | ✓ | `(org_id, workspace_id, created_at)` |  |
| M08 Knowledge (Đợt 2) | `knowledge_bases` (`embedding_model`, `dimension`) | O | ✓ | ✓ | `(org_id, workspace_id)` |  |
|  | `documents`, `document_versions` (`effective_from/to`, `approved_by`) | **O+W** (documents) | ✓ | ✓ | `(org_id, workspace_id, status)` |  |
|  | `document_chunks` (`embedding`, `content_tsv`, `content_unaccent`) | **O+W** |  |  | HNSW trên `embedding`; GIN `content_tsv`; GIN trigram |  |
|  | `abbreviations` (từ điển viết tắt ngành) | O |  |  | `(org_id, workspace_id, term)` unique |  |
| M09 Bảng giá B2B (Đợt 2) | `products`, `price_tiers` (`status`: draft · approved, `approved_by` ≠ `created_by`), `delivery_zones` | O | ✓ | ✓ | `(org_id, product_id, valid_from)` |  |
|  | `quotes`, `quote_items` (bản chụp giá) | **O+W** (quotes) | ✓ |  | `(org_id, workspace_id, status)` |  |
| M10 Automation (Đợt 2) | `automation_rules` (`enabled`), `automation_runs`, `automation_run_steps`, `tasks`, `notifications` | O | ✓ (rules) | ✓ (rules) | `(org_id, trigger_type, enabled)` | Tháng (runs) |
| M11 B2C (Đợt 2 · cổng 3) | `catalog_items`, `promotions`, `delivery_slots`, `carts`, `cart_items` | O | ✓ | ✓ (catalog) | `(org_id, workspace_id, active)` |  |
|  | `orders`, `order_items` (bản chụp giá + khuyến mãi lúc xác nhận), `order_events` | **O+W** (orders, items) | ✓ |  | `(org_id, workspace_id, status, created_at)` |  |
|  | `payments` (`payment_ref`, kết quả đối soát), `pos_sync_jobs` | O |  |  | `(payment_ref)` unique |  |
| M12 Mở rộng (Đợt 2 · cổng 3) | `campaigns`, `campaign_audiences`, `campaign_messages`, `webhook_endpoints`, `webhook_deliveries`, `usage_monthly` | O | ✓ (campaigns) | ✓ | `(org_id, status, scheduled_at)` | Tháng (deliveries) |

> **BẮT BUỘC:** bảng mới nào cũng phải có `org_id`, policy RLS và nằm trong `tenant-isolation.spec` — CI chặn merge nếu thiếu (lint migration kiểm `ENABLE ROW LEVEL SECURITY` + `FORCE`).

### Chính sách khác

- **UUIDv7:** sinh ở app (`packages/domain/id`); migration có hàm dự phòng cho default. Không dùng UUIDv4 cho bảng mới.
- **File:** đường dẫn `/{org_id}/{workspace_id}/{yyyy}/{mm}/{file_id}`. Không phát link bucket trực tiếp: client gọi `GET /v1/files/{id}/download` → `FileAccessService` kiểm quyền user + org/workspace → redirect tới presigned URL 60 giây. Link chia sẻ nội bộ hết hạn 15 phút (v2.3 §23). File upload qua quét virus (`scan_status`) trước khi dùng.
- **PII:** token kênh và trường `custom_fields` đánh dấu `sensitive` mã hóa ở mức cột (envelope). Trước khi gửi provider AI, che: SĐT, email, địa chỉ chi tiết, mã số thuế, số tài khoản, số giấy tờ → placeholder `[PHONE_1]`, `[TAX_ID_1]`; ánh xạ ngược chỉ trong phiên.
- **Xóa tenant:** soft delete `organizations.deleted_at` → `TenantPurgeJob` xóa theo lô, có báo cáo.
- **Seed dev:** 2 org giả ("Demo Foods" có workspace B2B + B2C; "Demo Accounting" mẫu Service), sản phẩm/khách giả sinh bởi factory. **Không dùng dữ liệu thật** ở dev/staging.

* **Partition theo tháng** (`messages`, `conversation_events`, `audit_logs`, `ai_usage_logs`, `inbound_events`, `outbox_events`, `automation_runs`, `webhook_deliveries`): dùng `pg_partman` nếu nhà cung cấp DB managed hỗ trợ; nếu không, job `PartitionMaintenanceJob` tạo trước 3 tháng, chạy hằng ngày, lỗi → cảnh báo DevOps (P19).
* **Bảng cấu hình 2 lớp:** đọc bản ghi `*_overrides` theo workspace trước, không có thì dùng `*_global`.

- **Bổ sung:** thêm bảng `bot_session_steps` (O; `session_id`, `step_index`, `node_type`, `payload`, `occurred_at`; partition tháng) thay cho mảng trace không giới hạn; `bot_sessions` chỉ giữ 20 bước gần nhất để debug nhanh. Thêm cột `agent_settings.max_concurrent_conversations` (O) và `workspaces.default_max_concurrent` (mặc định 5).

## P9 — API contract

**REST `/v1` + Socket.IO + webhook. OpenAPI đầy đủ là đầu ra thiết kế #6; bảng dưới là tập endpoint tối thiểu và quy ước bắt buộc.**

### Quy ước chung

- **Tenant:** `orgId` và danh sách `workspaceIds` lấy từ session (Admin/Agent), từ API key (Public API), từ `channel_account_id` (webhook) hoặc từ widget token (Widget). **Không bao giờ** đọc từ body/query.
- **Truy cập chéo tenant trả 404**, không trả 403, để không lộ sự tồn tại của tài nguyên.
- **Phân trang cursor:** `?cursor=<opaque>&limit=50` (max 100); trả `{ data, nextCursor }`. Không dùng offset.
- **Lỗi RFC 9457** (`application/problem+json`): `type`, `title`, `status`, `detail`, `traceId`, `code`.
- **Idempotency-Key** bắt buộc cho mọi POST tạo dữ liệu từ client; server lưu 24 giờ; gửi lại trả kết quả cũ.
- **Ghi audit** cho mọi thao tác ở cột "Audit" = ✓.

| Mã lỗi (`code`) | HTTP | Khi nào | Frontend nên làm gì |
| --- | --- | --- | --- |
| `validation_failed` | 400 | Zod schema không khớp | Hiện lỗi theo từng trường |
| `unauthorized` | 401 | Chưa đăng nhập, phiên hết hạn, API key sai | Chuyển về đăng nhập, giữ lại bản nháp tin nhắn |
| `forbidden` | 403 | Sai quyền trong cùng tenant | Ẩn nút, báo "Không có quyền" |
| `not_found` | 404 | Không có hoặc khác tenant | Báo không tìm thấy, quay lại danh sách |
| `version_conflict` | 409 | Optimistic lock | Tải lại dữ liệu, cho người dùng xem thay đổi rồi thử lại |
| `conversation_already_claimed` | 409 | Người khác đã nhận | Báo tên người đã nhận, bỏ khỏi danh sách chờ |
| `duplicate_resource` | 409 | Trùng dữ liệu (vd. gộp khách trùng SĐT) | Hiện bản ghi trùng, đề nghị gộp |
| `payload_too_large` | 413 | File vượt giới hạn | Báo giới hạn kích thước |
| `channel_window_closed` | 422 | Hết khung gửi tin của kênh | Khóa ô gửi, hiện ZNS / gọi điện / tạo task |
| `autonomy_restricted` | 422 | Hành động vượt mức tự chủ của workspace | Báo cần người duyệt |
| `rate_limited` | 429 | Vượt giới hạn | Đợi theo `Retry-After`, tự thử lại |
| `internal_error` | 500 | Lỗi không mong đợi | Báo lỗi chung kèm `traceId`, không tự thử lại thao tác ghi |
| `channel_unavailable` | 502 | Zalo/Facebook/kênh lỗi | Báo kênh đang lỗi; tin được giữ để gửi lại |
| `ai_budget_exceeded` | 503 | Hết hạn mức AI; hệ thống tự về flow kịch bản | Ẩn gợi ý AI, báo quản lý |
| `maintenance` | 503 | Đang bảo trì có lịch | Hiện thông báo bảo trì và thời gian dự kiến |

### Endpoint tối thiểu

| Bề mặt | Method + path | Auth | Rate limit | Idempotent | Audit | Đợt |
| --- | --- | --- | --- | --- | --- | --- |
| Admin | `GET/POST /v1/workspaces`, `POST /v1/members/invite`, `PATCH /v1/members/{id}/role` | Session · Owner/Admin | 60/phút | POST ✓ | ✓ | 1 |
| Agent | `GET /v1/conversations`, `GET /v1/conversations/{id}/messages` | Session | 600/phút tổng mỗi org | — |  | 1 |
| Agent | `POST /v1/conversations/{id}/messages` (kiểm `window_state`) | Session | 120/phút/user | ✓ |  | 1 |
| Agent | `POST /v1/conversations/{id}/claim` · `/transfer` · `/close` · `/notes` | Session | 120/phút/user | ✓ | ✓ (transfer) | 1 |
| Agent | `GET/PATCH /v1/customers/{id}` · `POST /v1/customers/merge` · `POST /v1/customers/import` · `GET /v1/customers/export` (job nền) | Session | 60/phút | ✓ | ✓ (merge, export) | 1 |
| Agent | `GET /v1/leads` · `PATCH /v1/leads/{id}/stage` · `GET/POST/PATCH /v1/tickets` | Session | 300/phút | ✓ |  | 1 |
| Admin | `GET/POST /v1/bot-flows` · `POST /v1/bot-flows/{id}/versions` (publish) · `POST /v1/bot-flows/{id}/dry-run` | Session · Admin/Manager | 60/phút | ✓ | ✓ (publish) | 1 |
| Agent | `POST /v1/conversations/{id}/summary` · `POST /v1/conversations/{id}/suggestions` | Session | 60/phút/user | ✓ |  | 1 (summary) · 2 |
| Admin | `PATCH /v1/workspaces/{id}/autonomy` | Session · Owner | 10/phút | ✓ | ✓ | 1 |
| Platform | `GET /v1/platform/tenants/health` · `POST /v1/platform/access-sessions` (bắt buộc `reason`) | Session · platform\_operator | 30/phút | ✓ | ✓ | 1 |
| Files | `POST /v1/files` (khởi tạo upload) · `GET /v1/files/{id}/download` | Session hoặc widget token | 60/phút | ✓ |  | 1 |
| Admin | `POST /v1/knowledge-bases/{id}/documents` · `POST /v1/documents/{id}/reindex` · `DELETE /v1/documents/{id}` | Session · Admin | 30/phút | ✓ | ✓ | 2 |
| Admin | `GET/POST /v1/price-tiers` · `POST /v1/price-tiers/{id}/approve` (người duyệt ≠ người tạo) · `POST /v1/quotes/{id}/approve-send` | Session | 60/phút | ✓ | ✓ | 2 |
| Admin | `CRUD /v1/automation-rules` · `POST /{id}/toggle` · `POST /{id}/dry-run` | Session · Admin/Manager | 60/phút | ✓ | ✓ (toggle) | 2 |
| Widget | `POST /v1/widget/sessions` · `POST /v1/widget/messages` · `GET /v1/widget/messages` | Widget key + visitor JWT ngắn hạn; domain allowlist | 30 tin/phút mỗi phiên khách; 300 tin/phút mỗi IP (chỉ chống spam, vì nhà mạng dùng chung IP — CGNAT) | ✓ |  | 2 (S10) |
| Webhook vào | `POST /v1/hooks/zalo/{channelAccountId}` · `GET/POST /v1/hooks/facebook/{channelAccountId}` · `POST /v1/hooks/payments/{provider}` | Chữ ký nền tảng | Theo nền tảng | Theo `(channel_account_id, platform_message_id)` |  | 1 (Zalo) · 2 (Facebook) · 2 cổng 3 (thanh toán) |
| Public API | `POST /v1/public/leads` · `GET /v1/public/orders/{id}` | API key (hash, scope) | 120/phút/key | ✓ | ✓ | 2 cổng 3 |

### Endpoint bổ sung v1.0 (phục vụ Brief UI)

Danh sách tối thiểu để Brief UI chạy được; tên và schema chi tiết chốt trong OpenAPI (đầu ra thiết kế #6). Quy ước chung ở trên áp dụng đầy đủ.

| Bề mặt | Method + path | Quyền | Audit | Đợt |
| --- | --- | --- | --- | --- |
| Agent | `GET /v1/customers` (cursor; lọc tag, kênh, người phụ trách; tìm tên/SĐT) | Session | | 1 |
| Agent | `GET /v1/customers/{id}/merge-suggestions` · `POST /v1/customers/{id}/unmerge` | Session · unmerge: Owner/Admin | ✓ (unmerge) | 1 |
| Agent | `POST /v1/leads` · `POST /v1/leads/{id}/close` (`won` \| `lost` + `lostReason` bắt buộc khi `lost`) | Session | | 1 |
| Agent | `POST /v1/conversations/{id}/assign` (P14) | Manager/Admin | ✓ | 1 |
| Agent | `GET/PUT /v1/me/drafts/{conversationId}` (bản nháp lưu ở server) | Session | | 1 |
| Admin | `GET /v1/audit-logs` (lọc ngày, người, hành động) · `POST /v1/audit-logs/export` (job nền) | Owner/Admin | ✓ (export) | 1 |
| Admin | `GET/PATCH /v1/feature-flags` (theo workspace) | Owner/Admin | ✓ | 1 |
| Admin | `GET/PATCH /v1/workspaces/{id}/ai-settings` (bật/tắt E1/L1, ngân sách tháng, môi trường `staging` \| `production` — chuyển `production` chỉ Owner) | Owner/Admin | ✓ | 1 |
| Admin | `GET /v1/prompt-versions` (chỉ đọc) | Admin | | 1 |
| Admin | `POST /v1/privacy-requests` · `GET /v1/privacy-requests/{id}` · `POST /v1/privacy-requests/{id}/execute` (`export` \| `rectify` \| `erase` \| `withdraw_consent`) | Owner/Admin | ✓ | 1 |
| Admin | `GET /v1/security-alerts` · `POST /v1/security-incidents` | Owner/Admin/platform\_operator | ✓ | 1 |
| Platform | `GET /v1/channel-policies` (mọi vai trò đọc) · `PUT /v1/channel-policies/{id}` (chỉ platform\_operator, có `effective_from`) | Session | ✓ (PUT) | 1 |
| Widget | `DELETE /v1/widget/sessions/current` (nút "Kết thúc & xóa trên máy này") | Widget token | | 2 (S10) |

**Quy tắc phục vụ giao diện:** thao tác nhận, chuyển, đóng, gộp khách, đổi quyền, xuất bản flow, đổi bước lead trả kết quả cuối cùng (giao diện không cập nhật lạc quan cho các thao tác này). Trạng thái gửi của từng tin phát qua `message.status_changed` (`sent` → `delivered` → `seen` \| `failed`). Mã lỗi đề xuất thêm: `file_scan_pending`, `file_infected` (422); `session_expired` (401, widget). Socket.IO kiểm quyền org/workspace/hội thoại khi client vào room; client không tự vào room theo id.

### Webhook

- **Vào:** verify chữ ký → ghi `inbound_events` (payload thô) → trả 200 trong < 100ms → `InboundProcessor` xử lý ở worker. Lỗi > 5 lần → `dead_letter` + cảnh báo + nút xử lý lại (v2.2 §14).
- **Ra:** ký HMAC-SHA256 (header `X-Signature`, `X-Timestamp`), retry lũy thừa 5 lần, sau đó dead-letter; nhật ký `webhook_deliveries`; chống SSRF (chặn IP nội bộ, chỉ HTTPS).

### Realtime (Socket.IO)

| Namespace | Room | Event (server → client) |
| --- | --- | --- |
| `/agent` | `org:{id}`, `ws:{id}`, `conv:{id}`, `user:{id}` | `message.created`, `message.status_changed`, `conversation.state_changed`, `conversation.assigned`, `typing`, `agent.presence`, `lead.score_changed`, `ai.suggestion_ready` |
| `/widget` | `visitor:{sessionId}` | `message.created`, `typing`, `conversation.closed` |

Reconnect: client gửi `resume { conversationId, lastSequenceNumber }` → server trả các tin bị lỡ theo `sequence_number`.

### Interface xuyên module (chỉ khai báo kiểu, nằm ở `packages/domain`)

```ts
type UUID = string; // UUIDv7

interface RequestContext {
  orgId: UUID; workspaceIds: UUID[]; userId?: UUID;
  role?: 'owner'|'admin'|'manager'|'sales'|'support'|'marketing'|'viewer'|'platform_operator';
  traceId: string;
}

interface DomainEvent<TType extends string, TPayload> {
  id: UUID; type: TType; version: number; orgId: UUID; workspaceId: UUID | null;
  occurredAt: string; traceId: string;
  actor: { kind: 'customer'|'agent'|'bot'|'system'|'platform_operator'; id?: UUID };
  payload: TPayload;
}

interface NormalizedInboundMessage {
  channelType: 'zalo_oa'|'facebook'|'webchat'; channelAccountId: UUID;
  platformMessageId: string; platformUserId: string; platformSentAt: string;
  kind: 'text'|'image'|'file'|'sticker'|'postback'|'system';
  text?: string; attachments?: { fileId: UUID; mime: string }[];
}

interface OutboundMessageCommand {
  conversationId: UUID; sender: 'agent'|'bot'|'system';
  content: { text?: string; quickReplies?: string[]; cards?: unknown[] };
  idempotencyKey: string; containsFigures: boolean; // true → bắt buộc qua ResponseGuard
}

interface AiTaskRequest {
  task: 'classify'|'answer'|'summarize'|'suggest'|'extract'|'judge';
  tier?: 'small'|'medium'|'high'; orgId: UUID; workspaceId: UUID;
  promptRef: string; // "b2b/answer@1.2.0"
  context: { maskedMessages: unknown[]; state?: unknown; retrieved?: unknown[] };
  tools?: string[]; batch?: boolean;
}

interface ToolResult { tool: string; ok: boolean; data?: unknown; figures: string[]; sourceVersion?: string }
```

> **CẦN QUYẾT ĐỊNH:** schema `cards` theo từng kênh (Zalo, Facebook, webchat có định dạng khác nhau) — vendor đề xuất trong đầu ra thiết kế #6; mặc định dùng `unknown[]` cho tới khi duyệt.

## P10 — Luồng nghiệp vụ triển khai

**Mọi luồng bắt đầu từ `inbound_events`, đi qua `ConversationStateMachine`, và phát sự kiện qua outbox.** Tên dưới đây là tên class/method dự kiến; vendor có thể đổi tên nhưng không đổi thứ tự trách nhiệm.

### F1 — B2B Hybrid (Gani, đợt 1 → 2)

1. `ZaloWebhookController.receive` → `SignatureVerifier.verify` → `InboundEventRepo.insertIfAbsent(channelAccountId, platformMessageId)` → trả 200.
2. `InboundProcessor.handle` (queue `q.conversations.process.ws.{id}`) → `ZaloAdapter.normalize` → chuẩn hóa Unicode NFC → `IdentityResolutionService.resolve` (UID theo OA; SĐT chỉ gộp khi `verified`) → `ConversationService.appendCustomerMessage` (gán `sequence_number`, sắp theo `platform_sent_at` khi về trễ).
3. `ConversationStateMachine.onCustomerMessage`: nếu trạng thái là **`HUMAN_ACTIVE` hoặc `PENDING_CUSTOMER`** → chỉ phát `message.created` (bot im lặng; `PENDING_CUSTOMER` chuyển về `HUMAN_ACTIVE`) và dừng.
4. `AiRouter.run({task:'classify'})` → lưu intent/entities vào `conversation_ai_state`; `TagService.autoTag`.
5. `BotRuntime.step` (flow kịch bản thu 5 trường). **Đợt 2:** nếu flow trao quyền → `AnswerOrchestrator.answer` → tool `get_price` / `get_product_info` → model trả lời có ô giữ chỗ → `ResponseGuard.check` → điền số thật → `OutboundService.send`.
6. `LeadService.upsertFromConversation` → `LeadScoringService.apply` (đợt 2) → outbox `lead.created` / `lead.score_changed`.
7. Điều kiện chuyển người (điểm ≥ ngưỡng, khách yêu cầu, tool lỗi) → `ConversationStateMachine.requestHuman` → `RoutingService.enqueue` → `AiRouter.run({task:'summarize'})` → `HandoffCardRepo.save` → `message.created` + `conversation.state_changed` tới Inbox.

### F2 — B2C Order (Lộc Thủy, Đợt 2 · cổng 3)

`AnswerOrchestrator` gọi lần lượt: `search_catalog` → `add_to_cart` → `get_delivery_slots(address)` → `calculate_order` (server tính tổng, khuyến mãi, ship; lưu bản chụp) → gửi tóm tắt → **chờ khách xác nhận rõ** (`ConfirmationDetector` + nút) → `OrderService.create` (Idempotency-Key = cartId + version) → `PaymentService.createQr(orderId)` hoặc COD → `PaymentWebhookController` → `ReconciliationService.match(payment_ref)` → outbox `payment.reconciled` → `PosSyncWorker.push` (retry + dead-letter). Bot chỉ báo "đã nhận tiền" sau `payment.reconciled`.

### F3 — Service (The Smile, đợt 1 → 2)

`IdentityResolutionService.resolve` (khách hiện hữu theo SĐT đã đăng ký) → `TicketService.createFromConversation(type)` → `RoutingService.assignOwner` (chuyên viên phụ trách) → `SlaService.schedule(dueAt)` → `SlaBreachJob` cảnh báo → (đợt 2) `ReminderRule` gửi nhắc hạn qua automation, kiểm `window_state`.

### F4 — Automation (đợt 2)

Outbox event → `AutomationDispatcher.match(orgId, triggerType)` → `ConditionEvaluator.evaluate(jsonCondition, eventContext)` → `ActionWorker.execute` (idempotent theo `ruleId + eventId`) → `automation_run_steps` → retry/dead-letter. Hành động gửi tin luôn qua `ChannelPolicyService.canSend`.

### F5 — AI Co-pilot (đợt 1 tóm tắt · đợt 2 gợi ý)

`message.created` khi `HUMAN_ACTIVE` → `CopilotWorker` → `AiRouter.run({task:'suggest', tier:'small'})` → phát `ai.suggestion_ready` (chỉ agent thấy) → agent **chấp nhận / sửa / bỏ** → `CopilotFeedbackRepo.log` (dùng cải tiến prompt). Đề xuất cập nhật CRM → `CrmSuggestion` chờ agent duyệt, không ghi trực tiếp.

### F6 — Ngoài giờ

`BusinessHoursService.isOpen(workspace)` = false khi cần người → đặt `after_hours_hold = true`, bot gửi tin hẹn giờ theo template, `TaskService.create(dueAt = mở cửa)`; khi mở cửa `AfterHoursReleaseJob` đưa hội thoại vào `HUMAN_WAITING_Q`.

### F7 — Bot sai số liệu (đợt 2+)

`ResponseGuard.check` phát hiện con số không khớp `ToolResult.figures` → chặn gửi, chuyển người. Nếu phát hiện **sau khi đã gửi** (khách phản ánh, Sales gắn cờ `number_error`) → `AutonomyGuard.downgrade(workspaceId, to='suggest_only')` → outbox `workspace.autonomy_downgraded` → thông báo CEO + cố vấn → runbook sự cố #1.

## P11 — AI Gateway & Model Router

**Service nghiệp vụ không bao giờ gọi provider trực tiếp:** chỉ gọi `AiRouter` (trong `packages/ai-core`), `AiRouter` gọi AI Gateway tự host, Gateway gọi provider theo config.

```text
module nghiệp vụ ─► AiRouter ─► ContextBuilder ─► PiiMasker ─► BudgetGuard ─► AI Gateway ─► provider
                         ◄── ResponseGuard ◄── ToolExecutor (server) ◄── tool calls ◄──┘
```

| Task | Tầng mặc định | Đợt | Ghi chú |
| --- | --- | --- | --- |
| `classify` (intent + entities, JSON schema) | small | 1 | Mọi tin khách |
| `summarize` (thẻ chuyển người) | small → medium nếu dài | 1 | Chỉ nội bộ |
| `suggest` (gợi ý trả lời cho agent) | small | 2 | Chỉ nội bộ |
| `extract` (đề xuất cập nhật CRM) | small | 2 | Agent duyệt |
| `answer` (RAG + tool, trả lời khách) | medium; ca khó → high | 2 | Chỉ khi `ai.customer_reply = true` |
| `judge` (chấm bộ test) | small, Batch | 1–2 | Hiệu chỉnh với người ≥ 90% |

- **Model:** bảng `model_routes_global` + `model_routes_overrides` (`task, tier, provider, model, params, fallback_model, slow_threshold_ms, active`); tên model **chỉ** nằm ở đây. Model trả lời khách chốt bằng bake-off (P20), trong đó có ít nhất 1 nhà cung cấp trong nước làm phương án dự phòng pháp lý. Mặc định khởi điểm theo hồ sơ: small = GPT-5.6 Luna, medium = Claude Haiku 4.5, high = Claude Sonnet 5.5 — **chờ bake-off xác nhận**.
- **Prompt caching (cache theo từng workspace):** thứ tự cố định — phần chung toàn nền tảng (quy tắc, định dạng) → phần tĩnh của workspace (vai trò, `{{tenant_name}}`, chính sách) → định nghĩa tool → `conversation_state` JSON → 6–8 lượt gần nhất → đoạn RAG. Tỉ lệ trúng cache thực tế phải đo, không giả định.
- **ResponseGuard — số liệu qua ô giữ chỗ (BẮT BUỘC):** câu trả lời có số nghiệp vụ thì model chỉ viết ô giữ chỗ trỏ tới `ToolResult` (`{{price_1}}`, `{{moq_1}}`, `{{delivery_slot_1}}`); hệ thống tự điền số thật. Mọi con số nghiệp vụ viết tự do (không qua ô) → chặn, chuyển người, log `ai.number_mismatch`. Chi tiết ở bảng dưới.
- **Cache & stream:** cache chỉ cho FAQ tĩnh, key = `org:ws:faq:<hash>:kb<v>:price<v>`; câu có tool result không cache. Stream chỉ ở widget và chỉ khi `containsFigures = false`.
- **PII masking:** `PiiMasker` thay họ tên người, ngày sinh, SĐT, email, địa chỉ chi tiết, mã số thuế, số tài khoản, số CCCD/giấy tờ bằng placeholder (`[NAME_1]`, `[PHONE_1]`…) trước khi gửi; giải mã ngược sau guard để bot vẫn xưng hô đúng. **Không** che tên quán/doanh nghiệp (cần cho báo giá B2B). Bật từ đợt 1.
- **Prompt injection:** tin khách và đoạn RAG luôn bọc trong khối dữ liệu có nhãn; tool kiểm quyền và tham số ở server (vd. `create_order` tự tính lại giá, bỏ qua giá model truyền vào); model không có tool giảm giá/hoàn tiền.
- **Ngưỡng chậm (v2.3 §25):** classify > 2s, answer FAQ > 6s, summarize nền > 20s → `fallback_model` khác hãng.
- **Ngân sách:** `ai_usage_logs` ghi token + USD theo org/workspace/task; `BudgetGuard` cảnh báo 80%, chặn ở 100% (về flow kịch bản, trả `ai_budget_exceeded`). Mức ngân sách do chủ đầu tư cấu hình theo workspace.
- **Batch:** bộ test và chấm điểm chạy qua Batch API (−50%).

### P11.1 — Đặc tả ResponseGuard

| Loại con số | Ví dụ | Xử lý |
| --- | --- | --- |
| **Phải qua ô giữ chỗ** — tiền | "85.000đ/kg", "85k", "tám lăm nghìn", "1,2 triệu" | Chỉ từ `get_price`, `calculate_order`, `get_service_price` |
| **Phải qua ô giữ chỗ** — khối lượng, số lượng nghiệp vụ | MOQ "50 kg", "1 tạ", "nửa ký", "2 tấn" | Chỉ từ `get_product_info`, `get_price` |
| **Phải qua ô giữ chỗ** — tỉ lệ | "giảm 10%", "VAT 8%" | Chỉ từ tool khuyến mãi/thuế |
| **Phải qua ô giữ chỗ** — cam kết thời gian | "giao trong 1 giờ", "3 ngày nữa có hàng", "hạn dùng 6 tháng", "giá áp dụng từ 01/03" | Chỉ từ `get_delivery_slots`, `get_product_info`, `valid_from` |
| Miễn kiểm — số đếm hội thoại | "em gửi anh 2 mẫu ảnh", "có 3 lựa chọn" | Cho phép |
| Miễn kiểm — số thuộc mã/định danh | "mã BV-500", số nhà trong địa chỉ khách đã gửi | Cho phép nếu khớp dữ liệu đầu vào |
| Không chắc chắn | Câu có số + đơn vị lạ | Chặn, chuyển người, ghi vào hàng chờ rà soát |

**Bộ chuẩn hóa tiếng Việt** nhận diện: k / nghìn / ngàn / tr / triệu / đ / đồng / VND · g / gram / ký / kg / tạ / tấn · % / phần trăm · số viết bằng chữ · ngày/tháng/giờ. **Test bắt buộc:** 30 câu chứa số tự nhiên và số nghiệp vụ trộn lẫn, đạt 100% phân loại đúng trước S9.

**Ví dụ file prompt** (`prompts/b2b/answer@1.0.0.md`, chỉ minh họa cấu trúc):

```markdown
---
task: answer
template: b2b_sales
version: 1.0.0
tier: medium
requires_tools: [get_price, get_product_info, create_or_update_lead, handoff_to_agent]
figure_policy: placeholder_only
---
# PLATFORM RULES   (chung toàn nền tảng — đặt đầu để trúng cache)
# WORKSPACE BLOCK  (vai trò, {{tenant_name}}, chính sách — tĩnh theo workspace)
# OUTPUT CONTRACT  (số nghiệp vụ chỉ viết {{price_n}}, {{moq_n}}, {{delivery_slot_n}})
```

#### Quy định bổ sung cho ResponseGuard và AI

- **Vi phạm ô giữ chỗ:** thử lại **1 lần** với chỉ dẫn chặt hơn (nêu rõ con số vi phạm); vẫn vi phạm → không gửi, chuyển người, log `ai.number_mismatch`. Tổng thời gian kể cả lần thử lại vẫn tuân ngưỡng chậm của tác vụ.
- **Quy tắc ranh giới:** mọi **lời hứa với khách** (giá, lượng, thời gian, hạn, tiến độ đơn) phải đến từ tool hoặc biến cấu hình (vd. `{{agent_eta}}`, `{{business_hours}}`). Model **bị cấm tự hứa thời gian** ("em kiểm tra trong 2 phút" → "em kiểm tra ngay"). Số đếm chỉ được miễn kiểm khi kiểm chứng được tự động (vd. "2 ảnh" khớp số file đính kèm).
- **Bộ phát hiện chỉ cần phát hiện, không cần hiểu giá trị:** vì mọi số nghiệp vụ viết tự do đều bị chặn, không cần xử lý dấu phẩy/dấu chấm. Mẫu phát hiện thêm: `K`/`k`, `vạn`, đơn vị dính liền ("85.000đ/kg", "85,000 VND/kg"), số viết bằng chữ (cả cách nói rút gọn "tám lăm nghìn").
- **Cảnh báo vận hành:** > 10% câu trả lời bị chặn trong tuần đầu → AI Engineer + cố vấn rà prompt.
- **`figure_policy` (front-matter prompt) có 4 giá trị:** `placeholder_only` (trả lời khách) · `source_only` (thẻ tóm tắt — số "đã báo giá" lấy từ `conversation_ai_state`, không lấy từ chữ model viết) · `free` (phân loại, trích xuất) · `none` (tác vụ không sinh chữ cho người đọc).
- **Ngân sách AI:** tính theo **tháng, theo workspace** (khớp `usage_monthly`); thêm cảnh báo bất thường khi 24 giờ gần nhất vượt 3 lần mức trung bình ngày.
- **Model chấm (`judge`):** bắt đầu tầng small; nếu đồng thuận với người chấm < 90% → nâng lên tầng medium. Con số luôn được chấm bằng luật cố định, không qua model.

## P12 — RAG & Knowledge Base

**Pipeline:** `upload` → `FileScan` → `TextExtractor` (PDF, DOCX, TXT, URL) → `Cleaner` (bỏ header/footer lặp, chuẩn hóa Unicode NFC) → `Chunker` → `Embedder` (batch, giới hạn tốc độ) → upsert `document_chunks` → cập nhật `document_versions.status = ready`.

| Hạng mục | Quy định |
| --- | --- |
| Chunking | Tách theo heading trước; mỗi chunk \~400–600 token theo tokenizer của model embedding (≈ 1.500–2.000 ký tự tiếng Việt, đo lại khi chốt model), overlap \~60; giữ bảng giá/bảng thông số nguyên khối; lưu `heading_path` |
| Hybrid search | Vector (cosine) + từ khóa trên `content_tsv` (config `simple` + `unaccent`) + `pg_trgm` cho lỗi chính tả; mở rộng truy vấn bằng `abbreviations` ("bv" → "bò viên"); trộn điểm (RRF); lấy 5–8 đoạn |
| pgvector | HNSW (`m=16`, `ef_construction=64` khởi điểm, tinh chỉnh qua bake-off); bật iterative index scan; **luôn lọc `org_id` + `workspace_id`** |
| Embedding | `knowledge_bases.embedding_model` + `dimension`; đổi model = tạo cột/bảng mới + re-index nền |
| Citation | Mỗi đoạn mang `docId@version#chunkIndex`; câu trả lời lưu danh sách citation vào `messages.payload.citations` (chỉ nội bộ) |
| Phiên bản | `document_versions.effective_from/to`; chỉ truy xuất bản đang hiệu lực và đã duyệt |
| Re-index | `q.knowledge.index`, chạy nền, không khóa truy vấn; bản cũ phục vụ tới khi bản mới `ready` |
| Xóa | Soft delete tài liệu → job xóa chunk + embedding → audit log |

> **BẮT BUỘC:** giá, MOQ, tồn kho, catalog, đơn **không** nạp vào Knowledge Base — chỉ truy vấn qua tool (Bản chốt §1).

**PDF scan (ảnh):** chạy OCR (dịch vụ OCR hoặc thư viện mã nguồn mở hỗ trợ tiếng Việt) → **người duyệt lại văn bản OCR trước khi đưa vào Knowledge Base**, vì bot sẽ trả lời từ đó (đặc biệt hồ sơ HACCP, chứng từ The Smile). Không OCR được → từ chối, báo admin.

## P13 — Bot Engine (rule-based)

**Flow là dữ liệu có phiên bản, runtime là máy trạng thái chạy trên `bot_sessions`.** `bot_flow_versions` bất biến sau khi publish; hội thoại đang chạy giữ phiên bản cũ tới khi kết thúc.

| Node type | Việc | Biến/điều kiện |
| --- | --- | --- |
| `trigger` | Bắt đầu flow (tin đầu, từ khóa, intent, ngoài giờ) | `intent`, `channel`, `isBusinessHours` |
| `message` | Gửi tin/thẻ/nút | Template có biến `{{customer.name}}` |
| `question` | Hỏi và chờ trả lời, có validate | Kiểu: text, phone (+84), number, choice |
| `condition` | Rẽ nhánh | Biểu thức JSON (cùng ngôn ngữ với automation, P15) |
| `set_variable` / `collect` | Ghi vào `bot_sessions.vars` và `conversation_ai_state.collected_fields` | Trường bắt buộc theo mẫu workspace |
| `tag` | Gắn tag khách/hội thoại |  |
| `api_call` | Gọi tool nội bộ đã đăng ký (không URL tự do) | Timeout 5s, retry 1 |
| `delay` | Chờ (chỉ trong khung kênh) |  |
| `handoff` | Gọi `ConversationStateMachine.requestHuman` | Lý do, mức ưu tiên |
| `ai_answer` (đợt 2) | Trao lượt cho `AnswerOrchestrator` | Chỉ khi `ai.customer_reply = true` và autonomy ≥ L1 |
| `end` | Kết thúc phiên |  |

- **Thứ tự ưu tiên:** (1) khiếu nại/an toàn thực phẩm/khách đòi gặp người → handoff ngay; (2) flow kịch bản đang dở → flow thắng; (3) node `ai_answer` hoặc không có flow khớp → AI (đợt 2); (4) AI không đủ dữ liệu → handoff.
- **Dry-run:** `POST /v1/bot-flows/{id}/dry-run` chạy kịch bản mẫu, không gửi kênh; so sánh 2 phiên bản bằng kết quả chạy cùng bộ kịch bản (không làm diff đồ thị).
- **Log:** mỗi bước ghi `bot_sessions.trace[]` + `conversation_events(type='bot.step')`.

* **Bổ sung:** node `jump_to_flow` (chuyển sang flow khác, giữ biến phiên) thuộc đợt 1; node `wait_for_event` (chờ sự kiện ngoài như thanh toán) **ngoài phạm vi đợt 1**.

- **Bổ sung:** log từng bước ghi vào bảng `bot_session_steps`; `bot_sessions` chỉ giữ 20 bước gần nhất. Node `ai_answer` là **một node duy nhất**, tự đọc mức tự chủ của workspace: L1 → chỉ trả lời từ Knowledge Base; L2+ → được gọi tool. Người dựng flow không phải chọn mức.

## P14 — Human Handoff, Inbox & Co-pilot

| Từ trạng thái | Sự kiện | Sang trạng thái | Ghi chú |
| --- | --- | --- | --- |
| (mới) | Tin đầu của khách | `BOT_ACTIVE` |  |
| `BOT_ACTIVE` | Cần người, trong giờ | `HUMAN_WAITING_Q` | Tạo thẻ tóm tắt |
| `BOT_ACTIVE` | Cần người, ngoài giờ | `BOT_ACTIVE` + `after_hours_hold` | F6 |
| `BOT_ACTIVE` | Bot giải quyết xong | `CLOSED` |  |
| `HUMAN_WAITING_Q` | Agent claim thành công | `HUMAN_ACTIVE` | UPDATE có điều kiện + `version` |
| `HUMAN_WAITING_Q` | Hết giờ làm / quá SLA chờ | `BOT_ACTIVE` + `after_hours_hold` | Bot nhận lời nhắn |
| `HUMAN_ACTIVE` | Agent chờ khách trả lời | `PENDING_CUSTOMER` |  |
| `PENDING_CUSTOMER` | Khách nhắn lại | `HUMAN_ACTIVE` |  |
| `HUMAN_ACTIVE` | Agent trả lại bot | `BOT_ACTIVE` |  |
| `HUMAN_ACTIVE` / `PENDING_CUSTOMER` | Đóng | `CLOSED` | Bắt buộc kết quả hội thoại: `resolved` \| `no_response` \| `spam`. Thắng/Thua thuộc lead (`POST /v1/leads/{id}/close`), đóng hội thoại không đổi trạng thái lead |
| `CLOSED` | Khách nhắn trong 72 giờ | `BOT_ACTIVE` (mở lại cùng hội thoại) | Sau 72 giờ → hội thoại mới |
| HUMAN\_ACTIVE / PENDING\_CUSTOMER | Chuyển cho agent khác | Giữ nguyên trạng thái | Đổi assigned\_user\_id + version; ghi sự kiện agent.transferred (audit) |
| HUMAN\_ACTIVE | Agent offline > 10 phút VÀ khách có tin chưa trả lời, trong giờ làm | HUMAN\_WAITING\_Q | Mất kết nối ngắn không đẩy hội thoại; báo quản lý; ngoài giờ → BOT\_ACTIVE + after\_hours\_hold |
| HUMAN\_ACTIVE | Agent đăng xuất khi đang giữ hội thoại | HUMAN\_WAITING\_Q (trong giờ) / BOT\_ACTIVE + after\_hours\_hold (ngoài giờ) | Không để hội thoại treo không người |
| PENDING\_CUSTOMER | Agent offline / đăng xuất | Giữ nguyên | Khi khách nhắn lại: agent offline → HUMAN\_WAITING\_Q, ngược lại → HUMAN\_ACTIVE |

- **BẮT BUỘC:** chỉ `ConversationStateMachine` được đổi `conversations.state`; mọi transition ghi `conversation_events`; transition không có trong bảng → lỗi.
- **Claim:** `UPDATE conversations SET state='HUMAN_ACTIVE', assigned_user_id=$u, version=version+1 WHERE id=$c AND state='HUMAN_WAITING_Q' RETURNING id` — 0 dòng → 409 `conversation_already_claimed`.
- **Silent Co-pilot:** ở `HUMAN_ACTIVE`/`PENDING_CUSTOMER` không có đường code nào cho bot gửi tin ra kênh.
- **Thẻ tóm tắt:** tạo khi vào `HUMAN_WAITING_Q` (Prompt 4); lưu `conversation_ai_state.handoff_card`; hiển thị cột phải Inbox.
- **Gợi ý trả lời (đợt 2):** agent chấp nhận / sửa / bỏ; log `copilot_feedback` để cải tiến prompt.
- **Phân bổ:** round-robin trong team; theo team (workspace → team mặc định); theo kỹ năng (tag kỹ năng trên agent ↔ intent). Agent offline không nhận.
- **SLA:** `sla_due_at` theo `sla_policies` của workspace; cảnh báo 15 phút chưa phản hồi, báo quản lý ở 30 phút.
- **Realtime:** room `conv:{id}`; reconnect bằng `resume` (P9).

**Bổ sung:**

- **Giới hạn tải agent:** mỗi agent có `max_concurrent_conversations` (mặc định 5, cấu hình theo workspace và theo agent), chỉ đếm hội thoại **`HUMAN_ACTIVE`**; hội thoại `PENDING_CUSTOMER` không tính vào giới hạn mà hiển thị riêng. Vượt giới hạn → không được phân bổ tự động; agent vẫn tự nhận được, kèm cảnh báo.
- **Nhận hội thoại đang giữ ngoài giờ:** điều kiện claim mở rộng thành `state = 'HUMAN_WAITING_Q'` **hoặc** (`state = 'BOT_ACTIVE'` và `after_hours_hold = true`); vẫn là một UPDATE có điều kiện + `version`.
- **Quản lý gán lại:** `POST /v1/conversations/{id}/assign` (Manager/Admin) — gán bất kể ai đang giữ, đổi `assigned_user_id` + `version`, ghi sự kiện `agent.reassigned` + audit log; khác với claim của agent.

## P15 — Automation Engine

**Rule = trigger + conditions + actions (+ branch, delay); chạy bất đồng bộ từ outbox event, không chạy trong request người dùng.**

| Thành phần | Quy định |
| --- | --- |
| Ngôn ngữ điều kiện | JSON (`all`/`any`/`not`; toán tử `eq`, `neq`, `gt`, `gte`, `in`, `contains`, `exists`), validate bằng Zod; ngữ cảnh = `event.payload` + `customer` + `conversation` + `workspace` |
| Action | `assign`, `tag`, `update_field`, `notify`, `create_task`, `send_message`, `call_webhook`, `delay`, `branch` |
| Dispatcher | Idempotent theo `ruleId + eventId`; retry 3 lần cách 1s → 4s → 16s, lệch ngẫu nhiên ±20% → dead-letter |
| Scheduler | Delay/cron theo timezone workspace (`Asia/Ho_Chi_Minh` mặc định) |
| Chống vòng lặp | Event do automation sinh ra mang `causationDepth`; > 10 → dừng; rule không tự kích hoạt chính nó |
| Vận hành | Dry-run bắt buộc trước khi bật; `automation_runs` + `automation_run_steps`; nút tắt tức thì (`enabled=false`, có hiệu lực < 5 giây, không cần deploy) |
| Gửi tin chủ động | Qua `ChannelPolicyService.canSend` (window\_state, loại tin, đồng ý tiếp thị); giới hạn N tin chủ động/khách/ngày theo workspace |

**Ví dụ điều kiện** — "lead score ≥ 70 và ngoài giờ làm việc" (chỉ minh họa cấu trúc):

```json
{
  "trigger": "lead.score_threshold_crossed",
  "conditions": { "all": [
    { "field": "event.payload.score", "op": "gte", "value": 70 },
    { "field": "workspace.isBusinessHours", "op": "eq", "value": false }
  ]},
  "actions": [
    { "type": "tag", "value": "hot-lead" },
    { "type": "create_task", "assignTo": "team:sales", "dueAt": "next_business_open" }
  ]
}
```

**Bổ sung:** automation dùng sự kiện `lead.score_threshold_crossed` (chỉ phát khi điểm vượt qua ngưỡng cấu hình của workspace, theo cả hai chiều); `lead.score_changed` chỉ dùng cho báo cáo, tránh kích hoạt rule liên tục. Khi chạm `causationDepth > 10`: dừng chuỗi, ghi cảnh báo, hiện trên dashboard; admin có nút chạy lại với độ sâu đặt lại sau khi sửa rule.

## P16 — Multi-tenant triển khai

**Ba lớp: middleware → repository → RLS. Lớp RLS là lưới cuối; code không được dựa vào nó để thay hai lớp trên.**

| Hạng mục | Quy định |
| --- | --- |
| Middleware | `TenantContextMiddleware` dựng `RequestContext` từ session/API key/widget token/channel account; lưu AsyncLocalStorage |
| Transaction | Mọi truy vấn chạy trong `TenantTx` mở bằng `SET LOCAL app.current_org = …` và `SET LOCAL app.current_workspaces = '{…}'`; tương thích pooler ở chế độ transaction |
| Role DB | Role ứng dụng không phải owner, không `BYPASSRLS`; migration chạy bằng role riêng |
| RLS mẫu | Bảng **O**: `org_id = current_setting('app.current_org')::uuid`. Bảng **O+W**: thêm `workspace_id = ANY(current_setting('app.current_workspaces')::uuid[])` (ERD/policy chi tiết là đầu ra thiết kế #5) |
| Worker | Job payload bắt buộc `orgId` (+ `workspaceId`); `TenantContext.runForJob` set lại context; thiếu → job fail ngay |
| Test CI | `tenant-isolation.spec` + `workspace-isolation.spec` sinh tự động cho mọi endpoint từ OpenAPI; chạy mỗi PR, đỏ → chặn merge |
| File | `FileAccessService` kiểm org/workspace/user rồi mới ký URL (P8) |
| Vector | Mọi truy vấn `document_chunks` có điều kiện `org_id` + `workspace_id` trong SQL, không chỉ dựa vào RLS |
| Cache | Key luôn bắt đầu `org:{orgId}:ws:{wsId}:` |
| Queue | Hàng đợi hội thoại theo workspace (`q.conversations.process.ws.{id}`), worker có trọng số; không dùng một FIFO chung |
| AI | Hạn mức, Knowledge Base, prompt override theo workspace |
| Platform operator | Xem dữ liệu tenant chỉ qua `access-session` có `reason`, thời hạn 60 phút, ghi `platform_access_logs` |
| Onboarding | `WorkspaceTemplateService.apply(template)` tạo sẵn flow mặc định, trường bắt buộc, pipeline, rule mặc định, dashboard theo mẫu B2B/B2C/Service |

**Ví dụ chính sách RLS cho bảng O+W** (chỉ minh họa; policy đầy đủ là đầu ra thiết kế #5):

```sql
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_ws_isolation ON conversations
  USING (org_id = current_setting('app.current_org')::uuid
         AND workspace_id = ANY (current_setting('app.current_workspaces')::uuid[]))
  WITH CHECK (org_id = current_setting('app.current_org')::uuid
         AND workspace_id = ANY (current_setting('app.current_workspaces')::uuid[]));
```

**Staging giống production:** cùng phiên bản PostgreSQL và extension, cùng vai trò DB (không owner, không BYPASSRLS), cùng bộ cờ tính năng mặc định; chỉ khác dữ liệu (ẩn danh/seed).

**3 role DB:**

| Role | RLS | Khi thiếu tenant | Dùng cho |
| --- | --- | --- | --- |
| `app_role` | Bị lọc, không owner, không BYPASSRLS | **Báo lỗi** (fail-loud) — bắt lỗi quên `TenantTx` ngay khi dev | API, worker, mọi traffic thật |
| `migration_role` | BYPASSRLS | — | Chỉ pipeline migration/backfill; mỗi lần chạy ghi log; **không** dùng chế độ "âm thầm 0 dòng" vì backfill sẽ báo thành công mà không cập nhật gì |
| `support_role` | Bị lọc như `app_role` | Báo lỗi | Debug, hỗ trợ — bắt buộc đặt tenant qua `access-session` có lý do |

## P17 — Checklist bảo mật cho DEV

**Mỗi mục là điều kiện merge hoặc điều kiện go-live; cố vấn tick khi duyệt.**

- [ ] **AuthN:** Argon2id (hoặc bcrypt cost ≥ 12); 2FA bắt buộc Owner/Admin/platform\_operator; session hết hạn 12 giờ; xoay session sau đăng nhập (chống session fixation)
- [ ] **AuthZ:** RBAC 7 vai trò + platform\_operator kiểm ở service; ma trận quyền × endpoint test tự động
- [ ] **API key:** chỉ lưu hash; có scope; xoay vòng được; hiển thị 1 lần
- [ ] **Input:** Zod cho mọi request/event; làm sạch HTML trong tin khách; chặn SSRF ở webhook ra (chỉ HTTPS, chặn IP nội bộ)
- [ ] **Widget:** CSP, allowlist domain theo workspace, escape mọi nội dung khách gửi
- [ ] **Nội dung khách gửi** trả về cho Inbox dạng văn bản thuần; server không sinh HTML từ nội dung khách; không tự tải xem trước link khách gửi (chống SSRF/phishing)
- [ ] **Mã hóa:** TLS 1.2+; mã hóa at-rest DB/backup/bucket; token kênh mã hóa envelope
- [ ] **Secrets:** secret manager; không log; không commit; quét secret pre-commit + CI
- [ ] **Audit:** thao tác admin, đổi quyền, xuất dữ liệu, gộp khách, đổi autonomy, publish flow, duyệt giá
- [ ] **Backup:** PITR bật; RPO ≤ 1 giờ; RTO ≤ 4 giờ; diễn tập quý có biên bản
- [ ] **Dữ liệu cá nhân:** consent theo kênh; quyền xem/xóa; retention theo chính sách; dữ liệu test ẩn danh
- [ ] **CI/CD:** SCA, SAST, quét secret, kiểm theo OWASP API Top 10; đỏ → không deploy
- [ ] **Rate limit:** theo org, theo user, theo IP widget, chặt hơn ở auth/export/merge
- [ ] **AI:** lọc prompt injection; PII masking trước provider; tool kiểm quyền ở server
- [ ] **File:** quét virus trước khi dùng; giới hạn kích thước/kiểu MIME
- [ ] **Logging:** không ghi PII thô (SĐT, email, nội dung tin nhắn) vào log ứng dụng; chỉ `messageId`
- [ ] **Pentest độc lập** trước go-live Đợt 1 và trước cổng 3 Đợt 2

* [ ] **CSRF:** mọi request thay đổi dữ liệu từ admin dùng session cookie phải có CSRF token; cookie `HttpOnly`, `Secure`, `SameSite=Lax`
* [ ] **Tạo lại session** sau đăng nhập, sau đổi vai trò, sau bật/tắt 2FA

## P18 — Ranh giới với Brief UI

**Toàn bộ giao diện (Inbox, Admin, Khách hàng, Widget) giao cho DEV Frontend theo Brief UI v1.0.** Brief này chỉ quy định những gì Backend phải cung cấp để giao diện chạy được.

| Hạng mục | Backend cung cấp | Nằm ở |
| --- | --- | --- |
| Hợp đồng API | OpenAPI đầy đủ, duyệt trước S2; FE làm song song từ S2 dựa trên OpenAPI | P9, đầu ra thiết kế #6 |
| Realtime | Namespace, room, sự kiện, `resume` theo `lastSequenceNumber`; kiểm quyền khi vào room | P9 |
| Mã lỗi | Bảng mã lỗi RFC 9457 | P9 |
| Trạng thái hội thoại | FSM, claim, tải agent, gán lại | P14 |
| Quyền | RBAC 7 vai trò + platform\_operator kiểm ở server theo ma trận quyền Brief UI Phụ lục B | P17 |
| Feature flag, mức tự chủ, chế độ AI tắt | Cờ theo workspace có hiệu lực < 10 giây; trạng thái AI (bật / tắt + lý do) trả qua API để giao diện hiển thị | P11, P16 |
| Widget | Endpoint widget, visitor JWT ngắn hạn, domain allowlist, rate limit | P9 |
| Tiêu chí nghiệm thu giao diện | Brief UI Phần 8 (SUS, Lighthouse, WCAG, phím tắt) | Brief UI |

## P19 — Observability & vận hành

- **Log có cấu trúc (JSON):** bắt buộc `ts`, `level`, `traceId`, `orgId`, `workspaceId`, `conversationId` (nếu có), `module`, `event`. Không PII thô.
- **Metrics:** độ trễ API (P50/P95), tỉ lệ lỗi, độ sâu từng hàng đợi, tuổi job cũ nhất, `inbound_events` dead-letter, thời gian phản hồi đầu tiên theo workspace, độ trễ + chi phí AI theo task/model, số lần guard chặn, kết nối realtime.
- **Tracing:** OpenTelemetry; span cho webhook ingress → processor → AI router → provider → outbound.
- **Dashboard:** (1) vận hành nền tảng, (2) sức khỏe từng tenant (dùng cho bảng điều khiển A7), (3) chi phí AI theo workspace.

| Cảnh báo | Ngưỡng | Kênh | Người nhận |
| --- | --- | --- | --- |
| Dead-letter webhook vào | ≥ 1 trong 5 phút | Chat nội bộ + email | Vendor on-call |
| Hàng đợi workspace B2B/Service tồn | Tuổi job > 60 giây | Chat nội bộ | Vendor on-call |
| Hàng đợi workspace B2C tồn (kể cả khi chạy chiến dịch) | Tuổi job > 180 giây | Chat nội bộ | Vendor on-call |
| Token kênh sắp hết hạn | < 24 giờ | Email | Vendor + quản lý workspace |
| AI guard chặn / mismatch lọt khách | Bất kỳ | Chat nội bộ + email | Cố vấn, CEO (runbook #1) |
| Tỷ lệ lỗi provider AI | > 5% trong 5 phút | Chat nội bộ | Vendor on-call |
| Ngân sách AI | 80% / 100% | Email | Quản lý workspace, CEO |
| Uptime | Check 30 giây/lần; lỗi 2 lần liên tiếp (≤ 60 giây) | SMS/Chat | Vendor on-call |
| Dung lượng đĩa DB/bucket | > 80% | Email | DevOps |
| Độ trễ đồng bộ bản sao DB | > 30 giây | Chat nội bộ | DevOps |
| Cạn kết nối DB | > 85% pool | Chat nội bộ | DevOps |
| Job tạo partition lỗi | Bất kỳ | Email | DevOps |
| Chứng chỉ TLS sắp hết hạn | < 14 ngày | Email | DevOps |

Có **chế độ bảo trì có lịch**: platform\_operator bật qua UI với thời điểm bắt đầu/kết thúc, ghi audit; tạm tắt cảnh báo không trọng yếu, hiện thông báo `maintenance` cho người dùng.

- **Runbook:** 5 sự cố trong hồ sơ gốc, lưu tại `docs/runbooks/` và link từ từng cảnh báo.
- **Hết quota provider AI:** router chuyển `fallback_model` khác hãng; nếu cả hai lỗi → flow kịch bản L0; thông báo trên dashboard; không tự nâng hạn mức.
- **Xuất dữ liệu tenant (rút lui):** `TenantExportJob` CSV/JSON + bản sao lưu + tài liệu schema, ≤ 10 ngày làm việc.

## P20 — Testing

| Loại | Quy định | Khi chạy |
| --- | --- | --- |
| Unit | Độ phủ ≥ 70% cho `packages/*` và module lõi; không viết test chỉ để tăng số dòng | Mỗi PR |
| Integration | Postgres, Redis, queue thật qua testcontainers; RLS bật | Mỗi PR |
| Contract | OpenAPI + schema event (Zod) so với bản đã duyệt | Mỗi PR |
| Isolation | Chéo tenant + chéo workspace, sinh từ OpenAPI | Mỗi PR — **chặn merge** |
| E2E (Playwright) | 5 luồng: B2B hybrid, handoff + claim, Service ticket, B2C đặt hàng (Đợt 2 · cổng 3), automation | Hằng đêm + trước release |
| Load | Số liệu v2.2 §17 (50 tin/s webhook, 300 hội thoại/10 phút/workspace, 30 agent, 500 kết nối) | Trước mỗi cổng đợt |
| Chaos nhẹ | Kill app/worker khi đang nhận 50 tin/s → 0 tin mất; kill queue sau commit → outbox vẫn gửi | Trước mỗi cổng đợt |
| Race | 50 agent claim đồng thời → đúng 1 thắng | Trước cổng đợt 1 |
| AI | Test Specification: 200 câu/workspace, 3 lần/câu, 3 lớp chấm, 20% câu ẩn vendor không xem; chạy qua Batch; thêm 30 câu số tự nhiên cho ResponseGuard (P11.1) | Mỗi lần đổi prompt/model/KB/bảng giá; trước cổng go-live AI |
| Bake-off model | Shortlist do cố vấn kỹ thuật cung cấp; đo tỉ lệ đạt, số sai, độ chính xác tool, độ trễ P90, token tiếng Việt thực tế, chi phí/câu đúng | Tầng nhỏ (phân loại, tóm tắt): S5 · Model trả lời khách (gồm ≥ 1 nhà cung cấp trong nước): S10, sau khi có tool + guard |
| Bảo mật | SAST + DAST cơ bản mỗi release; pentest độc lập trước go-live Đợt 1 và trước cổng 3 Đợt 2 | Theo mốc |
| Khôi phục | Restore từ PITR vào môi trường tạm, đo RTO | Mỗi quý |

Load test, chaos test và race test do QA + DevOps của vendor chạy; **cố vấn kỹ thuật chứng kiến và ký biên bản** ở S6, S13, S18. Pentest do bên thứ ba độc lập thực hiện, hợp đồng ký trước S3.

### Definition of Done (mức PR/tính năng)

- [ ] Unit + integration test pass; isolation test (tenant + workspace) pass
- [ ] Test theo cả 3 mẫu B2B/B2C/Service nếu chạm module dùng chung
- [ ] OpenAPI/event schema cập nhật; không `any` trong lõi; không PII trong log
- [ ] Log đủ để audit (ai, khi nào, tenant nào, làm gì)
- [ ] Tài liệu vận hành cập nhật (`docs/`)
- [ ] Demo trên staging; không làm chậm module đang chạy (P95 không tăng quá 10% so với baseline ở đường nóng)

## P21 — Kế hoạch thực thi theo mốc (sprint 2 tuần)

**Khoảng 21 sprint (\~44 tuần) tính từ S1, neo theo cổng.** Ngày dưới đây là dự kiến nếu S1 bắt đầu 16/11/2026; trượt cổng → toàn bộ phía sau dời tương ứng.

**Cấu trúc đợt:** dự án gồm 2 đợt. Đợt 2 = S8 → cổng cuối, gồm cả phần B2C, nghiệm thu và thanh toán theo 3 cổng: Cổng 1 (S10), Cổng 2 (S13), Cổng 3 (cuối đợt). Phạm vi v1.0 có thêm 16 mã bắt buộc và 13 mã bổ sung so với bản trước → giữ mốc 15/02/2027; Cổng 3 dự kiến khoảng giữa 09/2027. **Vendor xác nhận khối lượng và ngày khi báo giá theo mã.**

> **Giả định đội vendor** (xác nhận khi ký hợp đồng): 1 PM, 1 Tech Lead, 3 BE, 2 FE, 1 AI Engineer, 0,5 DevOps, 2 QA.

> **RỦI RO CAO — Tết Nguyên đán 2027:** mùng 1 Tết là thứ Bảy 06/02/2027; lịch nghỉ đã chốt từ thứ Năm 04/02 đến hết thứ Tư 10/02/2027. Brief coi **04/02 – 14/02/2027** là thời gian không làm việc (gồm tuần lấy lại nhịp). S6 rút còn 25/01 – 03/02 chỉ để kiểm thử và lập biên bản cổng; **không go-live trước 15/02/2027**.

| Sprint (bắt đầu) | Mốc | Deliverable chính | Nhóm | Đóng mốc khi | Rủi ro trượt → phương án |
| --- | --- | --- | --- | --- | --- |
| S1 (16/11/2026) | M1.1 Nền móng | Monorepo, CI (SCA, secret scan), Terraform staging, `tenancy`, `identity`, RLS 3 role + isolation harness | Tech Lead, BE, DevOps | Isolation test chạy trong CI; staging lên | Chờ chọn cloud → staging tạm, Terraform tách module |
| S2 (30/11) | M1.2 Lõi hội thoại | `conversations`, FSM (đủ transition P14), outbox, ingress chung, Socket.IO khung | BE | Transition test pass; outbox kill-test pass | FSM hiểu sai → review FSM với cố vấn đầu sprint |
| S3 (14/12) | M1.3 Zalo OA | Connector, `channel_policies`, làm mới token, Inbox UI cơ bản; **ký hợp đồng pentest** | BE, FE | Tin thật từ OA test vào/ra; khóa ô gửi khi hết khung | OA chưa có gói API → dùng OA test, chặn cổng |
| S4 (28/12) | M1.4 Bot + handoff | Bot engine (+ `jump_to_flow`), dry-run, claim, giới hạn tải agent, routing, CRM + identity, leads, tickets | BE, FE | Race test 50 agent pass; **chốt bản build cho pentest** | Phạm vi bot phình → chỉ node type ở P13 |
| S5 (11/01/2027) | M1.5 AI nội bộ + admin | Classifier, tóm tắt, PII masking, ngân sách, platform admin, onboarding template, eval harness; **bake-off tầng nhỏ**; **pentest vòng 1 (05/01 – 16/01)** trên bản build S4 | AI, BE, FE + bên pentest | Không có đường code gửi AI ra khách; masking test pass | Pháp lý chưa xong → AI nội bộ chỉ chạy staging (phương án B, P22) |
| S6 (25/01 – 03/02) | M1.6 Cổng đợt 1 | Sửa lỗi pentest + **kiểm tra lại**, load, chaos, UAT, tài liệu vận hành, đào tạo key user, kiểm thử dễ dùng (Brief UI Phần 8) | QA, DevOps, tất cả | Biên bản cổng đợt 1 | Lỗi nghiêm trọng → sửa trong S7, dời go-live |
| Tết (04/02 – 14/02) | — | Không làm việc; chỉ trực sự cố staging nếu cần | — | — | — |
| S7 (15/02) | Go-live đợt 1 | Go-live Gani, The Smile (+ công ty 3–5 ở L0), hỗ trợ sát 2 tuần, xác minh Meta | Tất cả | Go-live ổn định | Pháp lý chưa xong → **vẫn ký phụ lục Đợt 2 cho phần không dùng AI; điều khoản AI trả lời khách chưa kích hoạt** |
| S8 (01/03) | M2.1 Knowledge Base | Pipeline nạp + OCR, chunking, hybrid search, duyệt + phiên bản + hạn tài liệu (F5–F7); FE widget bắt đầu song song; Brief UI phần Đợt 2 chi tiết được duyệt; `abbreviations` | BE, AI | Truy xuất đúng trên bộ câu mẫu | Chất lượng tiếng Việt kém → tinh chỉnh chunk/từ điển |
| S9 (15/03) | M2.2 Tool + Guard | Bảng giá duyệt 2 người, `get_price`, `AnswerOrchestrator`, `ResponseGuard` + ô giữ chỗ + thử lại 1 lần + bộ phát hiện số tiếng Việt | BE, AI | 0 số sai; 30 câu số tự nhiên phân loại đúng 100% | — |
| S10 (29/03) | Cổng 1 Đợt 2 — Kênh + báo giá + chọn model | Facebook connector, Webchat go-live (CEO chốt 12/10), báo giá PDF, lead scoring; **bake-off model trả lời khách** (gồm nhà cung cấp trong nước) | BE, FE, AI | Tin Facebook và Webchat vào/ra; widget đạt Brief UI §3.9; PDF đúng 20/20; chọn xong model trả lời khách | Meta duyệt chậm → Facebook dời sang S12 |
| S11 (12/04) | M2.4 Automation + co-pilot | Automation engine, rule mặc định, gợi ý trả lời, analytics | BE, FE, AI | Dry-run + nút tắt hoạt động | — |
| S12 (26/04) | M2.5 Bộ test AI | Chạy Test Specification với model đã chọn, sửa lỗi, bắt đầu chạy song song | AI, QA | ≥ 95%, 0 số sai trên staging | Không đạt → lặp S12 |
| S13 (10/05) | Cổng 2 Đợt 2 — go-live AI | Chạy song song ≥ 300 hội thoại/workspace hoặc 4 tuần | QA, Ops | Biên bản cổng go-live AI | Lưu lượng thấp → kéo dài theo mẫu, không theo lịch |
| S14 (24/05) | M2.7 Catalog B2C | Catalog, khuyến mãi, vùng/khung giao, giỏ hàng | BE, FE | Tính tiền đúng 20/20 ca | — |
| S15 (07/06) | M2.8 Đơn + thanh toán | Đơn, COD/QR, đối soát | BE | Đối soát QR đúng 100% ca thử | Chưa chọn dịch vụ đối soát → chặn |
| S16 (21/06) | M2.9 POS + campaign | Đồng bộ POS, campaign, thao tác hàng loạt + tìm toàn văn Inbox, báo cáo định kỳ | BE, FE | Đơn sang POS, retry/dead-letter hoạt động | Chưa biết POS → chặn |
| S17 (05/07) | M2.10 Mở rộng | Public API, webhook ra, tra vận chuyển, đổi trả | BE | Contract test pass | — |
| S18 (19/07) | M2.11 Kiểm thử B2C + go-live mềm | Load, pentest, **go-live mềm với nhóm khách thử** của Lộc Thủy | QA, DevOps | Không lỗi mức 1 trên nhóm thử | Lỗi nghiêm trọng → dừng go-live mềm, sửa trước S19 |
| S19 (02/08/2027) → cổng cuối, khoảng giữa 09/2027 | Cổng 3 Đợt 2 (cổng cuối) | Go-live chính thức Lộc Thủy + công ty B2C + 1 tuần hỗ trợ sát | Tất cả | Biên bản cổng 3 Đợt 2 | Trượt → cắt theo thứ tự: mã bổ sung ở Đợt 2 trước, không cắt mã bắt buộc; chủ đầu tư duyệt |

### Đường găng

`tenancy + RLS` (S1) → `conversations + FSM + outbox` (S2) → `Zalo connector` (S3) → `bot + claim + handoff` (S4) → `AI nội bộ + masking` (S5) → **cổng đợt 1** (S6) → **cổng pháp lý (hạn 14/12/2026)** (S7) → `KB` (S8) → `tool + guard` (S9) → bake-off model trả lời khách (S10) → `bộ test AI` (S12) → **chạy song song** (S13) → `đơn + đối soát` (S15) → `POS` (S16) → **cổng 3 Đợt 2** (S19 → khoảng giữa 09/2027).

### Chạy song song được

- FE admin/Inbox chạy cùng BE từ S2 (dựa trên OpenAPI đã duyệt).
- Eval harness (S5) và bộ test 200 câu (phía chủ đầu tư) chạy độc lập với BE.
- Facebook connector chỉ phụ thuộc xác minh Meta; Webchat không phụ thuộc bên ngoài → FE widget làm từ S8, go-live S10.
- Observability, dashboard, runbook chạy song song mọi sprint.

### Điểm nghẽn nhân lực

| Thiếu | Ảnh hưởng ước tính | Đề xuất |
| --- | --- | --- |
| 1 BE | Đường găng chủ yếu là BE → mỗi đợt trượt \~3–4 tuần | Vendor cam kết người thay trong 10 ngày làm việc |
| AI Engineer | Đợt 1 trượt \~2 tuần; đợt 2 trượt 4–6 tuần (một điểm lỗi duy nhất) | Yêu cầu AI Engineer dự phòng có tên trong hợp đồng |
| Tech Lead | Rủi ro sai kiến trúc lan rộng | Không chấp nhận thay Tech Lead khi chưa có đồng ý của chủ đầu tư |

## P22 — Câu hỏi cho chủ đầu tư / cố vấn + Rủi ro triển khai

### Quyết định CEO 12/10/2026

| # | Quyết định | Ảnh hưởng trong Brief |
| --- | --- | --- |
| QĐ1 | Webchat (B5, B6) thuộc Đợt 2, go-live S10 (29/03/2027) | P2, P7, P21; đóng câu hỏi Webchat |
| QĐ2 | Thực hiện qua vendor, đội 10,5 người theo P21; giao diện giao DEV Frontend theo Brief UI | P18, P21 |
| QĐ3 | Dự án 2 đợt + nhóm Chờ dữ liệu; Đợt 2 gồm cả phần B2C, nghiệm thu và thanh toán theo 3 cổng | P2, P21 |
| QĐ4 | Phạm vi 135 mã (Đợt 1 = 58, Đợt 2 = 77) theo file "Phạm vi triển khai — 135 mã" (12/10/2026); 12 mã chờ dữ liệu | P7 |
| QĐ5 | 9 hạng mục tùy chọn trong hợp đồng: B16, D19, E14, E21, E26, H22, J11, L7, O7 — vendor báo giá và khóa giá, chỉ làm khi có văn bản luật sư hoặc quyết định CEO | Hợp đồng |
| QĐ6 | Phụ lục Đợt 2 tách điều khoản AI trả lời khách thành điều khoản kích hoạt khi có văn bản luật sư; phần còn lại ký ngay sau go-live Đợt 1 | P2 (cổng pháp lý), P21 (S7) |

Giao diện chi tiết theo Brief UI v1.0; khi Brief UI và brief này mâu thuẫn về API, FSM, quyền → brief này thắng.

### Câu hỏi chặn code (9 câu)

| # | Câu hỏi | Mặc định brief đề xuất | Người trả lời | Hạn | Chặn |
| --- | --- | --- | --- | --- | --- |
| Q1 | Ý kiến pháp lý: được gửi nội dung hội thoại (đã che PII) cho provider AI ở nước ngoài không? | Chưa có — không bật AI nội bộ ở production khi chưa có văn bản; xem phương án B bên dưới | CEO + luật sư | **Trước S3 (14/12/2026)** — để kịp chuẩn bị phương án B | Bật AI nội bộ ở production (đợt 1) và ký phụ lục đợt 2 |
| Q2 | Nhà cung cấp cloud và vùng đặt hạ tầng | Chờ Q1 phần lưu trữ dữ liệu | CEO + cố vấn | Trước S1 | Terraform, secret manager, managed PG |
| Q3 | Pháp nhân sở hữu nền tảng; repo + cloud đứng tên ai | — | CEO | Trước S1 | Tạo repo, tài khoản cloud |
| Q4 | ORM | **Drizzle** — SQL tường minh, dễ kiểm soát transaction `SET LOCAL` và policy RLS | Cố vấn | Trước S1 | `packages/db` |
| Q5 | Thư viện xác thực | **Better Auth** — có sẵn tổ chức, 2FA | Cố vấn | Trước S1 | `identity` |
| Q6 | Zalo OA của Gani và The Smile đã xác thực, đúng gói có API, cấp quyền cho vendor? | — | CEO | Trước S3 (14/12/2026) | Connector Zalo |
| Q7 | Giờ làm việc, team, số agent của từng workspace đợt 1 | — | CEO + quản lý workspace | Trước S4 (28/12/2026) | Routing, SLA, ngoài giờ, agent offline |
| Q8 | Danh mục loại ticket + SLA của The Smile | — | The Smile | Trước S4 | Mẫu Service |
| Q9 | Xác nhận trường bắt buộc, pipeline, ngưỡng điểm lead của Gani B2B | 5 trường, pipeline 6 bước, ngưỡng 70 (theo hồ sơ) | CEO | Trước S4 | Mẫu B2B, flow mặc định |

### Phương án B — nếu kết luận pháp lý không thuận

| Kết luận pháp lý | Phản ứng kỹ thuật | Ảnh hưởng tiến độ |
| --- | --- | --- |
| Được gửi ra nước ngoài, kèm che dữ liệu cá nhân + hồ sơ chuyển dữ liệu | Giữ nguyên brief | 0 |
| Được gửi nhưng có điều kiện (hợp đồng riêng, chỉ dữ liệu ẩn danh, hoặc xử lý trong nước cho một phần dữ liệu) | Phân loại dữ liệu: phần nhạy cảm (đặc biệt The Smile) chạy bằng nhà cung cấp trong nước hoặc model nhỏ tự host; phần còn lại giữ nguyên. Router đã tách provider nên chỉ đổi config + chạy lại bộ test | +2–4 tuần |
| Không được gửi ra nước ngoài | Đợt 1 tắt AI nội bộ (tag bằng luật, không tóm tắt), code giữ sau cờ `ai.internal`. Đợt 2 chỉ đi tiếp nếu nhà cung cấp trong nước vượt bộ test 200 câu (trong bake-off S10) | Đợt 1 không đổi; đợt 2 trễ 1–3 tháng |

Code AI ở S5 vẫn viết và test được ở staging với dữ liệu giả trong mọi kịch bản; chỉ việc **bật ở production** phụ thuộc Q1.

### Câu hỏi không chặn

| Câu hỏi | Mặc định | Cần trước |
| --- | --- | --- |
| Webchat đợt 2 hay 3? — ĐÃ CHỐT 12/10/2026 | Đợt 2, go-live S10 (29/03/2027) | S8 |
| Danh tính và mẫu của công ty 3–5 | — | S5 (onboarding L0) |
| Hội thoại đã đóng được mở lại trong bao lâu? | 72 giờ (khớp định nghĩa KPI) | S6 |
| Ngưỡng agent offline trước khi đưa hội thoại về hàng chờ | 10 phút | S4 |
| Ngôn ngữ ngoài tiếng Việt (tiếng Anh, tiếng Khmer) cần từ đợt nào? | Chỉ tiếng Việt ở Đợt 1–2; cấu trúc đa ngôn ngữ đã sẵn; E21 là hạng mục tùy chọn | S8 |
| Schema thẻ sản phẩm/nút theo từng kênh | Vendor đề xuất trong thiết kế #6 | S3 |
| Ngưỡng `hot_lead_kg` theo workspace | — | S10 |
| Mẫu ZNS và nhà cung cấp gửi ZNS | — | S11 |
| Phần mềm bán hàng/kho của Lộc Thủy | — | S14 |
| Dịch vụ đối soát chuyển khoản | — | S14 |
| Ngưỡng xử lý đơn sai giá | Không có mặc định — code để cấu hình; go-live B2C bị chặn đến khi CEO chốt (hồ sơ đề xuất 10%) | S15 |

### Rủi ro triển khai (giai đoạn code)

| Rủi ro | Biện pháp kiểm soát | Người theo dõi |
| --- | --- | --- |
| Hiểu sai FSM, đổi `state` ngoài `ConversationStateMachine` | Lint cấm ghi trực tiếp cột `state`; test transition; review FSM đầu S2 | Tech Lead |
| Quên RLS cho bảng mới | Lint migration + isolation test sinh tự động; CI chặn merge | Tech Lead + cố vấn |
| RLS làm chậm truy vấn | Index bắt đầu bằng `org_id`; đo P95 trước/sau mỗi migration | BE |
| Prompt trôi, sửa prompt không có version | Prompt chỉ đọc từ `prompts/` + `prompt_versions`; đổi prompt phải chạy bộ test | AI Engineer |
| Lạm dụng `any`, kiểu lỏng | `noImplicitAny`, cấm `any` bằng lint ở `packages/*` và module lõi | Tech Lead |
| Migration khóa bảng lớn (`messages`) | Expand → migrate → contract; `CONCURRENTLY`; chạy ngoài giờ cao điểm | BE + DevOps |
| Socket.IO nhiều instance mất sự kiện | Redis adapter; sticky session ở LB hoặc chỉ dùng transport WebSocket; test 500 kết nối | DevOps |
| Lệch múi giờ (UTC vs Asia/Ho\_Chi\_Minh) | Lưu UTC; chuyển đổi theo timezone workspace ở tầng hiển thị/scheduler | BE |
| Tiếng Việt lệch chuẩn Unicode (NFC/NFD) làm hỏng tìm kiếm và so khớp | Chuẩn hóa NFC tại ingress và trước khi index | BE + AI |
| Mock/seed lẫn vào production | Seed chỉ chạy ở `dev`/`staging`; kiểm tra môi trường trong script | DevOps |
| Nợ feature flag | Mỗi flag có chủ sở hữu và ngày gỡ; rà mỗi cổng đợt | PM |
| Staging khác production (phiên bản DB, vai trò RLS, cờ tính năng) → lỗi chỉ lộ ra khi go-live | Terraform dùng chung module cho staging và production; kiểm tra tự động phiên bản DB, extension, vai trò DB, cờ mặc định trước mỗi cổng | DevOps |
| ResponseGuard phân loại sai số tự nhiên và số nghiệp vụ → hoặc chặn quá tay, hoặc lọt số sai | Số nghiệp vụ chỉ qua ô giữ chỗ (P11.1); 30 câu test số tự nhiên trước S9; theo dõi tỷ lệ chặn hằng tuần | AI Engineer + QA |

### Đề xuất cân nhắc (ngoài phạm vi chính)

1. Đã chốt 12/10/2026: Webchat lên Đợt 2 — cả 5 công ty dùng, không phụ thuộc bên ngoài; FE widget làm song song từ S8 để không dồn vào S10.
2. Nếu nhà cung cấp managed hỗ trợ PostgreSQL bản mới hơn 16 với pgvector đầy đủ, cố vấn có thể cân nhắc — chỉ khi không làm thay đổi kiến trúc đã chốt.

### Tự kiểm theo tiêu chí nghiệm thu brief

| Tiêu chí | Trạng thái |
| --- | --- |
| Cố vấn không phải hỏi lại quyết định đã chốt | P4 liệt kê đủ; mâu thuẫn → hồ sơ gốc thắng |
| Mỗi nhóm tìm phần của mình ≤ 5 phút | BE: P8–P10, P13–P16 · FE: Brief UI · AI: P11–P12 · DevOps: P5, P19 · QA: P20 · Security: P17 |
| Mọi mục Phụ lục 1–29 được ánh xạ | P3.2 — không ngoại lệ |
| Mọi mã trong phạm vi xuất hiện | P7 (liệt kê từng mã) |
| Câu hỏi chặn code ≤ 10, có hạn và người trả lời | 9 câu |
| Không câu nào buộc DEV đoán | Chỗ chưa chốt đều có mặc định + người duyệt |

### Bộ đặc tả chi tiết (tài liệu riêng, viết theo mốc)

Brief giữ vai trò định hướng; đặc tả chi tiết viết thành tài liệu riêng khi mốc tương ứng đến gần, có người chịu trách nhiệm.

| Đặc tả | Người viết | Người duyệt | Hạn |
| --- | --- | --- | --- |
| RLS + 3 role DB + policy từng bảng | Tech Lead | Cố vấn | Trước S1 |
| Máy trạng thái hội thoại + tải agent + gán lại | Tech Lead | Cố vấn | Trước S2 |
| Connector Zalo OA + chính sách kênh | Backend lead | Tech Lead | Trước S3 |
| ResponseGuard (sơ đồ quyết định, 30 câu ví dụ, mẫu phát hiện số) | AI Engineer + QA | Cố vấn | Trước S9 |
| Đặt hàng B2C + đối soát + đồng bộ POS | Backend lead | Cố vấn | Trước S14 |

### Điều kiện bắt đầu code

S1 bắt đầu khi cố vấn kỹ thuật và CEO ký bảng dưới; các điều kiện phải đạt đúng hạn, nếu trễ thì mốc phụ thuộc bị chặn.

- [ ] Q2–Q5 (cloud, pháp nhân, ORM, thư viện xác thực) trả lời — **trước S1**
- [ ] Đặc tả RLS + 3 role DB được duyệt — **trước S1**
- [ ] Đặc tả máy trạng thái + tải agent được duyệt; OpenAPI v1 duyệt để FE bắt đầu — **trước S2**
- [ ] Wireframe 4 màn Đợt 1 (Brief UI Phụ lục C) được duyệt — **trước S2 (30/11/2026)**
- [ ] Q1 (pháp lý) có văn bản; Q6 (Zalo OA) xong; hợp đồng pentest đã ký — **trước S3 (14/12/2026)**
- [ ] Q7–Q9 trả lời — **trước S4 (28/12/2026)**
- [ ] Đặc tả ResponseGuard được duyệt — **trước S9**

| Người duyệt | Kết quả | Ngày |
| --- | --- | --- |
| Cố vấn kỹ thuật | Duyệt có điều kiện / Không duyệt |  |
| CEO | Duyệt có điều kiện / Không duyệt |  |

> **Bắt đầu code từ S1 (16/11/2026)** khi các điều kiện "trước S1" đạt và 2 người duyệt đã ký.
