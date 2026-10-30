# Tiến độ Backend Đợt 1, cập nhật (31/10/2026)

Người soạn: nhóm Backend · `main` lúc đo: `7ac7881` (30/10/2026 17:20 UTC, tức 31/10 giờ Việt Nam) · Chỉ tính phần Backend, không có %
cho cả dự án. Mốc so sánh: `docs/reviews/backend-progress-20261030.md` (đo trên `b1c5a03`). Mọi căn cứ đối chiếu file trên `main`.

## 1. Tóm tắt

- Từ `b1c5a03` tới `7ac7881`: **không có tính năng mới**. Có 25 commit vào `main`, trong đó 15 PR Backend, cả 15 đều là test, CI,
  chặn PII trong log hoặc báo cáo; 7 PR là màn admin của FE; 3 PR là tài liệu.
- Tiến độ theo hai mẫu số **giữ nguyên**: A = 17/50 (34 %), B ≈ 15/29 (≈ 52 %). Cách chấm như báo cáo 30/10, mục 1.
- Mẫu số A là danh sách 50 mã Đợt 1 theo Brief v0.4. Brief v1.0 có 58 mã Đợt 1 (50 + 8 mã thêm); phần giải thích ở
  `docs/reviews/backend-backlog-20261031.md`, mục "Mẫu số".
- Rủi ro tiến độ nằm ở các quyết định chưa có (Q1/Q2, U57, Q7), không nằm ở code.

## 2. Việc Backend đã làm chiều 30/10 (chất lượng, không phải tính năng)

| Việc | PR | Kết quả |
|---|---|---|
| Báo cáo tiến độ, rà độ phủ test | #422, #423 | 4 điểm mù của cách đo coverage; 19 file dưới 70 % |
| Không lộ PII trong log (quy tắc 5) | #439, #440 | Che PII ở API và worker, kể cả lúc crash; không in `detail` của lỗi PostgreSQL. Test chạy tiến trình thật, 3 tình huống |
| Cổng coverage theo từng file | #436 | `ci.yml` có 9 job (thêm `coverage`). Mỗi file: dòng ≥ 80 %, nhánh ≥ 70 %, gộp unit với integration. 7 file nợ ở #433, hạn 28/12 |
| SECURITY DEFINER: PUBLIC không chạy được | #426 | Ca từ chối chung cho 16 hàm |
| Sửa test giả che lỗi đọc chéo tổ chức | #431 | Ca cũ nuốt lỗi khóa ngoại; nay assert vô điều kiện |
| Test 2 file coverage không đo được | #434 | `member-role-store`, `auth-db` |
| RLS chéo tổ chức | #442, #443, #424, #446, #448 | Mục 3 |

## 3. Cách ly giữa các công ty (RLS), bước 2

- **Ca đọc chung (#442):** công ty A chỉ đọc được dòng của mình trên 22 bảng `app_role` đọc được, kể cả khi ngữ cảnh có workspace
  của công ty B. Bảng thêm sau tự được kiểm.
- **Ca riêng từng bảng**, mỗi PR có kiểm đột biến policy trên DB local; mọi đột biến đều bị bắt:

| Bảng | PR | Ca | Đột biến bị bắt |
|---|---|---|---|
| `messages` | #442 | ghi | 3/3 (cả PR) |
| `message_deliveries` | #443 | ghi, sửa | 2/2 |
| `customer_identities` | #424 | đọc, ghi | 1/1 |
| `idempotency_keys` | #446 | đọc, ghi, sửa | 3/3 |
| `agent_settings` | #448 | ghi, sửa | 2/2 (đột biến thứ 3 đã làm ở #442) |

- **Còn lại:**
  - `audit_logs`: plan trước; kiểm cả bảng cha, không chỉ một partition.
  - 4 bảng một phần: `conversation_events` (ghi), `quick_replies` (ghi), `feature_flags_overrides` (đọc), `team_members` (đọc).
    Hai ca đọc có thể đã nằm trong ca đọc chung của #442; đối chiếu từng bảng trước khi đề xuất.
- **Số test:** `packages/db` integration 870/870 (local, DB mới `gani_ref_1030` đủ 75 migration, nội dung bằng `main` `7ac7881`).
  Ngày 30/10 sáng: 834 (`b1c5a03`).

## 4. Phát hiện review M1.1–M1.3 (`docs/reviews/00-summary.md`)

| Mã | Mức | Trạng thái |
|---|---|---|
| F-02 (`received_at` do người gọi đặt) | HIGH | **Đã đóng:** `inbound-store.ts` ném `TypeError` khi có `receivedAt`; `QUESTIONS.md` N123 ghi "Đã làm". Bảng 00-summary (13/10) còn ghi "chờ PR" |
| C-01 (nguồn IP cho giới hạn đăng nhập) | HIGH | Còn mở; chờ sơ đồ proxy (N112), trước go-live |
| E-01, F-01, G-01 | MEDIUM | Còn mở, theo hướng ở 00-summary mục 4 |

## 5. Nút thắt

| Việc | Ai giữ | Hạn | Chặn gì |
|---|---|---|---|
| Mốc 30/10 (spec M8 "Bản nháp 3") | Lead BE | 31/10 02:00 UTC; quá hạn thì anh báo CEO | Đóng mốc 30/10 |
| Q1 (pháp lý), kéo theo Q2 (cloud) | CEO | 10/11; nhắc 05/11, 06/11, 08/11 | Staging (điều kiện S1), Terraform thật, sao lưu, AI ở S5 |
| U57 (`POST …/messages` có trả 502 không) | Lead BE | trước outbound | **Blocker S3:** Zalo gửi ra |
| Q7; U40, U41, U44, U45, U46, U47 | CEO; lead BE | 06/11 – 10/11 | SLA, giờ làm việc, routing, trường tùy chỉnh, tag (S4) |
| U58, U51; xác nhận bảng rủi ro | Lead BE | — | Chế độ bảo trì; còn lại không chặn code |
| 16 hàm SECURITY DEFINER chưa có cố vấn xác nhận | Chủ đầu tư (N35) | — | Rủi ro 4; #386 (`DROP` hàm cũ) chờ anh |

**Mốc 30/10: chưa có tín hiệu của lead BE** (kiểm lúc 30/10 17:20 UTC):

- `QUESTIONS.md` trên `main`, mục "Chờ lead BE": dòng "Mốc 30/10" vẫn còn.
- `docs/ui/spec-M8.md` vẫn ghi "Bản nháp 3", file đổi lần cuối 28/10 (`282cc15`).
- `docs/business/risk-ownership.md`, bảng "Xác nhận": dòng Lead BE còn trống.
- GitHub: không có issue hay comment nào từ 29/10 về việc này (chỉ có #430, #433).
- Giới hạn: Backend chỉ thấy repo và GitHub, không thấy kênh liên lạc khác.

**Nhận xét:** code S1, S2 gần xong trước ngày S1 bắt đầu (16/11), nhưng S1 chỉ đóng khi staging lên (cần Q2), còn S3 bị chặn bởi U57.

## 6. Quy trình

- **"Sẵn sàng merge" = 5 điều kiện:** 9 job `ci.yml` xanh trên đúng HEAD; HEAD khớp `git ls-remote`; `mergeable_state` clean;
  docker chạy thật, có log; GitGuardian success trên đúng HEAD. PR thử #445 xác nhận GitGuardian vẫn chạy. #424, #444 đã merge khi
  chưa có check GitGuardian; không rollback.
- **#448:** merge trước khi BE xác nhận `mergeable_state` clean; lỗi phía anh (người giao việc). Không rollback. 9/9 job xanh,
  GitGuardian xanh, docker chạy thật trên HEAD `41a0d3f`.
- **Hook pre-commit bỏ qua gitleaks** vì máy không có gitleaks trong PATH; BE chạy gitleaks tay trước mỗi push (exit 0). Sửa PATH
  là việc riêng.
- **Thời gian CI trên `main`** (CI push, 9/9 xanh cả ba lần):

| Commit | Run | Thời gian |
|---|---|---|
| `782b896` (#444) | 41085649775 | 4 phút 53 giây |
| `3eb5f2b` (#446) | 41090632861 | 4 phút 50 giây |
| `7ac7881` (#448) | 41095951059 | 3 phút 57 giây |

- **Nhánh chờ anh xóa trên UI:** `test/gitguardian-check`, `test/rls-idempotency-keys-cross-org`, `test/rls-agent-settings-cross-org`,
  `fix/pii-log-net`.

## 7. Việc tiếp theo (chờ brief riêng)

1. Plan `audit_logs`: kiểm cả bảng cha. Đọc migration và spec, trình phương án trước khi code.
2. 4 bảng một phần: đối chiếu với ca đọc chung của #442, chỉ thêm ca còn thiếu thật.
3. Khi U57 được chốt: outbound Zalo (8b) và làm mới token, điều kiện đóng S3.
4. Phần không phụ thuộc Q7: thiết kế bot engine và routing (vòng xoay, giới hạn tải) cho S4.
