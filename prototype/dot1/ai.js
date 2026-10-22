/* global Proto */
/* #26 AI nội bộ (danh-sach-man-M11; E1, E4, E5, E7, E20, L1). Sprint S5, nộp wireframe 04/01/2027.
   Căn cứ: Phụ lục B (bật/tắt AI nội bộ, ngân sách: Owner, Admin; chuyển AI sang Production: chỉ Owner), endpoint
   `GET/PATCH /v1/workspaces/{id}/ai-settings` (Brief, phụ lục kỹ thuật), Brief P11 (PII masking từ đợt 1; ngân sách: cảnh báo
   80%, chặn 100% → flow kịch bản; router theo tầng, dự phòng khác hãng), P22-Q1 (không bật production khi chưa có văn bản
   pháp lý), quy tắc 29 (AI nội bộ đợt 1 không gửi khách). E20 chưa có định nghĩa trong danh-sach-109: chờ U35. */
const { h } = Proto;

const INTENTS = ['Hỏi giá', 'Đặt hàng', 'Hỏi giao hàng', 'Khiếu nại', 'Hỏi sản phẩm', 'Khác'];
const MASKED = [['Họ tên người', '[NAME_1]'], ['SĐT', '[PHONE_1]'], ['Email', '[EMAIL_1]'], ['Địa chỉ chi tiết', '[ADDRESS_1]'], ['Mã số thuế', '[TAX_ID_1]'], ['Số tài khoản', '[BANK_1]'], ['CCCD, giấy tờ', '[ID_1]'], ['Ngày sinh', '[DOB_1]']];
const pending = (text) => h('span', { class: 'pending-spec' }, text);
const isOwner = () => Proto.role() === 'owner';
const state = () => Proto.state();
const used = () => ({ budget_80: 84, budget_100: 100 })[state()] ?? 37;

function environment() {
  const legal = state() === 'legal_ok';
  const env = Proto.get('env', 'staging');
  const reason = !isOwner() ? 'Chỉ Owner chuyển sang Production (Phụ lục B).' : !legal ? 'Chưa có văn bản ý kiến pháp lý về gửi dữ liệu cho nhà cung cấp AI ở nước ngoài (Q1): chưa bật được ở Production.' : null;
  return h('section', { class: 'card stack' }, h('h2', {}, 'Môi trường'),
    h('p', {}, 'Đang chạy: ', h('strong', {}, env === 'production' ? 'Production' : 'Staging (dữ liệu giả)')),
    env === 'production' ? null : h('div', { class: 'row' },
      h('button', { class: 'btn', disabled: Boolean(reason), onclick: () => Proto.dialog('Chuyển AI nội bộ sang Production?', h('p', {}, 'Nội dung hội thoại (đã che dữ liệu cá nhân) sẽ được gửi cho nhà cung cấp AI. Ghi audit.'), (close) => [
        h('button', { class: 'btn', onclick: close }, 'Hủy'),
        h('button', { class: 'btn primary', onclick: (e) => Proto.serverAction(e.currentTarget, 'Chuyển sang Production', () => { close(); Proto.set('env', 'production'); }) }, 'Chuyển sang Production'),
      ]) }, 'Chuyển sang Production…'),
      reason ? h('span', { class: 'small muted', id: 'env-reason' }, reason) : null));
}

function features() {
  const off = state() === 'aioff';
  const row = (id, title, text) => h('label', { class: 'row' }, h('input', { type: 'checkbox', id, checked: !off, onchange: (e) => Proto.toast(`${title}: ${e.target.checked ? 'bật' : 'tắt'}. Có hiệu lực dưới 10 giây, ghi audit.`) }), h('span', {}, h('strong', {}, title), h('br', {}), h('span', { class: 'small muted' }, text)));
  return h('section', { class: 'card stack' }, h('h2', {}, 'Tính năng (chỉ cho nhân viên)'),
    row('ai-e1', 'Phân loại ý định, trích thông tin (E1)', 'Gắn tag ý định và gợi ý sản phẩm, số lượng, khu vực trong Hộp thư.'),
    row('ai-l1', 'Tóm tắt hội thoại (L1)', 'Nút "Tóm tắt" trong Hộp thư.'),
    h('p', { class: 'small muted' }, 'Đợt 1 AI không trả lời khách: cờ ai.customer_reply luôn tắt. Tắt cả hai thì tag gắn bằng luật, không có tóm tắt.'));
}

function budget() {
  const pct = used();
  const err = h('p', { class: 'field-error', role: 'alert' });
  const input = h('input', { id: 'ai-budget', class: 'input', type: 'number', min: 1, value: '200' });
  const tone = pct >= 100 ? 'error' : pct >= 80 ? 'warn' : '';
  return h('section', { class: 'card stack' }, h('h2', {}, 'Ngân sách tháng (E5)'),
    pct >= 100 ? h('div', { class: 'banner warn', role: 'status' }, 'Đã dùng hết ngân sách tháng: AI nội bộ dừng, hội thoại theo flow kịch bản (ai_budget_exceeded). Tăng ngân sách hoặc chờ sang tháng.')
      : pct >= 80 ? h('div', { class: 'banner warn', role: 'status' }, `Đã dùng ${pct}% ngân sách: đã gửi email cho quản lý workspace và CEO.`) : null,
    h('div', { class: 'field' }, h('label', { for: 'ai-budget' }, 'Ngân sách tháng (USD) — chủ đầu tư cấu hình theo workspace'), input),
    h('div', {}, h('progress', { max: 100, value: Math.min(pct, 100), 'aria-label': 'Đã dùng trong tháng' }), ' ', h('span', { class: `badge ${tone}` }, `Đã dùng ${pct}%`)),
    h('p', { class: 'small muted' }, 'Cảnh báo ở 80%, dừng ở 100%. Số đã dùng do API tính từ nhật ký sử dụng, không tính ở trình duyệt. Số trên màn là số mẫu.'),
    err,
    h('div', {}, h('button', { class: 'btn primary', onclick: (e) => {
      const n = Number(input.value);
      err.textContent = Number.isFinite(n) && n > 0 ? '' : 'Ngân sách là số lớn hơn 0.';
      if (n > 0) Proto.serverAction(e.currentTarget, 'Lưu ngân sách', () => Proto.toast('Đã lưu ngân sách. Ghi audit.'));
    } }, 'Lưu ngân sách')));
}

function readOnly() {
  return h('section', { class: 'card stack' }, h('h2', {}, 'Chỉ đọc'),
    h('h3', {}, 'Ý định AI phân loại (E1)'), h('p', {}, INTENTS.map((i) => h('span', { class: 'badge' }, i))), h('p', { class: 'small muted' }, 'Theo mẫu workspace; ', pending('danh sách chốt cùng Backend')),
    h('h3', {}, 'Che dữ liệu cá nhân trước khi gửi (E7)'),
    h('table', { class: 'plain' }, h('thead', {}, h('tr', {}, h('th', {}, 'Dữ liệu'), h('th', {}, 'Gửi đi dạng'))), h('tbody', {}, MASKED.map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', {}, h('code', {}, v)))))),
    h('p', { class: 'small muted' }, 'Không che tên quán, doanh nghiệp (cần cho báo giá B2B). Luôn bật, không tắt được ở đây.'),
    h('h3', {}, 'Chọn model (E4)'),
    h('p', {}, 'Tầng nhỏ cho phân loại, tầng vừa cho tóm tắt; chậm quá ngưỡng hoặc lỗi thì chuyển nhà cung cấp dự phòng khác hãng. Đổi bằng cấu hình, không ở màn này.'),
    h('h3', {}, 'E20'), h('p', {}, pending('mã chưa có định nghĩa trong danh sách 109 tính năng: chờ U35')));
}

Proto.mount({
  page: 'ai',
  states: [['normal', 'Bình thường'], ['loading', 'Đang tải'], ['error', 'Lỗi'], ['aioff', 'AI tắt'], ['budget_80', 'Ngân sách ≥ 80%'], ['budget_100', 'Hết ngân sách'], ['legal_ok', 'Đã có văn bản pháp lý (Q1)']],
  render: () => {
    if (!['owner', 'admin'].includes(Proto.role())) {
      return h('div', { class: 'page-body' }, Proto.noAccess('AI nội bộ (Owner, Admin)', Proto.can('inbox.view') ? 'inbox.html' : 'customers.html'));
    }
    const s = state();
    const body = s === 'loading' ? h('div', { class: 'card' }, Proto.loading(6)) : s === 'error' ? h('div', { class: 'card' }, Proto.error('Không tải được cài đặt AI.')) : [environment(), features(), budget(), readOnly()];
    return h('div', { class: 'main' },
      h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'AI nội bộ'), h('p', { class: 'small muted' }, 'Workspace Gani Foods B2B · AI hỗ trợ nhân viên, không nói chuyện với khách ở Đợt 1.'))),
      Proto.aiOffBanner('Admin tắt AI nội bộ'),
      h('div', { class: 'page-body stack', style: 'max-width:880px' }, body));
  },
});
