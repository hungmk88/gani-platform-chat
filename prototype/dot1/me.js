/* global Proto */
/* #5 Hồ sơ cá nhân (spec M8 bản nháp 3 §3.8, Phụ lục C v3 dòng 9). 3 tab: Thông tin, Bảo mật, Thông báo. */
const { h } = Proto;

const SESSIONS = [
  { id: 's1', created: '13/10/2026 08:12', expires: '20/10/2026 08:12', current: true },
  { id: 's2', created: '11/10/2026 19:40', expires: '18/10/2026 19:40' },
  { id: 's3', created: '09/10/2026 07:55', expires: '16/10/2026 07:55' },
];

let tfaOn = null;
let enrolling = false;
let lastState = null;
let revoked = [];
const notify = { browser: false, sound: false };

function tabs() {
  const tab = Proto.get('tab', 'info');
  const labels = [['info', 'Thông tin'], ['security', 'Bảo mật'], ['notify', 'Thông báo']];
  return h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Hồ sơ cá nhân' },
    labels.map(([k, v]) => h('button', { role: 'tab', id: `tab-${k}`, 'aria-selected': String(tab === k), onclick: () => Proto.set('tab', k) }, v)));
}

function infoTab() {
  const save = h('button', { class: 'btn primary', type: 'submit' }, 'Đổi mật khẩu');
  return h('div', { class: 'stack' },
    h('section', { class: 'card stack' },
      h('h2', {}, 'Thông tin'),
      h('div', { class: 'row' },
        h('span', { class: 'avatar', 'aria-hidden': 'true' }, 'L'),
        h('button', { class: 'btn', onclick: () => Proto.toast('Chọn ảnh JPG/PNG ≤ 2 MB.') }, 'Đổi ảnh')),
      h('div', { class: 'field' }, h('label', { for: 'name' }, 'Họ tên'), h('input', { id: 'name', class: 'input', value: 'Trần Linh' })),
      h('div', { class: 'field' }, h('label', { for: 'mail' }, 'Email (chỉ Admin đổi được)'), h('input', { id: 'mail', class: 'input', value: 'linh@gani.vn', readonly: true })),
      h('p', { class: 'pending-spec' }, 'Chờ spec cuối: endpoint lưu tên/ảnh (Better Auth đã tắt /update-user).')),
    h('form', {
      class: 'card stack',
      onsubmit: (e) => {
        e.preventDefault();
        Proto.serverAction(save, 'Đổi mật khẩu', () => Proto.toast('Đã đổi mật khẩu. Các phiên khác đã bị đăng xuất.'));
      },
    },
    h('h2', {}, 'Mật khẩu'),
    h('div', { class: 'field' }, h('label', { for: 'old' }, 'Mật khẩu hiện tại'), h('input', { id: 'old', class: 'input', type: 'password', autocomplete: 'current-password' })),
    h('div', { class: 'field' }, h('label', { for: 'new' }, 'Mật khẩu mới (≥ 12 ký tự, có chữ và số)'), h('input', { id: 'new', class: 'input', type: 'password', autocomplete: 'new-password' })),
    save));
}

function tfaCard() {
  const required = Proto.NEEDS_2FA.includes(Proto.role());
  let body;
  if (enrolling) {
    body = Proto.tfaEnroll({
      onDone: () => { tfaOn = true; enrolling = false; Proto.toast('Đã bật xác thực 2 lớp.'); Proto.render(); },
      onCancel: () => { enrolling = false; Proto.render(); },
    });
  }
  else if (tfaOn) {
    body = h('div', { class: 'stack' },
      h('p', {}, h('span', { class: 'badge ok' }, 'Đã bật'), ' từ 02/10/2026 · ứng dụng xác thực (TOTP) · 10 mã dự phòng'),
      h('p', { class: 'small muted' }, 'Không tắt được 2FA tại đây. Mất thiết bị: dùng mã dự phòng, hoặc nhờ Owner/Admin đặt lại 2FA ở Cài đặt › Thành viên.'));
  } else {
    body = h('div', { class: 'stack' },
      h('p', {}, h('span', { class: 'badge' }, 'Chưa bật'), required ? ' — bắt buộc với vai trò của bạn' : ' — khuyến nghị bật'),
      h('button', { class: 'btn primary', onclick: () => { enrolling = true; Proto.render(); } }, 'Bật xác thực 2 lớp'));
  }
  return h('section', { class: 'card stack' }, h('h2', {}, 'Xác thực 2 lớp'), body);
}

function sessionsCard() {
  const rows = SESSIONS.filter((s) => !revoked.includes(s.id));
  return h('section', { class: 'card stack' },
    h('h2', {}, 'Phiên đăng nhập'),
    h('p', { class: 'small muted' }, 'Chỉ hiện thời điểm tạo và hạn phiên — không lưu IP, không lưu thiết bị.'),
    h('table', { class: 'plain' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Tạo lúc'), h('th', {}, 'Hết hạn'), h('th', {}, h('span', { class: 'sr-only' }, 'Thao tác')))),
      h('tbody', {}, rows.map((s) => {
        let action;
        if (s.current) action = h('span', { class: 'badge outline' }, 'Phiên này');
        else {
          action = h('button', { class: 'btn', 'aria-label': `Đăng xuất phiên tạo lúc ${s.created}` }, 'Đăng xuất');
          action.addEventListener('click', () => Proto.serverAction(action, 'Đăng xuất', () => { revoked = [...revoked, s.id]; Proto.toast('Đã đăng xuất phiên.'); Proto.render(); }));
        }
        return h('tr', {}, h('td', {}, s.created), h('td', {}, s.expires), h('td', {}, action));
      }))));
}

function notifyTab() {
  const item = (key, label, hint) => {
    const box = h('input', { id: `n-${key}`, type: 'checkbox', checked: notify[key] });
    box.addEventListener('change', () => {
      notify[key] = box.checked;
      if (key === 'browser' && box.checked) Proto.toast('Trình duyệt sẽ hỏi quyền hiển thị thông báo.');
    });
    return h('div', { class: 'stack' }, h('label', { class: 'row', for: `n-${key}` }, box, label), h('p', { class: 'small muted' }, hint));
  };
  return h('section', { class: 'card stack' },
    h('h2', {}, 'Thông báo'),
    h('p', { class: 'small muted' }, 'Mặc định tắt. Áp dụng cho trình duyệt này.'),
    item('browser', 'Thông báo trình duyệt khi có hội thoại mới hoặc được chuyển tới', 'Nội dung thông báo không chứa tin nhắn hay SĐT của khách.'),
    item('sound', 'Âm thanh khi có tin mới', 'Chỉ phát khi tab đang mở.'));
}

Proto.mount({
  page: 'me',
  states: [['normal', 'Bình thường'], ['tfa_on', '2FA đã bật'], ['loading', 'Đang tải'], ['error', 'Lỗi'], ['aioff', 'AI tắt']],
  render: () => {
    const s = Proto.state();
    // Đổi trạng thái trên thanh điều khiển thì đặt lại 2FA theo trạng thái mới.
    if (s !== lastState) { tfaOn = s === 'tfa_on'; enrolling = false; lastState = s; }
    const tab = Proto.get('tab', 'info');
    let content;
    if (s === 'loading') content = Proto.loading(5);
    else if (s === 'error') content = Proto.error('Không tải được hồ sơ.');
    else if (tab === 'security') content = h('div', { class: 'stack' }, tfaCard(), sessionsCard());
    else if (tab === 'notify') content = notifyTab();
    else content = infoTab();
    return h('div', { class: 'page-body stack', style: 'max-width:720px;overflow:auto' },
      h('h1', {}, 'Hồ sơ cá nhân'),
      Proto.noAiNote(),
      tabs(),
      h('div', { role: 'tabpanel', 'aria-labelledby': `tab-${tab}` }, content));
  },
});
