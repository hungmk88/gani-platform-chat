# Handoff BE — 07/11/2026 13:55 UTC

Repo `hungmk88/gani-platform-chat`. Vai trò: BE dev, báo cáo A (CEO) bằng tiếng Việt, giờ UTC, theo `CLAUDE.md`.
Phiên cũ: `session_015SNdqahP5ww1xzoFPE12QW`. File này chưa commit (lệnh cấm PR docs lẻ tới 09/11): đưa vào PR docs gộp sáng 09/11.

## 0. Việc phải làm NGAY khi mở phiên mới

1. Đọc `CLAUDE.md` gốc, `packages/db/CLAUDE.md`, `apps/api/CLAUDE.md`.
2. `git fetch origin && git ls-remote origin main` (chạy RIÊNG, không nối với push).
3. Kiểm CI `main` mới nhất đủ 9 job. Lúc viết: `main` = `61d16fc` (#638), run 42378882237 đang chạy.
4. **J3b-1 = PR #641 (draft, mở 14:03 UTC 07/11)**, HEAD `eddea64` trên `main` `61d16fc` (xanh 14:02). Kiểm 7 job + GitGuardian +
   `clean` → ready → merge kèm `expectedHeadSha`; `main` đổi → kiểm overlap, Update branch, chờ CI lại.
   Bản đầy đủ gộp + tách (nguồn J3b-2): `origin/feat/j3b-merge-store` = `efd1fc5` (nền cũ `a3f5a89`, không mở PR từ nhánh này).
5. Kiểm lịch đã đặt (mục 6) và PR đang mở của mình: `list_pull_requests` state open.

## 1. Luật đang áp dụng (ngoài CLAUDE.md)

- **Sprint 02/11–09/11, CEO chốt (X) 06/11:**
  - Cấm mọi PR docs/planned riêng lẻ tới 09/11. Docs gộp **một PR sáng 09/11**. Ngoại lệ: sửa `QUESTIONS.md` đi kèm PR code.
  - Báo cáo tầng 2 rút còn **2 mục**: HEAD + squash + giờ + CI `main` xanh. Tầng 3 giữ 5 mục. Tầng 1: PR + squash + giờ + CI main.
  - Thứ tự ưu tiên: **J3 → P11 → J5 → P7 → C11**. Không mở PR nào khác (không FPT, không planned mới, không docs lẻ).
  - Không chạy song song PR trùng file OpenAPI sinh (`planned.ts`, `document.ts`, `*.json`, `*.d.ts`) — tuần tự.
- **`URGENT APPROVAL`** (CEO 07/11): PR tầng 3 báo "sẵn sàng, chờ APPROVED" mà CEO chưa trả lời sau 1 giờ → nhắc lại kèm từ khóa
  `URGENT APPROVAL` và ngày giờ.
- **Mỗi lần Update branch**: mọi check phải xanh lại trên HEAD mới (kể cả GitGuardian; kiểm số commit đã quét / giờ chạy sau
  update). Không check nào "kế thừa" từ HEAD cũ.
- **Merge**: auto-merge chỉ khi khóa được HEAD (`expectedHeadOid`); công cụ hiện không có tham số này → merge trực tiếp kèm
  `expectedHeadSha` khi `clean`.
- **Không bao giờ** `test.skip`/tắt test để CI xanh (BE cũng không sửa test e2e của FE). Flaky FE: chạy lại job đỏ **một lần**; xanh
  → ghi flaky, chuyển FE; đỏ lần 2 → lỗi thật, dừng push, báo CEO + FE, đọc trace Playwright.
- `main` đỏ → không push PR nào. `ls-remote` là lệnh riêng trước mỗi push.
- Kích thước: ≤ 400; ≤ 500 nếu phần vượt là test bắt buộc; vượt 500 → báo trước khi push kèm phương án tách.
- Mutant bắt buộc: RLS, GRANT, CHECK hai chiều, FK cặp, logic quyền. Mutant DROP trình CEO trước. Chạy trên DB nháp `gani_o1`.
- Trivy: đọc một lần mỗi ngày cho báo cáo cuối ngày (chỉ đọc mỗi PR khi PR đụng `infra/docker`).
- Bài học mới (đưa vào PR docs 09/11):
  - `git stash` không cất file untracked → trước khi kiểm "trên main sạch": `git status --porcelain` / `git clean -n`.
  - Tách file bằng script → chạy typecheck + lint **trước** khi commit.
  - Amend `--no-edit` chỉ khi nội dung không đổi; nội dung đổi thì viết lại message (sự cố `61bd565`, mục 5).
  - Không trích mã N/U khi không chắc; ghi thẳng nội dung.

## 2. PR đã merge (05/11 → 07/11)

| PR | Nội dung | Squash | Merge (UTC) |
|---|---|---|---|
| #621 | docs báo cáo 05/11 | `3f438de` | 06/11 09:44 |
| #622 | đóng A/B, staging trên FPT | `81e3566` | 06/11 09:49 |
| #624 | L5 lead ghi qua HTTP (tầng 2) | `e83a00b` | 06/11 10:08 |
| #626 | K3 U81–U86 (tầng 3, APPROVED 10:30) | `aa73560` | 06/11 10:49 |
| #629 | docs U84 `workspaceId` mở rộng duyệt | `3bd2855` | 06/11 10:53 |
| #631 | khung Terraform FPT, N203 | `93ea58c` | 06/11 16:34 |
| #633 | J3-0 hợp đồng planned gộp/tách (tầng 3, APPROVED 13:05) | `c623ef8` | 07/11 13:10 |
| #635 | J3a bảng gộp khách + quyền (tầng 2) | `61bd565` | 07/11 13:32 |

FE trong khoảng này: #625, #627, #628, #630, #632, #634, #636 (.claude hook SessionStart), #637, #638. FE có PR #639 (tầng 3) chờ CEO.

## 3. J3 gộp khách trùng — đang làm (N197, N204, N205)

**Đã chốt (CEO 06–07/11):**
- Gộp + gợi ý: Owner/Admin/Manager (lệch Brief P9 dòng 443 "Agent", vì RLS workspace → gộp dở dang). Transaction gộp mở
  phạm vi **mọi workspace còn hoạt động** của công ty; `org_id` từ phiên; không SECURITY DEFINER.
- Tách + danh sách lần gộp: Owner/Admin. `unmerge` làm ở Đợt 1.
- Gộp vào khách đã xóa mềm → 404, không ghi gì. Tách khi đích đã xóa mềm → vẫn chạy. Gộp lại cùng cặp sau khi tách → được.
- Khóa hai khách theo thứ tự id. Audit `customer.merged`/`customer.unmerged` chỉ id.
- Hợp đồng (#633, planned S4): `POST /v1/customers/merge`, `POST /v1/customers/{id}/unmerge`, `GET /v1/customers/{id}/merges`,
  `GET /v1/customers/{id}/merge-suggestions`.
- Bảng (#635): `customers.merged_into/merged_at`, `customer_merges`, `customer_merge_moves`; `UPDATE (customer_id)` trên
  identities/tickets/leads/customer_tags/customer_field_values. FK `merged_into` dùng `NO ACTION` (duyệt). Mutant 27/27.

**Còn lại, theo thứ tự (CEO chốt tách 07/11):**

| Bước | Nội dung | Tầng | Trạng thái |
|---|---|---|---|
| J3b-1 | `mergeCustomers`, ẩn khách đã gộp trong `customer-read`, 6 test (gồm 3 test CEO bắt buộc), mutant C1–C3 (3/3), N205 mục (1) | 1 | **PR #641** draft, `eddea64` trên `61d16fc`; 406 dòng; kiểm local exit 0 |
| J3b-2 | `unmergeCustomer`, 4 test tách (gồm 2 test CEO bắt buộc), mutant C4–C6, N205 mục (2)(3) | 1 | mã có trong `origin/feat/j3b-merge-store` `efd1fc5`; làm sau khi J3b-1 merge |
| J3c | API merge/unmerge/merges: planned → served, hợp đồng giữ nguyên, sửa import FE cùng PR | 2 | chưa làm |
| J3d | `merge-suggestions` (SĐT/email khớp đúng, ≤ 20) | 2 | chưa làm |

**Dựng J3b-2 sau khi J3b-1 merge** (lấy phần tách từ `efd1fc5`):
```
git fetch origin feat/j3b-merge-store
git checkout -b feat/j3b2-unmerge-store origin/main
git show origin/feat/j3b-merge-store:packages/db/src/customer-merge-store.ts > /tmp/full-store.ts   # tham khảo
```
Thêm vào kho của `main`: `unmergeCustomer`, `CustomerNotMergedError`, `MergeTargetMergedError`, tham số `only` của `move()`, import
`isNull`; export trong `index.ts`; spec thêm `describe('unmergeCustomer')` + hằng `unmerge` (4 test: trả đúng dòng + ô đã điền
mà đích chưa đổi, đích xóa mềm vẫn tách, gộp lại cùng cặp, từ chối not_merged/không có/target_merged); mutant thêm C4–C6;
N205 thêm mục (2)(3). **Chạy typecheck + lint trước khi commit.** Chạy mutant (`DB_MUTANTS_CONFIRM=yes bash lint/db-mutants.sh
lint/mutants/customer-merge-store.sh <log>` trong `packages/db`), cập nhật `customer-merge-store.result.txt`.

## 4. Việc sau J3 (thứ tự CEO chốt)

- **P11 sự cố bảo mật** (hợp đồng planned S5 có sẵn ở `apps/api/src/modules/security/`). Operator **giữ** trong API (Phụ lục B);
  hiện chưa có cơ chế platform operator vào `/v1` qua access session → P11b phải làm cơ chế này (kiểm `platform_access_logs`
  còn hạn, có lý do): **trình phương án trước khi code**. P11a migration + store; P11b API; P11c nguồn sinh cảnh báo
  (`two_factor_reset`, `login_failures` trước).
- **J5** import/export CSV khách: chưa có hợp đồng → cần phương án + CEO gỡ cấm planned.
- **P7** privacy: chỉ phần ghi nhận (GET/POST/GET {id}); `execute` chờ luật sư, tầng 3.
- **C11** thông báo in-app: chờ CEO chốt in-app.

## 5. Sự cố và ghi chú cho PR docs 09/11

- 06/11: `ls-remote` và `push` cùng một lệnh → không thấy `main` đổi (`c2dce9e`). Từ nay lệnh riêng.
- 06/11: worker restart mất ~5 giờ (11:03 → 16:29 UTC), #631 mở trễ. 07/11: restart thêm lần nữa (08:00 → 08:22).
- Flaky e2e FE, cùng kiểu chờ 5s nhận 0: `e2e/ai.spec.ts:153` (06/11, `main` `93ea58c`) và `e2e/realtime.spec.ts:81`
  (07/11, `main` `61bd565`); đều xanh khi chạy lại. Chuyển FE: `waitFor` / tăng timeout / retry, FE chọn.
- Lỗ hổng phủ test: PR chỉ đụng BE không chạy job admin e2e → lỗi FE chỉ lộ trên `main`.
- Rủi ro hạ tầng: worker restart + flaky ≈ 5,5 giờ trong 2 ngày.
- Duyệt J3-0 trễ ~4,5 giờ (sẵn sàng 08:50, APPROVED 13:05); BE check-in 08:43, 09:35, 10:37 → luật `URGENT APPROVAL`.
- Commit `61bd565` (#635) ghi "mutant DROP chờ CEO duyệt" — **sai**: 14 DROP đã chạy, 27/27 bị bắt (bằng chứng: mô tả #635,
  `packages/db/lint/mutants/customer-merges.result.txt`). Nguyên nhân amend `--no-edit`. Không sửa lịch sử `main`.
- Công cụ auto-merge thiếu khóa HEAD → merge tay kèm `expectedHeadSha`.
- Bài học `git stash`/untracked, tách file bằng script, amend `--no-edit` (mục 1).

## 6. Lịch đã đặt (scheduled tasks)

| Id | Lúc (UTC) | Nội dung |
|---|---|---|
| `trig_01Q3ZhetkXCNmm7Z1nd5mutk` | 07/11 14:02 | Đã chạy: main `61d16fc` xanh, mở #641 |
| `trig_01Qt6m353f8dF8699uJqHyhY` | 08/11 01:00 | Nhắc rủi ro #2 (staging FPT, Q1, A/B), thay `trig_01DKAHXQBLz1mAbb9HmzfxPb` (đã tắt 06/11) |

Hai lịch này bắn vào phiên cũ `session_015SNdqahP5ww1xzoFPE12QW`. Phiên mới muốn nhận thì tạo lại (send_later) và tắt lịch cũ.

## 7. Treo ngoài tầm BE

- **FPT staging (N203):** proxy chặn `registry.terraform.io` → chưa xác minh provider. Khung `modules/{network,database}/fpt/`
  chỉ comment, `platform = ""`, không lock, không plan. Cần người dùng mở network access (Allowed domains: `registry.terraform.io`,
  `releases.hashicorp.com`, tài liệu FPT) hoặc FPT gửi tên provider. Tới 08/11 chưa mở → staging khó kịp S1 16/11 (CEO quyết
  dời S1 hoặc chấp nhận rủi ro).
- **Q7** hạn 10/11: chặn C9, C10 (phần còn lại), SLA. Trượt → dời sau S4; go-live 31/01/2027 giữ nếu phần khác đúng hạn.
  `Conversation.sla` hiện luôn `null`, lọc `?sla=` trả rỗng.
- **Q1** hạn 10/11: chờ văn bản luật sư (chặn bật AI production, P7 execute).
- **Q6/Z-g**: chặn `POST /v1/channels/zalo/connect`. **Q8** hạn 28/12: I1, I3.

## 8. Môi trường local (container)

- DB nháp: env `scratchpad/gani_o1.env` (nạp `set -a; . <file>; set +a`). Sau restart Postgres tắt: `bash scripts/check-db.sh`;
  thiếu migration: `pnpm --filter @gani/db migrate`.
- `unset NODE_ENV` trước khi build (môi trường có `NODE_ENV` lạ, Next build admin lỗi ở local — giới hạn local, CI kiểm thật).
- Lệnh kiểm giống CI: `pnpm build && pnpm typecheck && pnpm lint && pnpm format:check`; `pnpm --filter @gani/api test`
  (có coverage); `pnpm --filter @gani/db test`; `pnpm --filter @gani/{db,api} test:integration`.
- Sinh OpenAPI: `pnpm --filter @gani/api build && pnpm --filter @gani/api openapi && pnpm --filter @gani/admin gen:api`.
- Quét secret trên dòng thêm: `git diff origin/main...HEAD -U0 | grep '^+' | grep -i -E "npg_|sk-[a-zA-Z0-9]{20,}|sk-ant-|AIza|AKIA|ghp_|PASSWORD="` (exit 1 = sạch).
- gitleaks pre-commit coi SHA 40 ký tự là secret: viết SHA rút gọn.
- `registry.terraform.io` bị proxy chặn (403).
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` + `Claude-Session: <link phiên>`.
  PR body kết thúc bằng dòng Claude Code + link phiên + footer `_Generated by …_`.

## 9. Con số

- A ≈ 27/58 ≈ 47% (CEO ước 06/11; 03/11 đo 25/58 ≈ 43%).
- J3 xong (J3b-1, J3b-2, J3c, J3d) dự kiến nâng mã J3.
- Trivy `main` `93ea58c` (06/11): 4 ảnh HIGH 0 / CRITICAL 0; cảnh báo cỡ `api` 131 MB, `admin` 112 MB (dưới ngưỡng đỏ 150 MB).
