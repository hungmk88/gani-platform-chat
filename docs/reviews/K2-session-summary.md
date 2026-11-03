# Tóm tắt session Backend K2 (để session sau đọc lại)

Session `session_015SNdqahP5ww1xzoFPE12QW` · Backend · từ **01/11/2026 05:45 UTC** (CEO mở "Session K2", `main` `de1ecc3`) tới
**03/11/2026 ~10:10 UTC**. Session trước: `docs/reviews/K-session-summary.md`. Người giao việc: A (CEO); BE trả lời tiếng Việt, giờ
UTC. `main` lúc chốt: **`fe6f98c`** (#588), CI `main` 9/9 success (run 41608564909). Tiến độ đo cùng lúc:
`docs/reviews/progress-20261103.md`.

Đọc theo thứ tự: `CLAUDE.md` (gốc) → `apps/api/CLAUDE.md`, `packages/db/CLAUDE.md`, `apps/worker/CLAUDE.md`, `infra/CLAUDE.md` →
file này → `QUESTIONS.md` (N179–N193, U70–U78) → `docs/claude-changelog.md` (01–03/11).

## 1. Trạng thái lúc chốt

| Việc | Trạng thái |
|---|---|
| PR BE đang mở | Không có. PR docs của file này: nhánh `docs/progress-session-20261103` |
| Branch protection `main` | `strict`, `enforce_admins`, 9 required check gồm `docker images`: không đổi cả phiên |
| Sprint duyệt lô | 02/11–09/11 (CEO 02/11 16:17): BE tự merge PR tầng 2/3 có phương án đã duyệt khi đủ 7 điều kiện Mức A; bỏ FE comment và heads-up 30'. Báo cáo cuối ngày và cuối sprint 09/11 |
| DB nháp local | Chỉ giữ `gani_o1` (CEO 03/11 06:28). Env ở scratchpad `gani_o1.env`; Postgres tắt sau khi VM khởi động lại là bình thường: `bash scripts/check-db.sh` |
| Lịch tự kiểm | Không còn (đã hủy sau #588) |
| Tag 3b | Xong cả chuỗi (#579, #581, #583, #586, #588). FE còn 23b (tạo, sửa, ẩn, gộp) |
| Còn chờ FE review sau merge 24 giờ | #574 (stub e2e `description: null`), #578, #583 (`catalog.ts` đổi import `CustomerField`) |

## 2. Kết quả: 64 PR merge (squash), theo mạch việc

Bảng đủ 64 PR ở Phụ lục. Mọi PR: diff HEAD ↔ squash = 0; CI `main` sau merge success ở mọi lần đã kiểm.

| Mạch | PR | Kết quả |
|---|---|---|
| D1a Bot flow (lưu, xuất bản, API) | #486, #489, #493, #496, #499 | Đồ thị đóng băng theo phiên bản, lưu nháp cả đồ thị, xuất bản `max + 1`, `/v1/bot-flows` đọc, tạo, lưu nháp, xuất bản, xóa mềm (audit) |
| AI: che PII | #492, #495 | `PiiMasker` placeholder đánh số + unmask; cảnh báo PII còn sót trước khi gửi provider. Chưa nối (Q1) |
| D1b Bot runtime | #500, #502, #505, #507, #508, #509, #510, #513 | `bot_sessions`, `BotRuntime.step` hàm thuần, ngôn ngữ điều kiện P15, 6 handler lõi, chọn flow, lượt bot trong transaction inbound, `handoff`, `jump_to_flow` |
| U78 ưu tiên handoff | #515 | `conversations.priority`, lý do handoff trong lịch sử |
| O1–O2c gửi tin ra | #521, #522, #524, #525 | Lease và lần thử ở `message_deliveries`, kho, job gửi, nối worker **tắt** tới O3 (`createChannelSenders` trả `{}`) |
| D1d chạy thử flow | #526, #527 | `simulate` ở `bot-runtime`, `POST /v1/bot-flows/{id}/dry-run` |
| K1 Ticket | #530, #532, #533, #534, #538, #540 | Bảng, kho tạo/đổi/đọc, `GET/POST /v1/tickets` (Tầng 3, CEO APPROVED + merge), `GET/PATCH /v1/tickets/{id}` |
| Hợp đồng planned S4 | #544, #547, #548 | Lead (N188), Tag (N190), trường tùy chỉnh (N191): Tầng 3 theo Mức A |
| Tag 2–3a | #550, #552, #554, #556, #559, #563 | Bảng tag, trường, giá trị mã hóa; kho tag; `/v1/tags` tạo/đổi tên/ẩn/gộp; gắn tag khách, lọc `tagId` |
| C10 giờ làm việc | #553, #557, #560, #566, #570, #571 | Bảng, `isOpen` theo múi giờ, kho, `GET/PUT` giờ làm việc, ngày nghỉ GET/POST/PATCH/DELETE |
| C10-4 ngoài giờ | #573, #576, #577 | T03 giữ khi ngoài giờ; hàm SECURITY DEFINER thứ 19 + index CONCURRENTLY; job thả T08 mỗi 60 s |
| U77 bot flow | #574, #578 | Mô tả + PATCH đổi tên/mô tả; tạm dừng/chạy lại; trần 200 flow mỗi workspace (422) |
| Tag 3b trường tùy chỉnh | #579, #581, #583, #586, #588 | Store định nghĩa (trần 50), store giá trị (seal/open), `/v1/customer-fields`, luật giá trị theo kiểu, `/v1/customers/{id}/fields` với SecretBox thật |
| CI | #562 | Lọc job theo file đổi (Cách 1), `main` không hủy run |
| Docs, luật | #498, #518, #528, #529, #535, #542, #543, #546, #564, #567 | N179–N193, U76–U78; tiến độ 02/11 của BE; luật 5a/5b, Mức A, bảng job theo loại PR |

Số PR theo ngày: 01/11: 18 · 02/11: 33 · 03/11: 13.

## 3. Quyết định chính của CEO trong phiên

Chi tiết từng câu ở `QUESTIONS.md` (N/U tương ứng). Giờ UTC.

**01/11**
- D1a, D1b: phạm vi và cách tách PR được duyệt từng phần (06:07–12:11). Ngoại lệ kích thước: D1a2a 432, D1a3a 593, D1b3a2 667 dòng.
- Q6 chốt (b) 07:28: không mở mạng tới Zalo; code với `// Q6: unverified`, mặc định tắt.
- PII masker (08:03): regex, không NER; tách PR-AI1, PR-AI2.
- **10:52 CEO override, đóng băng**: hủy quyết định Q1 07:25 và U74/U75 08:52 do brief tự động vượt quyền. 11:05 mở lại theo
  phân tầng 1/2/3; tầng 3 bắt buộc comment APPROVED của CEO.
- D1b3 (11:27): chưa có giờ làm việc thì handoff luôn T02; `keyword` thắng `first_message`; không khớp thì chuyển người.

**02/11**
- O-series (01:22): gửi theo Q6 (b), mặc định tắt, thử tối đa 5 lần, khung đóng thì không gửi tin trả phí. **O3 tạm dừng** vì thiếu
  nguồn Z-g, **O4 tạm dừng** vì chưa ai dùng token (05:46; hai lý do ghi riêng).
- D1d duyệt 05:49; K1a 07:45; K1c giữ Tầng 3 lần này (10:54); K1c-2 duyệt 14:39.
- 15:27: **Mức A** áp dụng ngay; **go-live 31/01/2027** (phương án b, S6 17/01/2027); không cần văn bản ngày lễ.
- 16:17: **duyệt lô theo sprint** 02/11–09/11.
- Tag (15:08, 15:14, 16:25): định nghĩa chỉ Owner/Admin; gắn, sửa giá trị Owner/Admin/Manager/Sales/Support; giá trị `sensitive`
  mã hóa bằng SecretBox chung, AAD `customer_field_values.value_enc`; `support_role` không đọc giá trị.
- C10 (16:45, 18:32): 422 `holiday_overlap`, `holiday_in_past` theo giờ workspace; chỉ Owner/Admin đọc giờ làm.
- CI Cách 1 và luật Cách 2+3 duyệt 18:05–18:07; bảng job sửa 19:11 (PR lẫn BE + FE: 8 job).

**03/11**
- C10-4 (05:38): ngoài giờ chỉ giữ T03, không gửi tin; tuần mặc định T2–T6 08:00–18:00 áp ngay; thả sau ~60 s. U77(i) Tầng 2, làm PATCH.
- 06:18: duyệt lệch phương án #576 (RLS hội thoại cần tenant workspace); C10-4b-ii giữ 1 PR 579 dòng.
- Tag 3b + U77 b/c (07:05): trường ẩn vẫn đọc/ghi; audit `customer.fields_changed {fieldIds}`; không log đọc dữ liệu nhạy cảm Đợt 1;
  thiếu khóa → 503; xuất bản lại flow tạm dừng vẫn `inactive`; trần 200 flow (c1).
- Brief 54 (07:40): "Ngoại lệ 500 dòng … KHÔNG vượt 500. Vượt 500 → tách". 3b-i (553 dòng) và 3b-iii (575 dòng) đã tách theo luật này.

## 4. Luật làm việc hiện hành (đã vào `CLAUDE.md`; nhật ký ở `docs/claude-changelog.md`)

- Phân tầng merge 1/2/3; **Mức A** 7 điều kiện; báo 5 mục sau mỗi merge (HEAD, squash, job trước merge theo tên + giờ, CI `main`
  sau merge, diff = 0).
- **Job theo loại PR** (#564, #567): BE 7, FE 5, docs 3, Terraform 4, lẫn BE + FE hoặc file gốc 8, workflow/`infra/ci`/`main` 9.
  File sinh `apps/admin/src/api/*.d.ts` làm PR BE thành PR lẫn (8 job).
- PR ≤ 400 dòng; 500 chỉ khi phần vượt là test bắt buộc; vượt 500 thì tách theo ranh giới nghiệp vụ.
- Song song tối đa 4 nhánh; PR đang chờ merge thì không mở PR chồng lên nó; merge và Update branch từng PR một.
- Hợp đồng: thêm/đổi `planned.json` là Tầng 3; chuyển sang `openapi.json` giữ nguyên là Tầng 2, PR ghi bảng so sánh; mất kiểu FE
  đang import thì sửa import trong cùng PR.
- Chỉ comment GitHub của CEO mới là duyệt (#498). Hold = dừng mọi hoạt động trên PR.
- File mới dù 1 dòng phải có test (cổng coverage theo file). Store/controller chỉ test tích hợp: thêm vào danh sách loại coverage đơn vị.
- Mutant cần DROP (CHECK, UNIQUE, FK) trên DB: trình CEO trước. Kill mutant theo PID, không `pkill -f`.
- Scan secret chạy riêng trên dòng PR thêm, mẫu `sk-[a-zA-Z0-9]{20,}`, có kết quả thì không push (brief 52, 53).
- Test sắp theo tên: khác nhau ở chữ không dấu đầu (collation). Không `prettier --write` lên `QUESTIONS.md`.
- Kết nối GitHub gián đoạn: kiểm tay mọi PR đang mở. Lệnh kiểm không pipe che exit code; script commit dùng `&&` hoặc `set -e`.
- CEO chỉ trả lời 3 dạng tin: "Cần anh chốt", "Trình phương án", "Vi phạm Mức A"; tin khác là báo cáo.

## 5. Sự cố và bài học trong phiên

| Ngày | Việc | Bài học |
|---|---|---|
| 01/11 | Brief tự động ra quyết định Q1, U74/U75 vượt quyền CEO; CEO override 10:52 | Chỉ comment GitHub của CEO là duyệt |
| 01/11 | #513 bật auto-merge khi CI còn chạy, trước khi luật cho phép | Ghi "Lệch quy trình" trong báo cáo |
| 02/11 | #525 coverage đỏ (file 3 dòng 0 %) | File mới phải có test |
| 02/11 | #527 lint đỏ lần đầu; mutant treo vitest, `pkill -f` khớp cả shell | `pnpm lint` ở root trước push; kill theo PID |
| 02/11 | Script commit đặt `&&` sai chỗ, commit chạy khi kiểm đỏ | `set -e` hoặc nối cả chuỗi bằng `&&` |
| 02/11 | Run `main` sau #552 bị hủy (`cancel-in-progress`) | Hạ tầng; Cách 1 sửa `main` không hủy run (#562) |
| 02/11 | Lỗi collation lần 2 trong ngày | Luật vào `packages/db/CLAUDE.md` |
| 03/11 | #570 không mở lại log Trivy trên HEAD cuối | Bù bằng danh sách 9 job; luôn đọc job `docker` trên đúng HEAD |
| 03/11 | 3b-i (553) và 3b-iii (575) vượt 500 | Đếm dòng trước khi push; tách theo ranh giới nghiệp vụ |
| 03/11 | FE merge liên tục (#580–#587): Update branch 6 lần trong ngày (#581: 3 lần) | Bật auto-merge ngay khi chuyển ready; CEO: vấn đề quy trình, không phải lỗi BE |

## 6. Việc còn mở và đang chờ

| Mục | Chờ | Ghi chú |
|---|---|---|
| Q1 pháp lý AI | Văn bản luật sư | Mốc 14/12/2026; trượt thì go-live với AI tắt, phương án B (staging). Giữ `ai_production_locked` |
| O3 adapter Zalo | Nguồn Z-g (spec §7) | B1 "có" cần đủ 3 điều kiện CEO 02/11 |
| O4 client làm mới token | Có người dùng token (sau O3) | — |
| Q2 FPT Cloud | Access Key | Terraform chỉ qua CI |
| U57 `502 channel_unavailable` | Lead BE, hạn 15/11/2026 17:00 | — |
| Q7 / C9 phân bổ, online/offline | CEO + quản lý workspace | C10 giờ làm việc đã xong |
| Q8 loại ticket, SLA | The Smile | I1, I3 giữ "một phần" |
| Q9 lead B2B | CEO | Lead mới có hợp đồng planned (#544) |
| `cancel-in-progress` của `main` | CEO quyết khi có số liệu | — |
| #17 mở PATCH ở FE | CEO chốt riêng | Đổi phạm vi Đợt 1 |
| U41 đổi lịch khi hội thoại đang mở | Backlog C8 / SLA | — |
| Dry-run theo số phiên bản (Q-b) | Khi FE cần | — |

## 7. Ứng viên việc BE kế tiếp (chờ CEO giao, chưa phương án)

- Lead API thật (G1–G3, S4 leads) trên hợp đồng #544, phần không phụ thuộc Q9.
- C3 lọc Hộp thư theo tag (tag đã có ở khách, #563).
- C10 phần online/offline của agent (cần Q7 cho ngưỡng 10 phút, Brief dòng 991).
- J3 gộp khách trùng, J2 hợp nhất định danh (S4 CRM + identity).
- Nối PII masker (E7) khi có việc AI ở staging.

## Phụ lục: 64 PR của phiên (giờ merge UTC từ commit squash)

| PR | Merge | Squash | Tiêu đề |
|---|---|---|---|
| #486 | 01/11 07:48 | `6cc8fb7` | feat(db): bot_nodes and bot_edges, the graph of a published version frozen (D1a1b) |
| #489 | 01/11 09:18 | `91ca73e` | feat(db): store of the bot flows, a draft saved as a whole new graph (D1a2a) |
| #493 | 01/11 09:29 | `4b9b6cd` | feat(db): publish a bot flow as version max + 1, and list the flows of a workspace (D1a2b) |
| #492 | 01/11 09:35 | `e3da45a` | feat(ai-core): PII masker with numbered placeholders and unmask (PR-AI1) |
| #495 | 01/11 09:48 | `196b45c` | feat(ai-core): warn and count PII left in a request before it leaves for an AI provider (PR-AI2) |
| #496 | 01/11 10:09 | `0d519f1` | feat(api): list, make and read the bot flows of a workspace, with their graphs (D1a3a) |
| #499 | 01/11 10:28 | `6db6024` | feat(api): save the draft, publish and delete a bot flow, audited (D1a3b) |
| #498 | 01/11 11:06 | `89d656d` | docs(questions): Q2 FPT Cloud, Q6, U57, U63 recorded; Q1 waits for the written legal opinion; N179–N182, U76 |
| #500 | 01/11 11:37 | `48e9096` | feat(db): bot_sessions and bot_session_steps, seen only by who sees the conversation (D1b1a) |
| #502 | 01/11 12:13 | `549f380` | feat(bot-runtime): BotRuntime.step, one turn of a flow as a pure function (D1b1b) |
| #507 | 01/11 12:20 | `a91bb4f` | feat(bot-runtime): the condition language of P15 and the scope of a turn (D1b2a) |
| #505 | 01/11 12:26 | `ad47e17` | feat(db): store of the bot sessions, a turn written with its steps (D1b1b) |
| #508 | 01/11 12:31 | `eb3fc51` | feat(bot-runtime): the core node handlers: trigger, message, question, condition, set_variable, end (D1b2b) |
| #509 | 01/11 12:38 | `0d6303b` | feat(bot-runtime): choose the flow a customer's message starts (D1b3a1) |
| #510 | 01/11 14:00 | `dfd0683` | feat(worker): the scripted bot's turn in the inbound transaction (D1b3a2) |
| #513 | 01/11 14:09 | `5631385` | feat(worker): handoff and jump_to_flow nodes of the scripted bot (D1b3b) |
| #515 | 01/11 14:56 | `2e9b0c3` | feat(db): the priority of a conversation that waits for a person; the reason of a handoff in its history (U78) |
| #518 | 01/11 16:13 | `6b96c1c` | docs(questions): N183 bot runtime, N184 bot in the inbound transaction; U78 handoff reason and priority |
| #521 | 02/11 05:05 | `878ec01` | feat(db): the lease and the next attempt of the outbound worker on message_deliveries (O1) |
| #522 | 02/11 05:13 | `17962d6` | feat(db): the store of the outbound worker, and the window facts before the message being sent (O2a) |
| #524 | 02/11 05:20 | `f810f0b` | feat(worker): the outbound worker job, one delivery at a time under its claim (O2b) |
| #525 | 02/11 05:37 | `c0a843c` | feat(worker): wire the outbound worker, off until a channel sender exists (O2c) |
| #526 | 02/11 06:11 | `8d87e70` | feat(bot-runtime): the dry-run of a flow, and the jumps shared with the worker (D1d-1) |
| #527 | 02/11 06:33 | `96d397b` | feat(api): POST /v1/bot-flows/{id}/dry-run, the sample script through the bot's steps (D1d-2) |
| #528 | 02/11 08:04 | `43c7822` | docs(questions): N187 for the dry-run of a bot flow (D1d), and U63 answered for it |
| #529 | 02/11 08:10 | `fae3f2a` | docs(reviews): progress after D1d in a file of BE's own (A 22/58, B 17/29) |
| #530 | 02/11 08:48 | `33fb511` | feat(db): the tables of the tickets, tickets and ticket_events (K1a) |
| #532 | 02/11 09:08 | `fa6fd20` | feat(db): make a ticket, given only to someone who may handle it (K1b-1) |
| #533 | 02/11 09:18 | `8f32b12` | feat(db): change a ticket under its rules and its version (K1b-2) |
| #534 | 02/11 09:50 | `ab81ff4` | feat(db): read the tickets, a page at a time and one with its history (K1b-3) |
| #535 | 02/11 10:28 | `a585d9a` | docs(questions): N185 (4), O3 and O4 paused for two different reasons |
| #538 | 02/11 14:23 | `e74693c` | feat(api): K1c-1 GET/POST /v1/tickets |
| #540 | 02/11 15:29 | `265e7ff` | feat(api): K1c-2 GET/PATCH /v1/tickets/{id} |
| #542 | 02/11 15:38 | `52055b1` | docs(claude): 5a, 5b, Tầng 2 cho hợp đồng giữ nguyên, 3 bài học K1c-1 |
| #543 | 02/11 15:46 | `1688ee7` | docs(questions): N189 chốt theo #538 APPROVED |
| #544 | 02/11 15:57 | `9e29bea` | feat(api): hợp đồng Lead planned S4 và N188 (T-2) |
| #547 | 02/11 16:08 | `0f4c256` | feat(api): hợp đồng Tag planned S4 và N190 (Tag 1a) |
| #548 | 02/11 16:20 | `a4c883f` | feat(api): hợp đồng trường tùy chỉnh planned S4 và N191 (Tag 1b) |
| #546 | 02/11 16:40 | `62c375f` | docs(claude): Mức A tự merge tầng 3 theo phương án; go-live 31/01/2027 (P21) |
| #550 | 02/11 16:45 | `f63cf64` | feat(db): bảng tags và customer_tags, không DELETE (Tag 2a-i) |
| #552 | 02/11 17:05 | `27c8adf` | feat(db): bảng customer_field_defs và customer_field_values, không DELETE (Tag 2a-ii) |
| #553 | 02/11 17:11 | `abbd4e9` | feat(db): bảng workspace_hours và workspace_holidays (C10-1) |
| #554 | 02/11 17:24 | `a9d39cd` | feat(db): giá trị mã hóa của trường sensitive (Tag 2b) |
| #556 | 02/11 17:50 | `f07d0a2` | feat(db): kho tag của công ty (Tag 3a-i) |
| #557 | 02/11 18:07 | `b06f659` | feat(domain): isOpen, giờ làm việc theo múi giờ workspace (C10-2a) |
| #559 | 02/11 18:20 | `eaf29a9` | feat(api): /v1/tags, tạo, đổi tên, ẩn, gộp tag (Tag 3a-ii) |
| #560 | 02/11 18:26 | `6f42e69` | feat(db): kho giờ làm việc và ngày nghỉ của workspace (C10-2b) |
| #562 | 02/11 18:45 | `db322b8` | ci: lọc job theo file đổi (backend, admin, terraform), main không hủy run (Cách 1) |
| #564 | 02/11 18:54 | `79a0439` | docs(claude): job chạy theo loại PR, song song và gộp PR, test không phụ thuộc collation |
| #563 | 02/11 19:02 | `436b5f3` | feat(api): gắn tag cho khách, Customer.tags, lọc tagId (Tag 3a-iii) |
| #566 | 02/11 19:29 | `424a81e` | feat(api): GET/PUT giờ làm việc của workspace (C10-3a) |
| #567 | 03/11 01:45 | `cffdb6c` | docs(rules): sửa bảng job, PR lẫn BE + FE chạy 8 job |
| #570 | 03/11 02:02 | `f42701d` | feat(api): GET/POST ngày nghỉ của workspace (C10-3b-i) |
| #571 | 03/11 05:36 | `0a4881c` | feat(api): PATCH/DELETE ngày nghỉ của workspace (C10-3b-ii) |
| #573 | 03/11 06:03 | `7aa65e9` | feat(worker): giữ hội thoại cần người ngoài giờ làm việc (C10-4a, T03) |
| #574 | 03/11 06:11 | `969d53d` | feat(bot-flows): mô tả cho bot flow và PATCH đổi tên/mô tả (U77 (i)) |
| #576 | 03/11 06:21 | `4a1965a` | feat(db): tìm hội thoại giữ ngoài giờ cho job thả (C10-4b-i) |
| #577 | 03/11 06:36 | `1e8f6f9` | feat(worker): thả hội thoại giữ ngoài giờ khi workspace mở cửa (C10-4b-ii, T08) |
| #578 | 03/11 07:26 | `3e5dd56` | feat(bot-flows): tạm dừng, chạy lại flow và trần 200 flow mỗi workspace (U77 (b), (c)) |
| #579 | 03/11 07:41 | `b5b09fe` | feat(db): store định nghĩa trường tùy chỉnh của khách (Tag 3b-i-a) |
| #581 | 03/11 08:16 | `2ab9b0f` | feat(db): store giá trị trường tùy chỉnh, giá trị nhạy cảm chỉ ghi qua seal (Tag 3b-i-b) |
| #583 | 03/11 08:23 | `84f7c62` | feat(api): API định nghĩa trường tùy chỉnh /v1/customer-fields (Tag 3b-ii) |
| #586 | 03/11 08:50 | `9141d87` | feat(api): luật giá trị trường tùy chỉnh theo kiểu, kiểm dưới khóa trường (Tag 3b-iii-a) |
| #588 | 03/11 09:08 | `fe6f98c` | feat(api): API giá trị trường tùy chỉnh /v1/customers/{id}/fields với SecretBox (Tag 3b-iii-b) |
