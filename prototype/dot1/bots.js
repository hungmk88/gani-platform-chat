/* global Proto, setTimeout */
/* Trình dựng bot dạng form (Brief UI §5.6, Backend P13; U16: không có canvas ở Đợt 1). */
const { h } = Proto;

const TYPES = {
  trigger: 'Bắt đầu',
  message: 'Gửi tin',
  question: 'Hỏi và chờ trả lời',
  condition: 'Rẽ nhánh',
  set_variable: 'Ghi biến',
  tag: 'Gắn tag',
  api_call: 'Gọi tool nội bộ',
  delay: 'Chờ',
  handoff: 'Chuyển người',
  jump_to_flow: 'Chuyển sang flow khác',
  end: 'Kết thúc',
};
const TOOLS = ['tra_khach_theo_sdt', 'kiem_tra_gio_lam_viec'];

function greetingFlow() {
  return [
    { type: 'trigger', on: 'Tin đầu tiên' },
    { type: 'message', text: 'Chào anh/chị, cảm ơn đã nhắn cho Gani Foods. Em có thể hỗ trợ gì ạ?', greeting: true },
    { type: 'question', text: 'Anh/chị cho em xin số điện thoại ạ?', kind: 'SĐT (+84)', variable: 'sdt' },
    { type: 'api_call', tool: 'tra_khach_theo_sdt', onError: 'Thử lại 1 lần rồi chuyển người' },
    { type: 'condition', variable: 'khach_hien_huu', op: 'bằng', value: 'có', then: 6, otherwise: 7 },
    { type: 'tag', value: 'Khách mới' },
    { type: 'handoff', reason: 'Khách hiện hữu cần nhân viên', priority: 'Cao' },
    { type: 'jump_to_flow', flow: 'Thu nhu cầu' },
  ];
}

const flows = [
  { id: 'f1', name: 'Chào — Zalo OA', required: true, published: 3, draft: true, steps: greetingFlow() },
  { id: 'f2', name: 'Ngoài giờ', required: false, published: 2, draft: false, steps: [{ type: 'trigger', on: 'Ngoài giờ' }, { type: 'message', text: 'Ngoài giờ làm việc. Anh/chị để lại lời nhắn, chúng tôi gọi lại lúc 8:00.' }, { type: 'question', text: 'Anh/chị muốn được gọi lại lúc nào?', kind: 'Lựa chọn', variable: 'gio_goi_lai' }, { type: 'end' }] },
  { id: 'f3', name: 'Thu nhu cầu', required: false, published: 0, draft: true, steps: [{ type: 'trigger', on: 'Chuyển từ flow khác' }, { type: 'question', text: 'Anh/chị quan tâm sản phẩm nào?', kind: 'Lựa chọn', variable: 'nhu_cau' }, { type: 'handoff', reason: 'Đã thu nhu cầu', priority: 'Thường' }] },
];
const versions = [['v3', 'Đã xuất bản 10/10/2026 · Admin Gani'], ['v2', 'Đã xuất bản 02/10/2026 · Manager Sales'], ['v1', 'Đã xuất bản 25/09/2026 · Admin Gani']];
let selected = 'f1';
let appliedState = null;

function flow() {
  return flows.find((f) => f.id === selected);
}

function applyState() {
  // Mỗi lần đổi trạng thái prototype, dựng lại flow chào để trạng thái lỗi hiện đúng.
  const s = Proto.state();
  if (s === appliedState) return;
  appliedState = s;
  const f1 = flows[0];
  f1.steps = greetingFlow();
  if (s === 'config_error') f1.steps[2].text = '';
  if (s === 'missing_greeting') f1.steps.splice(1, 1);
}

function errors(f) {
  const list = [];
  f.steps.forEach((st, i) => {
    if ((st.type === 'message' || st.type === 'question') && !st.text.trim()) list.push({ index: i, text: `Bước ${i + 1}: chưa có nội dung tin.` });
  });
  if (f.required && !f.steps.some((st) => st.greeting)) list.push({ index: -1, text: 'Flow chào của kênh Zalo OA phải có câu chào bắt buộc — chặn xuất bản.' });
  return list;
}

function field(label, control) {
  return h('div', { class: 'field' }, h('label', {}, label), control);
}
function input(st, key, attrs = {}) {
  return h('input', { class: 'input', value: st[key] ?? '', ...attrs, oninput: (e) => { st[key] = e.target.value; } });
}
function choice(st, key, options) {
  return h('select', { class: 'input', onchange: (e) => { st[key] = e.target.value; } }, options.map((o) => h('option', { selected: st[key] === o }, o)));
}

function stepFields(st, i, f, readOnly) {
  const lock = readOnly ? { disabled: true } : {};
  switch (st.type) {
    case 'trigger':
      return field('Khi nào bắt đầu', choice(st, 'on', ['Tin đầu tiên', 'Từ khóa', 'Ý định', 'Ngoài giờ', 'Chuyển từ flow khác']));
    case 'message':
    case 'question': {
      const missing = !st.text.trim();
      return [
        field(st.type === 'message' ? 'Nội dung tin (biến: {{customer.name}})' : 'Câu hỏi', h('textarea', { class: `input${missing ? ' invalid' : ''}`, rows: 2, ...lock, oninput: (e) => { st.text = e.target.value; } }, st.text)),
        missing ? h('p', { class: 'field-error' }, 'Nhập nội dung trước khi xuất bản.') : null,
        st.greeting ? h('p', { class: 'small muted' }, 'Câu chào bắt buộc của kênh. Khi bật AI trả lời khách (Đợt 2), câu này phải có "trợ lý AI của [thương hiệu]" (§28).') : null,
        st.type === 'question' ? h('div', { class: 'row' }, field('Kiểu trả lời', choice(st, 'kind', ['Văn bản', 'SĐT (+84)', 'Số', 'Lựa chọn'])), field('Lưu vào biến', input(st, 'variable', lock))) : null,
      ];
    }
    case 'condition':
      return h('div', { class: 'stack' },
        h('div', { class: 'row' }, h('strong', {}, 'Nếu'), input(st, 'variable', { 'aria-label': 'Biến', ...lock }), choice(st, 'op', ['bằng', 'khác', 'chứa']), input(st, 'value', { 'aria-label': 'Giá trị', ...lock })),
        h('div', { class: 'branch row' }, h('strong', {}, 'Thì'), 'đi tới', h('select', { class: 'input', 'aria-label': 'Bước khi đúng' }, f.steps.map((_, k) => h('option', { selected: k + 1 === st.then }, `Bước ${k + 1}`)))),
        h('div', { class: 'branch row' }, h('strong', {}, 'Ngược lại'), 'đi tới', h('select', { class: 'input', 'aria-label': 'Bước khi sai' }, f.steps.map((_, k) => h('option', { selected: k + 1 === st.otherwise }, `Bước ${k + 1}`)))));
    case 'set_variable':
      return h('div', { class: 'row' }, field('Biến', input(st, 'variable', lock)), field('Giá trị', input(st, 'value', lock)));
    case 'tag':
      return field('Tag', input(st, 'value', lock));
    case 'api_call':
      return [
        field('Tool đã đăng ký (không nhập URL tự do)', choice(st, 'tool', TOOLS)),
        h('p', { class: 'small muted' }, 'Thời gian chờ 5 giây.'),
        h('div', { class: 'branch stack' }, h('strong', {}, 'Nếu lỗi (D15)'), choice(st, 'onError', ['Thử lại 1 lần rồi chuyển người', 'Chuyển người ngay', 'Đi tới bước khác'])),
      ];
    case 'delay':
      return field('Chờ (phút) — chỉ trong khung gửi của kênh', input(st, 'minutes', { type: 'number', min: 1, ...lock }));
    case 'handoff':
      return h('div', { class: 'row' }, field('Lý do', input(st, 'reason', lock)), field('Mức ưu tiên', choice(st, 'priority', ['Thường', 'Cao'])));
    case 'jump_to_flow':
      return [field('Flow đích (giữ biến phiên)', choice(st, 'flow', flows.map((x) => x.name)))];
    default:
      return h('p', { class: 'small muted' }, 'Kết thúc phiên bot.');
  }
}

function stepCard(st, i, f, errIdx, readOnly) {
  const moveBy = (d) => { const j = i + d; if (j < 0 || j >= f.steps.length) return; [f.steps[i], f.steps[j]] = [f.steps[j], f.steps[i]]; Proto.render(); };
  const summary = st.type === 'message' || st.type === 'question' ? st.text || '(trống)' : st.on || st.tool || st.value || st.reason || st.flow || '';
  return h('details', { class: `step${errIdx.includes(i) ? ' has-error' : ''}`, open: errIdx.includes(i) || i < 2 },
    h('summary', {}, h('strong', {}, `${i + 1}. ${TYPES[st.type]}`), h('span', { class: 'muted small', style: 'overflow:hidden;white-space:nowrap;text-overflow:ellipsis;flex:1' }, summary), errIdx.includes(i) ? h('span', { class: 'badge error' }, 'Lỗi cấu hình') : null),
    h('div', { class: 'body' }, stepFields(st, i, f, readOnly),
      readOnly ? null : h('div', { class: 'row' },
        h('button', { class: 'btn', 'aria-label': `Đưa bước ${i + 1} lên`, onclick: () => moveBy(-1) }, 'Lên'),
        h('button', { class: 'btn', 'aria-label': `Đưa bước ${i + 1} xuống`, onclick: () => moveBy(1) }, 'Xuống'),
        h('button', { class: 'btn', onclick: () => { f.steps.splice(i, 1); Proto.render(); } }, 'Xóa bước'))));
}

function addStep(f) {
  const picker = h('select', { class: 'input', 'aria-label': 'Loại bước' }, Object.entries(TYPES).filter(([k]) => k !== 'trigger').map(([k, v]) => h('option', { value: k }, v)));
  return h('div', { class: 'row' }, picker, h('button', { class: 'btn', onclick: () => { f.steps.push({ type: picker.value, text: '', value: '', reason: '', tool: TOOLS[0], onError: 'Thử lại 1 lần rồi chuyển người' }); Proto.render(); } }, 'Thêm bước'),
    h('span', { class: 'small muted' }, 'Không kéo-thả; sắp xếp bằng nút Lên/Xuống. Bước "Trả lời bằng AI" thuộc Đợt 2.'));
}

function dryRun(f) {
  const out = h('div', { class: 'test-panel', 'aria-live': 'polite' });
  const scenario = h('select', { class: 'input', 'aria-label': 'Kịch bản mẫu' }, ['Khách nhắn trong giờ', 'Khách nhắn ngoài giờ', 'Tool lỗi'].map((s) => h('option', {}, s)));
  const run = () => {
    out.replaceChildren();
    const failTool = scenario.value === 'Tool lỗi';
    f.steps.forEach((st, i) => setTimeout(() => {
      let line = `${i + 1}. ${TYPES[st.type]}`;
      if (st.type === 'message' || st.type === 'question') line += `: “${st.text || '(trống)'}”`;
      if (st.type === 'api_call') line += failTool ? ': lỗi → thử lại 1 lần → lỗi → chuyển người' : ': trả về kết quả';
      out.append(h('div', { class: `msg ${st.type === 'message' || st.type === 'question' ? 'bot' : 'system'}`, style: 'max-width:100%' }, line));
    }, 250 * (i + 1)));
  };
  Proto.dialog(`Chạy thử — ${f.name}`, h('div', { class: 'stack' }, h('p', { class: 'small muted' }, 'Chạy trên kịch bản mẫu, không gửi tin thật (D2).'), h('div', { class: 'row' }, scenario, h('button', { class: 'btn', onclick: run }, 'Chạy')), out), (close) => [h('button', { class: 'btn', onclick: close }, 'Đóng')]);
}

function publish(f) {
  const errs = errors(f);
  if (errs.length) {
    Proto.dialog('Chưa xuất bản được', h('ul', {}, errs.map((e) => h('li', {}, e.text))), (close) => [h('button', { class: 'btn', onclick: close }, 'Sửa lại')]);
    return;
  }
  const next = f.published + 1;
  Proto.dialog(`Xuất bản v${next}?`, h('p', {}, 'Bản đã xuất bản không sửa được. Hội thoại đang chạy giữ phiên bản cũ đến khi kết thúc. Thao tác ghi audit.'), (close) => [
    h('button', { class: 'btn', onclick: close }, 'Hủy'),
    h('button', { class: 'btn primary', onclick: (e) => Proto.serverAction(e.currentTarget, 'Xuất bản', () => {
      f.published = next;
      f.draft = false;
      if (f.id === 'f1') versions.unshift([`v${next}`, 'Đã xuất bản vừa xong · Bạn']);
      close();
      Proto.toast(`Đã xuất bản ${f.name} v${next}.`);
      Proto.render();
    }) }, 'Xuất bản'),
  ]);
}

function editor() {
  const f = flow();
  const readOnly = Proto.state() === 'published_view';
  const errs = errors(f);
  const errIdx = errs.map((e) => e.index);
  return h('div', { class: 'stack' },
    h('div', { class: 'spread' },
      h('div', {}, h('h2', {}, f.name), h('div', { class: 'row' },
        f.required ? h('span', { class: 'badge outline' }, 'Flow chào bắt buộc') : null,
        h('span', { class: 'badge outline' }, readOnly ? `Đang xem v${f.published} — không sửa được` : f.draft ? 'Nháp' : `Đã xuất bản v${f.published}`),
        h('span', { class: 'small muted' }, 'Mẫu: B2B Sales (D3)'))),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => dryRun(f) }, 'Chạy thử'),
        readOnly
          ? h('button', { class: 'btn primary', onclick: () => { Proto.set('state', 'normal'); Proto.toast('Đã tạo bản nháp mới từ bản đã xuất bản.'); } }, 'Tạo bản nháp mới')
          : h('button', { class: 'btn primary', onclick: () => publish(f) }, 'Xuất bản'))),
    errs.length ? h('div', { class: 'banner error', role: 'alert', style: 'border-radius:var(--r-input)' }, h('strong', {}, 'Chặn xuất bản: '), errs.map((e) => e.text).join(' ')) : null,
    f.steps.map((st, i) => stepCard(st, i, f, errIdx, readOnly)),
    readOnly ? null : addStep(f),
    f.id === 'f1' ? h('section', { class: 'card stack' }, h('h3', {}, 'Lịch sử phiên bản'), h('table', { class: 'plain' }, versions.map(([v, t]) => h('tr', {}, h('td', {}, v), h('td', {}, t), h('td', {}, h('button', { class: 'btn link', onclick: () => Proto.set('state', 'published_view') }, 'Xem'))))), h('p', { class: 'small muted' }, 'Không so sánh khác biệt giữa 2 phiên bản (§5.6); so sánh bằng kết quả chạy thử cùng kịch bản.')) : null);
}

function body() {
  const s = Proto.state();
  if (s === 'loading') return h('div', { class: 'bots' }, h('div', { class: 'card' }, Proto.loading(4)), h('div', { class: 'card' }, Proto.loading(10)));
  if (s === 'error') return h('div', { class: 'card' }, Proto.error('Không tải được danh sách flow.'));
  if (s === 'empty') return h('div', { class: 'card' }, Proto.empty('Workspace chưa có flow nào.', 'Tạo từ mẫu B2B Sales', () => Proto.toast('Đã tạo flow mặc định theo mẫu (D3).')));
  return h('div', { class: 'bots' },
    h('nav', { class: 'card flow-list stack', 'aria-label': 'Danh sách flow' }, h('h2', {}, 'Flow'),
      flows.map((f) => h('button', { 'aria-current': String(f.id === selected), onclick: () => { selected = f.id; Proto.render(); } }, h('strong', {}, f.name), h('br', {}), h('span', { class: 'small muted' }, f.published ? `v${f.published}${f.draft ? ' · có nháp' : ''}` : 'Chưa xuất bản'))),
      h('p', { class: 'small muted' }, 'Mỗi kênh có 1 flow chào bắt buộc.'),
      h('p', { class: 'small' }, 'Giờ làm việc (D4): ', h('span', { class: 'pending-spec' }, 'chờ spec M8 + Q7'))),
    h('div', {}, editor()));
}

Proto.mount({
  page: 'bots',
  states: [['normal', 'Bình thường'], ['loading', 'Đang tải'], ['empty', 'Trống'], ['error', 'Lỗi'], ['aioff', 'AI tắt'], ['config_error', 'Lỗi cấu hình node'], ['missing_greeting', 'Thiếu câu chào bắt buộc'], ['published_view', 'Xem bản đã xuất bản']],
  render: () => {
    if (!Proto.can('bot.edit')) return Proto.noAccess('Trình dựng bot', 'customer.html');
    applyState();
    return h('div', { class: 'main' },
      h('div', { class: 'page-head' }, h('div', {}, h('p', { class: 'small muted' }, 'Tự động hóa ›'), h('h1', {}, 'Trình dựng bot')), h('span', { class: 'badge outline' }, 'Dạng form — canvas hoãn Đợt 2')),
      Proto.state() === 'aioff' ? h('div', { class: 'banner info', role: 'note' }, 'Trạng thái AI tắt: Không áp dụng AI — bot kịch bản chạy bình thường. Bước "Trả lời bằng AI" (D5) thuộc Đợt 2.') : null,
      h('div', { class: 'page-body' }, body()));
  },
});
