/* global Proto */
/* #23 Dữ liệu khách, 2 tab (danh-sach-man-M11; J1, J4). Sprint S4, nộp wireframe 21/12/2026.
   Căn cứ: spec M8 §3.6 (trường tùy chỉnh cấp công ty: Owner, Admin; "Nhạy cảm" mã hóa và che với Marketing, Viewer — Phụ lục B
   dòng "Xem trường nhạy cảm"; trường đã có dữ liệu chỉ ẩn, không xóa) và §3.7 (tag: Owner, Admin, Manager; gộp 2 tag không mất
   khách; AI tắt thì tag do AI gắn (E1) không xuất hiện). Lưu phân khúc: Đợt 2 (Q-M8-2). Lọc và tìm khách nằm ở #7 /customers. */
const { h } = Proto;

const TYPES = [['text', 'Chữ'], ['number', 'Số'], ['date', 'Ngày'], ['one', 'Chọn 1'], ['many', 'Chọn nhiều'], ['phone', 'SĐT'], ['email', 'Email']];
const FIELDS = [
  { id: 'f1', name: 'Loại hình kinh doanh', type: 'one', options: ['Quán ăn', 'Nhà hàng', 'Đại lý'], required: true, sensitive: false, hidden: false, used: 1240 },
  { id: 'f2', name: 'Mã số thuế', type: 'text', required: false, sensitive: true, hidden: false, used: 318 },
  { id: 'f3', name: 'Ngày mở cửa hàng', type: 'date', required: false, sensitive: false, hidden: false, used: 0 },
  { id: 'f4', name: 'Kênh biết đến', type: 'many', options: ['Zalo', 'Hội chợ', 'Giới thiệu'], required: false, sensitive: false, hidden: true, used: 57 },
];
const TAGS = [
  { id: 'g1', name: 'Khách sỉ', count: 412, ai: false, hidden: false },
  { id: 'g2', name: 'bò viên', count: 96, ai: false, hidden: false },
  { id: 'g3', name: 'bo vien', count: 14, ai: false, hidden: false },
  { id: 'g4', name: 'Hỏi giá', count: 233, ai: true, hidden: false },
  { id: 'g5', name: 'Tết 2026', count: 51, ai: false, hidden: true },
];
const typeName = (t) => TYPES.find(([k]) => k === t)[1];
const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').toLowerCase().trim();
const canFields = () => ['owner', 'admin'].includes(Proto.role());
const aiOff = () => Proto.state() === 'aioff';

function saveFailed(err) {
  err.replaceChildren(h('p', {}, 'Không lưu được trường.'), h('p', { class: 'trace muted' }, 'Mã: 7f3a9c1e-…'), h('button', { class: 'btn', onclick: () => Proto.toast('Thử lại: gửi lại cùng Idempotency-Key.') }, 'Thử lại'));
}

function addField() {
  const name = h('input', { id: 'fd-name', class: 'input', autofocus: true, maxlength: 60 });
  const type = h('select', { id: 'fd-type', class: 'input' }, TYPES.map(([k, label]) => h('option', { value: k }, label)));
  const options = h('textarea', { id: 'fd-options', class: 'input', rows: 3 });
  const optionsField = h('div', { class: 'field', hidden: true }, h('label', { for: 'fd-options' }, 'Các lựa chọn (mỗi dòng một)'), options);
  type.addEventListener('change', () => { optionsField.hidden = !['one', 'many'].includes(type.value); });
  const required = h('input', { type: 'checkbox', id: 'fd-required' });
  const sensitive = h('input', { type: 'checkbox', id: 'fd-sensitive' });
  const err = h('div', { class: 'field-error', role: 'alert' });
  Proto.dialog('Thêm trường', h('div', { class: 'stack' },
    h('div', { class: 'field' }, h('label', { for: 'fd-name' }, 'Tên trường'), name),
    h('div', { class: 'field' }, h('label', { for: 'fd-type' }, 'Kiểu'), type),
    optionsField,
    h('label', { class: 'row' }, required, 'Bắt buộc khi tạo, sửa hồ sơ khách'),
    h('label', { class: 'row' }, sensitive, 'Nhạy cảm: mã hóa khi lưu, Marketing và Viewer chỉ thấy dạng che'),
    h('p', { class: 'small muted' }, 'Trường dùng chung cho mọi workspace của công ty; hiện trên hồ sơ khách và trong bộ lọc /customers ngay sau khi lưu.'),
    err), (close) => [
    h('button', { class: 'btn', onclick: close }, 'Hủy'),
    h('button', { class: 'btn primary', onclick: (e) => {
      const value = name.value.trim();
      const choices = options.value.split('\n').map((s) => s.trim()).filter(Boolean);
      const problem = !value ? 'Nhập tên trường.'
        : FIELDS.some((f) => fold(f.name) === fold(value)) ? 'Công ty đã có trường tên này.'
          : ['one', 'many'].includes(type.value) && choices.length < 2 ? 'Kiểu chọn cần ít nhất 2 lựa chọn.' : null;
      err.replaceChildren(problem ?? '');
      if (problem) return;
      Proto.serverAction(e.currentTarget, 'Thêm trường', () => {
        if (Proto.state() === 'save_error') return saveFailed(err);
        close();
        Proto.toast(`Đã thêm trường ${value}${sensitive.checked ? ' (nhạy cảm, mã hóa)' : ''}. Ghi audit.`);
      });
    } }, 'Thêm trường'),
  ]);
}

function fieldActions(f, i) {
  return h('div', { class: 'row' },
    h('button', { class: 'btn', disabled: i === 0, onclick: () => Proto.toast(`Đã đưa ${f.name} lên trên.`), 'aria-label': `Đưa ${f.name} lên` }, '↑'),
    h('button', { class: 'btn', disabled: i === FIELDS.length - 1, onclick: () => Proto.toast(`Đã đưa ${f.name} xuống dưới.`), 'aria-label': `Đưa ${f.name} xuống` }, '↓'),
    h('button', { class: 'btn', onclick: () => Proto.toast(f.hidden ? `Đã hiện lại ${f.name}.` : `Đã ẩn ${f.name}: dữ liệu giữ nguyên, không hiện trên hồ sơ và bộ lọc.`) }, f.hidden ? 'Hiện' : 'Ẩn'),
    f.used
      ? h('span', { class: 'small muted' }, 'Có dữ liệu: chỉ ẩn được')
      : h('button', { class: 'btn', onclick: () => Proto.toast(`Đã xóa ${f.name}. Ghi audit.`), 'aria-label': `Xóa ${f.name}` }, 'Xóa'));
}

function fieldsTab() {
  const s = Proto.state();
  if (s === 'loading') return Proto.loading(5);
  if (s === 'error') return Proto.error('Không tải được danh sách trường.');
  if (s === 'empty') return Proto.empty('Chưa có trường tùy chỉnh.', 'Thêm trường đầu tiên', addField);
  return h('div', { class: 'stack' },
    h('div', { class: 'row' }, h('p', { class: 'small muted' }, 'Thứ tự trong bảng là thứ tự trên hồ sơ khách. Cấp công ty: dùng chung mọi workspace.'), h('button', { class: 'btn primary', onclick: addField }, 'Thêm trường')),
    h('table', { class: 'plain' },
      h('thead', {}, h('tr', {}, ['Trường', 'Kiểu', 'Bắt buộc', 'Nhạy cảm', 'Đang có dữ liệu', ''].map((c) => h('th', {}, c || h('span', { class: 'sr-only' }, 'Thao tác'))))),
      h('tbody', {}, FIELDS.map((f, i) => h('tr', {},
        h('td', {}, f.name, ' ', f.hidden ? h('span', { class: 'badge' }, 'Đã ẩn') : null, f.options ? h('div', { class: 'small muted' }, f.options.join(' · ')) : null),
        h('td', {}, typeName(f.type)),
        h('td', {}, f.required ? 'Có' : '—'),
        h('td', {}, f.sensitive ? h('span', { class: 'badge warn' }, 'Mã hóa, che') : '—'),
        h('td', {}, f.used ? `${f.used} khách` : h('span', { class: 'small muted' }, 'Chưa có')),
        h('td', {}, fieldActions(f, i)))))));
}

function newTag() {
  const name = h('input', { id: 'tag-name', class: 'input', autofocus: true, maxlength: 40 });
  const err = h('p', { class: 'field-error', role: 'alert' });
  Proto.dialog('Tạo tag', h('div', { class: 'stack' }, h('div', { class: 'field' }, h('label', { for: 'tag-name' }, 'Tên tag'), name), err), (close) => [
    h('button', { class: 'btn', onclick: close }, 'Hủy'),
    h('button', { class: 'btn primary', onclick: (e) => {
      const value = name.value.trim();
      const twin = TAGS.find((t) => fold(t.name) === fold(value));
      const problem = !value ? 'Nhập tên tag.' : twin ? `Đã có tag "${twin.name}" (trùng khi bỏ dấu). Dùng tag đó, hoặc gộp nếu là một.` : null;
      err.textContent = problem ?? '';
      if (!problem) Proto.serverAction(e.currentTarget, 'Tạo tag', () => { close(); Proto.toast(`Đã tạo tag ${value}.`); });
    } }, 'Tạo tag'),
  ]);
}

function mergeTag(from) {
  const targets = TAGS.filter((t) => t !== from && !t.hidden && !(aiOff() && t.ai));
  const into = h('select', { id: 'merge-into', class: 'input' }, targets.map((t) => h('option', { value: t.id, selected: fold(t.name) === fold(from.name) }, `${t.name} (${t.count} khách)`)));
  const sum = h('p', { 'aria-live': 'polite' });
  const refresh = () => {
    const to = TAGS.find((t) => t.id === into.value);
    sum.textContent = `${from.count} khách mang "${from.name}" chuyển sang "${to.name}". Khách mang cả hai chỉ tính một lần. Sau khi gộp: kiểm số khách trước và sau, "${from.name}" bị xóa.`;
  };
  into.addEventListener('change', refresh);
  refresh();
  Proto.dialog(`Gộp tag "${from.name}"`, h('div', { class: 'stack' }, h('div', { class: 'field' }, h('label', { for: 'merge-into' }, 'Gộp vào tag'), into), sum), (close) => [
    h('button', { class: 'btn', onclick: close }, 'Hủy'),
    h('button', { class: 'btn primary', onclick: (e) => Proto.serverAction(e.currentTarget, 'Gộp tag', () => { close(); Proto.toast('Đã gộp. Số khách khớp trước/sau; ghi audit.'); }) }, 'Gộp tag'),
  ]);
}

function tagsTab() {
  const s = Proto.state();
  if (s === 'loading') return Proto.loading(5);
  if (s === 'error') return Proto.error('Không tải được danh sách tag.');
  if (s === 'empty') return Proto.empty('Chưa có tag.', 'Tạo tag đầu tiên', newTag);
  const rows = TAGS.filter((t) => !(aiOff() && t.ai));
  return h('div', { class: 'stack' },
    aiOff() ? h('div', { class: 'banner warn', role: 'status' }, 'AI đang tắt: tag do AI gắn (E1) không xuất hiện ở đây và không được gắn thêm; tag gắn tay dùng bình thường.') : null,
    h('div', { class: 'row' }, h('p', { class: 'small muted' }, 'Sales, Support gắn và bỏ tag có sẵn trên hồ sơ khách và hội thoại. Lưu phân khúc: Đợt 2.'), h('button', { class: 'btn primary', onclick: newTag }, 'Tạo tag')),
    h('table', { class: 'plain' },
      h('thead', {}, h('tr', {}, ['Tag', 'Số khách', 'Nguồn', ''].map((c) => h('th', {}, c || h('span', { class: 'sr-only' }, 'Thao tác'))))),
      h('tbody', {}, rows.map((t) => h('tr', {},
        h('td', {}, t.name, ' ', t.hidden ? h('span', { class: 'badge' }, 'Đã ẩn') : null),
        h('td', {}, String(t.count)),
        h('td', {}, t.ai ? 'AI gắn (E1)' : 'Gắn tay'),
        h('td', {}, h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => Proto.toast(`Đổi tên "${t.name}": khách đang mang tag giữ nguyên.`), 'aria-label': `Đổi tên ${t.name}` }, 'Đổi tên'),
          h('button', { class: 'btn', onclick: () => Proto.toast(t.hidden ? `Đã hiện lại "${t.name}".` : `Đã ẩn "${t.name}": không gắn thêm được, khách đang mang vẫn giữ.`) }, t.hidden ? 'Hiện' : 'Ẩn'),
          h('button', { class: 'btn', onclick: () => mergeTag(t), 'aria-label': `Gộp ${t.name}` }, 'Gộp…'))))))));
}

Proto.mount({
  page: 'customer-data',
  states: [['normal', 'Bình thường'], ['loading', 'Đang tải'], ['empty', 'Trống'], ['error', 'Lỗi tải'], ['save_error', 'Lỗi khi lưu trường'], ['aioff', 'AI tắt']],
  render: () => {
    if (!['owner', 'admin', 'manager'].includes(Proto.role())) {
      return h('div', { class: 'page-body' }, Proto.noAccess('Dữ liệu khách (Owner, Admin; Manager chỉ tab Tag)', Proto.can('inbox.view') ? 'inbox.html' : 'customer.html'));
    }
    const tabs = canFields() ? [['fields', 'Trường tùy chỉnh'], ['tags', 'Tag']] : [['tags', 'Tag']];
    const tab = canFields() ? Proto.get('tab', 'fields') : 'tags';
    return h('div', { class: 'main' },
      h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Dữ liệu khách'), h('p', { class: 'small muted' }, 'Công ty Gani Foods · Thêm, ẩn, gộp đều ghi audit.', canFields() ? '' : ' Manager quản lý tag; trường tùy chỉnh do Owner, Admin.'))),
      h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Phần dữ liệu khách' }, tabs.map(([k, label]) => h('button', { role: 'tab', id: `tab-${k}`, 'aria-selected': String(tab === k), onclick: () => Proto.set('tab', k) }, label))),
      tab === 'fields' && aiOff() ? Proto.noAiNote() : null,
      h('div', { class: 'page-body stack', style: 'max-width:1000px' }, h('div', { class: 'card', style: 'overflow:auto' }, tab === 'tags' ? tagsTab() : fieldsTab())));
  },
});
