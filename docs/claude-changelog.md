# Lịch sử thay đổi quy tắc `CLAUDE.md`

> Nhật ký, không phải quy tắc. Quy tắc nằm ở `CLAUDE.md` ở thư mục gốc.

## 08/11/2026 tối: merge trực tiếp, mục tiêu Lighthouse, kiểm cây accessibility của widget (ký A (CEO), brief 191, 192)

- "Tầng 1 code": merge bằng `merge_pull_request` + `expectedHeadSha` đủ 40 ký tự khi 9/9 + `clean`; bỏ `enable_pr_auto_merge`
  (sau khi kết nối GitHub đổi, công cụ không còn nhận `expectedHeadOid`). Ca đầu: #687, #688.
- "KIỂM CHỨNG": admin desktop LCP < 2,5 s, widget mobile Performance ≥ 90, admin mobile best-effort (#688).
- "KIỂM CHỨNG": widget kiểm thêm cây accessibility và focus, vì axe 0 vi phạm nhưng bỏ sót V1–V3 (#687, sửa ở #689).

## 08/11/2026: `expectedHeadSha` / `expectedHeadOid` đủ 40 ký tự (ký A (CEO), brief 180, 188)

- "Tầng 1 code": thêm dòng SHA đủ 40 ký tự lấy từ `git ls-remote`; SHA không khớp thì không bật auto-merge, báo CEO; sau
  merge kiểm `git diff <HEAD PR> <squash>` = 0.
- Sự cố gốc: #678, auto-merge bật với `expectedHeadOid` là SHA rút gọn đệm `0` (`26c9afd000…`), GitHub vẫn nhận. FE tắt rồi
  bật lại bằng SHA thật; trước đó #674 dùng SHA rút gọn, diff HEAD ↔ squash đã kiểm = 0. Chi tiết:
  `docs/ui/session-summary-08-11-2026.md` mục 4.

## 07/11/2026: phân tầng FE chỉ giữ tầng 3 cho thao tác không hoàn tác được (ký A (CEO), brief 167, 169)

- "Phân tầng merge", dòng FE: tầng 3 chỉ còn xóa dữ liệu khách (#23 B2), đóng sự cố bảo mật (#29 B2), gộp khách (J3 B1),
  chuyển AI sang production (#26 B2). Tách khách (J3 B2) và hạ mức tự chủ (#27 PR B) chuyển sang tầng 2 (hoàn tác được).
  Trước đó dòng FE ghi "xóa dữ liệu khách (B2), hạ mức tự chủ (màn 2)".
- Cùng brief 167 (đã áp dụng, không đổi chữ trong `CLAUDE.md` vì luật hiện hành đã có): tầng 1 code bật auto-merge khi còn
  check chờ; 5 mục sau merge gửi gộp cuối phiên; tối đa 4 nhánh song song; tầng 2 heads-up 30 phút rồi DEV tự merge.
- `docs/ui/danh-sach-man-M11.md`: #9 "Gộp khách" đã gộp vào #8, không route riêng (brief 169).

## 07/11/2026: bảng job thêm `.claude/**` và `.json` trong `docs/ui/` (ký A (CEO), brief 140, 145)

- Bảng "Job chạy theo loại PR": `.claude/**` chạy như code BE (7 + 2, như #636, #639, #643); PR chỉ docs có file không phải
  `.md` trong `docs/ui/` chạy thêm `admin` (4 + 5, ca đầu #645), theo `ADMIN_NEEDS` của `changes.sh`, không sửa `changes.sh`.
- "9/9" = 9 required check đạt theo tên, job skip đúng bảng tính là đạt (brief 140 mục 5).

## 03/11/2026: scan secret chạy riêng, mẫu `sk-` (ký A (CEO), brief 52, 53)

- "Scan trước khi push": mẫu `sk-` đổi thành `sk-[a-zA-Z0-9]{20,}` (`sk-` trần trúng `risk-ownership`); scan chạy riêng, không
  nối với `git commit`/`git push`; có dòng PR thêm vào khớp mẫu thì exit 1, không push tự động. Sự cố gốc: #575 (handoff FE
  `docs/ui/session-summary-29-10.md`).
- Có kết quả: kiểm từng dòng; tất cả là dòng mẫu quét hoặc dòng đã có trên `main` thì ghi vào mô tả PR rồi push, còn lại DỪNG
  (brief 53; ca đầu là chính PR này: 2 dòng mẫu quét vừa sửa).

## 02/11/2026: sửa bảng job, dòng PR lẫn (ký A (CEO), 19:15 UTC)

- Bảng "Job chạy theo loại PR" (`CLAUDE.md`, `infra/CLAUDE.md`): PR lẫn BE + FE hay đổi file ở gốc chạy 8 job, `terraform` skip
  (đúng bộ lọc `changes.sh` đã duyệt, #563); chỉ workflow, `infra/ci/`, push lên `main` chạy cả 9.

## 02/11/2026: job chạy theo loại PR, song song và gộp PR (ký A (CEO), brief tăng tốc 17:55, duyệt 18:00 và 18:10 UTC)

- GIT WORKFLOW thêm **Job chạy theo loại PR** (Cách 1, #562): bảng job phải chạy theo loại PR (code BE 7, chỉ FE 5, chỉ docs 3,
  chỉ Terraform 4, lẫn/workflow/`main` 9); thay các câu "9/9 success thật", "9 job xanh thật", "8 success + `docker images`
  skipped" ở Tầng 1 code, Đồng hồ heads-up, Mức A điều kiện 2 và `packages/db/CLAUDE.md`. PR code vẫn phải có `docker images`
  success thật.
- GIT WORKFLOW thêm **Song song và gộp PR** (Cách 2, 3): tối đa 4 nhánh, kiểm file trùng trước khi mở nhánh, gộp khi ≤ 500 dòng
  có test bắt buộc và không sửa file dùng chung, PR đụng `customers` đứng riêng, merge và Update branch từng PR một.
- `packages/db/CLAUDE.md`: test sắp theo tên dùng tên khác nhau ở chữ không dấu đứng đầu (collation local và CI khác nhau;
  lỗi lặp lần 2, CEO 18:40 UTC).

## 02/11/2026: Mức A, DEV tự merge tầng 3 theo phương án đã duyệt; mốc go-live 31/01/2027 (ký A (CEO))

- GIT WORKFLOW thêm **Mức A**: 7 điều kiện (phương án duyệt, 9 job thật sau Update branch cuối, `clean`, diff khớp phương án và
  trần dòng, không đụng dữ liệu khách thật, Trivy/GitGuardian, diff HEAD ↔ squash = 0 và báo sau merge); CEO xem lại trong 24 giờ;
  phê duyệt chỉ là comment GitHub; bỏ FE review/heads-up phải ghi trên PR. Áp lần đầu cho #540, #543, #544 (#542 CEO tự bật
  auto-merge). `packages/db/CLAUDE.md` (phân tầng BE) trỏ tới Mức A.
- GIT WORKFLOW thêm **Nhận việc và báo cáo**: bước 1 (soạn brief giao việc, chưa code) và bước 6 (báo 5 mục sau mỗi merge) của
  quy trình 7 bước CEO gửi 02/11.
- GIT WORKFLOW thêm **Duyệt lô theo sprint** (đề xuất 1 + 2, CEO 16:14 UTC): sprint 02/11–09/11, PR tầng 2/3 có phương án duyệt
  tự merge theo Mức A, bỏ FE comment và heads-up 30' của tầng 2; ngoài sprint giữ luật cũ.
- Brief P21: S6 17/01 – 30/01, go-live Đợt 1 31/01/2027 (trước Tết), pentest vòng 1 05–09/01, UAT/SUS song song S5, rủi ro CEO
  đã ký (phương án b).

## 02/11/2026: heads-up 5 phút (5a), ngoại lệ Update branch (5b), Tầng 2 cho hợp đồng giữ nguyên, 3 bài học K1c-1 (ký A (CEO))

- GIT WORKFLOW thêm **5a** (PR docs tầng 2 ≤ 10 dòng, chỉ `QUESTIONS.md`/`docs/`: heads-up 5 phút) và **5b** (Update branch
  không reset heads-up khi `main` chỉ đổi file không liên quan; vẫn reset khi cùng đường dẫn, `packages/db`, `CLAUDE.md`,
  `QUESTIONS.md`; ghi log quyết định vào comment PR). Nguồn: CEO trả lời 10 điểm ngày 02/11, mục 6 ("APPROVED"). Lý do: #528
  (+2/−1) mất khoảng 30 phút vì #523 sửa `CLAUDE.md`.
- `packages/db/CLAUDE.md` (phân tầng BE) thêm tầng của hợp đồng API: planned mới hay đổi là Tầng 3; chuyển planned → openapi
  giữ nguyên hợp đồng là Tầng 2 (CEO 02/11, quyết định 1).
- Bài học K1c-1: chuyển path làm mất kiểu FE từ `planned.d.ts` (#538); không `prettier --write` lên `QUESTIONS.md`; kiểm PR bằng
  tay sau khi kết nối GitHub gián đoạn (#538 merge mà phiên không nhận được tin).

## 02/11/2026: phạm vi đồng hồ heads-up (ký A (CEO), brief `2810-02112026-FE-BRIEF-37`)

- GIT WORKFLOW, mục **Đồng hồ heads-up 30 phút**, thêm **Phạm vi**: đồng hồ chỉ áp PR tầng 2 hoặc trường hợp đặc biệt; PR tầng 1
  code tự merge khi 9 job success thật và `clean`, không heads-up. Lý do: brief 36 viết "heads-up cho mọi PR code" trái mục
  "Tầng 1 code"; CEO chốt ở brief 37, ghi vào `CLAUDE.md` ở PR docs đo tiến độ 02/11 (brief 38, 40).

## 02/11/2026: đồng hồ heads-up 30 phút (ký A (CEO), sau #521)

- GIT WORKFLOW thêm **Đồng hồ heads-up 30 phút**: chỉ chạy khi comment heads-up đã đăng, 9 job xanh thật (hoặc 8 + `docker images`
  skipped với PR docs) và `mergeable_state = clean`; push thêm commit sau heads-up thì về 0 và phải đăng heads-up mới; CI đỏ thì
  dừng, chạy lại từ đầu khi xanh. Lý do: #521 (heads-up 04:30:06, push 04:58:59, CI xong 05:05:19, merge 05:05:28) đúng tinh
  thần nhưng comment không nêu cách tính.

## 01/11/2026: tầng 1 code tự push tự merge, bỏ docker ở local, trần 500 cho test bắt buộc (ký A (CEO))

- GIT WORKFLOW thêm **Tầng 1 code: tự push, tự merge, báo sau**: kiểm local lint/typecheck/unit test/format/build/E2E, không chạy
  docker, database, queue, terraform, coverage ở local; CI 9/9 thật; `main` đi trước thì "Update branch" của GitHub; báo sau merge
  gộp cả phiên; chỉ áp khi protection còn `strict`, `enforce_admins`, 9 required check.
- KÍCH THƯỚC PR: 400 mặc định, 500 cho PR code khi phần vượt là test bắt buộc; vượt trần báo trước khi push.
- Lý do (CEO): mỗi PR đang mất 4–5 vòng brief; luật để cắt số vòng.

## 01/11/2026: luật hủy heads-up, tự kiểm đủ 9 job (CEO, brief `2810-01112026-FE-BRIEF-01` mục 7)

- GIT WORKFLOW thêm **Luật hủy heads-up** (nguyên văn CEO): `hold` dừng mọi hoạt động trên PR (push, heads-up, đổi draft/ready,
  merge), hủy vĩnh viễn auto-merge của PR đó tới khi CEO comment gỡ hold; vi phạm là sự cố quy trình, ghi vào handoff.
- Dòng tự kiểm của tầng 1/2 ghi rõ **9 job theo tên**, trước khi merge; required check nay là 9 context, gồm `docker images`
  (CEO chốt giữ, 01/11), job `skipped` tính là đạt.
- Ghi bởi FE, theo lệnh CEO; `CLAUDE.md` gốc là file dùng chung FE + BE, BE lead chưa review.

## 13/10/2026: tách nhật ký khỏi `CLAUDE.md` (review G-04, N126)

- `CLAUDE.md` còn **một** H1. Hai bài học (bảo mật tài liệu, kiểm tra lệnh) thành mục của file; phần "Cách apply" và bảng "Lịch sử" chuyển về đây.
- Bỏ khối "Trước PR3 (PR1b, PR2)" (xem mục cuối).
- Ví dụ mật khẩu trong tài liệu chỉ còn placeholder; mẫu quét `password_` đổi thành `PASSWORD=` vì `password_` trúng tên cột `password_since`.
- Thêm mục "KÍCH THƯỚC PR" (N126); đổi tham chiếu Brief v0.4 sang Brief Backend & Core v1.0.

## 12/10/2026: hai bài học (PR `docs/claude-md-rules`)

| Ngày | Sự kiện |
|---|---|
| 12/10/2026 | `pnpm test \| grep` che exit code, báo xanh khi coverage đỏ |
| 12/10/2026 | `pnpm lint \| tail -1` che lỗi eslint |

Cách apply (đã làm, ghi lại để tham khảo):

```powershell
git checkout -b docs/claude-md-rules
git add CLAUDE.md
git commit -m "docs(claude): add document security and pipe exit code rules"
git push -u origin docs/claude-md-rules
```

PR mở từ `6b829c1`, tiêu đề `docs(claude): add document security and pipe exit code rules`.

## Trước PR3: đã hết hiệu lực

- PR1b, PR2: anh commit thủ công, em không tự commit và không tự push.
- Từ PR3: mỗi PR trên nhánh riêng (xem "Nhánh và PR" trong `CLAUDE.md`).
