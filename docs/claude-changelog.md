# Lịch sử thay đổi quy tắc `CLAUDE.md`

> Nhật ký, không phải quy tắc. Quy tắc nằm ở `CLAUDE.md` ở thư mục gốc.

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
