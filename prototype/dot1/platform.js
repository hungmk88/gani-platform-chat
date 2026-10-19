/* global Proto, location */
/* #30 Platform (danh-sach-man-M11; A7, A8, B3), bản tối thiểu 3 tab. Chỉ platform operator. Sprint S5, nộp 04/01/2027.
   `GET /v1/platform/tenants/health` · `POST /v1/platform/access-sessions` (bắt buộc reason, 60 phút) ·
   `GET /v1/channel-policies` · `PUT /v1/channel-policies/{id}` (có effective_from). */
const { h } = Proto;

const TENANTS = [
  ['Gani Foods', 'ok', 'Bình thường', 0, '2 / 2', 0],
  ['The Smile', 'warn', 'Token sắp hết hạn', 0, '0 / 1', 1],
  ['Công ty 3', 'error', 'Mất kết nối kênh', 14, '1 / 1', 0],
  ['Công ty 4', 'ok', 'Bình thường', 0, '1 / 1', 0],
  ['Công ty 5', '', 'Chưa có kênh', 0, '0 / 0', 0],
];

function tabs(current) {
  return h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Platform' },
    [['health', 'Sức khỏe công ty (A7)'], ['access', 'Phiên truy cập có lý do (A8)'], ['policies', 'Chính sách kênh (B3)']].map(([k, v]) =>
      h('button', { role: 'tab', id: `tab-${k}`, 'aria-selected': String(current === k), onclick: () => Proto.set('tab', k) }, v)));
}

function health() {
  return h('div', { class: 'stack' },
    h('table', { class: 'plain' },
      h('thead', {}, h('tr', {}, ['Công ty', 'Tình trạng', 'Tin gửi lỗi 24h', 'Kênh kết nối', 'Token sắp hết hạn', 'Chi phí AI tháng'].map((c) => h('th', {}, c)))),
      h('tbody', {}, TENANTS.map(([name, cls, label, failed, channels, expiring]) => h('tr', {},
        h('td', {}, name), h('td', {}, h('span', { class: `badge ${cls}` }, label)), h('td', {}, String(failed)), h('td', {}, channels), h('td', {}, String(expiring)),
        h('td', {}, h('span', { class: 'pending-spec' }, 'chờ E5')))))),
    h('p', { class: 'small muted' }, 'Chỉ số vận hành, không có dữ liệu khách. Muốn xem dữ liệu của một công ty phải mở phiên truy cập có lý do.'));
}

function access() {
  const company = h('select', { id: 'company', class: 'input' }, TENANTS.map(([name]) => h('option', {}, name)));
  const reason = h('textarea', { id: 'reason', class: 'input', rows: 3 });
  const err = h('p', { class: 'field-error', role: 'alert' });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Mở phiên 60 phút');
  return h('div', { class: 'stack' },
    h('form', {
      class: 'stack', style: 'max-width:560px',
      onsubmit: (e) => {
        e.preventDefault();
        if (reason.value.trim().length < 10) { err.textContent = 'Ghi lý do cụ thể (ít nhất 10 ký tự), ví dụ số yêu cầu hỗ trợ.'; reason.classList.add('invalid'); return; }
        err.textContent = '';
        Proto.serverAction(submit, 'Mở phiên 60 phút', () => { location.href = 'customer.html?role=platform_operator&shell=platform_session'; });
      },
    },
    h('p', { class: 'small muted' }, 'Phiên tối đa 60 phút. Công ty thấy lý do và mọi thao tác trong Audit log của họ.'),
    h('div', { class: 'field' }, h('label', { for: 'company' }, 'Công ty'), company),
    h('div', { class: 'field' }, h('label', { for: 'reason' }, 'Lý do (bắt buộc)'), reason),
    err,
    submit),
    h('h2', {}, 'Phiên gần đây của bạn'),
    h('table', { class: 'plain' },
      h('thead', {}, h('tr', {}, ['Bắt đầu', 'Công ty', 'Lý do', 'Thực tế'].map((c) => h('th', {}, c)))),
      h('tbody', {},
        h('tr', {}, h('td', {}, '17/10 14:00'), h('td', {}, 'Gani Foods'), h('td', {}, 'Hỗ trợ lỗi kênh Zalo theo yêu cầu #128'), h('td', {}, '37 phút')),
        h('tr', {}, h('td', {}, '09/10 10:15'), h('td', {}, 'Gani Foods'), h('td', {}, 'Kiểm tra dữ liệu sau khi gộp khách lỗi'), h('td', {}, '60 phút')))));
}

function newVersionDialog() {
  const from = h('input', { id: 'eff', class: 'input', type: 'date' });
  const err = h('p', { class: 'field-error', role: 'alert' });
  Proto.dialog('Thêm phiên bản chính sách', h('div', { class: 'stack' },
    h('p', { class: 'small muted' }, 'Không sửa dòng cũ: mỗi thay đổi là một phiên bản mới có ngày hiệu lực. Ghi audit.'),
    h('div', { class: 'field' }, h('label', { for: 'eff' }, 'Hiệu lực từ'), from),
    h('div', { class: 'field' }, h('label', { for: 'win' }, 'Khung miễn phí (giờ)'), h('input', { id: 'win', class: 'input', inputmode: 'numeric' })),
    h('div', { class: 'field' }, h('label', { for: 'quota' }, 'Số tin miễn phí trong khung'), h('input', { id: 'quota', class: 'input', inputmode: 'numeric' })),
    h('div', { class: 'field' }, h('label', { for: 'src' }, 'Nguồn (link thông báo của nền tảng)'), h('input', { id: 'src', class: 'input' })),
    err), (close) => [
    h('button', { class: 'btn', onclick: close }, 'Hủy'),
    h('button', { class: 'btn primary', onclick: (e) => {
      if (!from.value) { err.textContent = 'Chọn ngày hiệu lực.'; return; }
      Proto.serverAction(e.currentTarget, 'Lưu phiên bản', () => { close(); Proto.toast('Đã thêm phiên bản chính sách mới.'); });
    } }, 'Lưu phiên bản'),
  ]);
}

function policies() {
  return h('div', { class: 'stack' },
    h('table', { class: 'plain' },
      h('thead', {}, h('tr', {}, ['Kênh', 'Loại tin', 'Khung miễn phí', 'Ngoài khung', 'Hiệu lực từ', 'Nguồn'].map((c) => h('th', {}, c)))),
      h('tbody', {},
        h('tr', {}, h('td', {}, 'Zalo OA'), h('td', {}, 'Tư vấn'), h('td', {}, '48 giờ, 8 tin'), h('td', {}, 'Không cho agent gửi'), h('td', {}, '20/06/2023'), h('td', {}, 'Thông báo Zalo OA')),
        h('tr', {}, h('td', {}, 'Zalo OA'), h('td', {}, 'Giao dịch, Truyền thông'), h('td', {}, h('span', { class: 'pending-spec' }, 'chờ xác nhận')), h('td', {}, '—'), h('td', {}, '—'), h('td', {}, '—')))),
    h('p', { class: 'small muted' }, 'Giá trị tạm, chờ CĐT xác nhận (channel-policy-spec §1). Các màn #6 và #25 đọc từ bảng này.'),
    h('div', {}, h('button', { class: 'btn', onclick: newVersionDialog }, 'Thêm phiên bản…')));
}

Proto.mount({
  page: 'platform',
  states: [['normal', 'Bình thường'], ['loading', 'Đang tải'], ['empty', 'Trống'], ['error', 'Lỗi'], ['aioff', 'AI tắt — Không áp dụng']],
  render: () => {
    if (Proto.role() !== 'platform_operator') {
      return h('div', { class: 'page-body' }, Proto.noAccess('Platform (chỉ platform operator)', Proto.can('inbox.view') ? 'inbox.html' : 'customer.html'));
    }
    const s = Proto.state();
    const tab = Proto.get('tab', 'health');
    let body;
    if (s === 'loading') body = Proto.loading(6);
    else if (s === 'error') body = Proto.error('Không tải được dữ liệu nền tảng.');
    else if (s === 'empty') body = Proto.empty('Chưa có công ty nào. Tạo công ty bằng script quản trị (spec M8 hướng b).', null);
    else body = tab === 'access' ? access() : tab === 'policies' ? policies() : health();
    return h('div', { class: 'main' },
      h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Platform'), h('p', { class: 'small muted' }, '5 công ty · không thuộc công ty nào'))),
      Proto.noAiNote(),
      h('div', { class: 'page-body stack' }, tabs(tab), h('div', { class: 'card', role: 'tabpanel', 'aria-labelledby': `tab-${tab}` }, body)));
  },
});
