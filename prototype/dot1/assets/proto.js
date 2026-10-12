/* global document, window, location, history, URLSearchParams, setTimeout, clearTimeout */
/* Phần dùng chung của prototype: thanh điều khiển, khung app, 4 trạng thái, hộp thoại.
   Mọi nội dung hiển thị đi qua textContent (h() bên dưới), không dùng innerHTML. */
(() => {

  const ROLES = [
    ['owner', 'Owner'],
    ['admin', 'Admin'],
    ['manager', 'Manager'],
    ['sales', 'Sales'],
    ['support', 'Support'],
    ['marketing', 'Marketing'],
    ['viewer', 'Viewer'],
    ['platform_operator', 'Platform op'],
  ];
  const ROLE_LABEL = Object.fromEntries(ROLES);

  // Trích Phụ lục B (chỉ các thao tác 4 màn dùng).
  const PERMS = {
    'inbox.view': ['owner', 'admin', 'manager', 'sales', 'support'],
    'inbox.claim': ['owner', 'admin', 'manager', 'sales', 'support'],
    'inbox.reply': ['owner', 'admin', 'manager', 'sales', 'support'],
    'inbox.transfer': ['owner', 'admin', 'manager', 'sales', 'support'],
    'inbox.close': ['owner', 'admin', 'manager', 'sales', 'support'],
    'inbox.spam': ['owner', 'admin', 'manager'],
    'customer.view': ['owner', 'admin', 'manager', 'sales', 'support', 'marketing', 'viewer'],
    'customer.phone.full': ['owner', 'admin', 'manager', 'sales', 'support'],
    'customer.edit': ['owner', 'admin', 'manager', 'sales', 'support'],
    'customer.merge': ['owner', 'admin', 'manager'],
    'customer.merge.confirm': ['owner', 'admin', 'manager', 'sales'],
    'customer.unmerge': ['owner', 'admin'],
    'lead.change': ['owner', 'admin', 'manager', 'sales'],
    'ticket.create': ['owner', 'admin', 'manager', 'sales', 'support'],
    'bot.edit': ['owner', 'admin', 'manager'],
  };

  // Biến thể của khung app (Phụ lục C v3 dòng 0), dùng chung cho mọi màn có khung.
  const SHELLS = [
    ['normal', 'Bình thường'],
    ['disconnected', 'Mất kết nối realtime'],
    ['auto_offline', 'Tự chuyển Offline (> 5 phút)'],
    ['busy_30', 'Bận quá 30 phút'],
    ['switching', 'Đang đổi workspace'],
    ['platform_session', 'Phiên truy cập platform'],
  ];
  const PRESENCE = [
    ['online', 'Online'],
    ['busy', 'Bận'],
    ['offline', 'Offline'],
  ];
  let presence = null;

  const params = new URLSearchParams(location.search);

  const Proto = {
    ROLES,
    ROLE_LABEL,
    get(name, fallback) {
      return params.get(name) || fallback;
    },
    set(name, value) {
      params.set(name, value);
      history.replaceState(null, '', `${location.pathname}?${params.toString()}`);
      Proto.render();
    },
    role() {
      return Proto.get('role', 'sales');
    },
    state() {
      return Proto.get('state', 'normal');
    },
    can(perm) {
      return (PERMS[perm] || []).includes(Proto.role());
    },
    isManagerUp() {
      return ['owner', 'admin', 'manager'].includes(Proto.role());
    },
    maskPhone(phone) {
      return Proto.can('customer.phone.full') ? phone : `${phone.slice(0, 3)}***${phone.slice(-4)}`;
    },
    render() {},
  };

  /* h('div', {class: 'x', onclick: fn}, 'chữ', h(...)): chuỗi luôn thành text node. */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === false || value === null || value === undefined) continue;
      if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else if (key === 'class') el.className = value;
      else el.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat(Infinity)) {
      if (child === null || child === undefined || child === false) continue;
      el.append(child instanceof window.Node ? child : document.createTextNode(String(child)));
    }
    return el;
  }
  Proto.h = h;

  /* ---------- Bộ đếm click (đếm trong vùng app, không tính gõ chữ) ---------- */
  let clickCount = 0;
  function bumpCounter() {
    clickCount += 1;
    const out = document.getElementById('click-count');
    if (out) out.textContent = String(clickCount);
  }
  document.addEventListener(
    'click',
    (event) => {
      if (event.target.closest('#app') && event.target.closest('button, a, [role="button"], input[type="checkbox"], input[type="radio"], select')) bumpCounter();
    },
    true,
  );
  Proto.countKey = bumpCounter;

  /* ---------- Thanh điều khiển prototype ---------- */
  function select(label, name, options, current) {
    return h(
      'label',
      {},
      label,
      h(
        'select',
        { onchange: (event) => Proto.set(name, event.target.value) },
        options.map(([value, text]) => h('option', { value, selected: value === current }, text)),
      ),
    );
  }

  function protoBar(config) {
    return h(
      'div',
      { class: 'proto-bar', role: 'region', 'aria-label': 'Điều khiển prototype' },
      h('span', { class: 'tag' }, 'PROTOTYPE — không phải sản phẩm'),
      h('a', { href: 'index.html' }, 'Mục lục'),
      select('Trạng thái:', 'state', config.states, Proto.state()),
      select('Vai trò:', 'role', ROLES, Proto.role()),
      config.bare ? null : select('Khung:', 'shell', SHELLS, Proto.get('shell', 'normal')),
      (config.variants || []).map((v) => select(`${v.label}:`, v.name, v.options, Proto.get(v.name, v.options[0][0]))),
      h(
        'span',
        {},
        'Đếm click: ',
        h('strong', { id: 'click-count' }, String(clickCount)),
        ' ',
        h(
          'button',
          {
            onclick: () => {
              clickCount = 0;
              document.getElementById('click-count').textContent = '0';
            },
          },
          'Đặt lại',
        ),
      ),
    );
  }

  /* ---------- Khung app: menu 5 nhóm theo vai trò và theo đợt ---------- */
  function navItems() {
    const items = [];
    if (Proto.role() === 'platform_operator') {
      items.push(['platform', 'Platform', null]);
      if (Proto.get('shell', 'normal') === 'platform_session') items.push(['customers', 'Khách hàng (trong phiên)', 'customer.html']);
      return items;
    }
    if (Proto.can('inbox.view')) items.push(['inbox', 'Hộp thư', 'inbox.html']);
    items.push(['customers', 'Khách hàng', 'customer.html']);
    items.push(['leads', 'Lead', 'leads.html', true]);
    items.push(['tickets', 'Ticket', null, true]);
    if (Proto.can('bot.edit')) items.push(['bots', 'Tự động hóa', 'bots.html']);
    items.push(['overview', 'Tổng quan & Báo cáo', null]);
    if (['owner', 'admin'].includes(Proto.role())) items.push(['settings', 'Cài đặt', null]);
    return items;
  }

  /* Thanh trên cùng: đổi workspace, trạng thái agent (Online / Bận / Offline, U20-4), menu cá nhân. */
  function topbar() {
    const shellState = Proto.get('shell', 'normal');
    if (presence === null || shellState === 'auto_offline') presence = shellState === 'auto_offline' ? 'offline' : shellState === 'busy_30' ? 'busy' : 'online';
    const isPlatform = Proto.role() === 'platform_operator';
    return h(
      'header',
      { class: 'topbar', 'aria-label': 'Thanh trên cùng' },
      isPlatform
        ? h('span', { class: 'small muted' }, 'Nền tảng — không thuộc công ty nào')
        : h(
            'label',
            { class: 'row small' },
            'Workspace',
            h(
              'select',
              {
                class: 'input',
                id: 'ws',
                onchange: (event) => {
                  Proto.toast(`Đã chuyển sang ${event.target.selectedOptions[0].textContent}: xóa toàn bộ cache, ngắt realtime của workspace cũ (T1).`);
                },
              },
              h('option', {}, 'Gani Foods — B2B'),
              h('option', {}, 'The Smile — Dịch vụ'),
            ),
          ),
      h(
        'span',
        { class: 'row' },
        Proto.can('inbox.view')
          ? h(
              'label',
              { class: 'row small' },
              'Trạng thái',
              h(
                'select',
                {
                  class: 'input',
                  id: 'presence',
                  onchange: (event) => {
                    presence = event.target.value;
                    Proto.toast(presence === 'online' ? 'Bạn đang Online: được phân bổ hội thoại tự động.' : presence === 'busy' ? 'Bận: không nhận hội thoại mới, vẫn giữ hội thoại đang xử lý.' : 'Offline: không nhận hội thoại; hội thoại còn tin chưa trả lời về hàng chờ sau 10 phút.');
                    Proto.render();
                  },
                },
                PRESENCE.map(([value, text]) => h('option', { value, selected: value === presence }, text)),
              ),
            )
          : null,
        h('a', { class: 'btn link', href: `me.html?role=${Proto.role()}` }, 'Hồ sơ cá nhân'),
      ),
    );
  }

  function shellBanners() {
    const s = Proto.get('shell', 'normal');
    if (s === 'disconnected') return h('div', { class: 'banner warn', role: 'status' }, 'Mất kết nối — đang thử kết nối lại… Tin mới sẽ tải bù khi nối lại. Quá 5 phút bạn sẽ được chuyển sang Offline.');
    if (s === 'auto_offline')
      return h('div', { class: 'banner warn', role: 'status' }, 'Đã chuyển Offline do mất kết nối. Đã kết nối lại — bật Online khi bạn sẵn sàng nhận hội thoại. ', h('button', { class: 'btn', onclick: () => { presence = 'online'; Proto.set('shell', 'normal'); } }, 'Bật Online'));
    if (s === 'busy_30' && Proto.can('inbox.view')) return h('div', { class: 'banner info', role: 'status' }, 'Bạn đang Bận 32 phút. Hội thoại mới không được giao cho bạn.');
    if (s === 'platform_session' && Proto.role() === 'platform_operator')
      return h('div', { class: 'banner error', role: 'status' }, 'Phiên truy cập dữ liệu Gani Foods — còn 52 phút — Lý do: hỗ trợ lỗi kênh Zalo theo yêu cầu #128. Mọi thao tác được ghi nhật ký. ', h('button', { class: 'btn', onclick: () => Proto.set('shell', 'normal') }, 'Kết thúc phiên'));
    return null;
  }

  function shell(config, content) {
    const nav = h(
      'nav',
      { class: 'nav', 'aria-label': 'Menu chính' },
      navItems().map(([key, label, href, sub]) =>
        h(
          'a',
          {
            href: href ? `${href}?role=${Proto.role()}&shell=${Proto.get('shell', 'normal')}` : '#',
            class: sub ? 'sub' : null,
            'aria-current': key === config.page ? 'page' : null,
            onclick: href ? null : (event) => {
              event.preventDefault();
              Proto.toast('Màn này ngoài phạm vi prototype đợt này.');
            },
          },
          label,
        ),
      ),
      h('p', { class: 'small muted', style: 'margin-top:auto' }, `Đăng nhập: ${ROLE_LABEL[Proto.role()]}`),
    );
    const switching = Proto.get('shell', 'normal') === 'switching';
    const body = switching
      ? h('div', { class: 'state-box', 'aria-busy': 'true' }, h('span', { class: 'spin', 'aria-hidden': 'true' }), h('p', {}, 'Đang đổi sang The Smile — Dịch vụ… Đã xóa dữ liệu và ngắt realtime của workspace cũ.'))
      : content;
    return h('div', { class: 'app', id: 'app' }, nav, h('main', { class: 'main' }, topbar(), shellBanners(), body));
  }

  /* AI tắt: Manager trở lên thấy dải báo; Sales/Support không thấy (§2.3). */
  Proto.aiOffBanner = (reason) =>
    Proto.state() === 'aioff' && Proto.isManagerUp()
      ? h('div', { class: 'banner warn', role: 'status' }, `AI đang tắt — ${reason || 'Admin tắt bằng feature flag'}`)
      : null;

  /* "Không áp dụng AI" có chủ đích cho màn không có phần AI (M10). */
  Proto.noAiNote = () =>
    Proto.state() === 'aioff'
      ? h('div', { class: 'banner info', role: 'note' }, 'Trạng thái AI tắt: Không áp dụng AI — màn này không có phần AI, mọi chức năng giữ nguyên.')
      : null;

  Proto.loading = (rows = 6) =>
    h('div', { 'aria-busy': 'true', 'aria-label': 'Đang tải' }, Array.from({ length: rows }, (_, i) => h('span', { class: 'skeleton', style: `width:${90 - (i % 3) * 20}%` })));

  Proto.empty = (sentence, actionLabel, onAction) =>
    h('div', { class: 'state-box' }, h('p', {}, sentence), actionLabel ? h('button', { class: 'btn', onclick: onAction }, actionLabel) : null);

  Proto.error = (sentence) =>
    h(
      'div',
      { class: 'state-box', role: 'alert' },
      h('p', {}, sentence),
      h('p', { class: 'trace muted' }, 'Mã: 7f3a9c1e-…'),
      h('button', { class: 'btn', onclick: () => Proto.set('state', 'normal') }, 'Thử lại'),
    );

  Proto.noAccess = (what, href) =>
    h(
      'div',
      { class: 'state-box' },
      h('p', {}, `Vai trò ${ROLE_LABEL[Proto.role()]} không dùng ${what}.`),
      h('a', { class: 'btn', href: `${href}?role=${Proto.role()}` }, 'Về màn được phép'),
    );

  /* Nút chờ máy chủ: khóa bấm lặp, vòng quay, rồi gọi done (§2.4). */
  Proto.serverAction = (button, label, done, ms = 700) => {
    if (button.getAttribute('aria-busy') === 'true') return;
    button.setAttribute('aria-busy', 'true');
    button.disabled = true;
    button.replaceChildren(h('span', { class: 'spin', 'aria-hidden': 'true' }), 'Đang xử lý…');
    setTimeout(() => {
      button.removeAttribute('aria-busy');
      button.disabled = false;
      button.replaceChildren(label);
      done();
    }, ms);
  };

  let toastTimer = null;
  Proto.toast = (text) => {
    document.querySelector('.toast')?.remove();
    clearTimeout(toastTimer);
    const el = h('div', { class: 'toast', role: 'status' }, text);
    document.body.append(el);
    toastTimer = setTimeout(() => el.remove(), 4000);
  };

  Proto.dialog = (title, body, actions) => {
    const previous = document.activeElement;
    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
    const onKey = (event) => {
      if (event.key === 'Escape') close();
    };
    const box = h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('h2', {}, title), h('div', { style: 'margin-top:var(--sp-3)' }, body), h('div', { class: 'actions' }, actions(close)));
    const overlay = h('div', { class: 'overlay', onclick: (event) => event.target === overlay && close() }, box);
    document.body.append(overlay);
    document.addEventListener('keydown', onKey);
    (box.querySelector('[autofocus]') || box.querySelector('button, input, select, textarea'))?.focus();
    return close;
  };

  /* Gõ phím tắt chỉ khi con trỏ không ở ô nhập (§4.7). */
  Proto.inTextField = (event) => event.target.closest('input, textarea, select, [contenteditable]');

  /* Dựng trang: config = { page, states, variants, render: () => node } */
  Proto.mount = (config) => {
    Proto.render = () => {
      const root = document.getElementById('root');
      root.replaceChildren(protoBar(config), shell(config, config.render()));
    };
    Proto.render();
  };

  /* Trang không có khung app (đăng nhập, nhận lời mời, trang hệ thống ngoài phiên). */
  Proto.mountBare = (config) => {
    Proto.render = () => {
      const root = document.getElementById('root');
      root.replaceChildren(protoBar({ ...config, bare: true }), h('div', { class: 'bare', id: 'app' }, config.render()));
    };
    Proto.render();
  };

  window.Proto = Proto;
})();
