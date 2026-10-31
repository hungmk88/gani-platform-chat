# packages/db — Schema & RLS

Đọc trước khi sửa. Sai ở đây gây rò dữ liệu chéo tenant (sự cố mức 1).

## Quy tắc

- Mọi bảng nghiệp vụ có `org_id`. Bảng nhạy cảm có thêm `workspace_id`.
- Khóa ngoại giữa bảng nghiệp vụ luôn là cặp `(org_id, x_id)` →
  bảng cha phải có `UNIQUE(org_id, id)`.
- Bật **ENABLE + FORCE ROW LEVEL SECURITY** + `CREATE POLICY` cho mọi bảng.
- Migration theo mẫu expand → migrate → contract (≥ 2 release).
- Migration SQL không được viết `BEGIN`/`COMMIT` bên trong (cũng không `ROLLBACK`, `START TRANSACTION`, `END`, `ABORT`): runner đã bọc mỗi file trong một transaction; lint `MIG-TXN` chặn.
- Index nặng chạy `CREATE INDEX CONCURRENTLY`, không khóa `messages` (review DB-03):
  - File riêng, có dòng `-- migrate:no-transaction` trong phần chú thích đầu file (cùng khối với `-- rollback:`), và **đúng một câu lệnh** (lint `MIG-NOTXN`): runner chạy file này ngoài transaction, không `lock_timeout`.
  - Lỗi giữa chừng để lại index INVALID: tìm trong `pg_index` (`indisvalid = false`), `DROP INDEX CONCURRENTLY` rồi chạy lại. Không viết `IF NOT EXISTS` (lint `MIG-NOTXN` chặn: lần sau sẽ bỏ qua index INVALID); còn index INVALID nào thì runner không ghi nhận file no-transaction.
  - Bảng partition (`messages`, `conversation_events`, …): `CONCURRENTLY` không chạy trên bảng cha. Tạo index trên từng partition (mỗi partition một file no-transaction), rồi `CREATE INDEX … ON ONLY` bảng cha và `ALTER INDEX … ATTACH PARTITION` trong một file thường.
- Mỗi file thường chạy với `SET LOCAL lock_timeout = 5000` (ms): không lấy được khóa (`55P03`) thì rollback, thử lại tối đa 3 lần (chờ 2 s, 4 s), hết lượt thì dừng và báo lỗi. Migration không bao giờ xếp hàng sau một transaction dài mà chặn mọi truy vấn của bảng.
- Pool nào cũng đi qua `createDbPool`, nó đặt cho mọi kết nối `statement_timeout` 15 s, `lock_timeout` 5 s (cả khóa tư vấn), `idle_in_transaction_session_timeout` 30 s (N109). Cần lâu hơn thì truyền giá trị riêng; không có giá trị 0 (tắt giới hạn). Runner migration dùng client riêng nên không bị giới hạn này.

## Điền lại đoạn trích (U30, N169)

Chạy một lần trên mỗi môi trường có hội thoại từ trước migration `202610291000`, sau khi migration đã áp, **trước** khi báo FE bật đoạn trích:

1. `APP_ENV=<môi trường> DATABASE_URL_MIGRATION=<url> pnpm --filter @gani/db backfill:last-message-preview --dry-run`: in số hội thoại sẽ điền, không ghi gì.
2. Bỏ `--dry-run` để chạy thật.

- Chỉ `migration_role`: từ pipeline hoặc runbook của ops, không từ máy dev hay AI. `--org <uuid>` chỉ chạy một công ty.
- Lô 1000 hội thoại, mỗi lô một transaction. Chạy lại an toàn: lần sau không ghi gì, và không bao giờ đè đoạn trích mới.
- Thời gian đo (39 partition, 2 triệu tin, khoảng 20 000 hội thoại): lần chạy đầu sau khi Postgres khởi động lại (cache nguội) khoảng 50–55 s; các lần sau (cache nóng) khoảng 4 s.
- Script chỉ giữ khóa dòng từ UPDATE tới COMMIT của từng lô (rất ngắn). Phần chậm là đọc `messages`, không giữ khóa nào.
- Log ra stdout (log của job): mỗi lô `processed X/Y, ETA Zs`, cuối cùng số đã điền. Không có nội dung tin, khách hay id hội thoại. Lỗi ra stderr, exit khác 0.

## 4 role DB (không được dùng lẫn)

| Role | RLS | Thiếu tenant | Dùng cho |
|---|---|---|---|
| `app_role` | Bị lọc, không owner, không BYPASSRLS | **Báo lỗi** | API, worker, traffic thật |
| `migration_role` | BYPASSRLS | — | Chỉ pipeline migration |
| `support_role` | Bị lọc như app_role | Báo lỗi | Debug, cần `access-session` có lý do |
| `auth_role` | Bị lọc, không có policy nào trên bảng nghiệp vụ nên bị từ chối toàn bộ | — | Pool riêng của Better Auth; chỉ GRANT theo cột trên bảng auth (spec §3.2) |

## Kiểm chứng bắt buộc

- `tenant-isolation.spec`: dùng `app_role` không set tenant → phải báo lỗi.
- `workspace-isolation.spec`: Sales workspace A không đọc được hội thoại workspace B.
- Lint migration: mọi `CREATE TABLE` mới phải có `ENABLE ROW LEVEL SECURITY` + `FORCE`.
  CI báo đỏ nếu thiếu; GitHub Free không enforce branch protection nên không chặn được merge (N38), anh kiểm tay.

- Chữ tiếng Việt để tìm kiếm lưu ở **NFC** lúc ghi, không chuẩn hóa từng dòng lúc đọc (`customers.display_name`: `updateCustomer` + `customers_display_name_nfc_check`, 202611010900; tìm kiếm chỉ chuẩn hóa `q`). Thêm cột chữ để tìm thì làm giống vậy.
- Cột lưu sẵn chứa PII trên bảng có quyền theo cột (`conversations.last_message_preview`, N169): **không** cấp cho `support_role`, cấp UPDATE cho `app_role` trong cùng migration (`grants.spec` liệt kê đúng từng cột). File migration đã áp thì không sửa: runner từ chối, thêm migration mới.

## Phân tầng merge của BE (CLAUDE.md gốc, #466; anh chốt 31/10/2026)

Mọi PR mở ở draft. "Sẵn sàng merge" = 9 job `ci.yml` xanh trên đúng HEAD, HEAD khớp `git ls-remote`, `mergeable_state = clean`
(đọc sau khi mọi job xong), job `docker` chạy thật có log Trivy (PR chỉ docs: Skipped, kèm log của job `changes`), GitGuardian
success trên đúng HEAD.

- **Tầng 1/2: BE tự merge** khi đủ các điều kiện trên, chuyển ready ngay trước khi merge. Gồm mọi PR không gây hậu quả không hoàn
  tác được: migration **tạo mới** (hàm, bảng, cột), test RLS, code worker, code API thêm mới, docs, comment.
- **Tầng 3: CEO bấm merge**, sau khi BE báo "Sẵn sàng merge" và CEO comment phê duyệt vào PR:
  - migration `DROP` (bảng, cột, hàm; ví dụ #386);
  - migration phá hủy dữ liệu (`ALTER TYPE`, `DROP CONSTRAINT` có dữ liệu phụ thuộc);
  - đổi `key_version`, xoay khóa mã hóa (#461);
  - sửa hoặc xóa audit log; đổi RLS policy làm lộ dữ liệu;
  - rollback production.

## Cấm

- Không dùng UUIDv4. Chỉ UUIDv7.
- Không `ON DELETE CASCADE` từ `organizations`, cũng không từ `workspaces` — dùng soft delete + `TenantPurgeJob`.
- Không thêm bảng mới mà không cập nhật `tenant-isolation.spec`.
- Không bao giờ đưa input từ client vào `sql.identifier()`, `.as()`, hoặc bất kỳ chỗ nào chèn tên
  định danh (tên bảng/cột/alias) vào câu SQL. Tên bảng/cột phải là hằng số trong code hoặc lấy từ whitelist.
- CVE lịch sử GHSA-gpj5-g38j-94v9 (Drizzle 0.45.1 trở về trước, sửa ở 0.45.2) là bài học:
  escape tên định danh rất dễ sai.
