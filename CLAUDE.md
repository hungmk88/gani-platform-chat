# Gani Foods Platform — Quy tắc cốt lõi

Nền tảng Chat & AI Chatbot đa tenant cho 5 công ty.
Đọc `docs/brief-backend-core-v1.0.md` (Brief Backend & Core v1.0) trước khi làm bất cứ việc gì.
`docs/implementation-brief.md` (v0.4) đã bị thay thế, chỉ giữ làm lịch sử.
Hồ sơ gốc + Phụ lục v2.1–v2.3 thắng Brief khi mâu thuẫn.

## CÁCH LÀM VIỆC (bắt buộc)

1. Mọi yêu cầu code → **vào Plan Mode trước** (Shift+Tab ×2).
   Đọc code, hiểu ngữ cảnh, trình phương án. KHÔNG code ở lượt đầu.
2. Chờ tôi duyệt phương án rồi mới code.
3. Chia PR ≤ 400 dòng (mục tiêu; 500 cho PR code có test bắt buộc, xem "KÍCH THƯỚC PR"). Trunk-based. Conventional Commits.
4. Gặp chỗ chưa chốt trong Brief → ghi vào `QUESTIONS.md`, KHÔNG tự đoán.

## GIT WORKFLOW

### Nhánh và PR

- Mỗi PR làm trên branch riêng:
  - `feat/<mô-tả>`, `fix/<mô-tả>`, `chore/<mô-tả>`, `docs/<mô-tả>`, `test/<mô-tả>`
- KHÔNG commit trực tiếp lên `main`.
- KHÔNG `push --force` lên `main`.
- KHÔNG amend commit đã push.
- Sau khi push branch, báo URL cho anh.
- **Phân tầng merge (áp dụng cho FE và BE)** (CEO 31/10):
  - Tầng 1/2 — docs, chỉ đọc, test, fix nhỏ, thao tác ghi thông thường (POST/PATCH/DELETE lên API không gây hậu quả không
    hoàn tác): DEV tự merge sau khi required check xanh.
  - Tầng 3 — thao tác không hoàn tác được: CEO merge sau khi DEV gửi "Sẵn sàng merge" kèm HEAD + job +
    `mergeable_state = clean`, và CEO comment phê duyệt vào PR trước khi bấm merge.
    - FE (CEO brief 167, 169, 07/11/2026): **chỉ thao tác không hoàn tác được**: xóa dữ liệu khách (#23 B2), đóng sự cố bảo
      mật (#29 B2), gộp khách (J3 B1), chuyển AI sang môi trường chính thức (production, #26 B2). Tách khách (J3 B2) và hạ mức
      tự chủ (#27 PR B) là **tầng 2** (hoàn tác được: gộp lại, nâng lại).
    - BE: do BE lead định nghĩa trong tài liệu BE. Tầng 3 của BE (migration xóa dữ liệu, đổi schema phá vỡ, …) do BE lead định
      nghĩa trong tài liệu BE; nguyên tắc áp dụng ngay từ khi luật có hiệu lực.
- Kèm theo phân tầng (CEO 31/10). 5 dòng dưới đây là chi tiết bắt buộc của tầng 1/2, không phải tùy chọn:
  - Mọi PR mở ở draft. Tầng 1/2: DEV tự chuyển ready ngay trước khi tự merge, trong cùng một lượt. Draft không thay required
    check, phải có cả hai.
  - Tầng 1/2: DEV tự kiểm đủ 9 job của `.github/workflows/ci.yml` (của `main`) theo tên trên đúng HEAD, trước khi merge, theo
    mục "Job chạy theo loại PR" dưới đây, không chỉ nhìn required check (CEO 01/11). Required check (9 context, gồm `docker images`; job `skipped` tính là
    đạt) chỉ là lưới an toàn cuối. Sau merge báo HEAD, tên từng job, thời điểm, diff giữa HEAD và commit squash.
  - "Ready" ≠ "xong": PR rời draft không phải tín hiệu merge.
  - PR sửa file của bộ phận khác phải có review của bộ phận đó, kể cả comment.
  - Chi tiết và lịch sử: `docs/ui/session-summary-29-10.md` mục 2; required check (9 context) và `enforce_admins`: U71.
- **Tầng 1 code: tự push, tự merge, báo sau** (01/11/2026, ký A (CEO)). Chỉ PR tầng 1 có code; không áp cho PR docs, tầng 2/3:
  - Kiểm ở local trước khi push: lint, typecheck, unit test, format, build, E2E xanh. **Không** chạy `docker images`,
    `database`, `queue`, `terraform`, `coverage` ở local (không mirror, không `dockerd`, không chờ Docker Hub): CI kiểm thật.
  - Push, mở PR draft; trên CI tự kiểm đủ 9 job theo tên. Mọi job phải chạy theo bảng success thật và `clean`: chuyển
    ready, merge (auto-merge nếu còn check chờ, merge trực tiếp nếu đã `clean`), truyền `commit_title` và `expectedHeadSha`.
  - `expectedHeadSha` / `expectedHeadOid` luôn là SHA đủ 40 ký tự, lấy từ `git ls-remote` (08/11/2026, ký A (CEO), brief 180):
    SHA rút gọn hay đệm `0` vẫn được GitHub nhận, nên không chặn được HEAD sai. SHA không khớp thì không bật auto-merge, báo
    CEO. Sau merge kiểm `git diff <HEAD PR> <squash>` = 0.
  - Cách merge từ 08/11/2026 tối (ký A (CEO), brief 191, 192): 9/9 + `clean` thì merge trực tiếp bằng `merge_pull_request`
    với `expectedHeadSha` đủ 40 ký tự. **Không dùng `enable_pr_auto_merge`**: công cụ không còn nhận `expectedHeadOid`, nên
    không ghim được HEAD. Áp cho mọi PR tầng 1 (code, test, docs).
  - `main` đi trước: dùng "Update branch" của GitHub, không merge ở local.
  - Sau merge báo CEO **một lần, gộp cả phiên**, mỗi PR 3 mục: giờ merge từ commit squash, commit squash, 9 job trước và
    sau merge theo tên.
  - Dừng, báo CEO ngay khi: job phải chạy bị skip (sai bảng) hoặc lỗi hạ tầng; có job fail; `main` bất thường; có PR merge không qua
    tín hiệu.
  - Chỉ áp khi branch protection còn `strict`, `enforce_admins`, 9 required check gồm `docker images`; đổi thì quay về luật
    cũ, báo CEO.
- **Luật hủy heads-up** (CEO 01/11, nguyên văn): Khi có comment hold trên PR: dừng mọi hoạt động trên PR đó, gồm push,
  heads-up, đổi draft/ready, merge. Hold hủy vĩnh viễn auto-merge cho PR đang bị hold; muốn mở lại phải có comment gỡ hold
  từ CEO. Vi phạm hold là sự cố quy trình, ghi vào handoff.
- **Đồng hồ heads-up 30 phút** (02/11/2026, ký A (CEO), sau #521): chỉ chạy khi đồng thời (a) comment heads-up đã đăng công
  khai; (b) mọi job phải chạy theo bảng "Job chạy theo loại PR" xanh thật; (c)
  `mergeable_state = clean`. Sau comment heads-up có push thêm commit: đồng hồ về 0, comment cũ hết hiệu lực, phải đăng comment
  heads-up mới sau khi CI xanh lại. CI đỏ giữa chừng: đồng hồ dừng, chạy lại từ đầu khi CI xanh. Không tính "30 phút từ lúc
  comment" tách khỏi điều kiện: làm vậy là auto-merge trá hình.
  **Phạm vi** (02/11/2026, ký A (CEO), brief `2810-02112026-FE-BRIEF-37`): đồng hồ chỉ áp cho PR tầng 2 hoặc trường hợp đặc biệt.
  PR tầng 1 code tự merge ngay khi mọi job phải chạy success thật và `clean` (mục "Tầng 1 code" ở trên), không đăng heads-up, không chờ 30 phút.
- **Heads-up 5 phút cho PR docs nhỏ (5a)** (02/11/2026, ký A (CEO)): PR docs tầng 2, diff ≤ 10 dòng, chỉ sửa `QUESTIONS.md`
  hoặc file trong `docs/`: đồng hồ 5 phút thay 30, cùng điều kiện (a)–(c) và cùng cách reset. Không áp cho PR đụng code,
  schema, `CLAUDE.md` hay file nào khác. Nghi ngờ thì 30 phút.
- **Update branch không reset heads-up khi `main` chỉ đổi file không liên quan (5b)** (02/11/2026, ký A (CEO)): để merge song
  song PR không đụng file chung. Trước khi giữ đồng hồ, người merge so danh sách file `main` vừa đổi với file của PR. **Vẫn
  reset** khi `main` đổi: cùng đường dẫn với PR (khác nội dung cũng vậy); `packages/db` (schema, migration); `CLAUDE.md` hay
  `QUESTIONS.md`. Giữ đồng hồ thì ghi vào comment PR: "main đổi commit X, file Y, không overlap → giữ heads-up cũ". Không chắc
  thì reset, không đoán. Commit của chính PR vẫn reset như luật 30 phút.
- **Mức A: DEV tự merge PR tầng 3 theo phương án đã duyệt** (02/11/2026, ký A (CEO)). Chỉ khi đủ cả 7 điều kiện; thiếu một
  điều thì không merge, báo CEO:
  1. Phương án đã được CEO duyệt: brief giao việc ghi rõ, hoặc CEO comment "Duyệt phương án" / "APPROVED theo Mức A" trên PR.
  2. Mọi job phải chạy theo bảng "Job chạy theo loại PR" xanh thật trên đúng HEAD sau lần Update branch cuối; job bị skip
     đúng bảng, log `changes` ghi lý do.
  3. `mergeable_state = clean`, HEAD khớp `git ls-remote`.
  4. Diff mã khớp phương án: không thêm/bớt file, schema hay dependency ngoài phương án; ≤ 400 dòng (500 nếu test bắt buộc),
     không tính file sinh.
  5. Không đụng dữ liệu khách thật (INSERT/UPDATE/DELETE trên `customers`, `conversations`, `messages`, `tickets` ở production).
  6. Trivy không có HIGH/CRITICAL có bản sửa; GitGuardian xanh.
  7. Sau merge: diff HEAD ↔ commit squash = 0; báo CEO HEAD, commit squash, 9 job trước và sau merge theo tên, xác nhận diff
     khớp phương án.
  - CEO xem lại trong 24 giờ sau merge; lệch phương án thì revert hoặc migration bù (rollback vẫn do CEO quyết).
  - Mọi phê duyệt phải là comment GitHub của CEO (#498); tin nhắn không tính. Bỏ FE review hay heads-up của một PR chỉ khi CEO
    ghi rõ trên PR đó (ví dụ #542–#544: "bỏ FE comment + heads-up").
- **Job chạy theo loại PR** (02/11/2026, ký A (CEO), Cách 1, #562): job `changes` (`infra/ci/changes.sh`) quyết job nào chạy;
  bảng đầy đủ và luật fail-safe ở `infra/CLAUDE.md` "Lọc đường dẫn". Job phải chạy thì phải success thật; job bị skip phải đúng
  bảng và log `changes` ghi lý do; PR code (đụng `apps/**`, `packages/**`) luôn có `docker images` success thật.

  | PR | Job phải chạy, success thật | Skip |
  |---|---|---|
  | Code BE; `.claude/**` (`changes.sh` coi như code BE) | changes, verify, security, docker, database, queue, coverage (7) | admin, terraform |
  | Chỉ FE (`apps/admin`, `apps/widget`, `packages/ui`) | changes, verify, security, docker, admin (5) | 4 job còn lại |
  | Chỉ docs `.md` (`*.md`, `docs/` trừ dòng dưới) | changes, verify, security (3) | 6 job còn lại |
  | Chỉ docs có file không phải `.md` trong `docs/ui/` (ví dụ `docs/ui/session-state.json`) | changes, verify, security, admin (4) | 5 job còn lại |
  | Chỉ Terraform | changes, verify, security, terraform (4) | 5 job còn lại |
  | Lẫn BE + FE; file ở gốc (`package.json`, `pnpm-lock.yaml`…) | changes, verify, security, docker, database, queue, coverage, admin (8) | terraform |
  | Workflow, `infra/ci/`; push lên `main` | cả 9 | — |

  Dòng `.claude/**` và dòng `.json` trong `docs/ui/` (07/11/2026, ký A (CEO), brief 140): theo đúng `ADMIN_NEEDS` và
  `BACKEND_SKIP` của `changes.sh` (fail-safe), không sửa `changes.sh`. "9/9" = 9 required check đạt theo tên, job skip đúng
  bảng tính là đạt (brief 140 mục 5), áp cho mọi PR.

- **Song song và gộp PR** (02/11/2026, ký A (CEO), Cách 2 và 3):
  - Tối đa 4 nhánh song song. Trước khi mở nhánh, so file với các PR đang mở: trùng `packages/db/test/fixtures.ts`,
    `grants.spec.ts`, `packages/db/src/index.ts`, migration liền kề, `openapi/planned.ts`/`document.ts` hay file OpenAPI sinh ra
    thì chờ PR kia merge. Mô tả PR ghi "Độc lập với #…". PR đang chờ merge thì không mở PR chồng lên nó.
  - Gộp hai PR cùng module chỉ khi: tổng ≤ 500 dòng có test bắt buộc (không thì 400), không sửa file dùng chung giữa hai PR,
    không có hai migration liền kề. PR đụng module `customers` luôn đứng riêng. Báo cáo ghi PR nào gộp, PR nào tách, lý do.
  - Merge và Update branch từng PR một: PR xanh thì merge ngay, rồi mới Update PR kế tiếp.
- **Duyệt lô theo sprint** (02/11/2026, ký A (CEO), sprint 02/11–09/11):
  - Trong sprint CEO duyệt lô, mọi PR tầng 2/3 có phương án đã duyệt (brief hoặc comment GitHub): DEV tự merge khi đủ 7 điều
    kiện Mức A, không cần CEO comment lại từng PR; diff lệch phương án thì dừng, báo CEO.
  - Trong sprint đó bỏ FE comment (FE review sau merge 24 giờ, sai thì CEO quyết revert) và bỏ heads-up 30' của tầng 2. Ngoài
    sprint quay về luật cũ, trừ khi CEO gia hạn bằng comment GitHub. Báo cáo cuối ngày và cuối sprint.
- **Nhận việc và báo cáo** (02/11/2026, ký A (CEO), quy trình 7 bước):
  - Nhận việc qua chat: DEV soạn ngay brief giao việc gửi lại CEO (bối cảnh, phạm vi, tầng, hạn, acceptance, ràng buộc, câu hỏi
    cần chốt), không code ở bước này; sau đó mới Plan Mode.
  - Sau mỗi merge, báo CEO 5 mục: HEAD trước merge; commit squash; 9 job trước merge theo tên và giờ xong; 9 job của `main` sau
    merge theo tên; diff HEAD ↔ squash = 0 (kèm xác nhận diff khớp phương án khi theo Mức A).

### Quy trình mỗi PR

1. `git checkout main && git pull`
2. `git checkout -b feat/pr3-tenancy-tables`
3. [viết code, chạy lint/typecheck/test]
4. `git add . && git commit -m "feat(db): ..." -m "Co-Authored-By: Claude <noreply@anthropic.com>"`
5. `git push -u origin feat/pr3-tenancy-tables`. Luôn dùng `git push -u origin <branch>`, không dùng `git push` trần (08/11/2026,
   ký A (CEO), brief 193, 194); quét secret chạy riêng trước đó (mục "Scan trước khi push").
6. Mở PR ở draft, báo anh URL PR + tóm tắt thay đổi
7. CI chạy → merge theo phân tầng ở trên
8. `git checkout main && git pull`

Lưu ý trước bước 4: chạy `git status` và `git diff --stat`, chỉ để lại file thuộc PR này
(không `.env`, không file do công cụ tự sinh ở root).

Kết nối GitHub (MCP) gián đoạn hay phiên khởi động lại: đăng ký theo dõi PR có thể mất. Kiểm lại bằng tay mọi PR đang mở của mình
(merge chưa, `APPROVED`, hold, CI), không chờ thông báo (#538 merge 14:23 UTC 02/11, phiên không nhận được tin nào).

## KÍCH THƯỚC PR

- **≤ 400 dòng là mục tiêu, không phải trần cứng** (không tính file sinh tự động). Mỗi file ≤ 500 dòng.
- **500 cho PR code có test bắt buộc** (01/11/2026, ký A (CEO)): chỉ khi phần vượt 400 là test bắt buộc theo phạm vi đã
  duyệt (ví dụ đủ 12 loại bước, ca 200 bước, axe cho từng trạng thái). Vượt 500 vẫn báo trước khi push. PR docs và PR không
  có test bắt buộc giữ 400.
- Vượt trần (400, hoặc 500 như trên): **báo trước khi push**, kèm số dòng, lý do không tách được và phương án tách. Anh quyết giữ hay tách.
  Đã có ca được chấp nhận ở 454–464 dòng vì tách ra làm mất tính nguyên tử.
- Tách theo ranh giới nghiệp vụ: mỗi PR đứng một mình và CI xanh; không cắt đôi một thay đổi cho vừa số dòng.
- PR báo cáo rà soát (docs): mỗi file ≤ 400 dòng, cả PR ≤ 450.
- Nguồn: N126 trong `QUESTIONS.md`.

## 5 QUY TẮC KHÔNG THỂ THỎA HIỆP

1. `org_id` không bao giờ lấy từ client. Chỉ từ session/API key/job payload.
2. Mọi PK dùng **UUIDv7**, không dùng UUIDv4.
3. Số nghiệp vụ (giá/tổng tiền/MOQ/cam kết thời gian) phải từ tool;
   model chỉ viết `{{price_1}}` — không tự sinh số.
4. Đổi trạng thái hội thoại phải qua `ConversationStateMachine`.
   Cấm `UPDATE conversations SET state = ...` trực tiếp.
5. Không log PII (SĐT/email/nội dung tin/MST/số TK).
   Chỉ log `messageId`, `traceId`, `orgId`, `workspaceId`.

## KIỂM CHỨNG (phải pass trước khi báo "xong")

- `pnpm test && pnpm lint && pnpm typecheck` — CI phải xanh.
- Thay đổi RLS → chạy `tenant-isolation.spec`: thiếu tenant context phải **báo lỗi**
  (fail-loud), không trả 0 dòng im lặng.
- Thay đổi FSM → chạy `claim-race.spec`: 50 agent claim cùng lúc → **đúng 1 thắng**.
- Thay đổi AI/Giá → chạy bộ 30 câu ResponseGuard, phải **0 số sai lọt ra**.
- Lighthouse (08/11/2026, ký A (CEO), brief 191): admin **desktop** LCP < 2,5 s; widget **mobile** Performance ≥ 90; admin
  mobile best-effort, không bắt buộc. Cách đo và số gốc: `docs/ui/lighthouse-08-11-2026.md`; chạy lại trên staging ở S1.
- Widget: axe không đủ. Kiểm thêm cây accessibility (`toMatchAriaSnapshot`) và focus từng bước (brief 192): V1–V3 ở #687 axe
  không bắt được. NVDA/VoiceOver vẫn do người kiểm trước S5 (`docs/ui/widget-a11y-08-11-2026.md` mục 4).
- Không chứng minh được → báo chưa xong, không tự suy đoán kết quả.

## KHÓA PRODUCTION (không được vi phạm)

- Không kết nối production từ môi trường local/AI.
- Không chạy `seed` ngoài `dev`/`staging` — script phải tự chặn ở prod.
- Không DELETE/TRUNCATE/DROP nếu chưa xác nhận với người.
- Không commit `.env`, secret, credentials. Chỉ `.env.example`.
- Không tự ý deploy. Deploy qua CI/CD, không qua AI.

## CHIẾN LƯỢC MODEL

- Mặc định: `sonnet` (Sonnet 5.5) cho dev hằng ngày.
- Kiến trúc phức tạp / refactor nhiều file / bug khó: gõ `/model opus`.
- Review hàng loạt / sub-agent: gõ `/model haiku`.
- Cùng vấn đề mà 3 lần chưa xong → chuyển `/model opus`, không đốt token.

## QUY ƯỚC THƯ MỤC CON (đọc khi làm trong đó)

- `packages/db/CLAUDE.md` — schema, migration, RLS policy.
- `packages/ai-core/CLAUDE.md` — router, guard, PII masking.
- `apps/api/CLAUDE.md` — domain module, FSM transition, endpoint.
- `apps/worker/CLAUDE.md` — queue, outbox, scheduler, job tenant.
- `apps/admin/CLAUDE.md` — UI admin, 5 nhóm menu, design token.
- `apps/widget/CLAUDE.md` — loader nhẹ, Shadow DOM, brand per workspace.
- `prompts/CLAUDE.md` — system prompt, tool definitions, few-shots, figure_policy.
- `evals/CLAUDE.md` — bộ chạy Test Specification AI (ResponseGuard, 200 câu, PII); dataset không nằm trong repo.
- `infra/CLAUDE.md` — Terraform (module không gắn cloud, chưa apply), Docker, PITR, role DB.

## CẤM

- Không commit file do công cụ tự sinh ở root (`AGENTS.md`, `.cursorrules`, v.v.).
- Không chạy `prettier --write` lên `QUESTIONS.md`: file không theo prettier (`format:check` không quét `.md`), một dòng sửa
  thành hàng trăm dòng diff (K1c-1, 02/11).
- Turbo: `turbo.json` phải có `"agentGuidance": false` (tắt tự sinh `AGENTS.md`).
- Turbo telemetry: tắt bằng `turbo telemetry disable` (toàn cục, mỗi máy một lần); CI đặt `TURBO_TELEMETRY_DISABLED=1`. **Không thêm khóa `telemetry` vào `turbo.json`** (`turbo` báo `unknown key` và từ chối chạy).

## COMMIT MESSAGE

- Conventional Commits.
- Dòng cuối: `Co-Authored-By: Claude <noreply@anthropic.com>` cho mọi commit có AI hỗ trợ.
- Bắt buộc có `< >` để GitHub nhận diện.

## KHI BỊ SỬA CÙNG MỘT LỖI LẦN 2

Nhấn `#` để thêm quy tắc vào file này.
Đây là cách duy nhất để không lặp lại lỗi cũ.

## BẢO MẬT TÀI LIỆU

**Không bao giờ ghi giá trị thật của secret vào `.md`, `.txt`, spec, note, commit message, PR description.**

### Được / Không được

| ❌ KHÔNG | ✅ ĐƯỢC |
|----------|---------|
| `postgresql://user:pass@host` | `<đặt ở .env.test>` |
| `npg_xxxxx`, `sk-ant-xxxxx`, `ghp_xxxxx` | `DATABASE_URL_APP`, `app_role` |
| Private key, cert, token | Placeholder `<...>` |

### Cách viết đúng

```markdown
❌ DATABASE_URL_APP=postgresql://app_role:xxxx@host/db   # mật khẩu viết thẳng vào tài liệu
✅ DATABASE_URL_APP=<đặt ở .env.test>
✅ Connection: xem `.env.test` (đã trong .gitignore)
```

### Scan trước khi push

```powershell
git grep -i -E "npg_|sk-[a-zA-Z0-9]{20,}|sk-ant-|AIza|AKIA|ghp_|PASSWORD="
Get-ChildItem -Recurse -File -Exclude "*.git*","node_modules" |
  Select-String -Pattern "npg_|sk-[a-zA-Z0-9]{20,}|sk-ant-|AIza|AKIA|ghp_"
```

Có kết quả → **DỪNG**.

- Scan chạy **riêng**, không nối với `git commit`/`git push` trong cùng một lệnh. Trước push quét các dòng PR thêm vào; có kết
  quả thì lệnh scan trả exit 1, **không push tự động** (CEO 03/11, brief 52, sau #575):
  `git diff origin/main...HEAD -U0 | grep '^+' | grep -i -E "<mẫu ở trên>"` có dòng → exit 1.
- Khi quét trả kết quả, kiểm từng dòng. Nếu TẤT CẢ là dòng mẫu quét hoặc dòng đã có trên main từ trước PR: ghi vào mô tả PR
  (dòng khớp + lý do) rồi push. Mọi trường hợp khác: DỪNG, không push. (CEO 03/11, brief 53.)
- Mẫu `sk-[a-zA-Z0-9]{20,}`, không phải `sk-` trần: `sk-` trúng chữ thường như `risk-ownership` (#575).

### Khi secret lộ — 5 bước

1. Dừng ngay
2. **Rotate** credential (Neon/AWS/provider)
3. Update `.env.test` local
4. Sửa tài liệu → placeholder
5. Scan repo + ghi nhận vào Session Summary

### Định kỳ

- Cuối session lớn: scan repo
- Trước paste tài liệu cho AI khác: đọc lại
- Trước push public: scan

## KIỂM TRA LỆNH — KHÔNG PIPE CHE EXIT CODE

**Exit code của pipeline = exit code của command CUỐI.**

### Ví dụ SAI

```bash
pnpm test | grep "FAIL"     # ❌ grep thấy → exit 0, tưởng pass dù test fail
pnpm lint | tail -1         # ❌ tail luôn exit 0
```

### Ví dụ ĐÚNG

```bash
# Cách 1 — redirect + đọc exit code (khuyến nghị)
pnpm test > test.log 2>&1; echo "exit=$?"

# Cách 2 — pipefail
set -o pipefail; pnpm test | grep "FAIL"
```

PowerShell:
```powershell
pnpm test; echo "exit=$LASTEXITCODE"
```

### Quy tắc

1. **Không** kết thúc lệnh kiểm bằng `| grep` hoặc `| tail` không có `pipefail`/`PIPESTATUS`.
2. **Luôn** báo exit code thật khi pre-flight.
3. **Không** viết "test pass" mà không có số liệu.

### Report đúng format

```
| Lệnh | Exit | Ghi chú |
|------|------|---------|
| pnpm lint | 0 | |
| pnpm --filter @gani/db test | 0 | 47 test, coverage 100% funcs |
| pnpm --filter @gani/api test | 1 | SWC lỗi (N42) — giới hạn local |
```

## LỊCH SỬ

Nhật ký thay đổi quy tắc: `docs/claude-changelog.md`.
