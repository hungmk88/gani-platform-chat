/* global Proto, location */
/* #4 Nhận lời mời (Phụ lục C v3 dòng 8), theo N151 (22/10/2026): một bước. `/api/auth/invite/lookup` trả email được mời và vai trò;
   `/api/auth/invite/accept` nhận token + mật khẩu (+ tên) rồi tạo phiên luôn: không còn link email đặt mật khẩu, không quá thời
   gian. Mọi từ chối (hết hạn, đã dùng, đã rút, email đã có tài khoản mà chưa đăng nhập) là cùng một câu: không phân biệt được. */
const { h } = Proto;

const NEEDS_2FA = ['owner', 'admin', 'platform_operator'];
const EMAIL = 'nguoimoi@example.test';
const pending = (text) => h('span', { class: 'pending-spec' }, text);

function joined() {
  if (NEEDS_2FA.includes(Proto.role())) location.href = `twofa.html?role=${Proto.role()}&state=enroll_required`;
  else Proto.toast('Đã tham gia. Vào trang của vai trò.');
}

function acceptForm() {
  const name = h('input', { id: 'name', class: 'input', autocomplete: 'name', maxlength: 120 });
  const pass = h('input', { id: 'p1', class: 'input', type: 'password', autocomplete: 'new-password' });
  const again = h('input', { id: 'p2', class: 'input', type: 'password', autocomplete: 'new-password' });
  const err = h('p', { class: 'field-error', role: 'alert' });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Đặt mật khẩu và tham gia');
  return h('form', {
    class: 'stack',
    onsubmit: (e) => {
      e.preventDefault();
      const problems = Proto.passwordProblems(pass.value);
      if (problems.length) { err.textContent = `Mật khẩu cần ${problems.join(', ')}.`; pass.classList.add('invalid'); return; }
      if (pass.value !== again.value) { err.textContent = 'Hai lần nhập mật khẩu chưa khớp.'; again.classList.add('invalid'); return; }
      err.textContent = '';
      Proto.serverAction(submit, 'Đặt mật khẩu và tham gia', joined);
    },
  },
  h('div', { class: 'field' }, h('label', { for: 'name' }, 'Họ tên (không bắt buộc)'), name),
  h('div', { class: 'field' }, h('label', { for: 'p1' }, 'Mật khẩu mới (≥ 12 ký tự, có chữ và số)'), pass),
  h('div', { class: 'field' }, h('label', { for: 'p2' }, 'Nhập lại mật khẩu'), again),
  err,
  submit);
}

function body() {
  const s = Proto.state();
  const role = Proto.ROLE_LABEL[Proto.role()];
  if (s === 'invalid') {
    return [h('h1', {}, 'Link không dùng được'), h('p', {}, 'Link không hợp lệ hoặc đã hết hạn.'),
      h('p', {}, 'Nhờ người mời gửi lại link mới. Nếu email này đã có tài khoản, đăng nhập trước rồi mở lại link.'),
      h('a', { class: 'btn', href: `login.html?role=${Proto.role()}` }, 'Đến trang đăng nhập')];
  }
  if (s === 'rate_limited') return [h('h1', {}, 'Thử quá nhiều lần'), h('p', { role: 'alert' }, 'Đợi một phút rồi mở lại link.')];
  const intro = [
    h('h1', {}, 'Bạn được mời tham gia'),
    h('dl', { class: 'kv' }, h('dt', {}, 'Email được mời'), h('dd', {}, EMAIL), h('dt', {}, 'Vai trò'), h('dd', {}, role)),
    h('p', { class: 'small muted' }, 'Tên công ty, người mời: ', pending('API lookup chưa trả (N151 chỉ trả email và vai trò)')),
    NEEDS_2FA.includes(Proto.role()) ? h('div', { class: 'banner info', style: 'border-radius:var(--r-input)' }, 'Vai trò này bắt buộc xác thực 2 lớp: tham gia xong bạn cài 2FA ngay.') : null,
  ];
  if (s === 'signed_in') {
    const go = h('button', { class: 'btn primary', onclick: () => Proto.serverAction(go, 'Tham gia', joined) }, 'Tham gia');
    return [...intro, h('p', {}, `Bạn đang đăng nhập bằng ${EMAIL}: bấm Tham gia, không cần đặt mật khẩu.`), h('div', {}, go)];
  }
  return [...intro, acceptForm()];
}

Proto.mountBare({
  states: [['normal', 'Bình thường'], ['signed_in', 'Đã đăng nhập đúng email'], ['invalid', 'Link không dùng được (mọi lý do)'], ['rate_limited', 'Thử quá nhiều lần'], ['aioff', 'AI tắt — Không áp dụng']],
  render: () => h('main', { class: 'card stack auth-card' },
    Proto.noAiNote(),
    body()),
});
