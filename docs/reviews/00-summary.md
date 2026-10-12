# Code Review M1.1 → M1.3 — Tổng hợp (00-summary)

- **Phạm vi:** bảy nhóm A–G, sáu báo cáo trước (`A-foundation.md` … `F-inbound.md`) và `G-docs.md`.
- **Mốc:** `main` = `25fe6e1`. Nhóm A–C đọc ở `a443721`, D–E ở `1dfd6c5`, F ở `61c1e79`, G ở `25fe6e1`.
- **Ngày:** 13/10/2026. **Người rà soát:** Claude, chính tác giả của phần lớn mã (xem "Giới hạn").
- **Kết quả một dòng:** 0 CRITICAL; 39 phát hiện, trong đó 4 HIGH (sau khi nâng D-02 và F-02); 3 trong 4 HIGH đã đóng hoặc chờ một PR đã chốt, C-01 chờ sơ đồ triển khai.

## 1. Bảng đếm

Mức **lúc rà soát** (theo từng báo cáo):

| Nhóm | Nội dung | CRITICAL | HIGH | MEDIUM | LOW | INFO | Tổng |
|---|---|---|---|---|---|---|---|
| A | Nền móng, build, cấu hình | 0 | 1 | 1 | 0 | 5 | 7 |
| B | CSDL, RLS, partition | 0 | 0 | 1 | 0 | 2 | 3 |
| C | Xác thực | 0 | 1 | 0 | 2 | 2 | 5 |
| D | FSM hội thoại | 0 | 0 | 2 | 1 | 3 | 6 |
| E | Outbox | 0 | 0 | 1 | 1 | 2 | 4 |
| F | Inbound | 0 | 0 | 2 | 1 | 3 | 6 |
| G | Tài liệu | 0 | 0 | 1 | 4 | 3 | 8 |
| **Cộng** | | **0** | **2** | **8** | **9** | **20** | **39** |

Sau khi **nâng mức** (mục 2): HIGH 4, MEDIUM 6, LOW 9, INFO 20, tổng 39.

## 2. Phát hiện đã nâng mức

Các báo cáo gốc **không bị sửa thân**; mỗi file có một dòng con trỏ tới mục này.

| Mã | Mức trong báo cáo | Mức hiện tại | Ngày | Lý do |
|---|---|---|---|---|
| D-02 | MEDIUM | **HIGH** | 12/10/2026 | `last_customer_message_at` nhận giờ nền tảng không kiểm: ảnh hưởng cửa sổ trả lời miễn phí 48 giờ; sửa bằng kẹp giờ |
| F-02 | MEDIUM | **HIGH** | 13/10/2026 | `received_at` do người gọi đặt: cùng loại D-02, là khóa partition và đồng hồ hạn lưu; kết hợp F-01 thì dòng vào `DEFAULT` giữ PII vô hạn; kích hoạt khi PR6 nối webhook (~S3, 14/12/2026) |

## 3. Đã đóng

| Mã | PR | Ghi chú |
|---|---|---|
| A-01, A-02 | #85 (`1dfd6c5`) | `@gani/domain` build ra `dist`, bước smoke khởi động; timeout `statement`/`idle_in_transaction`/`lock` (N108, N109) |
| D-01, D-03 | #89 (`8dceb81`) | test claim-race T06; quét bí danh của quy tắc 4 |
| D-02 | #88 (`13f6234`), #90, #91 (`1733012`) | kẹp giờ nền tảng ở `now()`; sàn 30 ngày; giờ dưới sàn thì mốc khách = `now()` (khung 48 giờ). N116, N117 |
| C-01 (phần) | #92 (`c350d5f`) | hằng số tường minh + 4 test hành vi hiện tại; **phần còn lại chờ topology** (N112) |
| B-01 (phần) | #93 (PM-1), #94, #96, #97 (PM-2); `61c1e79` | hàm `ensure_log_partitions`, job bảo trì, dọn khóa inbound 35 ngày; **PM-3 (bỏ partition cũ) còn lại, sau 15/05/2027** (N110, N121) |

Chờ PR đã chốt: **F-02**, nhánh `fix/db-inbound-received-at-server-time`, trước 14/12/2026 (DB đặt `now()`, từ chối giờ do người gọi truyền; N123).

## 4. Chưa đóng

| Mã | Mức | Việc còn lại | Hướng đã chốt |
|---|---|---|---|
| C-01 (phần) | HIGH | sơ đồ proxy, `ipAddressHeaders`/`trustedProxies`, viết lại 4 ca | chờ anh chốt topology (N112) |
| F-02 | HIGH | PR fix | sau C2, trước 14/12/2026 |
| E-01 | MEDIUM | chỉ số outbox chưa có nơi phát | chờ kế hoạch sprint |
| F-01 | MEDIUM | `payload` ~61 ngày, `DEFAULT` không hết hạn | **điều kiện: PR6 và PM-3 đúng hạn; PM-3 trượt thì escalate** |
| G-01 | MEDIUM | ADR-004 danh sách `SECURITY DEFINER` + test so tập hàm | PR docs "refresh" |
| C-02, C-04 | LOW | token phiên thô; tính nguyên tử `switch-org` | N113, N114 |
| E-02 | LOW | `failOutboxEvent` kiểm `attempts` | N119 |
| F-03 | LOW | `CHECK` regex `last_error` | N124 |
| G-02, G-03, G-04, G-06 | LOW | README, trạng thái ADR/rls-spec, `CLAUDE.md`, `QUESTIONS.md` | PR docs "refresh" (N126) |
| A-03…A-07 | INFO | quan sát (Sentry, tiêu đề commit, advisory lock, import chéo, `randomUUID`) | theo dõi |
| B-02, B-03 | INFO | lint `MIG-RLS`; `support_role` đọc nội dung | N111; chờ quyết định |
| C-03, C-05 | INFO | khóa theo email; job dọn `sessions` | N114 |
| D-04, D-05, D-06 | INFO | `INSERT` hội thoại, claim 409, `userId` | D-04 và D-06 vào N128 (số mới); D-05 chỉ quan sát |
| E-03, E-04 | INFO | người tiêu thụ đầu tiên; cửa sổ khử trùng 1 giờ | N120 |
| F-04…F-06 | INFO | hàm webhook, `channel_policies` tạm, khử trùng theo `message_id` | N124 |
| G-05, G-07, G-08 | INFO | sổ mã `E_*`; quét PII sạch; pathspec | N127; không cần |

## 5. Đính chính C-01

Mô tả (2) của C-01 trong `C-auth.md` nói quá tay. Nội dung đúng (đã ghi ở N112):

- Người ngoài gửi chuỗi `a, b` làm đầy **xô chung** `no-trusted-ip|<đường dẫn>` của những yêu cầu không có địa chỉ tin được (thiếu header, hoặc là chuỗi). Người dùng hợp lệ có **một giá trị** (proxy ghi đè header) nằm ở xô riêng của họ và **không bị chặn**.
- Hệ quả chỉ nặng khi **mọi yêu cầu** đều là chuỗi (ví dụ CDN cộng bộ cân bằng tải nối header): khi đó cả hệ thống dùng chung 10 lần/phút, mà không cần kẻ tấn công.
- Phần đúng và còn nguyên: (1) không có header thì một xô chung cho mọi người; (3) một giá trị tự đổi mỗi lần thì không bao giờ bị giới hạn khi gọi thẳng.
- Bằng chứng chạy được: `apps/api/src/modules/auth/auth.rate-limit-ip.test.ts` (4 ca, ghi lại hành vi hiện tại ở chế độ production, **đổi khi N112 chốt**).
- Mức độ thực phụ thuộc topology, nên C-01 giữ HIGH ở trạng thái "chờ topology" thay vì đóng.

## 6. Đính chính phương pháp

Ba báo cáo (A:116, D:49, F:6) ghi lệnh `git grep` với pathspec `'apps/*/src'` không hiệu lực (luôn rỗng). Đã chạy lại bằng pathspec đúng: **cả ba kết luận vẫn đúng**. Chi tiết ở `G-docs.md` G-08.

## 7. N-số

### Đã ghi trong `QUESTIONS.md`

| N | Nội dung | Phát hiện |
|---|---|---|
| N108 | `@gani/domain` build ra `dist` + smoke khởi động | A-01 |
| N109 | timeout `statement`/`idle_in_transaction`/`lock` cho `app_role`, `auth_role` | A-02 |
| N110 | bảo trì partition: PM-1 (hàm), PM-2 (job); PM-3 chưa | B-01 |
| N112 | nguồn IP cho giới hạn tốc độ; **chờ topology** | C-01 |
| N116 | kẹp `platformSentAt` ở `now()` | D-02 |
| N117 | giờ nền tảng quá cũ (sàn 30 ngày); giảm khi Z3 chốt | D-02 |
| N121 | khóa trùng inbound giữ 35 ngày; job bảo trì | PM-2b |

### Đề xuất, chưa ghi (anh quyết)

| N | Nội dung | Phát hiện | Ghi chú |
|---|---|---|---|
| N111 | `CLAUDE.md` của `packages/db`: chốt chặn khuôn policy là `rls-all-tables.spec` | B-02 | |
| N113 | đóng N77(6): `sessions.token` thô hay băm | C-02 | |
| N114 | test `switch-org` thất bại giữa chừng; job dọn `sessions` | C-03, C-04, C-05 | |
| N115 | claim-race T06 | D-01 | **không cần**: đã đóng bằng test (#89) |
| N118 | chỉ số quan sát outbox | E-01 | |
| N119 | `failOutboxEvent` kiểm `attempts` | E-02 | |
| N120 | người tiêu thụ đầu tiên; tần suất `queue_full`; runbook 1 giờ | E-03, E-04 | |
| N122 | hạn lưu `payload` theo partition hoặc xóa theo dòng; xử `DEFAULT` trong PM-3 | F-01 | I3 còn mở với pháp lý |
| N123 | `received_at` do DB đặt | F-02 | **ghi ở PR fix F-02** |
| N124 | `CHECK` mã lỗi; thu hẹp hàm webhook; cổng C4; `event_type` vào khóa | F-03…F-06 | |
| N125 | ADR-004 + test so tập hàm `SECURITY DEFINER` | G-01 | |
| N126 | PR docs "refresh" (README, ADR, `CLAUDE.md`, `QUESTIONS.md`) | G-02, G-03, G-04, G-06 | |
| N127 | sổ đăng ký mã `last_error` | G-05 | gộp với F-03 |
| N128 | phần còn lại của đề xuất N117 cũ: D-04, D-06 | D-04, D-06 | **số mới**; N117 đã dùng cho D-02 |

Lưu ý: `D-conversation-fsm.md` đề xuất N117 cho D-03/D-04/D-06, còn `QUESTIONS.md` đã dùng N117 cho D-02 (nửa còn lại). Bảng trên là ánh xạ đúng; D-03 đã đóng bằng #89.

## 8. Điều cần anh theo dõi

| Việc | Hạn | Ai |
|---|---|---|
| PR fix F-02 (HIGH) | trước 14/12/2026 (PR6 ~S3) | em |
| PM-3 (bỏ partition cũ) | sau 15/05/2027 | em; trượt thì escalate F-01 |
| N112: chốt sơ đồ proxy | trước go-live | anh |
| N116: hai truy vấn dòng bẩn trên staging | trước go-live | anh |
| N117, N121: giảm hạn khi Z3 chốt | khi có tài liệu Zalo | anh |
| Cố vấn xác nhận duyệt ADR-001…004 và `rls-spec-M01` | — | anh |
| PR docs "refresh" + quy tắc kích thước PR | sau PR fix F-02 | em |

## 9. Thứ tự đã chốt cho phần còn lại

1. PR-C2 (file này và `G-docs.md`).
2. PR fix F-02.
3. PR docs "refresh" gộp quy tắc kích thước PR (N126).
4. E-01 (chờ kế hoạch sprint), outbox hardening E-02…E-04, D-04…D-06.
5. PM-3 (sau 15/05/2027).

## Giới hạn

Rà soát bởi chính tác giả. Checklist cứng + bằng chứng chạy được. Không thay thế review độc lập.

Cân nhắc review độc lập Nhóm D/E/F sau.

- Nhóm D, E, F do chính tác giả viết ở M1.2 và M1.3; hai lần nâng mức (D-02, F-02) đến từ quyết định của anh, không phải từ lần rà soát này.
- Test tích hợp chỉ chạy ở CI; các báo cáo dẫn tên test và vị trí, không chạy lại ở máy này (không PostgreSQL/Docker; `apps/api` cần SWC, N42).
- Quét PII là quét mẫu trên `git ls-files '*.md'`.
