# Code Review — Nhóm G: Tài liệu (README, ADR, CLAUDE.md, spec, QUESTIONS, quét PII)

- **Mốc code:** `main` = `25fe6e1` (PR-C1, #98). Nhóm A–C ở `a443721`, D–E ở `1dfd6c5`, F ở `61c1e79`.
- **Ngày rà soát:** 13/10/2026. **Người rà soát:** Claude (chính tác giả, xem mục "Giới hạn").
- **Phạm vi:** 34 file `.md` đang theo dõi (`git ls-files '*.md'`): `README.md`, `CLAUDE.md` gốc và 8 file thư mục con, 4 ADR, 7 spec, `QUESTIONS.md`, Brief, phụ lục, danh sách tính năng, `CHECKLIST-PRE-LAUNCH.md`, 6 báo cáo review.
- **Cách kiểm:** đọc từng file; đối chiếu với `git ls-files`, migration, catalog test; quét mẫu P5 trên cả 34 file; `git grep` hai chiều giữa tài liệu và mã.

## Tóm tắt

| Mức | Số | Mã |
|---|---|---|
| CRITICAL | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 1 | G-01 |
| LOW | 4 | G-02, G-03, G-04, G-06 |
| INFO | 3 | G-05, G-07, G-08 |

Không có bí mật hay PII thật (G-07). Điều đáng chú ý là các tài liệu **kiểm soát** (ADR-004, `QUESTIONS.md`) đã lệch khỏi mã mà không có công cụ nào báo.

---

## Phát hiện

### [MEDIUM] G-01 — ADR-004 "danh sách đóng" `SECURITY DEFINER` không còn khớp mã
- **File:** `docs/adr/ADR-004-rls-fail-loud.md:43-49`.
- **Nhóm:** G (liên quan B).
- **Mô tả:** ADR ghi "Ở S1 chỉ cho phép đúng các đối tượng sau" và "đối tượng thứ sáu phải qua cố vấn duyệt". Danh sách có 4 hàm + 1 view. Thực tế có **8 hàm** `SECURITY DEFINER` trong migration: 2 hàm có trong danh sách, **6 hàm không có**, và 2 hàm trong danh sách (`lookup_invite`, `accept_invite`) **chưa tồn tại** (chờ PR7, `rls-spec-M01.md:130,144`). Một người kiểm toán đọc ADR sẽ tưởng 5 đối tượng và không kiểm 6 hàm còn lại. Mỗi hàm thêm đều có N-số riêng (cột "N" dưới), nên quyết định có ghi, nhưng **không có test hay lint nào so tập hàm thật với danh sách**: `MIG-DEFINER` chỉ kiểm `search_path`, và các spec kiểm từng hàm riêng.
- **Bằng chứng:** phân tích từng `CREATE FUNCTION` có `SECURITY DEFINER` trong phần đầu hàm (không đếm file chỉ nhắc cụm từ trong chú thích, như `create_log_partitions`, `secure_log_partition`, `copy_policies_to_partitions`, `api_key_scopes_valid`, đều ghi "Not SECURITY DEFINER"):

| Hàm | Migration | Trong ADR | N |
|---|---|---|---|
| `app.support_access_ok` | `202610031700` | có | — |
| `app.memberships_for_user` | `202610031910` | có | N76 |
| `app.outbox_pending_orgs` | `202610061300` | **không** | N94 |
| `app.purge_inbound_event_keys` | `202610071220` | **không** | N104 |
| `app.channel_account_for_webhook` | `202610071300` | **không** | N101, N105 |
| `app.inbound_pending_orgs` | `202610071320` | **không** | N104 |
| `app.ensure_log_partitions` | `202610121500` | **không** | N110 |
| `app.log_default_partition_rows` | `202610131000` | **không** | N110 |
| `app.lookup_invite`, `app.accept_invite` | chưa có | có (cho phép) | chờ PR7 |

  `git grep -n -i "function.*invite" -- packages/db/migrations`: không có kết quả. View `app.org_users` (có trong ADR) tồn tại: `202610031900`.
- **Đề xuất:** (một PR docs + một test) cập nhật ADR-004 thành danh sách thật kèm cột N-số và ghi hai hàm của PR7 là "đã cho phép, chưa tạo"; thêm một test quét `pg_proc` (`prosecdef`, schema `app` và `public`) so với danh sách trong test, để thêm hàm thứ chín bắt buộc sửa danh sách. Ghi N-số.
- **Mức độ:** MEDIUM

### [LOW] G-02 — `README.md` mô tả trạng thái đầu Sprint 1
- **File:** `README.md:4-5, 83-91`.
- **Nhóm:** G.
- **Mô tả:** "Sprint 1 (nền móng) đang làm. Mới có khung monorepo, gói `domain` (UUIDv7) và API khung với `/healthz`; chưa có chức năng nghiệp vụ"; mục "Cấu trúc" ghi `worker/` và `db/` "mới là khung rỗng", `domain/` chỉ "UUIDv7". Thực tế: `apps/worker` 11 file nguồn (relay, bảo trì partition), `packages/db` 41 file nguồn và 50 migration, `packages/domain` có FSM hội thoại, `apps/api` có `auth`, `request-context`, `conversations`. `docs/` thiếu `specs/` và `reviews/`; thiếu lệnh `pnpm dev:worker`.
- **Bằng chứng:** `git ls-files <thư mục> | grep -v -E '\.(test|spec)\.'`: `apps/worker/src` 11, `packages/db/src` 41, `packages/domain/src` 8, `apps/api/src` 31. Tám thư mục thật sự rỗng: `apps/admin`, `apps/widget`, `packages/ai-core`, `channels`, `ui`, `testing`, `prompts`, `evals`.
- **Đề xuất:** viết lại phần trạng thái và cấu trúc theo mã thật; đây là việc của PR "refresh" (Q4).
- **Mức độ:** LOW

### [LOW] G-03 — Bốn ADR "chờ review PR0" và `rls-spec-M01.md` còn "NHÁP" dù đã cài
- **File:** `docs/adr/ADR-001..004` (dòng 5 mỗi file); `docs/specs/rls-spec-M01.md:5`.
- **Nhóm:** G.
- **Mô tả:** ADR-001 và ADR-002 "chờ review PR0"; ADR-003 "chờ review PR0 và cố vấn duyệt `auth_role`"; ADR-004 "chi tiết cài đặt chờ cố vấn duyệt"; `rls-spec-M01.md` "NHÁP, chờ cố vấn kỹ thuật duyệt (điều kiện mở PR1)". Mã của cả bốn đã chạy từ đầu tháng 10 (Drizzle, Better Auth 1.7.7, RLS fail-loud, `auth_role`); PR mới nhất trên `main` là #98. Không biết cố vấn đã duyệt hay chưa: **repo không ghi**, nên đây không thể kết luận "đã duyệt".
- **Bằng chứng:** dòng Trạng thái của năm file (đã dẫn); `git log -1 --format=%s origin/main` ra `... (#98)`.
- **Đề xuất:** anh xác nhận với cố vấn rồi cập nhật trạng thái kèm ngày; nếu chưa duyệt thì ghi rõ "đã cài, chưa duyệt" thay vì "chờ review PR0".
- **Mức độ:** LOW

### [LOW] G-04 — `CLAUDE.md` gốc lẫn hai tài liệu và dấu vết của một PR đã merge
- **File:** `CLAUDE.md:109-226`, `:41-44`, `:128`, `:136`.
- **Nhóm:** G.
- **Mô tả:** (1) **H1 thứ hai** ở dòng 109 ("CLAUDE.md — 2 bài học") giữa file, nên công cụ đọc theo tiêu đề thấy hai tài liệu; (2) mục "Cách apply" (`:210-224`) là hướng dẫn tạo PR đã làm, nhắc `6b829c1`; (3) bảng "Lịch sử" (`:201-206`) là nhật ký, không phải quy tắc; (4) khối "Trước PR3 (PR1b, PR2)" (`:41-44`: "Em KHÔNG tự commit") hết hiệu lực từ PR3; (5) ví dụ `app_password_123` (`:128`) là mẫu giả đánh dấu "KHÔNG", **không phải bí mật thật** (gitleaks 0), nhưng chính mẫu quét `password_` (`:136`) trúng nó và trúng tên cột `password_since` ở 12 dòng của `QUESTIONS.md` và `rls-spec-M01.md`: mỗi lần quét theo hướng dẫn đều ra dương tính giả; (6) quy tắc commit ghi `Claude <noreply@anthropic.com>` còn trailer thật là `Claude Sonnet 5.5 <noreply@anthropic.com>`: khác chữ, GitHub vẫn nhận diện.
- **Bằng chứng:** `grep -n "^# " CLAUDE.md` ra dòng 1 và 109; `git log -3 --format=%(trailers:key=Co-Authored-By)` trên `main`.
- **Đề xuất:** (anh đã chốt, làm ở PR "refresh") một H1; "Cách apply" và "Lịch sử" chuyển sang `docs/claude-changelog.md`; ví dụ chỉ dùng placeholder, đổi mẫu quét thành `password_[a-z0-9]{3,}=` hoặc loại tên cột; bỏ khối "Trước PR3".
- **Mức độ:** LOW

### [INFO] G-05 — Mã `last_error` (`E_*`) không có sổ đăng ký
- **File:** `docs/specs/outbox-spec.md`, `QUESTIONS.md`, `apps/worker/CLAUDE.md`, `docs/specs/zalo-channel-spec.md:39`.
- **Nhóm:** G.
- **Mô tả:** mã chạy thật chỉ có 3 mã `E_*`: `E_LEASE_EXPIRED` (ghi ở `outbox-spec`), `E_QUEUE` và `E_QUEUE_DOWN` (chỉ ở `QUESTIONS.md`, `apps/worker/CLAUDE.md`). Chúng thuộc không gian tên **khác** với mã API của Brief P9 (`rate_limited`, `conversation_already_claimed`, chữ thường): P9 không phải nơi đăng ký. `E_SECRET_DECRYPT` có trong spec Zalo nhưng chưa có mã (PR6). Bốn mã còn lại thấy trong `git grep` (`E_PREV`, `E_PROCESS`, `E_TIMEOUT`, `E_NOT_A_MESSAGE`) chỉ ở test.
- **Bằng chứng:** `git grep -h -o -E "\bE_[A-Z0-9_]{3,}\b" -- apps packages ':!*.test.ts' ':!*.spec.ts' ':!*.md' ':!*.sql' ':!*/test/*' | sort | uniq -c` → `E_LEASE_EXPIRED` 4, `E_QUEUE` 1, `E_QUEUE_DOWN` 4.
- **Đề xuất:** một bảng ở `outbox-spec.md` (hoặc `inbound-spec.md`) liệt kê mã `last_error` được phép; PR6 thêm các mã inbound vào đó (khớp F-03).
- **Mức độ:** INFO

### [LOW] G-06 — `QUESTIONS.md`: ba dòng hỏng và số không có dòng riêng
- **File:** `QUESTIONS.md:54-56`, `:107`, `:112`.
- **Nhóm:** G.
- **Mô tả:** ba dòng là `@@| N20 |`, `@@| N21 |`, `@@| N22 |`: **nội dung rỗng**, kèm tiền tố `@@` (dấu vết của một patch áp dở). Nội dung N20–N22 mất; không file nào trích dẫn chúng. Ngoài ra N34, N68, N80 không có dòng riêng: N68 được mã trích (`202610031830_create_conversations.sql:5`) nhưng định nghĩa nằm trong thân dòng khác (`QUESTIONS.md:107,136`); N80 ghi "chưa dùng". Còn lại: N111, N113–N115, N118–N120 là đề xuất của review, chưa ghi (đúng thiết kế).
- **Bằng chứng:** `grep -n "^@@" QUESTIONS.md` ra ba dòng 54–56; `git log -S'@@| N20 |' -- QUESTIONS.md` ra `399452c` (03/10/2026, "docs: add RLS spec M01, 4 ADR…"), tức hỏng từ đầu lịch sử; phân tích số dòng (`^\| \**N(\d+)\** \|`): 108 dòng, lớn nhất N121, không trùng, khoảng trống 20–22, 34, 68, 80, 111, 113–115, 118–120.
- **Đề xuất:** (PR "refresh") thay ba dòng hỏng bằng "N20–N22: nội dung mất, không còn được tham chiếu"; thêm dòng ngắn cho N34, N68, N80 trỏ tới nơi định nghĩa. **Không sửa trong PR review** (ràng buộc `QUESTIONS.md`).
- **Mức độ:** LOW

### [INFO] G-07 — Quét PII và bí mật: sạch; danh sách dương tính giả
- **File:** 34 file `.md`.
- **Nhóm:** G.
- **Mô tả:** mẫu P5 (email, email công ty, SĐT VN, 9–16 chữ số, hộ chiếu, địa chỉ, tên miền, tiền tố bí mật, họ + tên). **0 PII hay bí mật thật.**
- **Bằng chứng:**

| Mẫu | Dòng/File | Phân loại |
|---|---|---|
| email | 6 / 5 | `noreply@anthropic.com` (trailer), `nobody@example.test` (`C-auth.md:50`, fixture), `answer@1.2.0.md` (tên prompt, `prompts/CLAUDE.md:13`, Brief `:593`) |
| `@gani`, `@locthuy`, `@thesmile` | 30 / 7 | toàn tên gói `@gani/db`, `@gani/domain`…: 0 email công ty |
| SĐT VN, hộ chiếu, họ + tên | 0 / 0 | sạch |
| 9–16 chữ số | 11 / 7 | dãy thời gian của tên migration; `37476244877` (`QUESTIONS.md:73,130`) là mã chạy CI trên GitHub |
| địa chỉ | 2 / 1 | "4 đường tạo phiên" (`QUESTIONS.md:111,114`) |
| tên miền | 9 / 4 | `github.com`, `anthropic.com`, `oauth.zaloapp.com` |
| tiền tố bí mật | 17 / 3 | `CLAUDE.md:121-138`: bảng ví dụ "KHÔNG" và chính mẫu quét; `password_since` là tên cột (G-04) |

- **Đề xuất:** không cần sửa; giữ bảng này làm danh sách loại trừ cho lần quét sau.
- **Mức độ:** INFO

### [INFO] G-08 — Ba lệnh bằng chứng trong báo cáo dùng pathspec không hiệu lực
- **File:** `docs/reviews/A-foundation.md:116`; `docs/reviews/D-conversation-fsm.md:49`; `docs/reviews/F-inbound.md:6`.
- **Nhóm:** G (phương pháp của chính các báo cáo).
- **Mô tả:** ba báo cáo ghi `git grep ... -- 'apps/*/src' 'packages/*/src'`. Mẫu glob `apps/*/src` chỉ khớp **đúng đường dẫn thư mục**, không khớp file bên trong, nên lệnh luôn trả rỗng: kể cả với chuỗi chắc chắn có mặt. Kết quả "rỗng" trong ba chỗ đó **không phải bằng chứng**. Đã chạy lại bằng pathspec đúng; **cả ba kết luận vẫn đúng**.
- **Bằng chứng:**
  - kiểm chứng pathspec: `git grep -c "E_QUEUE_DOWN" -- 'apps/*/src'` rỗng (exit 1), trong khi `git grep -h -o "E_QUEUE_DOWN" -- apps ':!*.test.ts' ':!*.spec.ts' ':!*/test/*'` ra 5 kết quả (4 trong mã nguồn, 1 trong `apps/worker/CLAUDE.md`).
  - A-foundation:116 chạy lại `git grep -n -E "sql\.raw|sql\.identifier" a443721 -- packages apps ':!*.md'`: rỗng (exit 1). Kết luận đúng.
  - D-conversation-fsm:49 chạy lại `git grep -n -E "platformSentAt|platform_sent_at" a443721 -- apps packages ':!*.test.ts' ':!*.spec.ts' ':!*.md' ':!*.sql'`: 8 dòng, không dòng nào so sánh với `now()` (chỉ `coalesce(..., now())` ở `message-store.ts:83`). Kết luận D-02 đúng.
  - F-inbound:6 chạy lại `git grep -n -i -E "InboundProcessor|webhook" -- apps packages ':!*.test.ts' ':!*.spec.ts' ':!*.md' ':!*.sql'`: 3 dòng, đều là **chú thích** trong `packages/db/src/inbound-store.ts` (`:10`, `:62`) và `schema/inbound-event-keys.ts:4`; không có mã webhook hay bộ xử lý. Kết luận "ngoài mốc" đúng.
- **Đề xuất:** khi nhắc lại các lệnh, dùng `-- apps packages` kèm loại trừ; quét bằng một lệnh chứng minh được (ví dụ chạy cùng pathspec với một chuỗi đã biết).
- **Mức độ:** INFO

---

## Đã kiểm, không có phát hiện

| Mục | Cách kiểm | Kết quả |
|---|---|---|
| Trạng thái spec | dòng "Trạng thái" của 7 file | 6 "ĐÃ DUYỆT" (fsm, outbox, realtime 06/10; inbound, zalo, channel-policy 07/10); `rls-spec-M01` là G-03 |
| `CLAUDE.md` thư mục con | `ls` 9 thư mục được liệt kê ở `CLAUDE.md:83-91` | cả 9 `CLAUDE.md` tồn tại (5 trong số thư mục đó chưa có mã: `apps/admin`, `apps/widget`, `packages/ai-core`, `prompts`, `evals`; xem G-02) |
| `.claude/settings.json` | đọc file đang theo dõi | chỉ có danh sách `deny`; không bí mật |
| Hạng mục quy tắc PR ≤ 400 dòng | (lệch thực tế 454–464) | đã có PR docs riêng, không ghi phát hiện |
| `.env.example` trong tài liệu | `git grep -n "DATABASE_URL"` ở `.md` | chỉ tên biến hoặc `<role>:<mật khẩu>`; ngoại lệ duy nhất là mẫu giả `app_password_123` (G-04) |

## Đề xuất ghi vào `QUESTIONS.md` (chưa ghi, anh quyết)

| Số đề xuất | Nội dung | Phát hiện |
|---|---|---|
| N125 | ADR-004 cập nhật danh sách `SECURITY DEFINER` + test so tập hàm thật | G-01 |
| N126 | PR docs "refresh": README, trạng thái ADR/rls-spec, `CLAUDE.md` (một H1, `docs/claude-changelog.md`, mẫu quét), dòng hỏng ở `QUESTIONS.md` | G-02, G-03, G-04, G-06 |
| N127 | Sổ đăng ký mã `last_error` (gộp với F-03) | G-05 |

## Giới hạn

Rà soát bởi chính tác giả. Checklist cứng + bằng chứng chạy được. Không thay thế review độc lập.

- Không có cách xác minh từ repo việc cố vấn đã duyệt ADR hay `rls-spec-M01` (G-03).
- Quét PII là quét mẫu: file đã dán vào chat hoặc nằm ngoài `git ls-files` không nằm trong phạm vi.
- G-08 ảnh hưởng chính các báo cáo của tác giả; các lệnh còn lại đã được đọc lại và có pathspec đúng (`-- apps packages`).
