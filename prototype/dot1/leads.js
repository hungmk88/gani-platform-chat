/* global Proto, setTimeout */
/* Pipeline lead (Brief UI §6.3; U6: Thắng/Thua tách khỏi 6 bước). Dữ liệu là mẫu. */
const { h } = Proto;

const ME = 'Hà Linh';
const STAGES = ['Bước 1', 'Bước 2', 'Bước 3', 'Bước 4', 'Bước 5', 'Bước 6'];
const LOST_REASONS = ['Giá cao hơn đối thủ', 'Không đủ MOQ', 'Khách không phản hồi', 'Ngoài vùng giao', 'Lý do khác'];
const OWNERS = [ME, 'Trần Thu', 'Vũ Nam'];

function makeLeads(many) {
  const names = ['Quán Phở Hà Nội', 'Nhà hàng Sen', 'Đại lý Bình Minh', 'Bếp ăn Tân Phú', 'Cơm tấm Ba Ghiền', 'Chuỗi Bún Bò Huế', 'Siêu thị Mini 24h', 'Căn tin trường Lê Lợi', 'Khách sạn Hoa Mai', 'Quán Hủ Tiếu Nam Vang', 'Bếp Việt', 'Đại lý Phúc An', 'Nhà hàng Biển Xanh', 'Quán Mì Quảng'];
  const leads = names.map((company, i) => ({ id: `l${i}`, company, contact: ['An', 'Bình', 'Minh', 'Hoa', 'Nam'][i % 5], owner: OWNERS[i % 3], stage: STAGES[i % 6], status: 'open', last: `${(i % 9) + 1}/10`, days: (i * 3) % 11, source: 'Zalo OA' }));
  if (many) for (let i = 0; i < 26; i += 1) leads.push({ id: `m${i}`, company: `Khách thử ${i + 1}`, contact: 'Khách', owner: OWNERS[i % 3], stage: 'Bước 1', status: 'open', last: '10/10', days: i % 5, source: 'Zalo OA' });
  leads.push({ id: 'w1', company: 'Nhà hàng Đông Á', contact: 'Long', owner: ME, stage: 'Bước 6', status: 'won', last: '01/10', days: 0, source: 'Zalo OA' });
  leads.push({ id: 'x1', company: 'Quán Chay An Lạc', contact: 'Tâm', owner: 'Vũ Nam', stage: 'Bước 4', status: 'lost', reason: 'Không đủ MOQ', last: '28/09', days: 0, source: 'Zalo OA' });
  return leads;
}

let leads = makeLeads(false);
let seededFor = 'normal';
const view = { tab: 'open', owner: 'all' };

function canMove(lead) {
  if (!Proto.can('lead.change')) return false;
  return Proto.role() !== 'sales' || lead.owner === ME; // Sales: chỉ lead của mình
}

function move(lead, target, extra) {
  const from = { stage: lead.stage, status: lead.status };
  lead.busy = true; // chờ máy chủ, không cập nhật lạc quan (§2.4)
  Proto.render();
  setTimeout(() => {
    lead.busy = false;
    if (Proto.state() === 'save_error') {
      Object.assign(lead, from);
      Proto.toast(`Không lưu được — thẻ giữ ở ${from.stage}. Mã: 7f3a9c1e-… Thử lại sau.`);
    } else if (target === 'won' || target === 'lost') {
      lead.status = target;
      Object.assign(lead, extra);
      Proto.toast(target === 'won' ? `Đã đánh dấu Thắng: ${lead.company}` : `Đã đánh dấu Thua: ${lead.company} — ${extra.reason}`);
    } else {
      lead.stage = target;
    }
    Proto.render();
  }, 800);
}

function askLost(lead) {
  let reason = null;
  const err = h('p', { class: 'field-error', role: 'alert' });
  const body = h('div', { class: 'stack' },
    h('p', {}, `Chuyển "${lead.company}" sang Thua. Bắt buộc chọn lý do (G3).`),
    h('fieldset', { class: 'stack', style: 'border:0;padding:0;margin:0' }, h('legend', { class: 'small muted' }, 'Lý do Thua — danh sách tạm, chờ O1'),
      LOST_REASONS.map((r) => h('label', { class: 'row' }, h('input', { type: 'radio', name: 'lost', onchange: () => { reason = r; err.textContent = ''; } }), r))),
    err);
  Proto.dialog('Chọn lý do Thua', body, (close) => [
    h('button', { class: 'btn', onclick: close }, 'Hủy'),
    h('button', { class: 'btn primary', onclick: () => {
      if (!reason) { err.textContent = 'Chọn một lý do trước khi lưu.'; return; }
      close();
      move(lead, 'lost', { reason });
    } }, 'Lưu'),
  ]);
}

function requestMove(lead, target) {
  if (!canMove(lead) || lead.busy) return;
  if (target === 'lost') askLost(lead);
  else if (target !== lead.stage || lead.status !== 'open') move(lead, target, {});
}

function card(lead) {
  const movable = canMove(lead);
  const busy = lead.busy || (Proto.state() === 'saving' && lead.id === 'l2');
  return h('article', {
    class: 'lead-card stack', draggable: String(movable && !busy), 'aria-busy': String(Boolean(busy)), 'aria-disabled': String(!movable),
    title: movable ? 'Kéo để đổi bước' : 'Chỉ người phụ trách đổi bước',
    ondragstart: (e) => e.dataTransfer.setData('text/plain', lead.id),
  },
  h('div', { class: 'spread' }, h('strong', {}, lead.company), busy ? h('span', { class: 'row small muted' }, h('span', { class: 'spin', 'aria-hidden': 'true' }), 'Đang lưu…') : null),
  h('span', { class: 'small' }, `${lead.contact} · ${lead.owner}`),
  h('span', { class: 'small muted' }, `Liên hệ cuối ${lead.last} · ${lead.days} ngày ở bước này`),
  h('a', { class: 'small', href: `inbox.html?role=${Proto.role()}` }, `Nguồn: ${lead.source} · hội thoại gốc`),
  lead.status === 'lost' ? h('span', { class: 'badge error' }, `Thua — ${lead.reason}`) : null,
  lead.status === 'won' ? h('span', { class: 'badge ok' }, 'Thắng') : null,
  movable && lead.status === 'open' ? h('label', { class: 'small row' }, 'Chuyển tới',
    h('select', { class: 'input', 'aria-label': `Chuyển ${lead.company} tới`, disabled: busy, onchange: (e) => requestMove(lead, e.target.value) },
      STAGES.map((s) => h('option', { value: s, selected: s === lead.stage }, s)), h('option', { value: 'won' }, 'Thắng'), h('option', { value: 'lost' }, 'Thua…'))) : null);
}

function dropZone(target, attrs, ...children) {
  return h('div', {
    ...attrs,
    ondragover: (e) => { e.preventDefault(); e.currentTarget.classList.add('drop-target'); },
    ondragleave: (e) => e.currentTarget.classList.remove('drop-target'),
    ondrop: (e) => { e.preventDefault(); e.currentTarget.classList.remove('drop-target'); const lead = leads.find((l) => l.id === e.dataTransfer.getData('text/plain')); if (lead) requestMove(lead, target); },
  }, ...children);
}

function filtered() {
  return leads.filter((l) => view.owner === 'all' || l.owner === view.owner);
}

function column(stage) {
  const items = filtered().filter((l) => l.stage === stage && l.status === 'open');
  return dropZone(stage, { class: 'column', 'aria-label': stage },
    h('header', { class: 'spread' }, h('span', {}, h('strong', {}, stage), ' ', h('span', { class: 'pending-spec' }, 'tên tạm')), h('span', { class: 'badge' }, String(items.length))),
    h('div', { class: 'cards' }, items.length ? items.map(card) : h('p', { class: 'small muted', style: 'padding:var(--sp-2)' }, 'Chưa có lead')));
}

function terminalColumn(status, label) {
  const items = filtered().filter((l) => l.status === status);
  return dropZone(status, { class: 'column terminal', 'aria-label': label },
    h('header', { class: 'spread' }, h('strong', {}, label), h('span', { class: 'badge' }, String(items.length))),
    h('div', { class: 'cards' }, items.map(card)));
}

function board() {
  const variant = Proto.get('terminal', 'A');
  if (variant === 'A' && view.tab !== 'open') {
    const items = filtered().filter((l) => l.status === view.tab);
    return h('div', { class: 'stack' }, items.length ? h('div', { class: 'row', style: 'align-items:flex-start' }, items.map(card)) : Proto.empty(view.tab === 'won' ? 'Chưa có lead Thắng.' : 'Chưa có lead Thua.'));
  }
  return h('div', { class: 'stack' },
    h('div', { class: 'board' }, STAGES.map(column), variant === 'B' ? [terminalColumn('won', 'Thắng'), terminalColumn('lost', 'Thua')] : null),
    variant === 'A' ? h('div', { class: 'drop-bar', 'aria-label': 'Thả thẻ để kết thúc lead' }, dropZone('won', {}, 'Thả vào đây: Thắng'), dropZone('lost', {}, 'Thả vào đây: Thua (bắt buộc lý do)')) : null);
}

function filters() {
  const variant = Proto.get('terminal', 'A');
  return h('div', { class: 'row', style: 'margin-bottom:var(--sp-4)' },
    variant === 'A' ? h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Trạng thái lead' }, [['open', 'Đang mở'], ['won', 'Thắng'], ['lost', 'Thua']].map(([k, v]) => h('button', { role: 'tab', 'aria-selected': String(view.tab === k), onclick: () => { view.tab = k; Proto.render(); } }, v))) : null,
    h('label', { class: 'row small' }, 'Người phụ trách', h('select', { class: 'input', onchange: (e) => { view.owner = e.target.value; Proto.render(); } }, h('option', { value: 'all' }, 'Tất cả'), OWNERS.map((o) => h('option', { value: o, selected: view.owner === o }, o)))),
    h('label', { class: 'row small' }, 'Bước', h('select', { class: 'input' }, h('option', {}, 'Tất cả'), STAGES.map((s) => h('option', {}, s)))),
    h('label', { class: 'row small' }, 'Kênh nguồn', h('select', { class: 'input' }, h('option', {}, 'Zalo OA'))),
    h('label', { class: 'row small' }, 'Từ', h('input', { class: 'input', type: 'date' })),
    h('label', { class: 'row small' }, 'Đến', h('input', { class: 'input', type: 'date' })));
}

function body() {
  const s = Proto.state();
  if (s === 'loading') return h('div', { class: 'board' }, STAGES.map(() => h('div', { class: 'column', style: 'padding:var(--sp-3)' }, Proto.loading(5))));
  if (s === 'error') return h('div', { class: 'card' }, Proto.error('Không tải được pipeline.'));
  if (s === 'empty') return h('div', { class: 'card' }, Proto.empty('Chưa có lead. Lead tự tạo khi khách để SĐT hoặc hỏi giá.', Proto.can('lead.change') ? 'Tạo lead' : null, () => Proto.toast('Mở form tạo lead.')));
  return h('div', {}, filters(), board());
}

Proto.mount({
  page: 'leads',
  states: [['normal', 'Bình thường'], ['loading', 'Đang tải'], ['empty', 'Trống'], ['error', 'Lỗi'], ['aioff', 'AI tắt'], ['many', 'Cột nhiều thẻ'], ['saving', 'Đang lưu'], ['save_error', 'Lưu lỗi khi kéo']],
  variants: [{ label: 'Thắng/Thua', name: 'terminal', options: [['A', 'A — bộ lọc'], ['B', 'B — cột phụ']] }],
  render: () => {
    const wantMany = Proto.state() === 'many' ? 'many' : 'normal';
    if (wantMany !== seededFor) { leads = makeLeads(wantMany === 'many'); seededFor = wantMany; }
    return h('div', { class: 'main' },
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', {}, 'Pipeline lead'), h('p', { class: 'small muted' }, '6 bước dùng tên tạm "Bước 1–6", chờ O1. Thắng/Thua là trạng thái kết thúc riêng.')),
        Proto.can('lead.change') ? h('button', { class: 'btn primary', onclick: () => Proto.toast('Mở form tạo lead.') }, 'Tạo lead') : h('span', { class: 'badge outline' }, 'Chỉ xem')),
      Proto.noAiNote(),
      h('div', { class: 'page-body' }, body()));
  },
});
