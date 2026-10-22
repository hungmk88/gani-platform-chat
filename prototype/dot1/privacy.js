/* global Proto */
/* #11 Yêu cầu dữ liệu cá nhân (danh-sach-man-M11; P7, P5 phần xóa). Sprint S5, nộp wireframe 04/01/2027.
   Căn cứ: Phụ lục B dòng "Xử lý yêu cầu dữ liệu cá nhân (P7)" (Owner, Admin), Brief P17 "Dữ liệu cá nhân: quyền xem/xóa", J3
   (khách xem lịch sử cần OTP). P7 chưa có định nghĩa trong danh-sach-109 (U35): loại yêu cầu, thời hạn xử lý, cách xác minh,
   dữ liệu phải giữ lại khi xóa đều là dữ liệu tạm có nhãn chờ. Thời hạn lưu trữ (phần còn lại của P5) ở Đợt 2. */
const { h } = Proto;

const TYPES = { access: 'Xem, nhận bản sao', fix: 'Sửa thông tin', erase: 'Xóa dữ liệu', withdraw: 'Rút đồng ý nhận tin' };
const STATUS = { new: ['warn', 'Mới'], verifying: ['warn', 'Đang xác minh'], doing: ['', 'Đang xử lý'], done: ['ok', 'Hoàn tất'], refused: ['error', 'Từ chối'] };
const REQUESTS = [
  { id: 'YC-0007', customer: 'Nguyễn Văn An', via: 'Zalo OA', type: 'erase', received: '20/10/2026 09:12', status: 'verifying', owner: 'Admin Gani' },
  { id: 'YC-0006', customer: 'Trần Thị Bình', via: 'Email', type: 'access', received: '18/10/2026 14:40', status: 'doing', owner: 'Owner Gani' },
  { id: 'YC-0005', customer: 'Lê Minh Châu', via: 'Zalo OA', type: 'withdraw', received: '15/10/2026 08:05', status: 'done', owner: 'Admin Gani' },
  { id: 'YC-0004', customer: 'Khách Zalo 4471', via: 'Zalo OA', type: 'erase', received: '10/10/2026 16:22', status: 'refused', owner: 'Admin Gani', note: 'Không xác minh được danh tính' },
  { id: 'YC-0003', customer: 'Phạm Quốc Dũng', via: 'Điện thoại', type: 'erase', received: '08/10/2026 10:30', status: 'doing', owner: 'Owner Gani' },
];
const pending = (text) => h('span', { class: 'pending-spec' }, text);

function record() {
  const customer = h('input', { id: 'pr-customer', class: 'input', autofocus: true, placeholder: 'Tên, SĐT hoặc email' });
  const type = h('select', { id: 'pr-type', class: 'input' }, Object.entries(TYPES).map(([k, label]) => h('option', { value: k }, label)));
  const via = h('select', { id: 'pr-via', class: 'input' }, ['Zalo OA', 'Email', 'Điện thoại', 'Trực tiếp'].map((v) => h('option', {}, v)));
  const err = h('p', { class: 'field-error', role: 'alert' });
  Proto.dialog('Ghi nhận yêu cầu', h('div', { class: 'stack' },
    h('div', { class: 'field' }, h('label', { for: 'pr-customer' }, 'Khách'), customer),
    h('div', { class: 'field' }, h('label', { for: 'pr-type' }, 'Khách yêu cầu'), type),
    h('div', { class: 'field' }, h('label', { for: 'pr-via' }, 'Nhận qua'), via),
    h('p', { class: 'small muted' }, 'Không chép nội dung tin nhắn hay giấy tờ của khách vào đây; hệ thống tự gắn tin gốc. Hạn xử lý: ', pending('chờ chốt pháp lý (U35)')),
    err), (close) => [
    h('button', { class: 'btn', onclick: close }, 'Hủy'),
    h('button', { class: 'btn primary', onclick: (e) => {
      if (!customer.value.trim()) { err.textContent = 'Chọn khách đã gửi yêu cầu.'; customer.focus(); return; }
      Proto.serverAction(e.currentTarget, 'Ghi nhận', () => { close(); Proto.toast('Đã ghi nhận YC-0008. Bước kế tiếp: xác minh danh tính. Ghi audit.'); });
    } }, 'Ghi nhận'),
  ]);
}

function erase(r) {
  const confirmName = h('input', { id: 'erase-confirm', class: 'input', autocomplete: 'off' });
  const err = h('p', { class: 'field-error', role: 'alert' });
  Proto.dialog(`Xóa dữ liệu của ${r.customer}`, h('div', { class: 'stack' },
    h('p', {}, 'Không hoàn tác được. Sau khi xóa ', pending('đề xuất của FE, chờ U35'), ':'),
    h('ul', {},
      h('li', {}, 'Hồ sơ, SĐT, email, trường tùy chỉnh, tag: xóa.'),
      h('li', {}, 'Nội dung tin nhắn của khách: xóa; hội thoại giữ lại dạng "Khách đã xóa" để số liệu báo cáo không đổi.'),
      h('li', {}, 'Lead, ticket: giữ, bỏ liên kết tới khách.'),
      h('li', {}, 'Dữ liệu phải giữ theo luật (hóa đơn, chứng từ): ', pending('danh sách chờ chốt (U35)'))),
    h('div', { class: 'field' }, h('label', { for: 'erase-confirm' }, `Gõ "${r.customer}" để xác nhận`), confirmName),
    err), (close) => [
    h('button', { class: 'btn', onclick: close }, 'Hủy'),
    h('button', { class: 'btn primary', onclick: (e) => {
      if (confirmName.value.trim() !== r.customer) { err.textContent = 'Tên chưa khớp.'; confirmName.focus(); return; }
      Proto.serverAction(e.currentTarget, 'Xóa vĩnh viễn', () => { close(); Proto.toast(`${r.id}: đã xóa dữ liệu, gửi xác nhận cho khách qua ${r.via}. Ghi audit (không ghi nội dung đã xóa).`); }, 900);
    } }, 'Xóa vĩnh viễn'),
  ]);
}

function nextStep(r) {
  if (r.status === 'new' || r.status === 'verifying') {
    return h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => Proto.toast(`Đã gửi mã OTP tới SĐT đã xác minh của ${r.customer} (J3). Cách xác minh khác: chờ U35.`), 'aria-label': `Gửi OTP xác minh ${r.id}` }, 'Gửi OTP xác minh'),
      h('button', { class: 'btn', onclick: () => Proto.toast(`${r.id}: từ chối, gửi lý do cho khách. Ghi audit.`), 'aria-label': `Từ chối ${r.id}` }, 'Từ chối…'));
  }
  if (r.status === 'doing') {
    if (r.type === 'fix') return h('a', { class: 'btn primary', href: `customer.html?role=${Proto.role()}` }, 'Mở hồ sơ để sửa');
    const act = { access: ['Tạo bản xuất', () => Proto.toast(`${r.id}: đang tạo bản xuất (JSON + CSV). Link tải gửi cho khách; hạn link: chờ U35.`)],
      erase: ['Xóa dữ liệu…', () => erase(r)],
      withdraw: ['Gỡ đồng ý', () => Proto.toast(`${r.id}: gỡ đồng ý nhận tin marketing ở mọi kênh. Tin giao dịch vẫn gửi.`)] }[r.type];
    return h('button', { class: 'btn primary', onclick: act[1], 'aria-label': `${act[0]} ${r.id}` }, act[0]);
  }
  return h('span', { class: 'small muted' }, r.note ?? 'Đã gửi phản hồi cho khách');
}

function table() {
  const status = Proto.get('status', '');
  const rows = REQUESTS.filter((r) => !status || r.status === status);
  const filter = h('select', { id: 'pr-status', class: 'input', onchange: (e) => Proto.set('status', e.target.value) },
    h('option', { value: '' }, 'Mọi trạng thái'), Object.entries(STATUS).map(([k, [, label]]) => h('option', { value: k, selected: k === status }, label)));
  return h('div', { class: 'stack' },
    h('div', { class: 'field', style: 'max-width:240px' }, h('label', { for: 'pr-status' }, 'Trạng thái'), filter),
    h('table', { class: 'plain' },
      h('thead', {}, h('tr', {}, ['Mã', 'Khách', 'Yêu cầu', 'Nhận lúc', 'Hạn', 'Trạng thái', 'Người xử lý', ''].map((c) => h('th', {}, c || h('span', { class: 'sr-only' }, 'Bước tiếp theo'))))),
      h('tbody', {}, rows.map((r) => h('tr', {},
        h('td', {}, r.id),
        h('td', {}, r.customer, h('div', { class: 'small muted' }, `qua ${r.via}`)),
        h('td', {}, TYPES[r.type]),
        h('td', {}, r.received),
        h('td', {}, ['done', 'refused'].includes(r.status) ? '—' : pending('chờ U35')),
        h('td', {}, h('span', { class: `badge ${STATUS[r.status][0]}` }, STATUS[r.status][1])),
        h('td', {}, r.owner),
        h('td', {}, nextStep(r)))))));
}

Proto.mount({
  page: 'privacy',
  states: [['normal', 'Bình thường'], ['loading', 'Đang tải'], ['empty', 'Trống'], ['error', 'Lỗi'], ['aioff', 'AI tắt — Không áp dụng']],
  render: () => {
    if (!['owner', 'admin'].includes(Proto.role())) {
      return h('div', { class: 'page-body' }, Proto.noAccess('Yêu cầu dữ liệu cá nhân (chỉ Owner, Admin)', Proto.can('inbox.view') ? 'inbox.html' : 'customers.html'));
    }
    const s = Proto.state();
    const body = s === 'loading' ? Proto.loading(5) : s === 'error' ? Proto.error('Không tải được danh sách yêu cầu.') : s === 'empty' ? Proto.empty('Chưa có yêu cầu nào về dữ liệu cá nhân.', 'Ghi nhận yêu cầu', record) : table();
    return h('div', { class: 'main' },
      h('div', { class: 'page-head' },
        h('div', {}, h('p', { class: 'small muted' }, h('a', { href: `customers.html?role=${Proto.role()}` }, 'Khách hàng'), ' ›'), h('h1', {}, 'Yêu cầu dữ liệu cá nhân'),
          h('p', { class: 'small muted' }, 'Khách yêu cầu xem, sửa, xóa dữ liệu hoặc rút đồng ý. Mọi bước ghi audit. ', pending('P7 chưa có định nghĩa: loại yêu cầu, hạn, cách xác minh chờ U35'))),
        s === 'empty' ? null : h('button', { class: 'btn primary', onclick: record }, 'Ghi nhận yêu cầu')),
      Proto.noAiNote(),
      h('div', { class: 'page-body stack' }, h('div', { class: 'card', style: 'overflow:auto' }, body)));
  },
});
