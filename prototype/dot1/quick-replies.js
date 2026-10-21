/* global Proto */
/* #22 Mẫu trả lời nhanh (danh-sach-man-M11; C7). Sprint S4, nộp wireframe 21/12/2026.
   Căn cứ: spec M8 §3.2: Owner, Admin, Manager tạo/sửa/xóa mẫu dùng chung của workspace; Sales, Support chỉ dùng trong Hộp thư (gõ /).
   Biến Đợt 1: tên khách, tên nhân viên, tên công ty, SĐT công ty. Tìm theo tên/tag, sắp theo số lần dùng, xem trước với dữ liệu
   mẫu. Biến thiếu dữ liệu: Hộp thư hiện ô trống để điền, không gửi {{…}} ra khách (inbox.js, fillTemplate). Chỉ chữ thuần (T2). */
const { h } = Proto;

const VARS = [['ten_khach', 'Tên khách', 'Nguyễn Văn An'], ['ten_nhan_vien', 'Tên nhân viên', 'Trần Thu'], ['ten_cong_ty', 'Tên công ty', 'Gani Foods'], ['sdt_cong_ty', 'SĐT công ty', null]];
const TEMPLATES = [
  { id: 'q1', key: 'chao-hoi', text: 'Chào {{ten_khach}}, em là {{ten_nhan_vien}} từ {{ten_cong_ty}}. Em hỗ trợ được gì ạ?', tags: ['Chào hỏi'], uses: 412 },
  { id: 'q2', key: 'xin-sdt', text: 'Anh/chị cho em xin số điện thoại để bộ phận kinh doanh gọi lại ạ.', tags: ['Thu thập thông tin'], uses: 268 },
  { id: 'q3', key: 'hotline', text: 'Anh/chị cần gấp có thể gọi {{sdt_cong_ty}}, em là {{ten_nhan_vien}} ạ.', tags: ['Liên hệ'], uses: 97 },
  { id: 'q4', key: 'cam-on', text: 'Cảm ơn {{ten_khach}} đã liên hệ {{ten_cong_ty}} ạ.', tags: ['Chào hỏi', 'Kết thúc'], uses: 151 },
];
const KEY_RULE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const VAR_RE = /\{\{(\w+)\}\}/g;
const label = (key) => VARS.find(([k]) => k === key)?.[1];

/* Xem trước: mỗi biến thay bằng dữ liệu mẫu; biến không có dữ liệu hiện thành ô trống như Hộp thư sẽ hỏi. */
function preview(text) {
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(VAR_RE)) {
    parts.push(text.slice(last, m.index));
    const sample = VARS.find(([k]) => k === m[1])?.[2];
    parts.push(sample ? h('strong', {}, sample) : h('span', { class: 'var-blank' }, `[${label(m[1]) ?? m[1]}: người gửi điền]`));
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return parts;
}

function problemsOf(key, text, editing) {
  if (!KEY_RULE.test(key)) return 'Tên ngắn chỉ gồm chữ thường không dấu, số và dấu gạch ngang (vd. chao-hoi).';
  if (TEMPLATES.some((t) => t.key === key && t !== editing)) return `Đã có mẫu /${key}.`;
  if (!text.trim()) return 'Nhập nội dung mẫu.';
  const unknown = [...text.matchAll(VAR_RE)].map((m) => m[1]).filter((k) => !label(k));
  if (unknown.length) return `Biến không có ở Đợt 1: ${unknown.map((k) => `{{${k}}}`).join(', ')}.`;
  return null;
}

function editor(editing) {
  const key = h('input', { id: 'qr-key', class: 'input', value: editing?.key ?? '', autocomplete: 'off', autofocus: true });
  const text = h('textarea', { id: 'qr-text', class: 'input', rows: 4 }, editing?.text ?? '');
  const tags = h('input', { id: 'qr-tags', class: 'input', value: editing?.tags.join(', ') ?? '' });
  const shown = h('p', { class: 'preview', 'aria-live': 'polite' });
  const err = h('div', { class: 'field-error', role: 'alert' });
  const refresh = () => shown.replaceChildren(...(text.value ? preview(text.value) : [h('span', { class: 'muted' }, 'Gõ nội dung để xem trước.')]));
  text.addEventListener('input', refresh);
  refresh();
  const insert = (k) => {
    text.setRangeText(`{{${k}}}`, text.selectionStart, text.selectionEnd, 'end');
    text.focus();
    refresh();
  };
  Proto.dialog(editing ? `Sửa mẫu /${editing.key}` : 'Tạo mẫu trả lời', h('div', { class: 'stack' },
    h('div', { class: 'field' }, h('label', { for: 'qr-key' }, 'Tên ngắn (gõ sau / trong Hộp thư)'), key),
    h('div', { class: 'field' }, h('label', { for: 'qr-text' }, 'Nội dung'), text),
    h('div', { class: 'row', role: 'group', 'aria-label': 'Chèn biến' }, h('span', { class: 'small muted' }, 'Chèn biến:'),
      VARS.map(([k, name]) => h('button', { class: 'btn', type: 'button', onclick: () => insert(k) }, name))),
    h('div', { class: 'field' }, h('label', { for: 'qr-tags' }, 'Tag (cách nhau bằng dấu phẩy)'), tags),
    h('div', { class: 'card stack' }, h('h3', {}, 'Xem trước với dữ liệu mẫu'), shown,
      h('p', { class: 'small muted' }, 'Ô trống: biến chưa có dữ liệu (ở đây SĐT công ty chưa cài). Hộp thư bắt người gửi điền, không bao giờ gửi {{…}} ra khách.')),
    err), (close) => [
    h('button', { class: 'btn', onclick: close }, 'Hủy'),
    h('button', { class: 'btn primary', onclick: (e) => {
      const problem = problemsOf(key.value.trim(), text.value, editing);
      err.replaceChildren(problem ?? '');
      if (problem) return;
      Proto.serverAction(e.currentTarget, 'Lưu mẫu', () => {
        if (Proto.state() === 'save_error') {
          err.replaceChildren(h('p', {}, 'Không lưu được mẫu.'), h('p', { class: 'trace muted' }, 'Mã: 7f3a9c1e-…'), h('button', { class: 'btn', onclick: () => Proto.toast('Thử lại: gửi lại cùng Idempotency-Key.') }, 'Thử lại'));
          return;
        }
        close();
        Proto.toast(`Đã lưu mẫu /${key.value.trim()}. Dùng được ngay trong Hộp thư, không cần tải lại trang.`);
      });
    } }, 'Lưu mẫu'),
  ]);
}

function remove(t) {
  Proto.dialog(`Xóa mẫu /${t.key}?`, h('p', {}, 'Mẫu biến mất khỏi Hộp thư của mọi người trong workspace. Tin đã gửi không đổi.'), (close) => [
    h('button', { class: 'btn', onclick: close }, 'Hủy'),
    h('button', { class: 'btn primary', onclick: (e) => Proto.serverAction(e.currentTarget, 'Xóa mẫu', () => { close(); Proto.toast(`Đã xóa mẫu /${t.key}.`); }) }, 'Xóa mẫu'),
  ]);
}

function list() {
  const q = Proto.get('q', '').toLowerCase();
  const sort = Proto.get('sort', 'uses');
  const rows = TEMPLATES
    .filter((t) => !q || t.key.includes(q) || t.tags.some((g) => g.toLowerCase().includes(q)))
    .sort((a, b) => (sort === 'name' ? a.key.localeCompare(b.key) : b.uses - a.uses));
  const search = h('input', { id: 'qr-search', class: 'input', type: 'search', value: Proto.get('q', ''), placeholder: 'Tên hoặc tag' });
  search.addEventListener('change', () => Proto.set('q', search.value));
  return h('div', { class: 'stack' },
    h('div', { class: 'row' },
      h('div', { class: 'field' }, h('label', { for: 'qr-search' }, 'Tìm mẫu'), search),
      h('div', { class: 'field' }, h('label', { for: 'qr-sort' }, 'Sắp xếp'),
        h('select', { id: 'qr-sort', class: 'input', onchange: (e) => Proto.set('sort', e.target.value) },
          h('option', { value: 'uses', selected: sort === 'uses' }, 'Dùng nhiều nhất'), h('option', { value: 'name', selected: sort === 'name' }, 'Tên A–Z')))),
    rows.length === 0 ? h('p', { class: 'muted' }, `Không có mẫu khớp "${Proto.get('q', '')}".`) : h('table', { class: 'plain' },
      h('thead', {}, h('tr', {}, ['Tên ngắn', 'Nội dung', 'Tag', 'Lần dùng (30 ngày)', ''].map((c) => h('th', {}, c || h('span', { class: 'sr-only' }, 'Thao tác'))))),
      h('tbody', {}, rows.map((t) => h('tr', {},
        h('td', {}, h('code', {}, `/${t.key}`)),
        h('td', { style: 'max-width:420px' }, t.text),
        h('td', {}, t.tags.map((g) => h('span', { class: 'badge' }, g))),
        h('td', {}, String(t.uses)),
        h('td', {}, h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => editor(t), 'aria-label': `Sửa /${t.key}` }, 'Sửa'),
          h('button', { class: 'btn', onclick: () => remove(t), 'aria-label': `Xóa /${t.key}` }, 'Xóa'))))))));
}

Proto.mount({
  page: 'quick-replies',
  states: [['normal', 'Bình thường'], ['loading', 'Đang tải'], ['empty', 'Trống'], ['error', 'Lỗi tải'], ['save_error', 'Lỗi khi lưu'], ['aioff', 'AI tắt — Không áp dụng']],
  render: () => {
    if (!['owner', 'admin', 'manager'].includes(Proto.role())) {
      const where = Proto.can('inbox.view') ? 'inbox.html' : 'customer.html';
      return h('div', { class: 'page-body' }, Proto.noAccess('Mẫu trả lời nhanh (Owner, Admin, Manager; Sales, Support dùng mẫu trong Hộp thư bằng /)', where));
    }
    const s = Proto.state();
    let body;
    if (s === 'loading') body = Proto.loading(5);
    else if (s === 'error') body = Proto.error('Không tải được danh sách mẫu.');
    else if (s === 'empty') body = Proto.empty('Chưa có mẫu trả lời.', 'Tạo mẫu đầu tiên', () => editor(null));
    else body = list();
    return h('div', { class: 'main' },
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', {}, 'Mẫu trả lời nhanh'), h('p', { class: 'small muted' }, 'Workspace Gani Foods B2B · Mẫu dùng chung; trong Hộp thư gõ / để chọn.')),
        s === 'empty' ? null : h('button', { class: 'btn primary', onclick: () => editor(null) }, 'Tạo mẫu')),
      Proto.noAiNote(),
      h('div', { class: 'page-body stack' }, h('div', { class: 'card', style: 'overflow:auto' }, body)));
  },
});
