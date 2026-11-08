# Handoff FE — 07–08/11/2026

Phiên FE `session_015SNdqZsqMWFgeQMx5cVLsc`, nối tiếp `docs/ui/session-summary-07-11-2026.md` (mục 10). Căn cứ: FE BRIEF 154–188
(Người ký: A (CEO)). Giờ ghi theo UTC. Phiên mới đọc file này trước, rồi `CLAUDE.md`, `apps/admin/CLAUDE.md`.

## 0. Phiên mới làm gì trước

1. Đọc khối `=== CHECKPOINT PHIÊN` của hook `SessionStart`; tạo lại `.session/session-state.json` từ `docs/ui/session-state.json`.
2. Kiểm tay: CI `main` của `80260cb` (#684, run 42503382746) xanh chưa; PR BE đang mở có chạm file FE không.
3. **FE hết việc đã giao** (brief 188). Không tự mở việc mới khi chưa có brief. Chờ: Q6 (U26 kênh Zalo OA), Q-d (CEO lo trước
   15/12), Nhóm C 2 nhánh (CEO quyết giữ/xóa).
4. Check-in 2 giờ một lần (phút 06): 3 dòng + PR mở; ghi `last_checkin_utc`.

## 1. PR FE đã merge 07/11 tối – 08/11

| PR | Nội dung | Tầng | Merge | Squash |
|---|---|---|---|---|
| #660 | #6 đọc ghi chú nội bộ (C6, P1a) | 1 | 07/11 ~19:14 | `cd6b428` |
| #662 | #8 tag của khách (J4, P2a) | 1 | 07/11 ~21:14 | `503d16b` |
| #664 | #6 thêm ghi chú nội bộ (C6, P1b) | 1 | 07/11 ~21:23 | `b2fc33b` |
| #665 | #8 thông tin thêm chỉ đọc (J1, P2b-1) | 1 | 07/11 ~21:39 | `7241b0c` |
| #666 | lọc theo tag ở #7 và #6 (J4, P4) | 1 | 07/11 ~21:56 | `38c246a` |
| #668 | #8 sửa thông tin thêm (J1, P2b-2) | 1 | 07/11 ~22:10 | `ca7f8e0` |
| #669 | #8 lead của khách (N188, P3) | 1 | 07/11 ~22:29 | `ccb066a` |
| #667 | docs phân tầng FE, M11 #9 gộp vào #8 | 1 docs | 07/11 ~23:35 | `4bb1ede` |
| #672 | A: #6 lý do khi Chuyển (U54, N199) | 1 | 08/11 08:11:01 | `0eba753` |
| #674 | B8 + B7: #6 ticket của hội thoại (U53, N170) | 1 | 08/11 08:27:01 | `c7db263` |
| #676 | C: axe 5 trạng thái còn thiếu (#21, #28, #30) | 1 test | 08/11 08:34:45 | `36239bf` |
| #678 | T1: Gộp, Tách, Đóng sự cố lúc đang gửi; 403/404 | 1 test | 08/11 16:31:26 | `236c354` |
| #679 | T2: 401 giữa phiên, ẩn "Gán lại", phiên truy cập, mời lại giữ key | 1 test | 08/11 16:39:15 | `4be1396` |
| #682 | fix #29: bấm đúp "Đóng sự cố" chỉ gửi 1 PATCH | 1 | 08/11 16:48:04 | `9ff8389` |
| #683 | T3b: nhánh lỗi cài đặt, hồ sơ khách, mật khẩu | 1 test | 08/11 16:57:32 | `cf60bf2` |
| #684 | T3a: nhánh lỗi Hộp thư và ticket | 1 test | 08/11 17:07:41 | `80260cb` |

- Giờ 07/11 là giờ CI `main` bắt đầu chạy sau merge (5 mục đã gửi CEO trong phiên 07/11).
- 5 mục của 8 PR ngày 08/11 gửi gộp cuối phiên (CEO xác nhận brief 188): diff HEAD ↔ squash = 0 cả 8; mỗi PR 5 success + 4 skip
  đúng bảng; từ 08:48 mọi `expectedHeadOid` là SHA đủ 40 ký tự.
- Review chéo PR BE: từ #670 đến #681 không PR BE nào chạm file FE (chỉ `apps/worker`, `apps/api` seed, `packages/db`, docs).

## 2. Q7 SLA: đóng (brief 181)

- BE merge `seed:sla-demo` (#675, `a352a6c`). FE dựng ở máy: PostgreSQL 16 (DB `gani_q7`, 98 migration), API, worker, Valkey thật,
  admin build từ `main`; seed lúc 08:56:33.
- Kết quả 6/6 chip + 2/2 lọc + 2/2 realtime, không lỗi BE:
  - Chip: còn N phút; sắp quá hạn (còn 10, 8); quá hạn (đỏ); tạm dừng chờ khách; tạm dừng ngoài giờ; đã đóng không chip.
  - `?sla=due_soon` 2, `?sla=overdue` 2, bỏ hội thoại tạm dừng.
  - Realtime 2 phiên: T09 → chip tạm dừng sau 183 ms; đóng → mất chip sau ~790 ms; gói `conversation.sla_changed` v3, v4 tới.
- "Sắp quá hạn" không có màu riêng: đúng brief 116, chờ Q7/U40 mở rộng hợp đồng.
- DB `gani_q7` ở máy phiên: CEO giữ, không DROP (brief 181).

## 3. Rà E2E coverage (brief 175–186)

- 31 màn M11 + shell + widget; 28 màn có route. 12 màn đủ test hành động; 16 màn thiếu nhánh lỗi (P3), đã lấp bằng T1, T2,
  T3a, T3b (8 lỗ hổng P1/P2, 11 ca P3).
- T1 bắt được lỗi thật: #29 bấm đúp "Đóng sự cố" gửi 2 PATCH (`incident-actions.tsx` chỉ chặn bằng `send.isPending`). CEO duyệt
  sửa (brief 180) → #682 thêm ref `sending` như `merge-dialog.tsx`; mutant bỏ fix → ca bấm đúp đỏ (2 PATCH).
- Không làm (CEO đồng ý, brief 184): nhận hội thoại ngoài giờ (cần dữ liệu stub), 409 `last_owner` (UI không tạo được), gửi lại
  lời mời 404 (đã có unit), gửi lỗi widget (transport demo).
- Placeholder "chờ API": 22 path vẫn planned, không đổi từ lần rà B (brief 170).

## 4. Sự cố hạ tầng: gitleaks 504 (brief 183)

| Mục | Nội dung |
|---|---|
| Bắt đầu | 08/11 ~08:48: job "dependency audit, secret scan" tải `gitleaks_8.30.1_linux_x64.tar.gz` từ GitHub releases trả `curl: (22) … 504` |
| Phục hồi | 11:16 (CEO kiểm 15/15 lần tải khớp SHA256); CI `main` của #677 (11:19) và #680 (11:31) xanh; FE thử HEAD link 200 lúc 11:07, 13:07 |
| Thời gian | ~2 giờ 17 phút |
| Ảnh hưởng | #678 đỏ 2 lần (run 42464754781, 08:53:05 và chạy lại 09:02:09); #679, fix #29 đứng theo; #677 BE và PR BE khác cùng bước |
| Biện pháp | Chạy lại 1 lần, đỏ lần 2 thì dừng, gửi log cho CEO (brief 114). Không sửa workflow, không pin version khác, không cache binary, không tắt gitleaks; chờ tín hiệu "CI ổn" của CEO (brief 182, 184) |
| Sau phục hồi | #678 Update branch lên `451f17f` (job xanh 16:24:51), merge 16:31:26 |

- Bài học kèm theo: `expectedHeadOid` rút gọn đệm `0` vẫn được GitHub nhận (#678, 08:48) → luật SHA đủ 40 ký tự (`CLAUDE.md`
  "Tầng 1 code", brief 180).

## 5. Nhóm B: đã xóa (brief 186, 187)

| Nhánh | PR | HEAD | PR |
|---|---|---|---|
| `feat/admin-e2e-two-factor` | #178 | `3a6b76a8ce92` | đóng 21/10, không merge |
| `feat/admin-members-invite` | #234 | `96910e698939` | đóng 22/10, không merge |
| `feat/admin-members-list-v2` | #241 | `cde6f92af4aa` | đóng 24/10, không merge |
| `fix/axe-wait-title` | #267 | `f2da0e8ab06e` | đóng 26/10, không merge |
| `test/admin-many-rows-robust` | #266 | `abf9ab6ae84d` | đóng 24/10, không merge |
| `docs/backend-questions-30-10` | #201 | `8118c2541e5f` | đóng 21/10, không merge |

- FE không xóa được: `git push --delete` bị deny, MCP không có lệnh xóa nhánh; không lách. CEO xóa qua GitHub UI.
- Xác nhận 17:04:31: `git ls-remote origin | grep -E '(e2e-two-factor|members-invite|members-list-v2|axe-wait-title|many-rows-robust|backend-questions-30-10)'`
  không ra dòng nào, exit 1.

## 6. Số đo A/B/C/D (CEO chốt, brief 145, 188)

| | Thước đo | Số |
|---|---|---|
| A | Tính năng Đợt 1 (58 mã) | 28,5/58 |
| B | Deliverable S1–S5 (29) | 19,5/29 |
| C | Màn FE Đợt 1 (30) | 22/30 |
| D | Cả dự án (135 mã) | 28,5/135 |

## 7. Việc chờ

- U26 (kênh Zalo OA, #25): chờ Q6.
- Q-d: CEO lo trước 15/12.
- Nhóm C (`backup/privacy-full`, `docs/ui-prototype-outline`): giữ tới khi CEO quyết.
- Worktree ở máy phiên: `/home/user/u85-check`, `/home/user/docs-state`; không còn nhánh FE nào chưa push.
