/* global Proto */
/* #24 Kênh và #25 Cấu hình Zalo OA (danh-sach-man-M11; B1, B2, B3). Sprint S3, nộp wireframe 07/12/2026.
   Căn cứ: docs/specs/zalo-channel-spec.md (đã duyệt 07/10), channel-policy-spec.md. Chỉ Owner, Admin (Phụ lục B). */
const { h } = Proto;

const STATUS = {
  connected: ['ok', 'Đã kết nối'],
  token_expiring: ['warn', 'Token sắp hết hạn'],
  disconnected: ['error', 'Mất kết nối'],
};

function channels() {
  const s = Proto.state();
  return [
    {
      id: 'ch1', name: 'Gani Foods B2B', oaId: '4471…2096', appId: '18855…', workspace: 'B2B',
      status: s === 'token_expiring' || s === 'disconnected' ? s : 'connected',
      accessExpires: s === 'token_expiring' ? 'hôm nay 21:40' : '20/10/2026 08:15', refreshExpires: '18/01/2027', lastRefresh: '19/10/2026 08:15',
      lastError: s === 'disconnected' ? 'refresh_rejected' : null,
    },
    { id: 'ch2', name: 'Gani Foods Sỉ miền Nam', oaId: '9032…1177', appId: '18855…', workspace: 'B2B', status: 'connected', accessExpires: '20/10/2026 09:02', refreshExpires: '20/01/2027', lastRefresh: '19/10/2026 09:02', lastError: null },
  ];
}

function statusBadge(c) {
  const [cls, label] = STATUS[c.status];
  return h('span', { class: `badge ${cls}` }, label);
}

function pending(text) {
  return h('span', { class: 'pending-spec' }, text);
}

function connectAction(label) {
  return h('button', { class: 'btn primary', onclick: () => Proto.toast('Luồng kết nối Zalo OA chờ tài liệu Zalo (Z2, Q6) — chưa vẽ chi tiết.') }, label);
}

/* #24 Danh sách kênh */
function listScreen() {
  const s = Proto.state();
  let body;
  if (s === 'loading') body = Proto.loading(4);
  else if (s === 'error') body = Proto.error('Không tải được danh sách kênh.');
  else if (s === 'empty') body = Proto.empty('Workspace này chưa có kênh nào. Kết nối Zalo OA để nhận tin của khách.', null);
  else {
    body = h('table', { class: 'plain' },
      h('thead', {}, h('tr', {}, ['Kênh', 'Tên', 'OA ID', 'Trạng thái', 'Token hết hạn', ''].map((t) => h('th', {}, t ? t : h('span', { class: 'sr-only' }, 'Thao tác'))))),
      h('tbody', {}, channels().map((c) => h('tr', {},
        h('td', {}, 'Zalo OA'),
        h('td', {}, c.name),
        h('td', {}, c.oaId),
        h('td', {}, statusBadge(c), c.lastError ? h('div', { class: 'small muted' }, `Mã: ${c.lastError}`) : null),
        h('td', {}, c.accessExpires),
        h('td', {}, h('a', { class: 'btn', href: `channels.html?role=${Proto.role()}&screen=detail&state=${s}`, 'aria-label': `Cấu hình ${c.name}` }, 'Cấu hình'))))));
  }
  return h('div', { class: 'main' },
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Kênh'), h('p', { class: 'small muted' }, 'Workspace B2B · Đợt 1 chỉ có Zalo OA; Facebook, Webchat ở Đợt 2.')),
      connectAction('Kết nối Zalo OA')),
    Proto.noAiNote(),
    h('div', { class: 'page-body stack' }, h('div', { class: 'card' }, body)));
}

/* #25 Cấu hình Zalo OA */
function banner(c) {
  if (c.status === 'token_expiring') {
    return h('div', { class: 'banner warn', role: 'status' }, 'Token còn dưới 24 giờ và chưa làm mới được. Hệ thống đang thử lại; nếu không được, kênh sẽ mất kết nối.');
  }
  if (c.status === 'disconnected') {
    return h('div', { class: 'banner error', role: 'alert' },
      `Mất kết nối Zalo OA (mã: ${c.lastError}). Agent gửi tin sẽ thấy "kênh đang lỗi". Kết nối lại để tiếp tục nhận và gửi tin. `,
      connectAction('Kết nối lại'));
  }
  return null;
}

function tokenCard(c) {
  const refresh = h('button', { class: 'btn' }, 'Làm mới token ngay');
  refresh.addEventListener('click', () => Proto.serverAction(refresh, 'Làm mới token ngay', () => Proto.toast('Đã làm mới token. Hạn mới hiện sau khi tải lại.')));
  return h('section', { class: 'card stack' },
    h('h2', {}, 'Token (B2)'),
    h('dl', { class: 'kv' },
      h('dt', {}, 'Access token'), h('dd', {}, 'Đã lưu, mã hóa — không hiển thị'),
      h('dt', {}, 'Hết hạn'), h('dd', {}, c.accessExpires),
      h('dt', {}, 'Refresh token hết hạn'), h('dd', {}, c.refreshExpires),
      h('dt', {}, 'Làm mới lần cuối'), h('dd', {}, c.lastRefresh)),
    h('p', { class: 'small muted' }, 'Hệ thống tự làm mới trước khi hết hạn. ', pending('ngưỡng làm mới chờ Z4')),
    c.status === 'disconnected' ? null : h('div', {}, refresh));
}

function infoCard(c) {
  const webhook = `https://api.example.test/v1/hooks/zalo/${c.id}`;
  return h('section', { class: 'card stack' },
    h('h2', {}, 'Thông tin'),
    h('dl', { class: 'kv' },
      h('dt', {}, 'Tên hiển thị'), h('dd', {}, c.name),
      h('dt', {}, 'OA ID'), h('dd', {}, c.oaId),
      h('dt', {}, 'App ID'), h('dd', {}, c.appId),
      h('dt', {}, 'Workspace'), h('dd', {}, c.workspace),
      h('dt', {}, 'Webhook URL'), h('dd', {}, h('code', {}, webhook), ' ', h('button', { class: 'btn', onclick: () => Proto.toast('Đã chép webhook URL.') }, 'Chép')),
      h('dt', {}, 'Khóa webhook'), h('dd', {}, 'Đã lưu, mã hóa — không hiển thị ', pending('theo ứng dụng hay theo OA: chờ Z2'))));
}

function policyCard() {
  return h('section', { class: 'card stack' },
    h('h2', {}, 'Chính sách gửi tin (B3, chỉ xem)'),
    h('table', { class: 'plain' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Loại tin'), h('th', {}, 'Khung miễn phí'), h('th', {}, 'Ngoài khung'))),
      h('tbody', {},
        h('tr', {}, h('td', {}, 'Tư vấn'), h('td', {}, '48 giờ từ tin cuối của khách, 8 tin'), h('td', {}, 'Agent không gửi được tin thường; chọn ZNS, gọi điện hoặc tạo task')),
        h('tr', {}, h('td', {}, 'Giao dịch, Truyền thông'), h('td', {}, pending('chờ xác nhận')), h('td', {}, pending('chờ xác nhận'))))),
    h('p', { class: 'small muted' }, 'Giá trị tạm, chờ CĐT xác nhận. Chỉ platform operator sửa được (Phụ lục B), ở màn Platform (#30).'));
}

function disconnectCard(c) {
  const open = () => Proto.dialog('Ngắt kết nối Zalo OA?', h('p', {}, `Tin mới gửi tới "${c.name}" sẽ không vào hệ thống nữa. Hội thoại cũ giữ nguyên.`), (close) => [
    h('button', { class: 'btn', onclick: close }, 'Hủy'),
    h('button', { class: 'btn primary', onclick: (e) => Proto.serverAction(e.currentTarget, 'Ngắt kết nối', () => { close(); Proto.toast('Đã ngắt kết nối. Ghi nhật ký audit.'); }) }, 'Ngắt kết nối'),
  ]);
  return h('section', { class: 'card stack' },
    h('h2', {}, 'Ngắt kết nối'),
    h('p', { class: 'small muted' }, 'Dùng khi đổi OA hoặc thôi dùng kênh này.'),
    h('div', {}, h('button', { class: 'btn', onclick: open }, 'Ngắt kết nối…')));
}

function detailScreen() {
  const s = Proto.state();
  const c = channels()[0];
  let body;
  if (s === 'loading') body = Proto.loading(8);
  else if (s === 'error') body = h('div', { class: 'card' }, Proto.error('Không tải được cấu hình kênh.'));
  else if (s === 'empty') body = Proto.empty('Kênh không tồn tại hoặc đã bị ngắt kết nối.', null);
  else body = h('div', { class: 'stack' }, banner(c), infoCard(c), tokenCard(c), policyCard(), disconnectCard(c));
  return h('div', { class: 'main' },
    h('div', { class: 'page-head' },
      h('div', {}, h('a', { class: 'small', href: `channels.html?role=${Proto.role()}` }, 'Kênh ›'), h('h1', {}, c.name, ' ', s === 'loading' || s === 'error' ? null : statusBadge(c)))),
    Proto.noAiNote(),
    h('div', { class: 'page-body', style: 'max-width:880px;overflow:auto' }, body));
}

Proto.mount({
  page: 'settings',
  states: [['normal', 'Bình thường'], ['loading', 'Đang tải'], ['empty', 'Trống'], ['error', 'Lỗi'], ['aioff', 'AI tắt — Không áp dụng'], ['token_expiring', 'Token sắp hết hạn'], ['disconnected', 'Mất kết nối']],
  variants: [{ label: 'Màn', name: 'screen', options: [['list', '#24 Kênh'], ['detail', '#25 Cấu hình Zalo OA']] }],
  render: () => {
    if (!['owner', 'admin'].includes(Proto.role())) {
      return h('div', { class: 'page-body' }, Proto.noAccess('Cài đặt kênh (chỉ Owner, Admin)', Proto.can('inbox.view') ? 'inbox.html' : 'customer.html'));
    }
    return Proto.get('screen', 'list') === 'detail' ? detailScreen() : listScreen();
  },
});
