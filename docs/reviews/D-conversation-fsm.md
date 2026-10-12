# Code Review — Nhóm D: Hội thoại và máy trạng thái (FSM)

> ⚠️ Cập nhật 12/10/2026: D-02 đã được nâng lên HIGH và đã đóng (#88, #90, #91). Xem 00-summary.md mục "Phát hiện đã nâng mức".

- **Mốc code:** `main` = `1dfd6c5` (M1.3 hoàn tất, gồm PR4b-2a, 4b-2b và PR fix #85). So với `82caafe`, #85 chỉ đổi `@gani/domain` (ra `dist`), timeout của pool và smoke CI: không file nào của nhóm D hay E.
- **Ngày rà soát:** 12/10/2026. **Người rà soát:** Claude (chính tác giả, xem mục "Giới hạn").
- **Phạm vi:** `packages/domain/src/conversation/*`, `packages/db/src/{conversation-store,message-store}.ts`, `apps/api/src/modules/conversations/*`, migration `202610031830`, `202610061000`, `202610061020`, `202610061100`, `202610061110`, test FSM (domain, `conversations-fsm.spec`, `conversation-events.spec`, `conversation-state-machine.integration.test.ts`, `message-service.integration.test.ts`), đối chiếu `docs/specs/fsm-spec.md`.
- **Cách tìm bằng chứng:** đọc từng dòng của bảng `TRANSITIONS` đối chiếu bảng §2 của spec; `git grep` theo checklist P0; kịch bản PGlite chạy `MessageService`/kho thật (ngoài kho, lệnh ghi trong từng mục).

## Tóm tắt

| Mức | Số | Mã |
|---|---|---|
| CRITICAL | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 2 | D-01, D-02 |
| LOW | 1 | D-03 |
| INFO | 3 | D-04, D-05, D-06 |

Bảng transition khớp spec §2 từng dòng (T01–T21, N1–N4). Không có cách nào đi qua tay `ConversationStateMachine` để đổi cột FSM mà không bị trigger chặn. Hai điều cần anh quyết: **D-01** (nghiệm thu T06 còn thiếu) và **D-02** (giờ của nền tảng không được kiểm, hỏng vĩnh viễn nhờ `GREATEST`).

---

## Phát hiện

### [MEDIUM] D-01 — Nghiệm thu §9.2 đòi claim-race "cả cho T06", test chỉ chạy cho T05
- **File:** `apps/api/src/modules/conversations/conversation-state-machine.integration.test.ts:52-62, 169-229`; `docs/specs/fsm-spec.md` §9 mục 2.
- **Nhóm:** D.
- **Mô tả:** Spec ghi: "50 agent claim cùng lúc → đúng 1 thắng ... Chạy cả cho T06." Test `claim-race` dựng hội thoại bằng `waiting()` (`needs_human` trong giờ làm → `HUMAN_WAITING_Q`), tức chỉ T05. T06 (`BOT_ACTIVE` + `after_hours_hold`) dùng cùng hàm nhưng điều kiện `WHERE` có thêm cờ `after_hours_hold`, và là đường duy nhất có hai bên cùng tranh một dòng ở `BOT_ACTIVE`: claim (T06) và `release_after_hours` (T08). Mutation "bỏ `state = from` khỏi `WHERE`" có (`:201`); không có mutation "bỏ `after_hours_hold = from`". Rủi ro thực tế thấp (cùng đường mã, domain test đã quét T06 ở mức quyết định), nhưng đây là một mục nghiệm thu bằng văn bản chưa được thực hiện và là bất biến "đúng một người giữ".
- **Bằng chứng:**
  ```
  $ grep -n "T06" apps/api/src/modules/conversations/*.integration.test.ts
  (không có dòng nào)
  $ grep -n "T06" packages/domain/src/conversation/decide.test.ts
  114:  ['botHold', ['claim'], to('T06', held('HUMAN_ACTIVE', U2), 'claimed', CLAIMED)],
  ```
  Chỉ bảng quyết định thuần có T06, không có ca đồng thời trên PostgreSQL.
- **Đề xuất:** thêm một `describe` thứ hai vào `claim-race`: hội thoại `BOT_ACTIVE` + hold (`needs_human` với `inHours:false`), 50 agent claim → đúng một `T06`, 49 `ConversationAlreadyClaimedError`, `version` 2; thêm một ca trộn 25 claim với 1 `release_after_hours` (ai thắng thì kết quả cuối vẫn hợp lệ). Đây là test, không đổi mã chạy thật; PR riêng ≤ 150 dòng.
- **Mức độ:** MEDIUM

### [MEDIUM] D-02 — `last_customer_message_at` nhận thẳng giờ của nền tảng, không kiểm, và `GREATEST` làm mốc hỏng không sửa được
- **File:** `packages/db/src/message-store.ts:78-97` (nhóm F, ghi ở đây vì phát hiện trên đường `receiveCustomerMessage`); `apps/api/src/modules/conversations/message-service.ts:112-124`; cột `messages.platform_sent_at` (`202610061010_create_messages.sql:20`, không có CHECK).
- **Nhóm:** F (kho tin), liên quan D. PR-C trích dẫn, không đếm lại.
- **Mô tả:** Mốc khách `last_customer_message_at` (đầu khung miễn phí 48 giờ) lấy `platformSentAt` của chính tin do nền tảng gửi, rồi ghi `GREATEST(mốc cũ, giờ đó)`. Không có chỗ nào chặn giờ ở tương lai. Một tin có `platformSentAt` sai (đồng hồ lệch, lỗi ở nền tảng, payload giả mạo đã qua chữ ký trên kênh khác) kéo mốc lên năm 2099 và `GREATEST` giữ nó mãi: mọi tin sau đó đều thấp hơn nên không ghi đè. Khi chính sách gửi (khung 48 giờ) đọc cột này, hội thoại sẽ trông như khung còn mở vô hạn. Hiện chưa có mã nào đọc cột (chỉ ghi), nên đây là rủi ro tiềm ẩn đến khi PR gửi tin ra làm.
- **Bằng chứng:** chạy `insertMessage` thật trên PGlite (`review-future-ts.mjs`, kịch bản ngoài kho):
  ```
  after a normal message        : 2026-10-12T10:42:55.729Z
  after platformSentAt = 2099   : 2099-01-01T00:00:00.000Z
  after another normal message  : 2099-01-01T00:00:00.000Z   (never goes back: GREATEST)
  ```
  `git grep -n "platformSentAt\|platform_sent_at" -- 'apps/*/src' 'packages/*/src'` (bỏ test): không có nơi nào so với `now()`.
- **Đề xuất:** quyết định ở một chỗ duy nhất: kẹp `platformSentAt` trong `insertMessage` vào `LEAST(giờ nền tảng, now() + dung sai)` (dung sai do anh chọn, ví dụ 5 phút), hoặc từ chối ở `InboundProcessor` (PR6). Kèm test "tin có giờ tương lai không kéo mốc quá `now() + dung sai`". Ghi N-số. Không sửa trong PR docs.
- **Mức độ:** MEDIUM

### [LOW] D-03 — Khóa thứ hai của quy tắc 4 (quét mã) bị qua mặt bằng một bí danh; `message-store.ts` đang dùng đúng chỗ hở đó
- **File:** `packages/db/src/message-store.ts:84-97`; `packages/db/src/conversation-store-guard.test.ts:14,62-64`; `packages/config/eslint.config.mjs` (selector `CallExpression[callee.property.name='update'][arguments.0.name='conversations']`).
- **Nhóm:** D.
- **Mô tả:** Cả ESLint và test quét tìm chuỗi `.update(conversations` và `UPDATE conversations`. `message-store.ts` viết `const c = conversations; ... tx.update(c)` nên lọt cả hai, và test khẳng định "không file nào khác `conversation-store.ts` ghi `conversations`" trong khi `message-store.ts` ghi `last_message_at`, `last_customer_message_at`, `updated_at` (cột ngoài FSM, hợp lệ theo N107(5)). Không phải vi phạm: trigger `conversations_fsm_guard` vẫn chặn mọi đổi cột FSM (`FS001`) bất kể cách viết. Nhưng khóa "mã" yếu hơn lời của spec §5 ("test kiểm tập tệp vi phạm = ∅"), và người sau có thể viết `const c = conversations; tx.update(c).set({ state })` mà chỉ DB chặn.
- **Bằng chứng:** `git grep -n "\.update(c)\|\.update(conversations" -- packages apps` (bỏ test) → `conversation-store.ts:110` và `message-store.ts:85`; test chỉ khớp dòng đầu.
- **Đề xuất:** thêm `message-store.ts` vào danh sách ngoại lệ có chủ đích của test quét (kèm lý do "chỉ cột mốc") và mở rộng mẫu quét thêm `\.update\(\s*[A-Za-z_]\w*\s*\)` trong file có `import ... conversations`; hoặc viết `tx.update(conversations)` trực tiếp và cho ESLint một ngoại lệ theo file. Cách nào cũng là thay đổi nhỏ ở test, không đụng DB.
- **Mức độ:** LOW

### [INFO] D-04 — `INSERT` hội thoại không bị trigger canh; trạng thái đầu do mã chọn
- **File:** `packages/db/migrations/202610061110_create_conversations_fsm_guard.sql:1-9, 31-32`.
- **Nhóm:** D.
- **Mô tả:** Trigger là `BEFORE UPDATE`. `app_role` có `INSERT` trên `conversations`, nên một đường mã hay `psql` thủ công tạo được hội thoại ở bất kỳ tổ hợp trạng thái nào mà các CHECK cho phép (ví dụ `HUMAN_ACTIVE` đã gán, `version 0`, không có dòng `conversation_events`/outbox). Migration và spec §5 ghi nhận giới hạn này ("INSERT không bị canh") và N75 giữ `state` không có `DEFAULT`; không có test nào khẳng định hành vi đó để người sau biết đây là chủ ý.
- **Bằng chứng:** đọc trigger; `packages/db/test/conversations-fsm.spec.ts` chỉ kiểm `UPDATE`.
- **Đề xuất:** thêm một test "INSERT hợp lệ theo CHECK vẫn được phép: giới hạn có chủ ý" để khóa hành vi, hoặc thêm trigger `BEFORE INSERT` ép `version = 0` và `state = 'BOT_ACTIVE'` nếu anh muốn đóng hẳn. Quyết định của anh.
- **Mức độ:** INFO

### [INFO] D-05 — Claim thua một cuộc đua với T07/T08 vẫn trả `409 conversation_already_claimed` với `assignedUserId: null`
- **File:** `apps/api/src/modules/conversations/conversation-state-machine.ts:284-287`.
- **Nhóm:** D.
- **Mô tả:** Khi `UPDATE` của claim trả 0 dòng, mã luôn ném `ConversationAlreadyClaimedError`, kể cả khi hội thoại không bị ai nhận mà vừa chuyển trạng thái khác (hết hạn chờ T07, nhả sau giờ T08). Client thấy "đã có người nhận" nhưng không có người. Đúng chữ spec §6 ("0 dòng → 409 conversation_already_claimed"), nên không phải lỗi; chỉ là thông điệp gây hiểu nhầm cho giao diện.
- **Bằng chứng:** đọc `:284-287`; `ConversationAlreadyClaimedError` mang `assignedUserId` (null ở trường hợp này).
- **Đề xuất:** khi `assignedUserId` là null, để giao diện hiểu là "hội thoại vừa đổi, tải lại". Ghi một câu vào P9 khi cập nhật bảng mã lỗi (F6).
- **Mức độ:** INFO

### [INFO] D-06 — FSM tin `userId` của claim/transfer/reassign: chỉ DB kiểm là thành viên của tổ chức
- **File:** `packages/db/migrations/202610061100_add_conversations_fsm_columns.sql:15-17`; `conversation-state-machine.ts` (`claim`, `transfer`, `reassign`).
- **Nhóm:** D.
- **Mô tả:** Khóa ngoại kép `(org_id, assigned_user_id)` → `org_members` bảo đảm người được gán thuộc cùng tổ chức. Không có gì kiểm `status = 'active'`, vai trò (một `viewer` có claim được không?) hay quyền vào workspace của hội thoại. Spec FSM không viết quy tắc này (nó thuộc người gọi: controller và `RolePolicy`), nên chưa phải thiếu sót ở mốc này, nhưng cũng không có test hay chú thích nói rõ ranh giới.
- **Bằng chứng:** `conversations-fsm.spec.ts:101` chỉ kiểm "không phải thành viên tổ chức → 23503".
- **Đề xuất:** thêm câu "FSM không kiểm vai trò/trạng thái/quyền workspace của người nhận; người gọi PHẢI kiểm trước" vào `apps/api/CLAUDE.md` và nhắc ở PR8/PR controller đầu tiên.
- **Mức độ:** INFO

---

## Đã kiểm, không có phát hiện

| Mục | Cách kiểm | Kết quả |
|---|---|---|
| Bảng transition = spec §2 | đọc `transitions.ts:156-183` song song bảng spec | T01–T21 và N1–N4 khớp: từ, sự kiện, điều kiện, đích, phụ (`hold`, `assigned`), `history`, `effects`; T21 theo F2, T11 và T16 là đề xuất đã ghi §2 |
| Quét toàn bộ + mutation của bảng | `decide.test.ts:178-243` | oracle sinh mọi tổ hợp; bỏ dòng, đổi kết quả, đảo guard đều bị bắt |
| Bất biến snapshot = CHECK DB | `snapshot.ts:253-262` vs `202610061100:18-27`; test `conversations-fsm.spec.ts:57` | cùng bốn quy tắc; "mọi tổ hợp FSM sinh ra DB đều nhận" |
| Một lần ghi (§4) | `conversation-state-machine.ts:249-291`, `applyTransition` | đọc → `decide` → `set_config('app.fsm')` → `UPDATE ... WHERE id AND state AND hold [AND version]` → outbox → history cuối cùng (có chú thích lý do) |
| Va chạm (§6) | `conversation-state-machine.ts:269-289` | hành động người cần `expectedVersion` (`MissingExpectedVersionError`), claim không kiểm version, sự kiện hệ thống thử lại tối đa 3 lần rồi `ConversationContendedError` |
| Cô lập tenant | test `conversation-state-machine.integration.test.ts:340-357`, `conversation-events.spec.ts:64-80` | workspace khác: 404, hội thoại không đổi; F7 (event theo workspace) có test; INSERT sai workspace: `42501` |
| Nguyên tử | integration `:306-338` + `message-service.integration.test.ts` | lỗi ở history hay outbox cuốn cả trạng thái; rollback tin + outbox + hai mốc có ca đối chứng |
| Trigger guard | `conversations-fsm.spec.ts:127-200` | `FS001` cho `app_role` và `migration_role`; `FS002` khi `version` không tăng đúng 1; cờ không rò khỏi transaction |
| `org_id` không từ client | `currentTenantContext()` trong `conversation-store.ts:89,136`, `outbox-store.ts:31`, `message-store.ts` | cả ba lấy từ context, không có tham số `orgId` |
| UUIDv7 | `git grep -nE "randomUUID\|gen_random_uuid\|uuidv4"` ở D/E (bỏ test) | rỗng; `uuidv7()` cho hội thoại, sự kiện, outbox, tin |
| Không log PII | `git grep -nE "console\.\|logger\."` ở `apps/api/src/modules/conversations` | không có; lỗi chỉ mang trạng thái/sự kiện/lý do cố định, không nội dung tin |
| Payload outbox chỉ tham chiếu | `outbox-writer.ts:9-27, 54-85, 122-139` | khóa lọc theo `text\|body\|content\|name\|email\|phone\|address`, giá trị phải phẳng; giá trị chuỗi không được quét (giới hạn có chủ ý của bộ lọc: nó bắt tên khóa, không bắt nội dung) |
| Thứ tự khóa G8 | `message-service.ts:57-60, 112-124` | `insertMessage` (khóa tư vấn rồi `UPDATE` mốc) trước FSM; test 5 vòng × (20 tin + 3 claim) ở `message-service.integration.test.ts` |
| Không import chéo module | `git grep -n "from '\.\./" -- apps/api/src/modules/conversations` | chỉ `./`; không phụ thuộc `auth` hay `request-context` |
| Nợ trong mã | `any`, `ts-ignore`, `eslint-disable`, `TODO` | `git grep` rỗng ở phạm vi D |

## Cần kiểm thêm (INFO, chưa chứng minh được)

1. **Claim-race và 5 vòng deadlock chỉ chạy ở CI** (PGlite một kết nối). Dẫn: CI #190 và #192 xanh; không chạy lại cục bộ.
2. **`ConversationContendedError` chưa có người xử lý**: N96 nói "job gây ra được thử lại", nhưng chưa có job nào gọi FSM. Cần kiểm lại ở PR6 (bộ xử lý inbound) rằng lỗi này làm sự kiện quay về hàng đợi chứ không mất tin.
3. **Mutation "bỏ `READ COMMITTED`"** (§9.7): test chỉ khẳng định `default_transaction_isolation` của máy chủ (`:193`), không chứng minh mã đòi mức đó; nếu ai đặt `REPEATABLE READ` ở pool thì claim-race đỏ ở lỗi `40001`, không phải ở test này.

## Đề xuất ghi vào `QUESTIONS.md` (chưa ghi, anh quyết)

| Số đề xuất | Nội dung | Phát hiện |
|---|---|---|
| N115 | Thêm claim-race cho T06 (+ trộn với T08) vào nghiệm thu §9.2 | D-01 |
| N116 | Kẹp `platformSentAt` (dung sai do anh chọn) ở `insertMessage` hoặc bộ xử lý inbound; test giờ tương lai | D-02 |
| N117 | Mở rộng khóa quét của quy tắc 4 (bí danh), ghi ngoại lệ có chủ ý của `message-store.ts`; ghi rõ "INSERT không canh" và "FSM không kiểm vai trò người nhận" | D-03, D-04, D-06 |

(Số N hiện đã dùng tới N109; N110–N114 là đề xuất của PR-A và chưa ghi, nên dãy ở đây tiếp từ N115.)

## Giới hạn

Rà soát bởi chính tác giả. Checklist cứng + bằng chứng chạy được. Không thay thế review độc lập.

- Phần lớn mã nhóm D do chính tác giả viết ở PR M1.2–M1.3: nên cân nhắc review độc lập nhóm D/E/F, đặc biệt bảng transition so với P14 của Brief (em đối chiếu với **spec** đã duyệt, không đối chiếu lại Brief gốc từng chữ).
- Bộ test tích hợp không chạy cục bộ; các kết quả "đồng thời" lấy từ CI đã xanh trên `main`. Kịch bản PGlite chỉ chứng minh logic tuần tự.
