/* global Proto */
/* #28 Audit log (danh-sach-man-M11; A8, A9, A17). Sprint S5, nộp wireframe 04/01/2027.
   Owner, Admin (Phụ lục B "Xem audit log công ty"). `GET /v1/audit-logs` (lọc ngày, người, hành động) ·
   `POST /v1/audit-logs/export` (job nền). Không hiện PII: khách chỉ hiện mã, không tên/SĐT/nội dung tin (CLAUDE.md quy tắc 5). */
const { h } = Proto;

const ACTIONS = [
  ['19/10/2026 09:41', 'Admin Gani', 'Đổi vai trò', 'Thành viên Trần Thu: Sales → Manager', null],
  ['19/10/2026 09:12', 'Owner Gani', 'Đặt lại 2FA', 'Thành viên Vũ Nam', 'Mất điện thoại'],
  ['18/10/2026 17:05', 'Admin Gani', 'Xuất bản flow', 'Flow "Ngoài giờ" phiên bản 3', null],
  ['18/10/2026 15:30', 'Hà Linh', 'Gộp khách', 'Khách #c-0193 + #c-0247', null],
  ['18/10/2026 11:02', 'Admin Gani', 'Xuất dữ liệu', 'Danh sách khách (CSV)', 'Báo cáo quý'],
  ['17/10/2026 08:20', 'Owner Gani', 'Đổi mức tự chủ', 'Workspace B2B: L0 → L1', null],
];

const ACCESS = [
  ['17/10/2026 14:00', 'Platform op Minh', 'Hỗ trợ lỗi kênh Zalo theo yêu cầu #128', '60 phút', '14:00–14:37 (kết thúc sớm)', 12],
  ['09/10/2026 10:15', 'Platform op Minh', 'Kiểm tra dữ liệu sau khi gộp khách lỗi', '60 phút', '10:15–11:15', 31],
];

function tabs(current) {
  return h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Loại nhật ký' },
    [['actions', 'Thao tác quản trị (A9)'], ['access', 'Truy cập của platform (A8)']].map(([k, v]) =>
      h('button', { role: 'tab', id: `tab-${k}`, 'aria-selected': String(current === k), onclick: () => Proto.set('tab', k) }, v)));
}

function filters() {
  return h('div', { class: 'row', style: 'margin-bottom:var(--sp-4);flex-wrap:wrap' },
    h('label', { class: 'row small' }, 'Người', h('select', { class: 'input' }, ['Tất cả', 'Owner Gani', 'Admin Gani', 'Hà Linh'].map((o) => h('option', {}, o)))),
    h('label', { class: 'row small' }, 'Hành động', h('select', { class: 'input' }, ['Tất cả', 'Đổi vai trò', 'Đặt lại 2FA', 'Xuất bản flow', 'Gộp khách', 'Xuất dữ liệu', 'Đổi mức tự chủ'].map((o) => h('option', {}, o)))),
    h('label', { class: 'row small' }, 'Từ', h('input', { class: 'input', type: 'date' })),
    h('label', { class: 'row small' }, 'Đến', h('input', { class: 'input', type: 'date' })));
}

function actionsTable() {
  return h('table', { class: 'plain' },
    h('thead', {}, h('tr', {}, ['Thời điểm', 'Người làm', 'Hành động', 'Đối tượng', 'Lý do'].map((c) => h('th', {}, c)))),
    h('tbody', {}, ACTIONS.map(([at, who, what, target, reason]) =>
      h('tr', {}, h('td', {}, at), h('td', {}, who), h('td', {}, what), h('td', {}, target), h('td', {}, reason || '—')))));
}

function accessTable() {
  return h('div', { class: 'stack' },
    h('p', { class: 'small muted' }, 'Mỗi lần nhân viên nền tảng xem dữ liệu của công ty phải mở phiên có lý do, tối đa 60 phút. Mọi thao tác trong phiên được ghi lại.'),
    h('table', { class: 'plain' },
      h('thead', {}, h('tr', {}, ['Bắt đầu', 'Người truy cập', 'Lý do', 'Thời hạn', 'Thực tế', 'Số thao tác'].map((c) => h('th', {}, c)))),
      h('tbody', {}, ACCESS.map((row) => h('tr', {}, row.map((cell) => h('td', {}, String(cell))))))),
    h('p', { class: 'pending-spec' }, 'endpoint xem phiên truy cập của công ty: chờ U28'));
}

function exportButton() {
  const b = h('button', { class: 'btn primary' }, 'Xuất nhật ký');
  b.addEventListener('click', () => Proto.serverAction(b, 'Xuất nhật ký', () => Proto.toast('Đang xuất ở nền. File có trong Thông báo khi xong. Việc xuất cũng được ghi audit.')));
  return b;
}

Proto.mount({
  page: 'audit',
  states: [['normal', 'Bình thường'], ['loading', 'Đang tải'], ['empty', 'Trống'], ['error', 'Lỗi'], ['aioff', 'AI tắt — Không áp dụng']],
  render: () => {
    if (!['owner', 'admin'].includes(Proto.role())) {
      return h('div', { class: 'page-body' }, Proto.noAccess('Audit log (chỉ Owner, Admin)', Proto.can('inbox.view') ? 'inbox.html' : 'customer.html'));
    }
    const s = Proto.state();
    const tab = Proto.get('tab', 'actions');
    let body;
    if (s === 'loading') body = Proto.loading(6);
    else if (s === 'error') body = Proto.error('Không tải được nhật ký.');
    else if (s === 'empty') body = Proto.empty('Không có mục nào trong khoảng thời gian này.', 'Xem 30 ngày gần nhất', () => Proto.set('state', 'normal'));
    else body = tab === 'access' ? accessTable() : h('div', {}, filters(), actionsTable());
    return h('div', { class: 'main' },
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', {}, 'Audit log'), h('p', { class: 'small muted' }, 'Gani Foods · chỉ xem, không sửa hay xóa được. Không hiện SĐT, email, nội dung tin. ', h('span', { class: 'pending-spec' }, 'A17: chưa có định nghĩa trong repo (U28)'))),
        exportButton()),
      Proto.noAiNote(),
      h('div', { class: 'page-body stack' }, tabs(tab), h('div', { class: 'card', role: 'tabpanel', 'aria-labelledby': `tab-${tab}` }, body)));
  },
});
