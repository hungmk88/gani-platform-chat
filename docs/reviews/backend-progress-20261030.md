# Tiến độ Backend Đợt 1, có căn cứ (30/10/2026)

Người soạn: nhóm Backend · `main` lúc đo: `b1c5a03` · Chỉ tính phần Backend. Không có số liệu FE, pháp lý, staging nên **không có % cho cả
dự án**. Mọi căn cứ đối chiếu file trên `main`, không dựa vào tóm tắt session.

## 1. Scope Đợt 1: mẫu số

Repo có **hai** tài liệu định nghĩa phạm vi Đợt 1. Không có bảng nào cân theo khối lượng công việc, nên mọi % dưới đây là **đếm hạng mục**,
không phải giờ công.

| Mẫu số | Nguồn | Số hạng mục | Backend đạt |
|---|---|---|---|
| **A. Tính năng Đợt 1** | `docs/danh-sach-109-tinh-nang.md`, cột "Đợt (Brief v0.4)" = 1, kể cả "1 (chỉ nội bộ)" và "1 (công cụ chạy test)" | **50** | **17/50 = 34 %** |
| **B. Deliverable sprint S1–S5** | `docs/brief-backend-core-v1.0.md` dòng 905–909 (bảng sprint) | **29** | **≈ 15/29 ≈ 52 %** |

- **Cách chấm:** có code + test trên `main` = 1; một phần = 0,5; chưa có = 0.
- **Mẫu số A** = 10 xong + 14 một phần (7) + 26 chưa:
  - **Xong:** A1, A2, A3, A4, A5, A6, C1, C4, C7, P2.
  - **Một phần:** A8, A9, B1, B3, C2, C3, C5, C9, I2, J1, J2, J4, P1, P4.
  - **Chưa:** A7, B2, C6, C8, C10, C11, D1–D4, E1, E4–E7, G1–G3, I1, I3, J3, J5, J6, L1, P3, P6.
- **Mẫu số B:**

  | Sprint | Đạt | Ghi chú |
  |---|---|---|
  | S1 | 5,5/6 | Terraform mới là khung |
  | S2 | 5/5 | |
  | S3 | 1,5/3 | Inbox UI là của FE, không tính |
  | S4 | 2/8 | claim xong; giới hạn tải, CRM một phần; ticket mới có hợp đồng (0) |
  | S5 | 1/7 | |
- **Hai mẫu số lệch nhau, đều đúng theo định nghĩa của mình:** S1–S2 (hạ tầng, lõi) đã gần xong và chiếm nhiều dòng của bảng sprint, nên B
  cao. Mẫu số A đếm tính năng người dùng thấy; nhiều tính năng nằm ở S4–S5, nên A thấp.
- **Giới hạn của mẫu số A:**
  - Cột "Đợt" ghi theo Brief v0.4, đã bị thay bằng Brief v1.0. Brief v1.0 **không có** danh sách tính năng riêng (`git grep` không tìm thấy),
    chỉ có bảng sprint.
  - Không tìm thấy baseline nào chốt lại 50 tính năng theo Brief v1.0.
- **Ước lượng 55–65 % trước đây:** gần với mẫu số B. Theo mẫu số A thì thấp hơn nhiều.
- **Dùng con số nào:** A khi nói về **tính năng** (CEO, FE); B khi nói về **tiến độ sprint** (lead BE, nội bộ). Hỏi "bao nhiêu %" thì
  trả lời "tùy mẫu số" và đưa cả hai, không chọn một.

## 2. Theo mảng việc

| Mảng | Trạng thái | % (căn cứ) | Còn lại | Đang chặn | Mốc |
|---|---|---|---|---|---|
| Nền móng (tenancy, identity, RLS) | xong | A1–A6: 6/6. `tenant-isolation.spec.ts`, `workspace-isolation.spec.ts`, `grants.spec.ts`; 75 migration; `tenant:create-org`, `tenant:create-workspace` | — | — | S1 16/11 |
| Terraform / staging | chờ | khung 8 module (#409); `plan`/`apply` 0 | cài đặt cloud, backend state | Q2 (chờ Q1) | S1 16/11 |
| CI / Docker | xong | 8 job trong `ci.yml`; 4 image (#406); lọc docker cho PR chỉ đổi tài liệu (#420) | đẩy image lên registry | Q2 | S1 |
| Lõi hội thoại (FSM, outbox, inbound, Socket.IO) | xong | C4: `conversation-state-machine.ts`, claim race trong `conversation-*.integration.test.ts`; K-IN (#356); realtime `message.created`, `conversation.*` | — | — | S2 30/11 |
| Zalo OA | đang làm (một phần) | B1 0,5 (chỉ nhận: `zalo-webhook.ts`); B3 0,5 (`channel_policies`, `ChannelPolicyService.check`); B2 0 | gửi ra (outbound worker 8b), làm mới token, ZNS | lead BE (U57); chính sách thử lại của Zalo chưa xác minh (Z3) | S3 14/12 |
| Hộp thư (U30, U31, U56) | xong phần Đợt này | C1 1; C3, C5, C2 0,5 mỗi mục. #363, #367, #379, #385, #390, #393, #398 | đếm tin chưa đọc (N171), tag (U47), chuyển cho team (N133), "đang gõ" và "đã đọc" | N171 chưa xếp sprint; lead BE (U47) | — |
| Thành viên, workspace, team, mẫu trả lời | xong | A3, A4, C7: `modules/members`, `teams`, `workspaces`, `quick-replies` | — | — | — |
| Khách hàng (CRM) | đang làm (một phần) | J1, J2, J4, I2: 0,5 mỗi mục. `customers`, `customer_identities`, tìm theo email/SĐT, tên NFC (#337, #393) | trường tùy chỉnh, tag, gộp khách, CSV | lead BE (U46, U47) | S4 28/12 |
| Ticket | chưa bắt đầu (chỉ có hợp đồng) | I1, I3: 0. `planned.json` có `/v1/tickets` (N167, N170) | code, luật xuất ra file riêng (U60) | lịch S4 | S4 28/12 |
| SLA, giờ làm việc, phân bổ | chưa bắt đầu (trừ giới hạn tải) | C8, C10: 0; C9 0,5 (`PATCH /v1/members/{id}/capacity`, `default_max_concurrent`) | đồng hồ SLA, lịch làm việc, round-robin | Q7 (hạn 10/11); lead BE (U41, U44, U45) | S4 28/12 |
| Bot, flow (D1–D4) | chưa bắt đầu | 0/4. Chỉ có cột `after_hours_hold` | toàn bộ bot engine | lịch S4 | S4 28/12 |
| Lead (G1–G3) | chưa bắt đầu | 0/3 | toàn bộ | lịch S4 | S4 28/12 |
| AI nội bộ (E1, E4–E7, L1) | chưa bắt đầu | 0/6. `packages/ai-core` chưa có `src`; `/v1/ai/prompts` chỉ có trong `planned.json` | toàn bộ | Q1 (pháp lý) | S5 11/01 |
| Vận hành, an ninh (A7–A9, P1–P4, P6) | một phần | P2 1 (`secret-box.ts`). A8, A9, P1, P4: 0,5 mỗi mục (`platform_access_logs`, `audit_logs`, `token-bucket.ts`, metrics của worker). A7, P3, P6: 0 | bảng điều khiển vận hành (`/v1/overview` mới có hợp đồng), sao lưu/PITR, quét virus, cảnh báo | Q2 (P3) | S6 |
| Rà độ phủ test (mục 4) | chờ | plan đã gửi 30/10 | đo unit + integration + SQL | anh duyệt plan | — |

## 3. Nút thắt

Chỉ ghi sự kiện, không kết luận trách nhiệm.

| Việc đang chặn | Ai giữ | Hạn | Chặn gì |
|---|---|---|---|
| Q1 pháp lý, kéo theo Q2 (cloud, vùng) | CEO | 10/11 (báo động 05/11, N172) | staging (điều kiện S1), Terraform thật, sao lưu P3, AI S5 |
| Q7 (giờ làm việc, SLA, phân bổ) | CEO; khảo sát gửi 30/10 (#400) | trả lời 06/11; hạn tổng 10/11 | C8, C9, C10, U18, U40 |
| Xác nhận mốc 30/10 (U48, Spec M8 "Bản nháp 3") | lead BE | anh báo CEO nếu 31/10 02:00 UTC chưa có phản hồi | đóng mốc 30/10 |
| Gói xác nhận U41, U44, U45, U46, U47, U51 (#418) | lead BE | trước S4 | SLA, routing, trường tùy chỉnh, tag |
| **U57** (`POST …/messages` có trả 502 không) | lead BE | trước khi làm 8b | **Blocker S3:** "tin thật đi được cả vào lẫn ra" (Brief dòng 907). Backend không code outbound trước khi U57 được chốt |
| U58 (chế độ bảo trì, Brief dòng 859) | lead BE | khi làm bảo trì | câu trang bảo trì của FE |

## 4. Đề xuất 3 việc tiếp theo, xếp theo rủi ro

1. **Zalo gửi ra (outbound worker 8b) + làm mới token (B1, B2).**
   - S3 (14/12) chỉ đóng khi có "tin thật từ OA test vào/ra" (Brief dòng 907).
   - Đây là kênh duy nhất của Đợt 1. Hiện tin chỉ nằm ở trạng thái `pending`, chưa có đường gửi.
   - Cần lead BE chốt U57 trước khi thiết kế.
2. **Thiết kế bot engine và routing cho S4 (D1–D4, C9).**
   - S4 có 8 deliverable, mới đạt 2, và bản build S4 là bản đem đi pentest (dòng 908).
   - Phần routing không phụ thuộc Q7 (vòng xoay, giới hạn tải, U45) làm được trước; phần SLA chờ Q7.
3. **Rà độ phủ test (mục 4) trước khi viết nhiều code cho S3 và S4.**
   - Ba điểm mù đã thấy:
     - ngưỡng 80 % tính gộp cả gói;
     - integration không đo coverage;
     - SQL (RLS, SECURITY DEFINER) không đo được.
   - Phát hiện muộn thì phải sửa trên bản build đem đi pentest.
