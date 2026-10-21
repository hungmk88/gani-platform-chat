/* global Proto */
/* #19 Thành viên (danh-sach-man-M11; A3, A5, C9). Sprint S4, nộp wireframe 21/12/2026.
   Căn cứ: Phụ lục B dòng "Mời thành viên, đổi vai trò" (Owner; Admin không nâng lên Owner), spec-M8 §3.5 (giới hạn tải riêng),
   §3.8 + Q-U20-1 (đặt lại 2FA: Owner/Admin, bắt buộc lý do, audit, thu hồi phiên; 2FA của Owner chỉ Owner khác đặt lại),
   endpoint-M8 (POST /v1/members/invite, PATCH …/capacity, POST …/2fa/reset). Chỉ Owner, Admin. */
const { h } = Proto;

const ROLE_NAMES = { owner: 'Owner', admin: 'Admin', manager: 'Manager', sales: 'Sales', support: 'Support', marketing: 'Marketing', viewer: 'Viewer' };
const STATUS = { active: ['ok', 'Đang hoạt động'], invited: ['warn', 'Chờ nhận lời mời'], expired: ['error', 'Lời mời hết hạn'] };
const TFA_REQUIRED = ['owner', 'admin'];

function members() {
  const s = Proto.state();
  return [
    { id: 'u1', name: 'Owner Gani', email: 'owner@example.test', role: 'owner', teams: [], tfa: true, status: 'active', capacity: null, lastSeen: '21/10/2026 08:02' },
    { id: 'u2', name: 'Admin Gani', email: 'admin@example.test', role: 'admin', teams: [], tfa: true, status: 'active', capacity: null, lastSeen: '21/10/2026 09:15' },
    { id: 'u3', name: 'Hà Linh', email: 'halinh@example.test', role: 'manager', teams: ['Sales B2B'], tfa: false, status: 'active', capacity: null, lastSeen: '21/10/2026 07:40' },
    { id: 'u4', name: 'Trần Thu', email: 'tranthu@example.test', role: 'sales', teams: ['Sales B2B'], tfa: true, status: 'active', capacity: 8, lastSeen: '21/10/2026 09:30' },
    { id: 'u5', name: 'Đặng Mai', email: 'dangmai@example.test', role: 'support', teams: ['CSKH'], tfa: false, status: 'active', capacity: null, lastSeen: '20/10/2026 17:55' },
    { id: 'u6', name: '—', email: 'moi@example.test', role: 'sales', teams: [], tfa: false, status: s === 'invite_expired' ? 'expired' : 'invited', capacity: null, lastSeen: '—' },
  ];
}

const pending = (text) => h('span', { class: 'pending-spec' }, text);
/* Admin không nâng ai lên Owner (Phụ lục B); không ai sửa vai trò của chính mình ở đây. */
const assignable = () => Object.keys(ROLE_NAMES).filter((r) => Proto.role() === 'owner' || r !== 'owner');
const isMe = (m) => m.role === Proto.role() && (m.id === 'u1' || m.id === 'u2');

function invite() {
  const email = h('input', { id: 'inv-email', class: 'input', type: 'email', autocomplete: 'off' });
  const role = h('select', { id: 'inv-role', class: 'input' }, assignable().map((r) => h('option', { value: r, selected: r === 'sales' }, ROLE_NAMES[r])));
  const err = h('p', { class: 'field-error', role: 'alert' });
  Proto.dialog('Mời thành viên', h('div', { class: 'stack' },
    h('div', { class: 'field' }, h('label', { for: 'inv-email' }, 'Email'), email),
    h('div', { class: 'field' }, h('label', { for: 'inv-role' }, 'Vai trò'), role),
    h('p', { class: 'small muted' }, 'Link mời gửi qua email, hết hạn sau 7 ngày (hạn lấy từ API, không ghi cứng). Owner, Admin phải cài 2FA khi nhận lời mời.'),
    Proto.role() === 'admin' ? h('p', { class: 'small muted' }, 'Admin không mời được vai trò Owner.') : null,
    err), (close) => [
    h('button', { class: 'btn', onclick: close }, 'Hủy'),
    h('button', { class: 'btn primary', onclick: (e) => {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value)) { err.textContent = 'Nhập email hợp lệ.'; email.focus(); return; }
      Proto.serverAction(e.currentTarget, 'Gửi lời mời', () => { close(); Proto.toast(`Đã gửi lời mời tới ${email.value}. Ghi audit.`); });
    } }, 'Gửi lời mời'),
  ]);
}

function changeRole(m) {
  const role = h('select', { id: 'role-new', class: 'input' }, assignable().map((r) => h('option', { value: r, selected: r === m.role }, ROLE_NAMES[r])));
  Proto.dialog(`Đổi vai trò — ${m.name}`, h('div', { class: 'stack' },
    h('div', { class: 'field' }, h('label', { for: 'role-new' }, 'Vai trò mới'), role),
    h('p', { class: 'small muted' }, 'Có hiệu lực ngay; quyền xem hội thoại đổi ở lần tải kế tiếp. Ghi audit. Lên Owner/Admin thì người đó phải cài 2FA.')), (close) => [
    h('button', { class: 'btn', onclick: close }, 'Hủy'),
    h('button', { class: 'btn primary', onclick: (e) => Proto.serverAction(e.currentTarget, 'Lưu vai trò', () => { close(); Proto.toast(`Đã đổi vai trò của ${m.name} thành ${ROLE_NAMES[role.value]}. Ghi audit.`); }) }, 'Lưu vai trò'),
  ]);
}

function resetTwoFactor(m) {
  const reason = h('textarea', { id: 'tfa-reason', class: 'input', rows: 2 });
  const err = h('p', { class: 'field-error', role: 'alert' });
  Proto.dialog(`Đặt lại 2FA — ${m.name}`, h('div', { class: 'stack' },
    h('p', {}, 'Mọi phiên đăng nhập của người này bị thu hồi. Lần đăng nhập kế tiếp họ phải cài lại 2FA và nhận 10 mã dự phòng mới.'),
    h('div', { class: 'field' }, h('label', { for: 'tfa-reason' }, 'Lý do (bắt buộc, ghi audit)'), reason),
    err), (close) => [
    h('button', { class: 'btn', onclick: close }, 'Hủy'),
    h('button', { class: 'btn primary', onclick: (e) => {
      if (reason.value.trim().length < 5) { err.textContent = 'Ghi lý do, ít nhất 5 ký tự.'; reason.focus(); return; }
      Proto.serverAction(e.currentTarget, 'Đặt lại 2FA', () => { close(); Proto.toast(`Đã đặt lại 2FA của ${m.name}. Đã thu hồi mọi phiên. Ghi audit.`); });
    } }, 'Đặt lại 2FA'),
  ]);
}

function capacity(m) {
  const input = h('input', { id: 'cap', class: 'input', type: 'number', min: 1, max: 50, value: m.capacity ?? '' });
  const err = h('p', { class: 'field-error', role: 'alert' });
  Proto.dialog(`Giới hạn tải — ${m.name}`, h('div', { class: 'stack' },
    h('div', { class: 'field' }, h('label', { for: 'cap' }, 'Số hội thoại đang xử lý tối đa (để trống: theo workspace)'), input),
    h('p', { class: 'small muted' }, 'Mặc định của workspace: 5, sửa ở Cài đặt › Workspace › Phân bổ. Đầy tải thì không được phân bổ thêm, vẫn tự nhận được kèm cảnh báo.'),
    err), (close) => [
    h('button', { class: 'btn', onclick: close }, 'Hủy'),
    h('button', { class: 'btn primary', onclick: (e) => {
      const n = Number(input.value);
      if (input.value !== '' && !(Number.isInteger(n) && n >= 1 && n <= 50)) { err.textContent = 'Nhập số nguyên từ 1 đến 50, hoặc để trống.'; input.focus(); return; }
      Proto.serverAction(e.currentTarget, 'Lưu', () => { close(); Proto.toast(`Đã lưu giới hạn tải của ${m.name}.`); });
    } }, 'Lưu'),
  ]);
}

function actions(m) {
  if (isMe(m)) return h('span', { class: 'small muted' }, 'Bạn');
  if (m.status !== 'active') {
    return h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => Proto.toast('Đã gửi lại lời mời, hạn 7 ngày tính lại từ bây giờ.') }, 'Gửi lại lời mời'), pending('đường gửi lại: chờ PR7'));
  }
  const ownerOnly = m.role === 'owner' && Proto.role() !== 'owner';
  return h('div', { class: 'row' },
    ownerOnly ? null : h('button', { class: 'btn', onclick: () => changeRole(m), 'aria-label': `Đổi vai trò của ${m.name}` }, 'Đổi vai trò'),
    ['sales', 'support', 'manager'].includes(m.role) ? h('button', { class: 'btn', onclick: () => capacity(m), 'aria-label': `Giới hạn tải của ${m.name}` }, 'Giới hạn tải') : null,
    m.tfa && !ownerOnly ? h('button', { class: 'btn', onclick: () => resetTwoFactor(m), 'aria-label': `Đặt lại 2FA của ${m.name}` }, 'Đặt lại 2FA…') : null,
    ownerOnly ? h('span', { class: 'small muted' }, 'Chỉ Owner khác sửa được Owner') : null);
}

function tfaCell(m) {
  if (m.status !== 'active') return h('span', { class: 'small muted' }, '—');
  if (m.tfa) return h('span', { class: 'badge ok' }, 'Đã bật');
  return TFA_REQUIRED.includes(m.role) ? h('span', { class: 'badge error' }, 'Bắt buộc, chưa cài') : h('span', { class: 'small muted' }, 'Chưa bật');
}

function table() {
  return h('table', { class: 'plain' },
    h('thead', {}, h('tr', {}, ['Thành viên', 'Vai trò', 'Team', '2FA', 'Trạng thái', 'Giới hạn tải', 'Lần cuối vào', ''].map((t) => h('th', {}, t || h('span', { class: 'sr-only' }, 'Thao tác'))))),
    h('tbody', {}, members().map((m) => h('tr', {},
      h('td', {}, h('div', {}, m.name), h('div', { class: 'small muted' }, m.email)),
      h('td', {}, ROLE_NAMES[m.role]),
      h('td', {}, m.teams.length ? m.teams.join(', ') : h('span', { class: 'small muted' }, '—')),
      h('td', {}, tfaCell(m)),
      h('td', {}, h('span', { class: `badge ${STATUS[m.status][0]}` }, STATUS[m.status][1])),
      h('td', {}, m.capacity ?? h('span', { class: 'small muted' }, 'Theo workspace (5)')),
      h('td', {}, m.lastSeen),
      h('td', {}, actions(m))))));
}

Proto.mount({
  page: 'members',
  states: [['normal', 'Bình thường'], ['loading', 'Đang tải'], ['empty', 'Trống'], ['error', 'Lỗi'], ['aioff', 'AI tắt — Không áp dụng'], ['invite_expired', 'Lời mời hết hạn']],
  render: () => {
    if (!['owner', 'admin'].includes(Proto.role())) {
      return h('div', { class: 'page-body' }, Proto.noAccess('Thành viên (chỉ Owner, Admin)', Proto.can('inbox.view') ? 'inbox.html' : 'customer.html'));
    }
    const s = Proto.state();
    let body;
    if (s === 'loading') body = Proto.loading(6);
    else if (s === 'error') body = Proto.error('Không tải được danh sách thành viên.');
    else if (s === 'empty') body = Proto.empty('Công ty mới có mình bạn. Mời thành viên đầu tiên để cùng xử lý hội thoại.', 'Mời thành viên', invite);
    else body = table();
    return h('div', { class: 'main' },
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', {}, 'Thành viên'), h('p', { class: 'small muted' }, 'Công ty Gani Foods · Mời, đổi vai trò, giới hạn tải và đặt lại 2FA đều ghi audit.')),
        s === 'empty' ? null : h('button', { class: 'btn primary', onclick: invite }, 'Mời thành viên')),
      Proto.noAiNote(),
      h('div', { class: 'page-body stack' }, h('div', { class: 'card', style: 'overflow:auto' }, body)));
  },
});
