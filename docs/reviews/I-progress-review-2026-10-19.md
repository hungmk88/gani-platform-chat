# Tiến độ và review toàn dự án — 19/10/2026 (I)

- **Mốc:** `main` = `acb0335`, cộng 8 PR đang mở #115–#122 (đầu nhánh ở mục 3).
- **Nối tiếp:** `H-full-codebase-audit.md` (audit 19/10). File này chỉ ghi **thay đổi từ H**: tiến độ, trạng thái từng phát hiện, phát hiện mới.
- **Phương pháp lần này:** ba lượt đọc độc lập, mỗi lượt một agent không viết mã ở đây; điểm nặng nhất em tự kiểm lại bằng lệnh hoặc test:
  1. diff của 8 PR đang mở, kể cả tương tác giữa các nhánh;
  2. bảng chuyển trạng thái FSM so với Brief P14, `fsm-spec.md` và N96;
  3. đọc từng dòng đủ 50 migration (H mới đọc 6).
- **Độ tin cậy:** CONFIRMED (đã kiểm bằng lệnh, test hoặc trích dẫn hai phía) / POTENTIAL.

---

## 1. Tóm tắt

- **Nền backend M1.1–M1.2 xong trước lịch** (S1 chính thức bắt đầu 16/11/2026).
- **Chưa có luồng chat nào chạy từ đầu đến cuối.** Phần còn thiếu nằm cả trên đường găng: webhook, connector Zalo, realtime, gắn module hội thoại vào API, UI.
- **Bảo mật:** 3 lỗi P1 trong code của H (DB-01, SEC-01, SEC-03 cùng AR-03/AR-04) **đã có PR sửa**, chờ merge. SEC-02 chờ sơ đồ triển khai (N112).
- **Review lần này:** 0 P1 mới. 1 mâu thuẫn tài liệu cần anh quyết (**FSM-01**, N130). Một test rỗng nghĩa trong PR của em đã sửa. 8 điểm P3 ở migration.
- **8 PR mở gộp lại với nhau và với `main` không xung đột; mọi kiểm tra xanh** (bảng ở mục 7).

## 2. Tiến độ so với Brief P21

| Mốc (sprint)      | Deliverable                                                                                                                | Trạng thái       | Ghi chú                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------- |
| M1.1 (S1)         | Monorepo, CI (SCA, secret scan), `tenancy`, `identity` (đăng nhập, 2FA, khóa TK, đổi tổ chức), RLS 4 role + harness cô lập | **Xong**         | CI GitHub đang bị chặn vì thanh toán (mục 8)                                    |
| M1.1 (S1)         | Terraform staging                                                                                                          | **Chưa**         | Chờ Q2 (cloud); OPS-01                                                          |
| M1.2 (S2)         | `conversations`, FSM 21 transition, outbox + relay + kill-test, kho `inbound_events`                                       | **Xong**         | FSM-01 (mục 4)                                                                  |
| M1.2 (S2)         | Ingress webhook chung                                                                                                      | **Chưa**         | Kho có, endpoint chưa (PR6)                                                     |
| M1.2 (S2)         | Socket.IO khung                                                                                                            | **Chưa**         |                                                                                 |
| M1.2 (S2)         | Module hội thoại trong API                                                                                                 | **Một phần**     | Có code, **chưa gắn** vào `AppModule`                                           |
| M1.3 (S3)         | Connector Zalo, làm mới token, Inbox UI                                                                                    | **Chưa**         | Cần Q6 (OA có API)                                                              |
| M1.3 (S3)         | `channel_policies`                                                                                                         | **Tạm**          | Bảng giá Zalo tạm trong migration (N124)                                        |
| M1.4 (S4) → Đợt 2 | Bot, CRM, lead, ticket, AI, KB, admin, widget                                                                              | **Chưa bắt đầu** | `apps/admin`, `apps/widget`, `packages/ai-core`, `packages/channels`: 0 file mã |
| —                 | Tạo user/org (invite, bootstrap)                                                                                           | **Chưa**         | DB-02                                                                           |
| —                 | Hạ tầng triển khai, backup/PITR                                                                                            | **Chưa**         | OPS-01, chờ Q2                                                                  |

**Số liệu mã (đếm `git ls-files`, không tính test):**

| Gói               | File              |
| ----------------- | ----------------- |
| `packages/db`     | 94 (50 migration) |
| `apps/api`        | 32                |
| `apps/worker`     | 12                |
| `packages/domain` | 8                 |
| `packages/config` | 2                 |

Cộng thêm 103 file test.

**Rủi ro lịch:**

- Q1 pháp lý (hạn 14/12/2026).
- Q2 cloud (chặn OPS-01 và staging).
- Q6 Zalo OA (chặn M1.3).
- Chưa có lát dọc: rủi ro tích hợp dồn về S3–S4.

## 3. Trạng thái các phát hiện của H

| ID                         | Mức             | Trạng thái 19/10                                  | PR (đầu nhánh)                            |
| -------------------------- | --------------- | ------------------------------------------------- | ----------------------------------------- |
| DB-01                      | P1              | Đã sửa, chờ merge                                 | #115 `225f98c` (DB); #116 `6330ec7` (API) |
| SEC-01                     | P1              | Đã sửa, chờ merge                                 | #117 `4b031ef`                            |
| SEC-02 (= C-01)            | P1 khi có proxy | Giữ mặc định của thư viện tới khi có sơ đồ (N112) | —                                         |
| AR-01, DB-02, OPS-01       | P1 (go-live)    | Chưa xây                                          | —                                         |
| AR-03, AR-04, SEC-03       | P2/P3           | Đã sửa, chờ merge                                 | #118 `8813135`                            |
| DB-03                      | P2              | Đã sửa, chờ merge                                 | #121 `7b790ed`                            |
| AR-05                      | P2              | Đã sửa, chờ merge                                 | #122 `5e32e26`                            |
| TEST-01                    | P3              | Đã sửa, chờ merge                                 | #119 `e8c9573`                            |
| AR-02                      | P2              | **Đề nghị hoãn** (mục 6)                          | —                                         |
| OPS-02, E-01               | P2 / MEDIUM     | Làm tiếp: PR-K, PR-L (mục 6)                      | —                                         |
| E-02                       | P3              | Làm tiếp: PR-J (mục 6)                            | —                                         |
| Báo cáo H + N112/N113/N129 | docs            | Chờ merge                                         | #120 `541723f`                            |
| Các P3/INFO còn lại của H  |                 | Không đổi                                         | —                                         |

PR này (I) xếp chồng lên #120 (base là nhánh của #120): merge #120 trước.

## 4. Phát hiện mới

### 4.1 FSM so với Brief P14

Kết quả chung: 21 transition (T01–T21) và 4 dòng "không đổi" (N1–N4) **khớp** P14 dòng 691–705 và các quyết định N96. `decide.test.ts` phủ đủ 21 dòng và có test đột biến.

| ID         | Mức    | Conf      | Nội dung                                                                                                                                                                                                                                                                                                                                                                                 | Hướng                                                                                               |
| ---------- | ------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **FSM-01** | **P2** | CONFIRMED | Brief v1.0 dòng 700 (12/10): đóng hội thoại bắt buộc kết quả `resolved \| no_response \| spam`; "Thắng/Thua thuộc lead". Mã cho phép `won \| lost \| resolved \| resolved_by_bot` ở `packages/domain/src/conversation/types.ts:12` và `CHECK` `conversations_outcome_check` ở `202610061100:26`, theo N96 F4 (06/10, trước Brief v1.0). Thiếu `no_response`, `spam`; thừa `won`, `lost`. | **Đã chốt 19/10: phương án (a) (N130)**, sửa ở `fix/conversation-outcomes-n130`. Chưa có endpoint đóng hội thoại nên chưa có dữ liệu thật; đổi bây giờ rẻ nhất |
| FSM-02     | P3     | CONFIRMED | Chưa ép quyền theo vai trò khi chuyển trạng thái. Brief dòng 720: reassign chỉ Manager/Admin; chuyển và đóng không kiểm người gọi có phải agent đang giữ. `decide` và `ConversationStateMachine` không xem vai trò                                                                                                                                                                       | Làm cùng endpoint hội thoại đầu tiên (Phụ lục B)                                                    |
| FSM-03     | INFO   | CONFIRMED | Brief không nói, mã đã chọn: T04 đóng cả hội thoại đang `hold`; T08 chỉ có trong F6 (văn xuôi); chuyển hoặc gán cho chính người đang giữ không bị chặn; `release_after_hours` trong giờ và `wait_expired` chưa quá SLA trả `guard_failed`, không `no_change`                                                                                                                             | Ghi nhận; xem lại khi viết job ngoài giờ                                                            |
| FSM-04     | INFO   | CONFIRMED | Test API chưa chạy T04, T07, T18, T19, T20 (chỉ test domain phủ)                                                                                                                                                                                                                                                                                                                         | Thêm khi có endpoint                                                                                |

### 4.2 Migration (đọc đủ 50 file)

Kết quả chung, tất cả CONFIRMED:

- mọi bảng theo org đều ENABLE + FORCE RLS và có policy;
- khóa ngoại ghép `(org_id, …)`, không `CASCADE`;
- không có UUIDv4;
- 8 hàm `SECURITY DEFINER` đều khóa `search_path`, thu `PUBLIC`, chỉ cấp đúng một role.

| ID     | Mức  | Conf      | File                               | Nội dung                                                                                                                                                                                                           | Hướng                                                     |
| ------ | ---- | --------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| DBM-01 | P3   | CONFIRMED | `202610031830:48`                  | `GRANT SELECT ON public.conversations TO support_role` cấp cả bảng, nên `external_user_id` (id Zalo của khách, thêm ở `202610071310:10`) tự lộ cho `support_role`. Trái cách cấp theo cột ở `1720`, `7000`, `7210` | Migration đổi sang GRANT theo cột; gộp với B-03           |
| DBM-02 | P3   | CONFIRMED | `202610031830:47`                  | `app_role` UPDATE được mọi cột `conversations`, kể cả `id`, `org_id`, `workspace_id`                                                                                                                               | Đã có trong DB-05 của H                                   |
| DBM-03 | P3   | CONFIRMED | `202610031720:1`                   | Ghi chú rollback "bỏ 9 policy `*_support`" quên bản đã chép xuống partition (`copy_policies_to_partitions`, dòng 43–44): rollback kế (`DROP FUNCTION app.support_access_ok`) sẽ lỗi vì còn phụ thuộc               | Sửa ghi chú khi viết migration bù                         |
| DBM-04 | P3   | CONFIRMED | `202610071200:1`, `202610061100:1` | Ghi chú rollback thiếu phụ thuộc: FK của `conversations` (`202610071310:13`) trỏ `channel_accounts`; trigger `conversations_fsm_guard` (`202610061110`) đọc các cột sẽ bỏ                                          | Như trên                                                  |
| DBM-05 | P3   | CONFIRMED | `202610031910:15`                  | `memberships_for_user(p_user_id)` tin tham số: một kết nối `auth_role` bị chiếm đọc được tổ chức và vai trò của người khác                                                                                         | Thêm `AND p_user_id = app.auth_user_id()` hoặc bỏ tham số |
| DBM-06 | P3   | CONFIRMED | `202610031700:14`                  | `support_access_ok()` không lọc `created_at`: quét mọi partition `platform_access_logs` ở mỗi truy vấn của support                                                                                                 | Thêm điều kiện 60 phút (đúng với CHECK `202610031620:19`) |
| DBM-07 | P3   | POTENTIAL | `src/inbound-store.ts:143`         | Claim inbound theo workspace không có index khớp (`inbound_events_due_idx` chỉ `(org_id, available_at)`)                                                                                                           | Đo khi có tải thật, rồi thêm index `CONCURRENTLY`         |
| DBM-08 | INFO | CONFIRMED | mọi file                           | Khối `-- rollback:` chỉ là văn xuôi, chưa từng chạy; `202610071110` dùng động từ `seed` cho dữ liệu tham chiếu chạy ở mọi môi trường (dễ đọc nhầm quy tắc "không seed ở prod")                                     | Theo dõi                                                  |
| —      | —    | —         | `202610061100`, `202610071310`     | Index và CHECK tạo trong transaction, không `NOT VALID`                                                                                                                                                            | Đúng lúc đó vì bảng rỗng; từ nay theo DB-03 (#121)        |

### 4.3 Review độc lập 8 PR đang mở

- **Không có P1.**
- Ba nhánh cùng sửa `auth.config.ts` (#116, #117, #118) gộp sạch; logic không va nhau.
- Không file nào vượt 500 dòng, không PR nào vượt 400 dòng; quét secret sạch.

| ID     | PR   | Mức | Conf      | Nội dung                                                                                                                                                                                                                             | Xử lý                                                                                                       |
| ------ | ---- | --- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| PRR-01 | #119 | P2  | CONFIRMED | Ca 9c rỗng nghĩa khi DB đã có đủ partition (`missing = 0`, kỳ vọng `[0, 0]`)                                                                                                                                                         | **Đã sửa** `e8c9573`: hỏi 12 tháng, `missing > 0`. Kiểm đột biến "tạo 0 partition": bản cũ xanh, bản mới đỏ |
| PRR-02 | #116 | P3  | CONFIRMED | Khi trigger của #115 đã thu hồi phiên, hai test phiên của #116 vẫn xanh dù bỏ bộ lọc của adapter                                                                                                                                     | **Đã sửa** `6330ec7`: test gỡ thu hồi trước khi kiểm. Bỏ bộ lọc: bản cũ 1 test đỏ, bản mới 3                |
| PRR-03 | #117 | P3  | CONFIRMED | Lỗi ném đồng bộ thoát khỏi bộ làm sạch (chỉ bắt promise bị từ chối)                                                                                                                                                                  | **Đã sửa** `4b031ef`, có test (đỏ trên mã cũ)                                                               |
| PRR-04 | #121 | P3  | CONFIRMED | File no-transaction có `IF NOT EXISTS` sẽ bỏ qua index INVALID rồi vẫn ghi nhận                                                                                                                                                      | **Đã sửa** `7b790ed`: lint cấm, runner không ghi nhận khi còn index INVALID (test đỏ trên mã cũ)            |
| PRR-05 | #118 | P3  | CONFIRMED | problem+json bỏ `assignedUserId` của `conversation_already_claimed` (P9 yêu cầu); mã 404 hai kiểu chữ (`NOT_FOUND` / `not_found`); lỗi sau bộ parser rơi vào handler mặc định của Express (HTML, in stack ra stderr, đã có từ trước) | **Làm trước endpoint claim đầu tiên** (chưa có endpoint dùng tới)                                           |
| PRR-06 | #118 | P3  | CONFIRMED | `/list-sessions` vẫn trả token của các phiên (không dùng được thiếu secret, xem N113)                                                                                                                                                | Ghi nhận ở N131                                                                                             |
| —      | #119 | —   | —         | "Mất kiểm thứ tự org cũ nhất"                                                                                                                                                                                                        | **Không đúng**: `mine(1000, 60)` vẫn so `[A, B]` theo đúng thứ tự hàm trả                                   |
| —      | #121 | —   | —         | "`spyOn` không được khôi phục"                                                                                                                                                                                                       | **Không đúng**: `afterEach` gọi `vi.restoreAllMocks()`                                                      |

#122 (AR-05): reviewer lần hết mọi đường ghi `conversations`, không còn đường lấy khóa hàng trước khóa tư vấn; claim-race vẫn đúng 1 thắng.

## 5. Bảng tổng phát hiện còn mở (H + I, đã khử trùng)

| Mức  | H còn mở sau khi các PR merge                       | Mới (I)                                           | Cộng |
| ---- | --------------------------------------------------- | ------------------------------------------------- | ---- |
| P1   | 4 (SEC-02 chờ sơ đồ; AR-01, DB-02, OPS-01 chưa xây) | 0                                                 | 4    |
| P2   | 2 (AR-02, OPS-02)                                   | 1 (FSM-01)                                        | 3    |
| P3   | 16 (18 của H, trừ SEC-03 và TEST-01)                | 9 (FSM-02, DBM-01, DBM-03…DBM-07, PRR-05, PRR-06) | 25   |
| INFO | 10                                                  | 3 (FSM-03, FSM-04, DBM-08)                        | 13   |

DBM-02 trùng DB-05 của H, không đếm lại.

## 6. Việc tiếp theo (đã duyệt 19/10/2026)

| #   | Việc                                                                                       | Nhánh                                | Ghi chú                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | E-02: `failOutboxEvent` kiểm `attempts` như kho inbound                                    | `fix/db-outbox-fail-attempts` (PR-J) | Test relay cũ fail claim của relay mới → `null`                                                                                                               |
| 2   | OPS-02a: HTTP của worker `/healthz` + `/metrics` (đếm của relay, không nhãn org)           | `feat/worker-health-metrics` (PR-K)  | Prometheus đã chốt ở Brief P4; không thêm dependency                                                                                                          |
| 3   | OPS-02b + E-01: `app.outbox_stats()` (`SECURITY DEFINER`, chỉ số tổng) → gauge của spec §7 | `feat/db-outbox-stats` (PR-L)        | Cập nhật danh sách ADR-004                                                                                                                                    |
| 4   | AR-02: cờ bật/tắt relay                                                                    | —                                    | **Đề nghị hoãn.** Ở production chưa có đường mã nào ghi outbox (module hội thoại chưa gắn), nên relay chạy cũng không đẩy gì. Gộp vào lát dọc khi có consumer |
| 5   | PRR-05, FSM-02                                                                             | —                                    | Trước endpoint hội thoại đầu tiên                                                                                                                             |
| 6   | DBM-01, DBM-05, DBM-06 cùng DB-05                                                          | một PR migration "thu hẹp quyền"     | Sau khi #115 merge                                                                                                                                            |
| 7   | Lát dọc: webhook → inbound → message → outbox → consumer → realtime                        |                                      | Đề nghị ưu tiên sau khi các PR trên merge (H, mục C)                                                                                                          |

## 7. Kiểm chứng

Gộp thử `main` + 8 nhánh (đầu nhánh ở mục 3) trên một worktree tạm, PostgreSQL 16 cục bộ, DB mới tinh:

| Lệnh                                                          | Exit | Ghi chú                                     |
| ------------------------------------------------------------- | ---- | ------------------------------------------- |
| merge 8 nhánh                                                 | 0    | không xung đột                              |
| `pnpm build` / `lint` / `typecheck` / `test` / `format:check` | 0    | unit: domain 89, db 47, worker 112, api 236 |
| `pnpm --filter @gani/db lint:migrations`                      | 0    |                                             |
| `pnpm --filter @gani/db migrate`                              | 0    | 50 file                                     |
| `pnpm --filter @gani/db test:integration`                     | 0    | 679/679                                     |
| `pnpm --filter @gani/api test:integration`                    | 0    | 69/69                                       |
| `pnpm --filter @gani/api smoke`                               | 0    |                                             |

Từng nhánh có commit mới cũng chạy riêng các lệnh trên trước khi push (số liệu trong mô tả từng PR).

## 8. Việc anh cần làm hoặc quyết

| Việc                                         | Vì sao                                    | Hạn đề xuất                   |
| -------------------------------------------- | ----------------------------------------- | ----------------------------- |
| Sửa thanh toán GitHub                        | Mọi job CI đang không được cấp runner     | Ngay                          |
| Merge #115–#122 (#120 trước PR này)          | Gộp đã kiểm, không xung đột               | Khi CI xanh                   |
| Đóng PR #3                                   | Mọi file đã có trên `main` ở dạng mới hơn | Ngay                          |
| N130 (FSM-01): **đã chốt 19/10, phương án (a)** | Sửa ở nhánh `fix/conversation-outcomes-n130` | Xong |
| N112: sơ đồ proxy                            | SEC-02                                    | Trước go-live                 |
| Q1, Q2, Q6                                   | Đường găng                                | Theo Brief P22                |

## Giới hạn

- Các agent đọc mã, không chạy; em tự kiểm lại bằng lệnh và test các điểm FSM-01, DBM-01, DBM-03, PRR-01…PRR-04.
- Hạng P3 của migration dựa trên đọc SQL, chưa đo tải (DBM-06, DBM-07).
- Review do cùng một hệ thống viết phần lớn mã; không thay thế review của người hoặc pentest (Brief: hợp đồng pentest ký trước S3).
