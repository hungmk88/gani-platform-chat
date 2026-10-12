/* global Proto */
/* #1 Đăng nhập (spec M8 §3.8, Phụ lục C v3 dòng 5). Đăng nhập qua Better Auth `/api/auth/sign-in/email`. */
const { h } = Proto;

const NEEDS_2FA = ['owner', 'admin', 'platform_operator'];

function form() {
  const s = Proto.state();
  const email = h('input', { id: 'email', class: 'input', type: 'email', autocomplete: 'username', value: 'linh@gani.vn' });
  const pass = h('input', { id: 'pass', class: 'input', type: 'password', autocomplete: 'current-password' });
  const error = s === 'error'
    ? h('p', { class: 'field-error', role: 'alert' }, 'Email hoặc mật khẩu không đúng.')
    : s === 'locked'
      ? h('p', { class: 'field-error', role: 'alert' }, 'Tài khoản tạm khóa 30 phút vì nhập sai 5 lần. Thử lại sau hoặc liên hệ Admin.')
      : null;
  const submit = h('button', { class: 'btn primary', type: 'submit', disabled: s === 'locked' }, 'Đăng nhập');
  if (s === 'loading') {
    submit.setAttribute('aria-busy', 'true');
    submit.disabled = true;
    submit.replaceChildren(h('span', { class: 'spin', 'aria-hidden': 'true' }), 'Đang đăng nhập…');
  }
  return h('form', {
    class: 'stack',
    onsubmit: (e) => {
      e.preventDefault();
      Proto.serverAction(submit, 'Đăng nhập', () => {
        if (NEEDS_2FA.includes(Proto.role())) Proto.toast('Bước tiếp: nhập mã 2FA (màn #2 — chưa làm ở đợt sớm này).');
        else Proto.toast('Đăng nhập thành công — vào trang mặc định theo vai trò.');
      });
    },
  },
  h('div', { class: 'field' }, h('label', { for: 'email' }, 'Email'), email),
  h('div', { class: 'field' }, h('label', { for: 'pass' }, 'Mật khẩu'), pass),
  error,
  submit,
  h('a', { class: 'btn link', href: '#', onclick: (e) => { e.preventDefault(); Proto.toast('Quên mật khẩu (#3) phụ thuộc PR7 — chưa làm ở đợt sớm này.'); } }, 'Quên mật khẩu?'));
}

Proto.mountBare({
  states: [['normal', 'Bình thường'], ['loading', 'Đang đăng nhập'], ['error', 'Sai email hoặc mật khẩu'], ['locked', 'Khóa 30 phút (5 lần sai)']],
  render: () => h('main', { class: 'card stack auth-card' },
    h('h1', {}, 'Đăng nhập'),
    h('p', { class: 'muted' }, 'Nền tảng chat — dùng chung cho 5 công ty.'),
    form(),
    h('p', { class: 'small muted' }, 'Owner, Admin và platform operator bắt buộc xác thực 2 lớp.')),
});
