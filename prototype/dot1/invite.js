/* global Proto, location */
/* #4 Nhận lời mời (spec M8 §3.8, Phụ lục C v3 dòng 8) — phụ thuộc PR7: duyệt bố cục, chi tiết duyệt lại khi PR7 xong. */
const { h } = Proto;

const NEEDS_2FA = ['owner', 'admin', 'platform_operator'];

function acceptForm() {
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
      Proto.serverAction(submit, 'Đặt mật khẩu và tham gia', () => {
        if (NEEDS_2FA.includes(Proto.role())) location.href = `twofa.html?role=${Proto.role()}&state=enroll_required`;
        else Proto.toast('Đã tham gia. Vào Hộp thư.');
      });
    },
  },
  h('div', { class: 'field' }, h('label', { for: 'p1' }, 'Mật khẩu mới (≥ 12 ký tự, có chữ và số)'), pass),
  h('div', { class: 'field' }, h('label', { for: 'p2' }, 'Nhập lại mật khẩu'), again),
  err,
  submit);
}

function body() {
  const s = Proto.state();
  const role = Proto.ROLE_LABEL[Proto.role()];
  if (s === 'expired') return [h('h1', {}, 'Link đã hết hạn'), h('p', {}, 'Link mời chỉ dùng được trong 7 ngày. Nhờ người mời gửi lại link mới.')];
  if (s === 'invalid') return [h('h1', {}, 'Link không hợp lệ hoặc đã hết hạn'), h('p', {}, 'Kiểm tra lại link trong email, hoặc nhờ người mời gửi lại.')];
  if (s === 'used') return [h('h1', {}, 'Đã chấp nhận lời mời'), h('p', {}, 'Đã chấp nhận, kiểm tra email để đặt mật khẩu.'), h('a', { class: 'btn', href: `login.html?role=${Proto.role()}` }, 'Đến trang đăng nhập')];
  if (s === 'timeout') return [h('h1', {}, 'Đã quá thời gian đặt mật khẩu trên trang'), h('p', {}, 'Chúng tôi đã gửi link đặt mật khẩu tới email của bạn.')];
  return [
    h('h1', {}, 'Bạn được mời tham gia'),
    h('dl', { class: 'kv' }, h('dt', {}, 'Công ty'), h('dd', {}, 'Gani Foods'), h('dt', {}, 'Workspace'), h('dd', {}, 'B2B'), h('dt', {}, 'Vai trò'), h('dd', {}, role), h('dt', {}, 'Người mời'), h('dd', {}, 'Admin Gani')),
    NEEDS_2FA.includes(Proto.role()) ? h('div', { class: 'banner info', style: 'border-radius:var(--r-input)' }, 'Vai trò này bắt buộc xác thực 2 lớp: sau khi đặt mật khẩu bạn sẽ cài 2FA ngay.') : null,
    acceptForm(),
  ];
}

Proto.mountBare({
  states: [['normal', 'Bình thường'], ['expired', 'Link hết hạn (7 ngày)'], ['invalid', 'Link không hợp lệ / sai email'], ['used', 'Link đã dùng (N31)'], ['timeout', 'Quá thời gian đặt mật khẩu'], ['aioff', 'AI tắt — Không áp dụng']],
  render: () => h('main', { class: 'card stack auth-card' },
    h('div', { class: 'banner info', style: 'border-radius:var(--r-input)' }, 'Phụ thuộc PR7: duyệt bố cục; chi tiết duyệt lại khi PR7 xong.'),
    Proto.noAiNote(),
    body()),
});
