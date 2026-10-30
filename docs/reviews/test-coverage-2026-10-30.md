# Rà độ phủ test Backend (30/10/2026)

Người soạn: nhóm Backend · `main` lúc đo: `b1c5a03` · Plan mục 4 anh duyệt 30/10.

- **Không có con số "độ phủ chung X %".** Báo cáo chỉ ra chỗ thấp và vì sao đáng lo, không tính trung bình.
- **Không đổi config nào.** Đo bằng cờ CLI của Vitest (`--coverage.thresholds.*=0`, `--coverage.reporter`, `--coverage.include`,
  `--coverage.reportsDirectory`); không sửa `vitest.config.ts`, không đổi ngưỡng.
- **Phạm vi:**
  - Có đo: `apps/api`, `apps/worker`, `packages/db`, `domain`, `conversations`, `channels`, `email`.
  - Không đo: `apps/admin`, `apps/widget`, `packages/ui` (của FE). `packages/ai-core` chưa có `src`.

## 1. Cách đo và thời gian thật

| Bước | Lệnh | Exit | Test | Thời gian |
|---|---|---|---|---|
| Unit, 7 gói | `vitest run --coverage …` từng gói | 0 cả 7 | 689 (api 256, worker 182, domain 105, conversations 81, db 51, channels 9, email 5) | 40 s |
| Integration db | `vitest run --config vitest.integration.config.ts --coverage …` | 0 | 834 | 68 s |
| Integration api | như trên | 0 | 189 | 40 s |
| Integration worker | như trên (Postgres + Valkey ở máy) | 0 | 41 | 162 s |

- **Thời gian máy chạy:** tổng khoảng 5 phút 10 giây; phần phân tích và đọc tay mất lâu hơn.
- **Cách gộp hai lần đo:** gộp unit + integration theo từng file (một câu lệnh hay nhánh chạy ở lần nào cũng tính là đã phủ).
  - Đo được 225 file.
  - 19 file dưới 70 % dòng hoặc nhánh, xem mục 3.

## 2. Bốn điểm mù

1. **Ngưỡng 80 % tính gộp cả gói, không tính từng file** (`packages/config/vitest.base.mjs`, không có `perFile`).
   - Tổng unit của gói db chỉ ở mức 80,64 %.
   - 8 file có unit dưới 50 % vẫn lọt cổng, ví dụ `send-message.controller.ts` 11 %, `process-event.ts` 12,5 %, `assignee-read.ts` 0 %.
   - Cả 8 file đều được integration phủ 85–100 %, nhưng cổng CI không biết điều đó.
2. **Integration không đo coverage trong CI.**
   - 12 file api bị loại khỏi cổng unit "vì integration lo" (`apps/api/vitest.config.ts`).
   - Đo lần này: **93–100 % dòng, 80–100 % nhánh**, nên lý do loại là đúng. Nhưng nếu một file trong đó tụt, không ai biết.
3. **SQL không đo được bằng v8** (RLS, hàm SECURITY DEFINER, CHECK): em đối chiếu bằng tay ở mục 4.
4. **Coverage không đo chất lượng test.** Một test gọi hàm rồi pass vẫn tính là "đã phủ".
   - Bài học K-IN #324: test xanh mà lỗi vẫn còn.
   - Mục 5 đọc tay test của 5 vùng rủi ro cao nhất.

Thêm hai chỗ cách đo làm số **thấp hơn thật** (không phải thiếu test):
- **Code chạy trong tiến trình con không được tính:** `tenant:create-org`, `tenant:create-workspace` do spec gọi qua script.
- **Code `@gani/db` mà api gọi tới (qua `dist`) không tính vào gói db.**

## 3. File dưới 70 % (gộp unit + integration)

| File | Dòng / nhánh | Đánh giá |
|---|---|---|
| `packages/db/src/member-role-store.ts` | 0 / 0 | **Do cách đo.** `lockActiveOwners` được api gọi qua `dist`; `apps/api/src/members.integration.test.ts` có ca "hai Owner hạ vai trò của nhau cùng lúc" |
| `packages/db/src/auth-db.ts` | 0 / – | **Do cách đo.** Một dòng `drizzle(...)`, api gọi lúc khởi động (`auth.config.ts:221`) |
| `packages/db/src/schema/*.ts` (8 file: audit-logs, conversation-events, idempotency-keys, inbound-event-keys, inbound-events, messages, outbox-events, platform-access-logs) | 50 / 100 | **Thấp cố ý.** Hàm thứ hai của `pgTable` (khóa chính, index) không được gọi khi chạy test (hàm 0 %); nó mô tả bảng cho công cụ sinh migration |
| `apps/worker/src/ops/create-workspace.ts` | 61 / 77 | **Do cách đo.** Thân `createWorkspace` chạy trong tiến trình con của `create-workspace.spec.ts` (2 ca: tạo + từ chối) |
| `apps/worker/src/ops/create-org.ts` | 66 / 83 | **Do cách đo**, như trên (`create-org.spec.ts`) |
| `packages/db/src/customer-store.ts` | 86 / 50 | **Thiếu nhỏ:** dòng 91, nhánh sửa hồ sơ mà không đổi tên chưa chạy. Rủi ro thấp |
| `packages/db/src/quick-reply-store.ts` | 84 / 67 | **Thiếu nhỏ:** dòng 181–183, xem trước khi công ty/SĐT/tên agent rỗng → `null`. Rủi ro thấp |
| `apps/api/src/modules/members/invite-mailer.ts` | 100 / 50 | **Thiếu nhỏ:** dòng 53, một nhánh khi gửi thư |
| `apps/api/src/modules/teams/teams.schemas.ts` | 100 / 50 | **Thiếu nhỏ:** dòng 14, một nhánh kiểm dữ liệu vào |
| `packages/db/src/audit-log.ts` | 100 / 50 | **Thiếu nhỏ:** dòng 24 |
| `packages/email/src/smtp-sender.ts` | 100 / 67 | **Thiếu nhỏ**, chỉ có unit |
| `apps/api/src/modules/auth/testing/totp.ts` | 100 / 54 | **Thấp cố ý:** công cụ cho test, không phải code chạy thật |

**Thấp cố ý, không tính là thiếu test:** file sinh (`schema.d.ts`, `openapi.json`), `*.module.ts` chỉ nối NestJS, `index.ts` chỉ export lại,
file chỉ có kiểu, `main.ts`, `src/openapi/planned.ts` (hợp đồng chưa làm), công cụ cho test.

## 4. SQL: hàm SECURITY DEFINER và policy RLS

**Tiêu chí "có ca từ chối"** (anh đặt): file test có gọi tên hàm hoặc policy, **và** trong test đó có ít nhất một ca kiểm vai trò hoặc quyền **thất bại**.

### 4.1 Hàm SECURITY DEFINER: 16/16 đạt, không có hàm nào đỏ

- **Số hàm:** sau mọi migration, còn **16** hàm SECURITY DEFINER, **khớp ADR-004**. Có 21 migration nhắc tới cụm này vì tính cả comment và lệnh
  thay thế hàm.
- **`packages/db/test/security-definer.spec.ts`** (44 dòng) gọi tên cả 16 hàm, nhưng **chỉ** kiểm danh sách khớp ADR-004 và `search_path` đã ghim.
  File này **không có ca từ chối nào**.
- **Ca từ chối của từng hàm** nằm ở spec riêng của hàm đó: `has_function_privilege` của các vai trò không được phép, hoặc mong lỗi 42501.

| Hàm | Spec có ca từ chối |
|---|---|
| `accept_invite`, `lookup_invite` | `invites.spec.ts`: "is for auth_role only", "refuses every other case with one and the same error" |
| `audit_own_account_event` | `account-audit.spec.ts`: "refuses … app_role" |
| `channel_account_for_webhook` | `channel-account-webhook.spec.ts`: "executable by app_role only" |
| `ensure_log_partitions`, `log_default_partition_rows` | `partitions-ensure.spec.ts`, `partitions-default-rows.spec.ts`: "only app_role may run it" |
| `held_conversation_counts`, `…_by_state` | `assignee-read.spec.ts`: quyền EXECUTE của cả hai hàm |
| `inbound_pending_orgs`, `outbox_pending_orgs` | `inbound-pending-orgs.spec.ts`, `outbox-relay.spec.ts`: EXECUTE theo vai trò |
| `memberships_for_user` | `memberships.spec.ts`: "app_role and support_role get 42501" |
| `outbox_stats` | `outbox-stats.spec.ts`: "only app_role may run" |
| `purge_idempotency_keys`, `purge_inbound_event_keys` | `idempotency-store.spec.ts`, `inbound-event-keys.spec.ts`: "not for support_role", "app_role only" |
| `reset_member_two_factor` | `member-two-factor.spec.ts`: "only app_role may call it", TN001 khi không có ngữ cảnh tenant |
| `support_access_ok` | `support-access.spec.ts`: "executable by support_role only" |

### 4.2 Policy RLS: 46 policy trên 23 bảng

- **Theo đúng tiêu chí "gọi tên policy": chỉ 4/46 đạt, 42 đỏ.**
- Nhưng 42 policy đó **không bị bỏ trống**. `packages/db/test/rls-all-tables.spec.ts` sinh test từ catalog cho **mọi** bảng có `org_id`, gồm:
  - ENABLE + FORCE RLS;
  - đúng hai policy: app trên `current_org()`, support có `support_access_ok()`;
  - ca 1: thiếu ngữ cảnh tenant thì báo TN001 (hoặc 42501);
  - ca 11: cấm DELETE/TRUNCATE.

  Bảng mới tự được kiểm, không cần gọi tên policy.
- **Chỗ đỏ thật là cái catalog không kiểm:** hành vi **đọc chéo tenant** (tenant A đọc dữ liệu của B ra 0 dòng). Catalog chỉ kiểm biểu thức
  policy có chứa `current_org`.
- Đã có ca đọc chéo tenant cho: `organizations` (`tenant-isolation.spec.ts`), `conversations` (`workspace-isolation.spec.ts`),
  `inbound_event_keys`, và các bảng mà spec của store có ca "another organisation". `feature_flags_overrides` chỉ có ca **ghi** chéo tenant
  (42501), chưa có ca đọc.
- **`customer_identities`** (chứa Zalo UID): `customer-store.spec.ts` chỉ có ca khóa ngoại "refuses a customer of another organisation". **Không
  có ca đọc chéo tenant.**
- Danh sách bảng nào có ca đọc chéo tenant được lập bằng tìm kiếm, **chưa đọc tay đủ 23 bảng**.

## 5. Chất lượng test: đọc tay 5 vùng rủi ro cao

| Vùng | Test đã đọc | Có thật sự kiểm hành vi không |
|---|---|---|
| Cách ly tenant (RLS) | `tenant-isolation.spec.ts` ca 1, 2; `workspace-isolation.spec.ts` ca 5 | **Có.** Kiểm mã lỗi cụ thể (TN001, 42501), UPDATE chéo ra 0 dòng, có ca đối chứng dương. Hạn chế: chỉ một số bảng (mục 4.2) |
| SECURITY DEFINER | `security-definer.spec.ts`; `memberships.spec.ts`; `channel-account-webhook.spec.ts` | **Spec chung yếu** (chỉ danh sách + `search_path`). **Spec riêng mạnh:** kiểm EXECUTE theo từng vai trò, 42501, và không lộ token |
| FSM + claim race | `conversation-state-machine.integration.test.ts` | **Có.** 50 agent, `wins` đúng 1, các agent còn lại nhận `conversation_already_claimed`, đúng 1 sự kiện `claimed` |
| Webhook Zalo | `zalo-webhook.integration.test.ts` ("stores nothing"); `zalo.test.ts` | **Có.** Đếm dòng `inbound_events` sau chữ ký sai. Đột biến tay "header sai vẫn qua": **bị bắt** (1 ca đỏ) |
| Không log PII (quy tắc số 5) | `problem.filter.test.ts:101`, `safe-errors-adapter.test.ts:142`, `message-service.test.ts` (không có tên khách trong thông báo lỗi), `event-consumer.test.ts` | **Chỉ kiểm từng điểm.** Không có test nào bắt **mọi** dòng log của một lần chạy thật để tìm SĐT, email hay nội dung tin. Đây là quy tắc không thể thỏa hiệp mà chưa có lưới chung |

- **Thêm một đột biến tay:** cổng kênh `ChannelPolicyService.check` luôn mở → **bị bắt** (C-N4, C-N6 đỏ).
- **Đột biến tương đương:** không gặp ở 2 lần đột biến này.

## 6. Đề xuất (không viết test trong PR này; mỗi mục "thêm ngay" sẽ là một PR riêng, chờ anh duyệt)

**Thêm ngay**, xếp theo rủi ro:
1. **Lưới "không log PII":**
   - Trong bộ integration của api và worker, bắt mọi dòng log của logger NestJS và worker.
   - Đỏ khi thấy giá trị PII đã seed: SĐT, email, nội dung tin, tên khách.
   - Lý do: đây là quy tắc số 5 của `CLAUDE.md`; hiện chỉ có 4 điểm kiểm rời, code mới log nhầm sẽ không bị chặn.
2. **Ca đọc chéo tenant cho `customer_identities`**, rồi đọc tay 23 bảng ở mục 4.2 để thêm ca cho bảng nào còn thiếu.
   - Lý do: catalog chỉ kiểm biểu thức policy; bảng chứa định danh khách không có ca hành vi nào.
3. **Ca từ chối trong `security-definer.spec.ts`:** với cả 16 hàm, kiểm `PUBLIC` không có EXECUTE.
   - Lý do: hiện mỗi spec riêng tự làm việc này; hàm thứ 17 mà quên thì spec chung không bắt.

**Để anh quyết** (đổi config hoặc CI, không làm trong mục 4):
- Đặt mức sàn theo từng file (ví dụ 50 %) bên cạnh ngưỡng gộp 80 %.
- Đo coverage của integration trong CI (job `db`, `queue`). Tốn thêm thời gian job; hiện chỉ đo được ở máy.

**Để sau S4:** các nhánh nhỏ ở mục 3 (`customer-store`, `quick-reply-store`, `invite-mailer`, `teams.schemas`, `audit-log`, `smtp-sender`).

**Chờ Q hoặc lead BE, chưa có code nên không tính là thiếu test:**
- SLA, giờ làm việc, ngày lễ, routing: chờ Q7 và lead BE (U41, U44, U45).
- Zalo gửi ra 8b: chờ lead BE (U57).
- Staging, Terraform thật, sao lưu: chờ Q2.
- AI nội bộ: chờ Q1.
