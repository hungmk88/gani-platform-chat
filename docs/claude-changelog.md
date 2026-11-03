# Lịch sử thay đổi quy tắc `CLAUDE.md`

> Nhật ký, không phải quy tắc. Quy tắc nằm ở `CLAUDE.md` ở thư mục gốc.

## 03/11/2026: scan secret chạy riêng, mẫu `sk-` (ký A (CEO), brief 52)

- "Scan trước khi push": mẫu `sk-` đổi thành `sk-[a-zA-Z0-9]{20,}` (`sk-` trần trúng `risk-ownership`); scan chạy riêng, không
  nối với `git commit`/`git push`; có dòng PR thêm vào khớp mẫu thì exit 1, không push. Sự cố gốc: #575 (handoff FE
  `docs/ui/session-summary-29-10.md`).

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
