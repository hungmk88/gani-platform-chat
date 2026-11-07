# Handoff FE — 07/11/2026

Phiên FE `session_015SNdqeCQvNjK6rFoqzt5Su` (FE BRIEF 123, Người ký: A (CEO)). Phiên này đóng sau khi file này merge; phiên mới
đọc file này trước, rồi `CLAUDE.md`, `apps/admin/CLAUDE.md`. Lịch sử chi tiết (29/10–07/11): `docs/ui/session-summary-29-10.md`.
Giờ ghi theo UTC.

## 0. Phiên mới làm gì trước

1. Tạo lại `.session/session-state.json` từ mục 9 (file chỉ ở máy, mất cùng container; loại khỏi git bằng `.git/info/exclude`).
   Khởi động lại mà không chắc trạng thái: trả lời **"Em cần kiểm lại trạng thái"**, không bao giờ "No response requested".
2. Kiểm tay mọi PR đang mở của FE (merge chưa, hold, CI, `mergeable_state`), không chờ thông báo GitHub.
3. Nhánh có commit ở máy: push trước mọi việc khác.
4. Làm tiếp theo thứ tự mục 7: #637 (U84) → U85 → U86. Check-in 2 giờ một lần (phút 06), ghi `last_checkin_utc`.

## 1. `main` và PR

- `main` lúc viết: `4a77da0` (#634), CI `main` 9/9 success (run 42376385160, xong 13:25:25 07/11).
- PR mở:

  | PR | Bộ phận | Nội dung | Tầng | FE cần làm |
  |---|---|---|---|---|
  | #637 | FE | U84 hồ sơ hiện team + sửa locator `Trạng thái` + handoff lần 8, #633 | 1 code | CI 5+4, `clean` → tự merge → 5 mục |
  | #635 | BE | J3a bảng `customer_merges`, `customer_merge_moves` (`packages/db`) | BE | không chạm file FE; không comment |
  | #636 | CEO/OPS | `.claude/settings.json` + hook SessionStart in checkpoint (Mức 2.5) | 3 | CEO merge; không chạm file FE |

- Đã merge 07/11: #632 U82 (08:26:41, `27a85d1`), #633 J3-0 của BE (13:10:30, `c623ef8`), #634 U83 (13:18:53, `4a77da0`).
- Đã merge 06/11, FE: #620 U79a (`ad515e7`), #623 U79b (`8226810`), #625 U80 (`c2dce9e`), #627 U74 (`a239563`), #628 U75
  (`b017efa`), #630 U81 (`8f573b3`). Khác: #621, #622 (docs), #624 L5, #626 K3 (U81–U86), #629 (QUESTIONS), #631 (infra).
- Review chéo PR BE chạm file FE (trong 24 giờ, ghi handoff, không comment GitHub): #618, #624, #626, #633 xong, đều đúng
  (`gen:api` sinh lại khớp từng byte). Ghi ở `session-summary-29-10.md` mục 2.

## 2. Số đo A/B/C/D (CEO 07/11, brief 123)

| | Thước đo | Số |
|---|---|---|
| A | Tính năng Đợt 1 (58 mã) | 28/58 |
| B | Deliverable S1–S5 (29) | 19/29 |
| C | Màn FE Đợt 1 (30) | 22/30 |
| D | Cả dự án (135 mã) | 28/135 |

## 3. Tám sự cố worker khởi động lại

Chung: worker của phiên FE khởi động lại, bộ nhớ hội thoại mất; FE trả "No response requested" thay vì làm tiếp việc dở. CEO: lỗi
hệ thống phiên, **không trừ điểm FE** (brief 77, 105, 119, 121).

| Lần | Thời gian | Hậu quả | Bằng chứng |
|---|---|---|---|
| 1–4 | 05/11 ~07:42, 08:08, 10:08, 12:10 | 5 mục #602 chưa gửi, B2 chưa push; chậm ~6 giờ | brief 77; giờ push B2 trên GitHub |
| 5 | 05/11 17:35, 17:52, 18:07, 20:07, rồi qua đêm | U79a xong ở máy (380 dòng, kiểm xanh) không push; lỡ 6 check-in (22:06 → 08:08); push 09:30 06/11 (#620), trễ ~13 giờ | brief 105; #620 |
| 6 | 06/11 | U81 xanh ở máy ~11:08, push 16:12 (#630), trễ ~5 giờ; lỡ check-in 12:06, 14:06, 16:06 | brief 119; #630 |
| 7 (nặng) | 06/11 16:56 → 07/11 07:37 | U82 xanh ở máy (E2E 292/292), ~8 lần trả lời như trên **dù checkpoint đã có**; push 07:37 (#632), trễ ~14,5 giờ; lỡ 7 check-in (18:06 → 06:06), lịch nhắc BE-03 18:00, 5 mục #630 trễ | brief 119; #632 |
| 8 | 07/11 | U83 xanh ở máy ~08:32, push 13:04 (#634), trễ ~4,5 giờ; lỡ check-in 10:06, 12:06, nhắc BE-03 12:05 | brief 121; #634 |

- Lũy kế lần 5–8: ~36,5 giờ (CEO tính lần 5–7 ~32 giờ, brief 119); cộng lần 1–4 (~6 giờ): ~42,5 giờ.
- Biện pháp:
  - Mức 2 (brief 107): `.session/session-state.json`, cập nhật khi nhận brief, push, merge, check-in.
  - Mức 2.5 (brief 119): `.session/CHECKPOINT_README.md` (local). Hook in checkpoint vào ngữ cảnh khi phiên mở: FE tự sửa
    `.claude/settings.local.json` bị bộ phân loại quyền chặn (không tự vượt); OPS làm ở #636 (tầng 3, CEO merge).
  - Mức 3/4: vận hành phiên AI (CEO gửi OPS).
  - Luật FE từ lần 8: nhánh có commit ở máy push ngay, trước phần việc còn lại.

## 4. Luật hiện hành

- Tầng 1 code: mọi job phải chạy theo bảng success thật + `clean` → tự merge, báo 5 mục. Không heads-up.
- Tầng 2: heads-up 30 phút (docs ≤ 10 dòng chỉ `QUESTIONS.md`/`docs/`: 5 phút). Có commit mới hoặc phải Update branch → reset.
- Tầng 3: CEO merge sau comment `APPROVED` trên PR.
- Tầng 1 docs (brief 123): tự merge khi job theo bảng xanh. **Lệch:** brief ghi "8 success + terraform skip"; bảng #567 và CI thật
  cho PR chỉ docs là 3 success (changes, verify, security) + 6 skip (kiểm ở #629). FE theo bảng, đã báo CEO.
- Bảng job (CLAUDE.md "Job chạy theo loại PR"): chỉ FE 5 success + 4 skip; lẫn BE+FE 8 + terraform skip; chỉ docs 3 + 6.
- Ngoại lệ 500 dòng: chỉ khi phần vượt 400 là test bắt buộc. Vượt 500 → tách, không ngoại lệ.
- Brief đánh số liên tục; thiếu số → báo CEO (thiếu 118: CEO nói không cần gửi lại, brief 120). Brief quan trọng gửi 2 lần nếu
  FE chưa xác nhận sau 10 phút. Brief chỉ hợp lệ khi có `[GỬI FE]` + Session ID + "Người ký: A (CEO)".
- Không chắc trạng thái → "Em cần kiểm lại trạng thái".
- Không bịa dữ liệu hay ngưỡng khi hợp đồng chưa có; không hardcode ngưỡng nghiệp vụ (30 phút, 15 phút) khi Q7 chưa chốt.
- Hợp đồng thật thắng brief khi lệch.
- CI đỏ hạ tầng: chạy lại 1 lần; đỏ lần 2 dừng, dán log, báo CEO; không tự sửa test cho xanh.
- Không comment PR BE; kênh 2b quét PR mở mỗi 2 giờ. Review chéo PR BE chạm file FE trong 24 giờ, ghi handoff.
- Sau merge báo 5 mục: HEAD trước merge; commit squash; 9 job trước merge theo tên và giờ xong; 9 job `main` sau merge; diff
  HEAD ↔ squash = 0.
- Quét secret chạy riêng trước mỗi push (lệnh ở `CLAUDE.md`); có dòng → exit 1, không push.

## 5. Hợp đồng đã có

| U | Hợp đồng | API | FE |
|---|---|---|---|
| U26 | `Channel.tokenExpiresAt`, `lastError` (live); `POST /v1/channels/{id}/refresh-token`, `/disconnect` (planned) | live + planned | #24 chưa hiện hai trường, chưa nút (chờ brief) |
| U60 | Luật ticket export: `apps/api/src/modules/tickets/tickets.permissions.ts`, `packages/db/src/ticket-store.ts` `TICKET_TRANSITIONS` | live | test đồng bộ ticket chưa làm |
| U74 | `AiSettings.productionLocked`, `productionLockReason` | planned S5 | #627 (dòng khóa đỏ, câu ngân sách 0) |
| U75 | `PATCH ai-settings` bật E1/L1 ở `production` → 409 `ai_production_locked` | planned S5 | #628 (31 mã lỗi) |
| U79 | `GET/POST /v1/platform/access-sessions`, `POST …/{id}/end` | planned S5 | #620, #623 |
| U80 | `GET /v1/channel-policies/{channelType}/{messageClass}/versions` | planned S5 | #625 |
| U81 | `Conversation.sla {dueAt, pausedReason}` + lọc `?sla=` | live, `sla` luôn `null` tới Q7 | #630 |
| U82 | `GET/PUT /v1/me/agent-status` (`online`/`busy`/`offline`, `reason`) | planned S4 | #632 (tầng 2) |
| U83 | `GET /v1/conversations?teamId=` | live | #634 |
| U84 | `Me.teams[] {id, name, workspaceId}` | live | #637 |
| U85 | `GET /v1/teams/{id}/agent-status` → `{data: TeamAgentStatus[]}` | planned S4 | nháp, mục 7 |
| U86 | Realtime `agent_status.changed`, `conversation.sla_changed` (`docs/specs/realtime-spec.md` §3) | phát thật S4 | chưa làm, mục 7 |
| J3-0 | `POST /v1/customers/merge`, `POST /v1/customers/{id}/unmerge`, `GET …/{id}/merges`, `GET …/{id}/merge-suggestions` (N204) | planned | chưa code, chờ brief riêng |

Planned trả 404 tới khi BE làm thật: FE hiện `PendingPage` hoặc một câu "chưa có trong bản hiện tại", không dữ liệu giả.

## 6. Việc còn chờ

- **Q7 (rủi ro số 1), hạn 10/11 12:00 UTC.** Chưa có thì CEO chốt mặc định (CEO-ACTION-01: T2–T6 08:00–17:30, nghỉ trưa
  12:00–13:00 giờ VN; mỗi workspace một team mặc định; Gani 5–10 agent, The Smile 5–10 agent; ngày lễ nhà nước VN 2026–2027).
  FE không tự chốt. 10/11 12:00 chưa có → báo CEO. Q7 trượt: FE vẫn code UI theo hợp đồng, nói rõ chưa kiểm được hành vi thật.
  Khi có: kiểm lại chip và lọc SLA (U81, không cần sửa nếu đúng hợp đồng); dải "Bận quá X phút" làm PR riêng khi API có trường
  cấu hình (TODO trong `apps/admin/src/agent-status-picker.tsx`, brief 119).
- **Gộp khách (J3):** #633 đã có hợp đồng planned; #635 (bảng) đang mở. FE chờ brief riêng.
- **Nhóm B, 6 nhánh** (PR đóng không merge): `feat/admin-e2e-two-factor` (#178), `feat/admin-members-invite` (#234),
  `feat/admin-members-list-v2` (#241), `fix/axe-wait-title` (#267), `test/admin-many-rows-robust` (#266),
  `docs/backend-questions-30-10` (#201). Sau 12/11: gửi danh sách cho CEO; brief 87: CEO không phản hồi thì FE xóa, ghi "CEO
  duyệt brief 87". Khôi phục: "Restore branch" trên PR gốc. Nhóm C giữ: `backup/privacy-full`, `docs/ui-prototype-outline`.
- **Hook Mức 2.5:** chờ OPS/CEO (#636).

## 7. Việc đang dở

- **#634 (U83): xong**, 5 mục đã gửi CEO.
- **#637 (U84)**, nhánh `feat/me-u84-my-teams`, tầng 1 code. Kiểm ở máy xanh (E2E 295 + 1 đỏ do locator `Trạng thái`, đã sửa
  trong PR, 3 spec × 3 lần = 60 passed). Việc còn: CI 5 success + 4 skip + `clean` → ready → squash merge (`commit_title`,
  `expectedHeadSha`) → diff = 0 → CI `main` 9/9 → 5 mục.
- **U85** (tầng 1, sau #637): nháp ở nhánh `feat/teams-u85-agent-status`, commit WIP `db51a45` trên `4a77da0`, chưa PR, **chưa
  chạy typecheck/unit/E2E** (commit bỏ qua pre-commit vì worktree không có `node_modules`; đã quét secret riêng). Thiết kế:
  - #20 Team: mỗi dòng có nút "Trạng thái" (`aria-label` "Trạng thái của team <tên>") cho cả Owner/Admin và Manager (Manager chỉ
    có nút này; hợp đồng cho Manager là thành viên team đọc).
  - Hộp thoại "Trạng thái team <tên>": bảng Người (`name ?? 'Chưa có tên'`), Trạng thái (`AGENT_STATUS`), Từ lúc (`timeText`),
    Bận hôm nay (`busyText`: "n phút", "h giờ m phút"). Đang tải / lỗi + mã + "Thử lại" / rỗng "Team chưa có người giữ hội thoại."
    / 404 "Trạng thái team: chưa có trong bản hiện tại." Không ngưỡng tô màu cho số phút "Bận" (Q7).
  - Khóa cache `['teams', 'agent-status', teamId]`.
  - Đã có trong WIP: `src/teams/team-status.ts` (+ test), `team-status-dialog.tsx`, nút trong `team-list.tsx`,
    `e2e/team-status.spec.ts` (3 ca: Owner danh sách + axe, Manager lỗi + "Thử lại" + rỗng, 404), ca Manager của
    `e2e/teams.spec.ts` (từ 0 nút thành đúng 1 nút "Trạng thái của team CSKH"), dòng #20 của `apps/admin/CLAUDE.md`.
  - Việc còn: rebase lên `main` sau #637, kiểm đủ ở máy, sửa nếu đỏ, PR draft, merge, 5 mục. Team của cả công ty: múi giờ của
    "Bận hôm nay" chờ CEO (U85 (i)); FE hiện số API trả.
- **U86** (tầng 1, sau U85): nghe `agent_status.changed` (phòng `user:` → cập nhật `AGENT_STATUS_KEY`; phòng `ws:` → đọc lại khóa
  trạng thái team) và `conversation.sla_changed` (`{conversationId, sla}` → vá `sla` trong cache danh sách/chi tiết hội thoại);
  bỏ gói cũ theo `aggregateVersion` như các sự kiện khác (`apps/admin/src/realtime/`). Kiểm bằng mock/unit + E2E stub.

## 8. Ghi chú kỹ thuật

- Build/E2E ở máy: đặt `NODE_ENV=production` (shell của container đặt `development`, `next build` lỗi prerender
  `useContext` null). Trước khi chạy lại, tắt `next-server` cũ còn giữ cổng 3001.
- Lint: `pnpm exec eslint apps/admin` ở gốc (gói admin không có script `lint`; `pnpm --filter @gani/admin lint` không lint gì).
- Thanh trên có ô "Trạng thái của tôi" (U82): locator E2E tìm ô lọc "Trạng thái" phải giới hạn trong `<main>`.
- Review PR BE: sinh lại `planned.d.ts`/`schema.d.ts` bằng `npx openapi-typescript` từ JSON của commit squash, so từng byte.
- Sự kiện CI đôi khi không về: đặt `send_later` để tự kiểm.
- Cập nhật checkpoint: `python3 -I .session/update.py [--brief N] [--checkin] [--done "tiền tố"] [--add "việc"]` (script local,
  tạo lại nếu mất: đọc/ghi `session-state.json`, tự điền `last_commit_local`, `updated_at`).

## 9. `session-state.json` lúc viết (13:3x UTC 07/11)

```json
{
  "session_id": "session_015SNdqeCQvNjK6rFoqzt5Su",
  "last_brief_received": 123,
  "pending_tasks": [
    "BRIEF 123: handoff docs/ui/session-summary-07-11-2026.md → PR docs → merge → 5 mục + xác nhận sẵn sàng đóng phiên",
    "U84 = PR #637 draft, HEAD 82163b2: CI 5+4 + clean → ready → squash merge → 5 mục",
    "U85: nhánh feat/teams-u85-agent-status (WIP db51a45, chưa kiểm) → sau #637 merge: rebase → kiểm đủ → PR → merge → 5 mục; rồi U86",
    "Q7: 10/11 12:00 UTC chưa có → báo CEO; CEO chốt mặc định (CEO-ACTION-01)",
    "Nhóm B 6 nhánh: sau 12/11 gửi danh sách cho CEO",
    "Check-in 2 giờ (phút 06): tóm tắt 3 dòng + PR mở; ghi last_checkin_utc"
  ],
  "last_commit_local": "82163b2",
  "last_checkin_utc": "2026-11-07T13:05:31Z"
}
```
