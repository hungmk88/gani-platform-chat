# Admin: rà dead code, import và export không dùng (08/11/2026)

CEO brief 194, việc D, tầng 1. Báo cáo danh sách, **không sửa code**. Phần đề xuất ở mục 6 chờ CEO duyệt.

Phạm vi: `apps/admin/src` và `apps/admin/app` trên `main` `0b0e08e`. Không tính `src/api/schema.d.ts`, `src/api/planned.d.ts`
(sinh từ OpenAPI).

## 1. Cách rà

| Công cụ | Cách chạy | Bắt được gì |
|---|---|---|
| knip 5 | Cài tạm ngoài repo, không thêm dependency. Entry: route Next (`page`, `layout`, `error`, `not-found`, `route`…), `instrumentation.ts`, `next.config.ts`, unit test, E2E | File không ai import; export không ai import; dependency thừa hoặc thiếu |
| knip `--production` | Như trên nhưng không tính test | Export chỉ test dùng (code chết ở bản chạy thật) |
| `tsc --noEmit --noUnusedLocals --noUnusedParameters --allowUnreachableCode false` | Chạy riêng, không đổi `tsconfig` | Import, biến, tham số không dùng; code không chạy tới được |
| `grep` | Mỗi kết quả của knip kiểm tay: số lần dùng trong file, nơi khác dùng cùng tên | Loại kết quả sai; nhận ra trùng tên khác nghĩa |
| `grep` | `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, dòng code bị comment | Chỗ che lỗi, code cũ để lại |

## 2. Kết quả chính

| Mục | Số |
|---|---|
| File không ai dùng | **0** |
| Import, biến, tham số không dùng (`tsc`, exit 0) | **0** |
| Code không chạy tới được | **0** |
| `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, code bị comment | **0** |
| Export chết hẳn (không dùng ở đâu, kể cả trong file) | **3** (mục 3.1) |
| Hàm chỉ test gọi, bản chạy thật không dùng | **1** (mục 4) |
| Export chỉ dùng trong chính file của nó | 16 giá trị + 16 kiểu (mục 3.2) |
| Hàm trùng hệt nhau ở 2 file | 2 cặp (mục 5) |
| Dependency thừa hoặc thiếu | 0 thật (3 báo sai, mục 5) |

## 3. Export không file nào khác import

### 3.1 Chết hẳn

| Vị trí | Tên | Ghi chú |
|---|---|---|
| `src/api/client.ts:4` | `paths` (re-export kiểu) | Không ai import `paths` từ `client`; ai cần thì import từ `./schema` |
| `src/platform/platform.ts:10` | `ChannelPolicyList` (kiểu) | Khai báo rồi không dùng, cả trong file |
| `src/teams/team-status.ts:5` | `TeamAgentStatus` (kiểu) | Như trên |

### 3.2 Chỉ dùng trong chính file (từ khóa `export` thừa)

Mỗi tên dưới đây được dùng trong file của nó, không file nào khác import. Bỏ `export` không đổi hành vi. Cùng tên ở file khác
(ví dụ `PAGE_SIZE`, `Column`, `Step`, `Problem` trong E2E) là khai báo riêng của file đó, không phải nơi dùng.

| Vị trí | Giá trị |
|---|---|
| `src/autonomy/autonomy.ts:32` | `ALL_LEVELS` |
| `src/customers/customer-fields.ts:15` | `MASK` |
| `src/customers/customers.ts:10` | `PAGE_SIZE` |
| `src/inbox/composer.ts:55` | `localId` |
| `src/inbox/ticket-title.ts:5` | `TITLE_MIN` |
| `src/members/list.ts:14` | `PAGE_SIZE` |
| `src/platform/access.ts:38`, `:39` | `MIN_REASON`, `MAX_REASON` |
| `src/platform/policy-edit.ts:37` | `startOf` |
| `src/profile/password.ts:4`, `:5` | `MIN_PASSWORD`, `MAX_PASSWORD` |
| `src/quick-replies/quick-replies.ts:41`, `:42`, `:70` | `MAX_TAGS`, `MAX_TAG`, `tagsOf` |
| `src/tickets/ticket-create.ts:77` | `CUSTOMER_PICKS` |
| `src/workspaces/workspace-members.ts:13` | `MAX_WORKSPACE_MEMBERS` |

| Vị trí | Kiểu |
|---|---|
| `src/ai/prompts.ts:7` | `PromptVersion` |
| `src/api/errors.ts:4` | `Problem` |
| `src/autonomy/autonomy.ts:10` | `FeatureFlag` |
| `src/bots/graph.ts:33` | `Step` |
| `src/customers/customer-fields.ts:11` | `FieldValue` |
| `src/customers/merges.ts:10` | `MergeSuggestion` |
| `src/inbox/list.ts:181` | `InboxChannel` |
| `src/leads/leads.ts:16`, `:42` | `LeadStatus`, `Column` |
| `src/nav.ts:32` | `NavGroup` |
| `src/overview/overview.ts:20` | `Card` |
| `src/profile/password.ts:18` | `ChangeResult` |
| `src/quick-replies/quick-reply-preview.tsx:21` | `PreviewSource` |
| `src/security/labels.ts:5` | `AlertKind` |
| `src/two-factor-setup.ts:7` | `EnableResult` |
| `src/workspaces/holiday-edit.ts:13` | `HolidayDraft` |

Các kiểu này phần lớn đặt tên cho một schema của OpenAPI (`components['schemas'][…]`); để `export` cũng không hại, chỉ là
dư. Mức ưu tiên thấp.

## 4. Chỉ test dùng

| Vị trí | Tên | Ghi chú |
|---|---|---|
| `src/audit/audit.ts:132` | `splitAction` | Chỉ `src/audit/audit.test.ts` gọi (2 ca). Màn #31 Audit không dùng: code chết ở bản chạy thật |

knip `--production` còn báo 29 tên khác (ví dụ `addDays`, `titleOf`, `durationText`, `unknownVariables`, `mayChangeTickets`,
mã lỗi `WRONG_CODE`, `TOO_MANY`…). Kiểm tay: **đều được dùng trong file của nó**, `export` chỉ để unit test gọi trực tiếp. Đó là
cách test đã chọn, không phải code chết; giữ nguyên. Riêng kiểu `SecurityAlert` (`src/security/security.ts:8`)
chỉ API giả của E2E (`e2e/stub-security.ts`) dùng; cũng giữ.

## 5. Trùng lặp và báo sai

**Hàm trùng hệt nhau:**

| Hàm | Ở đâu | Ghi chú |
|---|---|---|
| `localId(key) => \`local-${key}\`` | `src/inbox/composer.ts:55` (export) và `src/inbox/notes.ts:63` (riêng) | Cùng nội dung; tin chờ gửi và ghi chú chờ gửi dùng chung dạng id |
| `dayText(day) => day.split('-').reverse().join('/')` | `src/audit/audit.ts:60` và `src/workspaces/holidays.ts:15` | Cùng nội dung. `src/platform/platform.ts:63` cũng tên `dayText` nhưng nhận ISO có giờ, khác nghĩa: không gộp |

**Báo sai của knip (không phải lỗi, không đổi gì):**

- `@gani/ui` "không dùng": dùng qua CSS, `app/globals.css:2` `@import '@gani/ui/theme.css'`.
- `tailwindcss` "không dùng": dùng qua CSS, `app/globals.css:1` `@import 'tailwindcss'`.
- `postcss` "thiếu khai báo": `postcss.config.mjs` chỉ khai báo plugin `@tailwindcss/postcss`, không import `postcss`; Next tự mang
  `postcss`.

## 6. Đề xuất (chưa làm, chờ CEO duyệt)

Một PR tầng 1, khoảng 40–60 dòng, không đổi hành vi. Gate: lint, typecheck, unit, E2E đầy đủ xanh; chạy lại knip thì mục 3.1 và
4 về 0.

1. Xóa 3 export chết hẳn ở mục 3.1.
2. `splitAction`: xóa hàm và 2 ca test của nó. Nếu màn Audit sắp cần tách `entity.verb` (ví dụ lọc theo loại đối tượng) thì giữ,
   CEO chốt.
3. Gộp 2 cặp hàm trùng ở mục 5: `notes.ts` import `localId` từ `composer.ts`; `holidays.ts` và `audit.ts` dùng chung một
   `dayText` (ví dụ chuyển vào `src/format.ts` hay file ngày tháng sẵn có).
4. Không bắt buộc, ưu tiên thấp: bỏ `export` thừa ở mục 3.2. Nếu làm thì thêm knip vào CI để chặn tái phát; việc này đụng
   `package.json` và workflow, cần CEO quyết riêng (không tự sửa workflow).

Các phần không đề xuất: dependency (mục 5 báo sai), export cho unit test (mục 4 đoạn 2).
