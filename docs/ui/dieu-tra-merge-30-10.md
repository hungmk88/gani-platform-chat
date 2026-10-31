# Điều tra cơ chế merge PR (sự cố 30/10, CEO BRIEF 31/10)

Trạng thái: **dây chuyền dừng** (CEO 31/10). **B2 dừng hoàn toàn** (mục 7). Mọi mốc là giờ UTC lấy từ GitHub: `created_at`
của dòng thời gian PR, `completed_at` của check run. Chỉ ghi dữ kiện (tài khoản nào làm), không suy diễn người làm.

## 1. Sáu sự cố

Sự cố 6 là chính PR của file này (#457), thêm sau khi nó bị merge.

Cả sáu lần: `merged_by = hungmk88`, `performed_via_github_app` rỗng (`app=none`), `auto_merge = null`; repo
`allow_auto_merge: false`. FE chưa gửi "Sẵn sàng merge" ở cả sáu lần.

| #   | PR   | Loại     | Draft             | `ready_for_review` | `merged` | Ready → merge | Job CI xong cuối trước merge     | CI lúc merge                                                                                                                                                  |
| --- | ---- | -------- | ----------------- | ------------------ | -------- | ------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | #438 | docs     | không (chưa luật) | —                  | 14:31:22 | —             | 14:31:16 (6 giây trước merge)    | 8/8 job của HEAD `4b62888` success, **thiếu `coverage`**: job thứ 9 vào `main` lúc 14:29:22 (#436), nhánh chưa cập nhật                                       |
| 2   | #441 | refactor | không (chưa luật) | —                  | 15:28:14 | —             | 15:21:35 (GitGuardian: 15:27:07) | 9/9 success trên `ff6c6a8`                                                                                                                                    |
| 3   | #447 | B1       | có                | 16:35:55           | 16:36:04 | 9 giây        | 16:35:03                         | 9/9 success trên `6cf3dbc`                                                                                                                                    |
| 4   | #450 | fix      | có                | 17:27:06           | 17:27:12 | 6 giây        | 17:26:19                         | 9/9 success trên `ce544b5`                                                                                                                                    |
| 5   | #452 | docs     | có                | 17:42:46           | 17:42:53 | 7 giây        | 17:41:59 (`terraform`)           | **CI CHƯA XONG** trên `ecea0cb`: chỉ `terraform` xong trước merge; 7 job chưa xong; `coverage` chưa được tạo (tạo 17:53:23). Run PR 41100166005 còn `queued` |
| 6   | #457 | docs     | có                | 18:01:52           | 18:02:04 | 12 giây       | — (chưa job nào của `ci.yml`)    | **CI CHƯA CHẠY** trên `5f710b7`: run PR 41103169210 tạo 18:00:51, còn `queued`; chưa có check run nào của `ci.yml`, chỉ GitGuardian xong (18:01:09) |

Ghi chú #452: lúc FE đọc (17:43:38) API còn trả cả 8 job `queued`; giờ xong của `terraform` do runner báo về sau.

Đối chiếu: #449 là lần đúng quy trình: FE gửi "Sẵn sàng merge" rồi tự chuyển ready qua công cụ (lệnh lúc 16:53:04.6,
timeline 16:53:05), merge 17:02:59 (594 giây sau).

## 2. Bốn mục kiểm tra (Việc 1)

Proxy GitHub của môi trường FE chỉ cho đường `repos/hungmk88/gani-platform-chat/...` và chặn một số đường quản trị.

| Mục                                           | Lệnh                                      | Kết quả                                                                                                                                                                         | Ai kiểm tiếp                                                                                                                                                    |
| --------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. PAT, deploy key của `hungmk88`             | `GET /repos/…/keys`, `GET /users/hungmk88` | 403 của proxy ("not permitted through this proxy"; "sessions are bound to their configured repositories"). GitHub không có API để chủ tài khoản tự liệt kê PAT classic | **Cần anh kiểm:** github.com/settings/tokens (classic và fine-grained: số lượng, scope, "Last used"), Settings → SSH keys, repo Settings → Deploy keys          |
| 2. Webhook của repo                           | `GET /repos/…/hooks`                      | 403 của proxy                                                                                                                                                                   | **Cần anh kiểm:** repo Settings → Webhooks (URL nhận, sự kiện, "Recent deliveries" quanh các mốc ở mục 1)                                                       |
| 3. GitHub Apps trên repo                      | `GET /repos/…/installation`               | 401 "A JSON web token could not be decoded": đường này chỉ gọi được bằng JWT của chính app                                                                                      | **Cần anh kiểm:** github.com/settings/installations; Settings → Applications (Authorized OAuth Apps, Authorized GitHub Apps)                                    |
| 4. `audit_log` 24 giờ, lọc `pull_request.merge` | `GET /orgs/hungmk88/audit-log`            | 403 của proxy. `hungmk88` là tài khoản **cá nhân** (`owner.type = User`); API audit log chỉ có cho tổ chức/enterprise                                                          | **Cần anh kiểm:** Settings → Security log của tài khoản. Không có sự kiện merge hay `actor_ip`/`user_agent` ở đó thì mục này không trả lời được bằng nhật ký |

## 3. Dữ kiện FE kiểm được

- **`app=none` không loại trừ phiên Claude.** Sự kiện ready của #449 do FE gọi công cụ GitHub cũng ghi `hungmk88`, `app=none`,
  giống hệt bốn sự kiện ready không rõ nguồn. Công cụ GitHub của các phiên Claude trên tài khoản này đứng tên `hungmk88`, có
  quyền admin repo (`permissions.admin = true` khi đọc repo qua proxy) và có lệnh merge.
- **Lịch sử phiên FE** (`session_015SNdqeCQvNjK6rFoqzt5Su`, đọc từ bản ghi lệnh):
  - không có lệnh `merge_pull_request` nào; lệnh `draft: false` duy nhất là #449 (sau tín hiệu);
  - không có lệnh Bash ghi lên GitHub (chỉ đọc);
  - quanh năm mốc merge và bốn mốc ready, FE không gọi lệnh GitHub nào; lúc đó FE chỉ sửa file ở máy, như #447: 16:35:07–16:36:03.
- **Sửa ghi chú cũ về #450.** Lệnh sửa mô tả #450 (chỉ `body`) chạy 17:25:49, xong 17:25:51, tức 75 giây trước
  `ready_for_review` (17:27:06). Từ 17:25:52 tới 17:27:10 FE không gọi lệnh nào. Câu "cùng thời điểm" ở handoff là sai.
- **Phiên Claude khác trên tài khoản:** mục 3a.
- **Lịch tự động của tài khoản** (`list_triggers`): 6 lịch, không lịch nào có nội dung merge PR:
  - 2 của FE: check-in 2 tiếng và tự kiểm 18:30;
  - 3 nhắc Rủi ro 1 (05/11, 06/11, 08/11) của phiên BE cũ;
  - 1 lịch cũ đã tắt.
  Lịch lưu ở máy (ứng dụng desktop) không hiện ở đây.
- **Workflow:** repo chỉ có `ci.yml`, không có bước merge. Merge bằng `GITHUB_TOKEN` sẽ đứng tên `github-actions[bot]`.
- **Branch protection trên `main` đang có** (`GET /repos/…/branches/main/protection`, 200):
  - có: bắt buộc qua PR, `dismiss_stale_reviews`, bắt buộc giải quyết hội thoại, chặn force push và xóa nhánh;
  - **0 approval**, **không có required status check**, `enforce_admins` **tắt**.
  Ruleset `main` (id 24382989, tạo 03/10) có 1 approval và không ai được bỏ qua, nhưng `enforcement: disabled`. Khớp N36/N38:
  19/10 bật 1 approval thì chặn mọi merge vì tác giả không tự duyệt được, CEO đặt lại 0.
- **37 PR merge ngày 30/10** (FE và BE): tác giả và người merge đều là `hungmk88`.
  - Từ job CI xong cuối tới merge: 6–2616 giây, trung vị 118 giây.
  - Dưới 20 giây: #438 6, #422 12, #448 13, #429 17, #444 18. Hai PR BE (#422, #448) không draft cũng nằm trong nhóm này.
  - Chỉ 4 PR draft có sự kiện ready: #447 9 giây, #449 594 giây, #450 6 giây, #452 7 giây.

### 3a. Phiên Claude khác trên tài khoản

FE đọc lịch sử lệnh (tin người dùng và lệnh của agent, qua `list_events`) của hai phiên BE chạy trong khung giờ sự cố:

| Phiên                                          | Khung giờ đã đọc                             | Phủ sự cố                |
| ---------------------------------------------- | -------------------------------------------- | ------------------------ |
| `session_015SNdqaLzkgVtERKS4NdqaD` (BE Session K) | 15:48:23 (sự kiện đầu tiên) – 17:57:00        | #447, #449, #450, #452   |
| `session_01BjcEWmGXkhq6DYgXdQ5YyF` (BE flaky test) | 13:58:40 – 15:59:17 (phiên dừng lúc 15:59:10) | #438, #441               |

Kết quả:

- Không phiên nào gọi `merge_pull_request`, `enable_pr_auto_merge` hay `pull_request_review_write`, và không có lệnh
  `update_pull_request` nào truyền `draft`.
- Không lệnh Bash merge hay chuyển ready.
- Thao tác ghi GitHub duy nhất của hai phiên:
  - tạo PR, issue, comment;
  - `update_pull_request_branch` #424 (15:50:40);
  - đóng #445 (`state=closed`, 16:13:22);
  - sửa mô tả #436 (14:23:46).
- Không có poller merge: hai phiên chỉ `sleep` chờ CI và đặt lịch `send_later` để kiểm và báo.

Chưa đọc:

- phiên "Gani KPI system review": cập nhật cuối 16:12, trước sự cố 3–5;
- phiên Cowork: không liệt kê được từ phiên này.

Các phiên còn lại có lần cập nhật cuối trước 14:00 ngày 30/10.

Dữ kiện tổng hợp: ở cả năm mốc merge và bốn mốc ready, ba phiên Claude đã đọc (FE và hai BE) không gọi lệnh merge hay ready nào.
Các khả năng ngoài các phiên này (PAT/script, extension, người bấm) FE không kiểm được, xem mục 2 và câu hỏi ở mục 4.

### 3b. Sự cố 6 (#457)

- FE ở #457:
  - lệnh ghi GitHub cuối là sửa mô tả kèm `draft: true` (18:01:09–18:01:12, PR `updated_at` 18:01:10);
  - đọc lại lúc 18:01:14: `draft = true`, HEAD `5f710b7`;
  - sau đó FE chỉ sửa hai lịch tự kiểm (không phải lệnh GitHub, xong 18:01:37);
  - lệnh kế tiếp là đọc thông báo lúc 18:02:05.
  - FE không gọi lệnh nào lúc 18:01:52.
- Hook trong môi trường FE: `SessionStart` (báo lỗi script cài đặt) và `Stop` (kiểm git chưa commit/push). Không hook nào gọi
  GitHub. `.claude/settings.json` của repo không có hook.
- Diff giữa `5f710b7` và squash `46492c2` trên 3 file của PR: rỗng.
- Run CI trên `main` chứa `ad131f0` (Việc 2): run 41100997464, 9/9 job success theo tên, xong 17:48–17:54. Run trên `main` chứa
  `46492c2`: 41103352713, tạo 18:02:07, phải kiểm xanh trước việc kế tiếp.

## 4. Câu hỏi cho anh (CEO 31/10, ghi nguyên văn, chờ anh trả lời)

> có phải anh đang bấm merge khi PR còn draft / CI chưa chạy, và nếu có, vì sao?

Trả lời: _(chờ)_

## 5. Đề xuất

**Kết quả (CEO 31/10):**
- Chọn required check `lint, typecheck, test` và `enforce_admins`; bỏ approval.
- Phân tầng merge: DEV merge tầng 1/2, CEO merge tầng 3 sau tín hiệu và comment phê duyệt. Xem handoff mục 2.
- "PR có thao tác ghi" = PR gửi POST/PATCH/DELETE lên API.

Đề xuất ban đầu:

- **Tạm dừng mọi PR có thao tác ghi cho tới khi có branch protection tối thiểu** (CEO 31/10). FE hiểu: PR thêm thao tác ghi dữ
  liệu lên API, như B1/B2. PR chỉ đọc và PR docs không thuộc diện này. Anh sửa nếu khác.
- **Branch protection tối thiểu** (U71, "mức tối thiểu trước, đầy đủ sau"). **Vướng, cần anh/BE quyết:**
  - **1 required check, bật kèm `enforce_admins`:** chặn merge khi CI chưa xong hoặc đỏ, tức chặn được #452 nhưng không chặn được
    #438–#450 vì CI các PR đó đã xanh. Một tài khoản vẫn merge được.
  - **1 approval:** mọi PR (FE và BE) do `hungmk88` mở, mà GitHub không cho tác giả tự duyệt.
    - Bật kèm `enforce_admins`: không PR nào merge được (đã gặp 19/10, N36).
    - Không bật `enforce_admins`: quản trị viên `hungmk88` vẫn merge bỏ qua được, nên không chặn được cơ chế nào dùng thông tin
      đăng nhập của `hungmk88`.
    - Muốn approval có tác dụng cần tài khoản thứ hai (dòng audit trail của U71), và chỉ chặn được khi cơ chế merge không cầm
      quyền duyệt của tài khoản kia.

## 6. Điều kiện ready (#457 và mọi PR sau)

Đủ 9 job theo tên ở `ci.yml` của `main`. PR doc-only: `docker images` `skipped` hợp lệ; `terraform` và `coverage` phải chạy thật.
`mergeable_state = clean` khi mọi check đã kết thúc (không tin `clean` lúc còn pending). HEAD khớp `git ls-remote`. PR vẫn draft.
Gửi "Sẵn sàng merge" kèm HEAD và tên từng job, **rồi mới** chuyển ready.

## 7. B2 (hộp thoại xóa, màn #23): mở lại 31/10

Đã dừng hoàn toàn 31/10. Lý do: xóa dữ liệu không hoàn tác, không đặt lên `main` khi cơ chế merge chưa hiểu rõ. Điều kiện mở
lại:

1. **CEO comment phê duyệt vào chính PR tầng 3 trước khi merge** (CEO 31/10; thay cho comment xác nhận vào #457).
   Bản đầu: "cơ chế merge đã hiểu, và đã tắt nếu là script/app".
2. **Branch protection tối thiểu:** required check `lint, typecheck, test` và `enforce_admins` bật (CEO bật 31/10, FE đọc lại 07:56 UTC). Approval
   bị bỏ vì bất khả thi với một tài khoản (mục 5). Bản đầu: "1 required check bất kỳ và 1 approval".

B2 là tầng 3 của phân tầng merge (handoff `session-summary-29-10.md` mục 2): CEO merge sau tín hiệu và comment phê duyệt. Giữ
4 guardrail; audit trail qua comment `[b2-audit]` trên PR (CEO 31/10), không dùng file `docs/ui/b2-audit.md`; comment giữ
vĩnh viễn sau merge.

Thiết kế đã duyệt giữ ở handoff `session-summary-29-10.md` mục 7. B2 tách hai PR (CEO 31/10): B2a tầng 1, B2b tầng 3.
