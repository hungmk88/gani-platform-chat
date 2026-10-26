/* global Proto, window */
/* #27 Tự chủ & feature flag (danh-sach-man-M11; A13). Sprint S5, nộp wireframe 04/01/2027.
   Phụ lục B: hạ mức tự chủ, tắt feature flag — Owner, Admin; nâng mức tự chủ — chỉ Owner.
   `PATCH /v1/workspaces/{id}/autonomy` (Owner), có lý do, ghi audit. Đợt 1 chỉ L0 + AI nội bộ (Phụ lục kỹ thuật mục 29). */
const { h } = Proto;

const LEVELS = [
  ['L0', 'Bot kịch bản, AI không trả lời khách'],
  ['L1', 'AI trả lời khách chỉ từ Knowledge Base (Đợt 2)'],
  ['L2', 'AI được gọi tool, ví dụ tra giá (Đợt 2)'],
];

let level = 'L0';
let flags = {};
let lastState = null;

function levelCard() {
  const isOwner = Proto.role() === 'owner';
  const reason = h('textarea', { id: 'reason', class: 'input', rows: 2 });
  const err = h('p', { class: 'field-error', role: 'alert' });
  const lower = h('button', { class: 'btn', type: 'button', disabled: level === 'L0' }, 'Hạ mức');
  lower.addEventListener('click', () => {
    if (!reason.value.trim()) { err.textContent = 'Ghi lý do trước khi đổi mức tự chủ.'; reason.classList.add('invalid'); return; }
    Proto.serverAction(lower, 'Hạ mức', () => { level = 'L0'; Proto.toast('Đã hạ về L0. Có hiệu lực trong 10 giây, ghi audit.'); Proto.render(); });
  });
  return h('section', { class: 'card stack' },
    h('h2', {}, 'Mức tự chủ — workspace B2B'),
    h('p', {}, 'Hiện tại: ', h('strong', {}, level), ' — ', LEVELS.find(([k]) => k === level)[1]),
    h('table', { class: 'plain' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Mức'), h('th', {}, 'Ý nghĩa'))),
      h('tbody', {}, LEVELS.map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', {}, v))),
        h('tr', {}, h('td', {}, 'L3–L5'), h('td', {}, h('span', { class: 'pending-spec' }, 'chưa có định nghĩa trong repo (U29)'))))),
    h('div', { class: 'field' }, h('label', { for: 'reason' }, 'Lý do đổi mức (bắt buộc, ghi audit)'), reason),
    err,
    h('div', { class: 'row' },
      lower,
      h('button', { class: 'btn', type: 'button', disabled: true, title: isOwner ? 'Đợt 1 chỉ dùng L0' : 'Chỉ Owner nâng được' }, 'Nâng mức')),
    h('p', { class: 'small muted' },
      isOwner ? 'Nâng mức: chỉ Owner, sau khi chạy song song ≥ 300 hội thoại hoặc 4 tuần (Phụ lục kỹ thuật mục 27). Đợt 1 khóa ở L0.' : 'Chỉ Owner nâng được mức tự chủ.',
      ' Một lần số liệu sai lọt tới khách → hệ thống tự hạ về "AI gợi ý – người gửi" (mục 26).'));
}

function flagRow(key, label, lockedReason) {
  const box = h('input', { id: `f-${key}`, type: 'checkbox', checked: flags[key], disabled: Boolean(lockedReason) || !flags[key] });
  box.addEventListener('change', () => {
    if (!box.checked) {
      box.disabled = true;
      turnOff(key);
    }
  });
  return h('tr', {},
    h('td', {}, h('label', { class: 'row', for: `f-${key}` }, box, h('code', {}, key))),
    h('td', {}, label),
    h('td', {}, lockedReason ? h('span', { class: 'badge outline' }, lockedReason) : flags[key] ? h('span', { class: 'badge ok' }, 'Đang bật') : h('span', { class: 'badge' }, 'Đang tắt')));
}

function turnOff(key) {
  flags[key] = false;
  Proto.toast(`Đã tắt ${key}. Có hiệu lực trong 10 giây, ghi audit.`);
  Proto.render();
}

function flagsCard() {
  if (Proto.state() === 'empty') {
    // Trống: workspace chưa có cờ nào để tắt; mức tự chủ thì luôn có (L0).
    return h('section', { class: 'card stack' },
      h('h2', {}, 'Feature flag — workspace B2B'),
      Proto.empty('Workspace này chưa có cờ nào để tắt. AI nội bộ bật ở màn AI nội bộ.', 'Mở AI nội bộ', () => { window.location.href = `ai.html?role=${Proto.role()}`; }),
      h('p', { class: 'small muted' }, h('span', { class: 'pending-spec' }, 'danh sách cờ theo workspace: chờ U29')));
  }
  return h('section', { class: 'card stack' },
    h('h2', {}, 'Feature flag — workspace B2B'),
    h('table', { class: 'plain' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Cờ'), h('th', {}, 'Tác dụng'), h('th', {}, 'Trạng thái'))),
      h('tbody', {},
        flagRow('ai.internal', 'AI nội bộ: phân loại, tóm tắt cho nhân viên (E1, L1)', null),
        flagRow('ai.customer_reply', 'AI trả lời khách', 'Khóa ở Đợt 1'),
        flagRow('channel.webchat', 'Kênh Webchat', 'Đợt 2'))),
    h('p', { class: 'small muted' }, 'Ở đây chỉ tắt được cờ (Owner, Admin). Bật AI nội bộ ở production theo cổng pháp lý Q1 và màn AI nội bộ (#26). ', h('span', { class: 'pending-spec' }, 'danh sách cờ theo workspace: chờ U29')));
}

Proto.mount({
  page: 'autonomy',
  states: [['normal', 'Bình thường'], ['loading', 'Đang tải'], ['empty', 'Trống'], ['error', 'Lỗi'], ['aioff', 'AI tắt']],
  render: () => {
    if (!['owner', 'admin'].includes(Proto.role())) {
      return h('div', { class: 'page-body' }, Proto.noAccess('Tự chủ & feature flag (chỉ Owner, Admin)', Proto.can('inbox.view') ? 'inbox.html' : 'customer.html'));
    }
    const s = Proto.state();
    // Đổi trạng thái trên thanh điều khiển thì đặt lại cờ theo trạng thái mới.
    if (s !== lastState) { flags = { 'ai.internal': s !== 'aioff', 'ai.customer_reply': false, 'channel.webchat': false }; lastState = s; }
    let body;
    if (s === 'loading') body = Proto.loading(6);
    else if (s === 'error') body = h('div', { class: 'card' }, Proto.error('Không tải được cấu hình tự chủ.'));
    else body = h('div', { class: 'stack' }, levelCard(), flagsCard());
    return h('div', { class: 'main' },
      h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Tự chủ & feature flag'), h('p', { class: 'small muted' }, 'Mọi thay đổi có lý do, ghi audit, hiệu lực trong 10 giây.'))),
      Proto.aiOffBanner('Admin tắt cờ ai.internal'),
      h('div', { class: 'page-body', style: 'max-width:880px;overflow:auto' }, body));
  },
});
