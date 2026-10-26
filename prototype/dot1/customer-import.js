/* global Proto */
/* #10 Nhập khách từ file, 3 bước (danh-sach-man-M11; J5, J2). Sprint S4, nộp wireframe 21/12/2026.
   Căn cứ: Phụ lục B dòng "Nhập khách từ file" (Owner, Admin), J2 (SĐT chuẩn hóa +84 để nhận ra khách đã có), J1 (trường tùy
   chỉnh cấp công ty, #23). Chưa có spec màn và endpoint: giới hạn số dòng, định dạng ngoài CSV, đồng ý nhận tin marketing
   (P-) gắn nhãn chờ. Nhập chạy nền; kết quả và file dòng lỗi lấy từ API, không tự tính ở client. */
const { h } = Proto;

const COLUMNS = ['Họ tên', 'Điện thoại', 'Email', 'Cửa hàng', 'Loại hình'];
const FIELDS = [['', 'Bỏ qua cột này'], ['name', 'Tên khách'], ['phone', 'SĐT'], ['email', 'Email'], ['company', 'Công ty'], ['kind', 'Loại hình kinh doanh (trường tùy chỉnh)'], ['tag', 'Tag']];
const GUESS = { 'Họ tên': 'name', 'Điện thoại': 'phone', Email: 'email', 'Cửa hàng': 'company', 'Loại hình': 'kind' };
const ROWS = [
  ['Ngô Thị Hoa', '0912 345 678', 'hoa@example.test', 'Quán Hoa', 'Quán ăn'],
  ['Đỗ Văn Khoa', '+84900000004', '', 'Đại lý Khoa', 'Đại lý'],
  ['Bùi Lan', '12345', 'lan@example', '', 'Nhà hàng'],
];
const STEPS = ['Chọn file', 'Ghép cột', 'Xác nhận'];
const step = () => Number(Proto.get('step', '1'));
const go = (n) => Proto.set('step', String(n));
const pending = (text) => h('span', { class: 'pending-spec' }, text);

/* Chuẩn hóa như J2 (minh họa; API mới là nơi quyết định): bỏ ký tự thừa, 0xxxxxxxxx → +84xxxxxxxxx. */
function normalize(raw) {
  const d = raw.replace(/[^\d+]/g, '');
  if (/^\+84\d{9}$/.test(d)) return d;
  if (/^0\d{9}$/.test(d)) return `+84${d.slice(1)}`;
  return null;
}

function stepper() {
  return h('ol', { class: 'row', 'aria-label': 'Các bước nhập khách', style: 'list-style:none;padding:0;gap:var(--sp-4)' },
    STEPS.map((label, i) => h('li', { 'aria-current': step() === i + 1 ? 'step' : null, class: step() === i + 1 ? '' : 'muted' },
      h('strong', {}, `${i + 1}. `), label, step() > i + 1 ? ' ✓' : '')));
}

function chooseFile() {
  const input = h('input', { id: 'file', type: 'file', accept: '.csv,text/csv', class: 'input' });
  const stays = () => ['bad_file', 'empty_file'].includes(Proto.state());
  input.addEventListener('change', () => (stays() ? Proto.render() : go(2)));
  return h('div', { class: 'stack' },
    h('div', { class: 'field' }, h('label', { for: 'file' }, 'File CSV (UTF-8, dòng đầu là tiêu đề cột)'), input),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => Proto.toast('Tải file mẫu khach-hang-mau.csv (cột Tên, SĐT, Email, Công ty và các trường tùy chỉnh).') }, 'Tải file mẫu'),
      h('button', { class: 'btn', onclick: () => (stays() ? Proto.render() : go(2)) }, 'Dùng file ví dụ (prototype)')),
    Proto.state() === 'bad_file'
      ? h('div', { class: 'state-box', role: 'alert' }, h('p', {}, 'Không đọc được file: dòng 1 không có tiêu đề cột, hoặc file không phải UTF-8.'), h('p', { class: 'trace muted' }, 'Mã: 7f3a9c1e-…'), h('p', { class: 'small' }, 'Lưu lại từ Excel bằng "CSV UTF-8" rồi chọn lại.'))
      : null,
    Proto.state() === 'empty_file'
      ? h('div', { class: 'state-box', role: 'alert' }, h('p', {}, 'File chỉ có dòng tiêu đề, không có khách nào để nhập.'), h('button', { class: 'btn', onclick: () => input.click() }, 'Chọn file khác'))
      : null,
    h('p', { class: 'small muted' }, 'Giới hạn: ', pending('số dòng và dung lượng tối đa: chờ Backend'), ' · Excel (.xlsx): ', pending('chờ chốt, Đợt 1 chỉ CSV theo J5')));
}

function mapColumns() {
  const mapping = Object.fromEntries(COLUMNS.map((c) => [c, Proto.get(`map-${c}`, GUESS[c] ?? '')]));
  const err = h('p', { class: 'field-error', role: 'alert' });
  const used = Object.values(mapping).filter(Boolean);
  const dup = used.find((v, i) => used.indexOf(v) !== i);
  const phoneCol = COLUMNS.find((c) => mapping[c] === 'phone');
  return h('div', { class: 'stack' },
    h('p', {}, 'File ', h('strong', {}, 'khach-hang.csv'), ': 120 dòng, 5 cột. Hệ thống đoán sẵn, sửa nếu sai.'),
    h('table', { class: 'plain' },
      h('thead', {}, h('tr', {}, ['Cột trong file', 'Ví dụ (dòng 2)', 'Nhập vào'].map((t) => h('th', {}, t)))),
      h('tbody', {}, COLUMNS.map((c, i) => h('tr', {},
        h('th', { scope: 'row' }, c),
        h('td', {}, ROWS[0][i] || h('span', { class: 'muted' }, '(trống)')),
        h('td', {}, h('select', { class: 'input', 'aria-label': `Nhập cột ${c} vào`, onchange: (e) => Proto.set(`map-${c}`, e.target.value) },
          FIELDS.map(([v, label]) => h('option', { value: v, selected: v === mapping[c] }, label)))))))),
    h('h3', {}, 'Xem trước 3 dòng'),
    h('table', { class: 'plain' },
      h('thead', {}, h('tr', {}, ['Dòng', 'Tên', 'SĐT sau chuẩn hóa', 'Kết quả'].map((t) => h('th', {}, t)))),
      h('tbody', {}, ROWS.map((r, i) => {
        const phone = phoneCol ? normalize(r[COLUMNS.indexOf(phoneCol)]) : null;
        const existing = phone === '+84900000004';
        return h('tr', {}, h('td', {}, String(i + 2)), h('td', {}, r[0]), h('td', {}, phone ?? h('span', { class: 'badge error' }, 'SĐT không hợp lệ')),
          h('td', {}, !phone ? 'Lỗi: bỏ qua dòng' : existing ? 'Trùng khách Phạm Quốc Dũng' : 'Khách mới'));
      }))),
    h('fieldset', { class: 'stack' }, h('legend', {}, 'Khi trùng SĐT với khách đã có'),
      h('label', { class: 'row' }, h('input', { type: 'radio', name: 'dup', value: 'fill', checked: Proto.get('dup', 'fill') === 'fill', onchange: () => Proto.set('dup', 'fill') }), 'Chỉ điền ô đang trống của khách đã có (không ghi đè)'),
      h('label', { class: 'row' }, h('input', { type: 'radio', name: 'dup', value: 'skip', checked: Proto.get('dup', 'fill') === 'skip', onchange: () => Proto.set('dup', 'skip') }), 'Bỏ qua dòng trùng')),
    h('div', { class: 'field' }, h('label', { for: 'batch-tag' }, 'Gắn tag cho mọi khách của lần nhập này (không bắt buộc)'), h('input', { id: 'batch-tag', class: 'input', value: Proto.get('tag', ''), onchange: (e) => Proto.set('tag', e.target.value) })),
    err,
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => go(1) }, 'Quay lại'),
      h('button', { class: 'btn primary', onclick: () => {
        const problem = dup ? 'Mỗi trường chỉ nhận từ một cột.' : !used.includes('name') && !used.includes('phone') ? 'Cần ít nhất cột Tên khách hoặc SĐT.' : null;
        err.textContent = problem ?? '';
        if (!problem) go(3);
      } }, 'Tiếp tục')));
}

function confirmStep() {
  const skip = Proto.get('dup', 'fill') === 'skip';
  const done = Proto.get('done', '') === '1';
  if (done) {
    return h('div', { class: 'stack', role: 'status' },
      h('p', {}, h('strong', {}, 'Đã nhập xong.'), ` 96 khách mới, ${skip ? 'bỏ qua 18 dòng trùng' : '18 khách đã có được điền thêm ô trống'}, 6 dòng lỗi. Ghi audit.`),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => Proto.toast('Tải file dong-loi.csv: 6 dòng kèm lý do từng dòng.') }, 'Tải 6 dòng lỗi'),
        h('a', { class: 'btn primary', href: `customers.html?role=${Proto.role()}` }, 'Xem danh sách khách')));
  }
  return h('div', { class: 'stack' },
    h('table', { class: 'plain' }, h('tbody', {},
      h('tr', {}, h('th', { scope: 'row' }, 'Khách mới'), h('td', {}, '96')),
      h('tr', {}, h('th', { scope: 'row' }, 'Trùng SĐT với khách đã có'), h('td', {}, `18 — ${skip ? 'bỏ qua' : 'chỉ điền ô trống'}`)),
      h('tr', {}, h('th', { scope: 'row' }, 'Dòng lỗi (bỏ qua)'), h('td', {}, '6 — SĐT hoặc email không hợp lệ')),
      Proto.get('tag', '') ? h('tr', {}, h('th', { scope: 'row' }, 'Gắn tag'), h('td', {}, Proto.get('tag', ''))) : null)),
    h('p', { class: 'small muted' }, 'Số liệu do API kiểm tra trên toàn file trước khi nhập. Nhập chạy nền: có thể rời trang, xong sẽ có thông báo. ', pending('đồng ý nhận tin marketing của khách nhập từ file: chờ chốt')),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => go(2) }, 'Quay lại'),
      h('button', { class: 'btn primary', onclick: (e) => Proto.serverAction(e.currentTarget, `Nhập ${skip ? 96 : 114} khách`, () => Proto.set('done', '1'), 900) }, `Nhập ${skip ? 96 : 114} khách`)));
}

Proto.mount({
  page: 'customers',
  states: [['normal', 'Bình thường'], ['loading', 'Đang đọc file'], ['empty_file', 'File không có dòng nào'], ['bad_file', 'File không đọc được'], ['error', 'Nhập lỗi'], ['aioff', 'AI tắt — Không áp dụng']],
  render: () => {
    if (!['owner', 'admin'].includes(Proto.role())) {
      return h('div', { class: 'page-body' }, Proto.noAccess('Nhập khách từ file (chỉ Owner, Admin)', 'customers.html'));
    }
    const s = Proto.state();
    // Đang tải: API đọc file và đoán cột (trước bước 2). Lỗi: lần nhập không chạy, chưa thêm khách nào; Thử lại dùng lại Idempotency-Key.
    const body = s === 'loading'
      ? h('div', { class: 'stack', role: 'status' }, h('p', {}, 'Đang đọc khach-hang.csv và kiểm tra từng dòng…'), Proto.loading(4))
      : s === 'error'
        ? Proto.error('Không nhập được khách. Chưa có khách nào được thêm; thử lại không tạo khách trùng.')
        : step() === 3 ? confirmStep() : step() === 2 ? mapColumns() : chooseFile();
    return h('div', { class: 'main' },
      h('div', { class: 'page-head' }, h('div', {}, h('p', { class: 'small muted' }, h('a', { href: `customers.html?role=${Proto.role()}` }, 'Khách hàng'), ' ›'), h('h1', {}, 'Nhập khách từ file'), h('p', { class: 'small muted' }, 'Khách nhập vào hồ sơ cấp công ty, dùng chung mọi workspace.'))),
      Proto.noAiNote(),
      h('div', { class: 'page-body stack', style: 'max-width:880px' }, stepper(), h('div', { class: 'card stack' }, body)));
  },
});
