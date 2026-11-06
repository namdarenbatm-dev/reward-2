/*
 * app.js — رابط کاربری: Splash، تب‌ها، داشبورد، پلیرها، درآمد، گزارش، داده
 * تمام فرمول‌ها در calculations.js / reward-engine.js هستند؛ این فایل فقط نمایش و ورودی را مدیریت می‌کند.
 */
(function () {
  'use strict';
  const TT = window.TT;
  const { calc, referrals, players, engine, reports, storage, exporter } = TT;
  const fa = calc.fa;
  const SPLASH_MS = 5000;
  const splashStart = performance.now();

  /* ================= ابزارک‌های DOM ================= */
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) Object.keys(props).forEach(k => {
      const v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    kids.flat().forEach(c => { if (c === null || c === undefined || c === false) return; el.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return el;
  }
  const clear = el => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  const num = n => h('span', { class: 'num', text: fa(n) });

  function toast(msg, isErr) {
    const t = h('div', { class: 'toast' + (isErr ? ' err' : ''), text: msg });
    document.getElementById('toast-root').append(t);
    setTimeout(() => t.remove(), isErr ? 6000 : 3200);
  }

  function dialog({ title, body, okText, cancelText, danger, hideCancel }) {
    return new Promise(resolve => {
      const root = document.getElementById('modal-root');
      const done = v => { back.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = e => { if (e.key === 'Escape') done(false); };
      const ok = h('button', { class: 'btn' + (danger ? ' btn-danger' : ''), text: okText || 'تأیید', onclick: () => done(true) });
      const cancel = hideCancel ? null : h('button', { class: 'btn btn-ghost', text: cancelText || 'انصراف', onclick: () => done(false) });
      const back = h('div', { class: 'modal-back', onclick: e => { if (e.target === back) done(false); } },
        h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, h('h3', { text: title }), h('div', null, body), h('div', { class: 'row' }, cancel, ok)));
      root.append(back);
      document.addEventListener('keydown', onKey);
      (danger ? cancel || ok : ok).focus();
    });
  }

  /** ورودی عددی با جداکنندهٔ هزارگان (ارقام فارسی/لاتین قابل‌قبول) */
  function numInput(o) {
    const el = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', class: 'numin ' + (o.cls || ''), 'aria-label': o.label || 'مقدار', placeholder: o.placeholder || '' });
    const show = () => { const v = o.get(); el.value = v === null || v === undefined ? '' : fa(v); };
    el.addEventListener('input', () => {
      let n = calc.parseNumber(el.value);
      if (n === null) { if (o.allowEmpty) { o.set(null); return; } n = 0; }
      o.set(Math.max(0, n));
    });
    el.addEventListener('change', () => {
      const n = calc.parseNumber(el.value);
      if (o.commit) o.commit(n === null ? null : Math.max(0, n));
      show();
    });
    el.addEventListener('focus', () => setTimeout(() => el.select && el.select(), 0));
    el.addEventListener('keydown', e => { if (e.key === 'Enter') el.blur(); });
    el.refresh = () => { if (document.activeElement !== el) show(); };
    show();
    return el;
  }

  /* ================= وضعیت برنامه ================= */
  const loaded = storage.load();
  let state = loaded.state;
  let result = engine.compute(state);
  const ui = { tab: 'master', selected: null, sortTotal: false };
  try { const t = (location.hash || '').slice(1); if (t) ui.tab = t; } catch (e) { /* ignore */ }
  let view = null;      // { refresh() }
  let deferredInstall = null;

  const TABS = [
    { id: 'master', title: 'داشبورد' },
    { id: 'network', title: 'شبکه' },
    { id: 'report', title: 'گزارش توزیع پاداش' },
    { id: 'guide', title: 'فرمول‌ها و فرض‌ها' },
    { id: 'data', title: 'داده و پشتیبان' }
  ];
  if (!TABS.some(t => t.id === ui.tab)) ui.tab = 'master';

  function commit(structural) {
    result = engine.compute(state);
    storage.save(state);
    renderBanner();
    if (structural) renderView(); else if (view && view.refresh) view.refresh();
  }

  /* ================= هشدارهای سراسری ================= */
  function renderBanner() {
    const box = clear(document.getElementById('banner'));
    ['partner', 'agent'].forEach(k => {
      const b = result.baskets[k];
      if (b.status === 'short') {
        box.append(h('div', { class: 'banner err', role: 'alert' },
          h('strong', { text: `کسری ${b.label}: ` }), num(b.shortfall), ' تومان',
          h('span', { class: 'small', text: ` — تعهد ${fa(b.committed)} از بودجه ${fa(b.pool)} بیشتر است. مازاد سبد دیگر آن را پوشش نمی‌دهد.` })));
      }
    });
    const errs = result.issues.filter(i => i.level === 'error');
    const warns = result.issues.filter(i => i.level === 'warn');
    if (errs.length) box.append(h('div', { class: 'banner err' }, h('strong', { text: `${fa(errs.length)} خطا در ورودی‌ها` }),
      h('ul', { class: 'issues' }, errs.slice(0, 4).map(i => h('li', { class: 'error', text: i.msg })))));
    if (warns.length) box.append(h('div', { class: 'banner warn' }, h('strong', { text: `${fa(warns.length)} هشدار` }),
      h('ul', { class: 'issues' }, warns.slice(0, 3).map(i => h('li', { class: 'warn', text: i.msg })))));
    if (!storage.isPersistent()) box.append(h('div', { class: 'banner warn' }, 'ذخیره‌سازی مرورگر در دسترس نیست؛ داده‌ها فقط تا بستن صفحه می‌مانند. از «دانلود پشتیبان JSON» استفاده کنید.'));
  }

  function setSaveStatus(info) {
    const el = document.getElementById('save-status');
    if (!el) return;
    const t = info.at;
    const hhmm = calc.toFaDigits(String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0'));
    if (!info.persistent) { el.className = 'save-status warn'; el.textContent = 'ذخیره‌سازی در دسترس نیست'; }
    else { el.className = 'save-status'; el.textContent = 'ذخیره شد · ' + hhmm; }
  }

  /* ================= تب‌ها ================= */
  function renderTabs() {
    const nav = clear(document.getElementById('tabs'));
    TABS.forEach(t => nav.append(h('button', {
      class: 'tab', role: 'tab', id: 'tab-' + t.id, 'aria-selected': String(t.id === ui.tab), text: t.title,
      onclick: () => { ui.tab = t.id; try { history.replaceState(null, '', '#' + t.id); } catch (e) { /* ignore */ } renderTabs(); renderView(); }
    })));
  }
  function renderView() {
    const root = clear(document.getElementById('view'));
    const builders = { master: viewMaster, network: viewNetwork, report: viewReport, guide: viewGuide, data: viewData };
    view = builders[ui.tab](root);
  }

  /* ================= ۱) داشبورد (جدول مادر مالی) ================= */
  const L_PARTNER = 'بودجه پاداش شریک از محل افزایش قیمت دستگاه';
  const L_AGENT = 'بودجه پاداش نماینده و پاداش شریک از فعالیت نماینده از محل افزایش قیمت دستگاه';

  function formulaValueOf(ref) {
    const cfg = JSON.parse(JSON.stringify(state.config));
    calc.setPath(cfg, calc.CELL_BINDINGS[ref].path, null);
    return calc.evaluateCells(cfg).values[ref];
  }

  function viewMaster(root) {
    const bound = {};   // ref -> { el, kind, rst }
    const live = [];
    const fx = () => result.cells;

    /* فیلد ورودی/محاسباتی مرتبط با یک سلول جدول مادر */
    function field(ref, label, hint) {
      const b = calc.CELL_BINDINGS[ref];
      const input = numInput({
        label, cls: 'big',
        get: () => fx().values[ref],
        set: n => {
          if (b.override) calc.setPath(state.config, b.path, n === formulaValueOf(ref) ? null : n);
          else calc.setPath(state.config, b.path, n);
          commit(false);
        }
      });
      const wrap = h('div', { class: 'fld' }, h('span', { class: 'fld-l', text: label }), h('div', { class: 'fld-in' }, input, h('em', { text: 'تومان' })));
      if (hint) wrap.append(h('small', { class: 'muted', text: hint }));
      if (b.override) {
        const rst = h('button', { class: 'btn btn-ghost btn-sm', text: 'بازگشت به فرمول', title: 'حذف مقدار دستی و استفاده از فرمول', hidden: true,
          onclick: () => { calc.setPath(state.config, b.path, null); commit(false); } });
        wrap.append(rst);
        bound[ref] = { el: input, kind: 'ov', rst };
      } else bound[ref] = { el: input, kind: 'in' };
      return wrap;
    }
    function calcField(ref, label, cls) {
      const v = h('b', { class: 'num' });
      bound[ref] = { el: v, kind: 'calc' };
      return h('div', { class: 'fld calc ' + (cls || '') }, h('span', { class: 'fld-l', text: label }), h('div', { class: 'fld-v' }, v, h('em', { text: 'تومان' })));
    }
    const kpi = (label, key, sub) => {
      const v = h('b', { class: 'num' }), s = h('small', { class: 'muted' });
      live.push(() => { const o = key(); v.textContent = o.v; s.textContent = o.s || sub || ''; });
      return h('div', { class: 'kpi' }, h('span', { class: 'kpi-l', text: label }), v, s);
    };

    /* --- نوار شاخص‌های کلیدی --- */
    const G = () => result.groups, R = () => result.refStats;
    const kpis = h('section', { class: 'kpis' },
      kpi('جمع کل پاداش (تومان)', () => ({ v: fa(result.grand.total), s: `حق ثبت ${fa(result.grand.reg)} · تارگت ${fa(result.grand.target)} · معرفی ${fa(result.grand.referral)}` })),
      kpi('تعداد پلیرها', () => ({ v: fa(G().partner.count + G().agent.count), s: `${fa(G().partner.count)} شریک · ${fa(G().agent.count)} نماینده` })),
      kpi('معرفی نماینده', () => ({ v: fa(R().total), s: `${fa(R().paid)} مستحق و پرداخت‌شده · ${fa(R().pending)} در انتظار شرایط` })),
      kpi('وضعیت کنترل‌های مالی', () => { const bad = result.controls.filter(c => !c.ok).length; return { v: bad ? `${fa(bad)} مورد ناموفق` : 'همه موفق', s: bad ? 'جزئیات در پایین همین صفحه' : `${fa(result.controls.length)} کنترل بررسی شد` }; }));
    live.push(() => { const el = kpis.children[3]; el.classList.toggle('bad', !result.allOk); el.classList.toggle('good', result.allOk); });

    /* --- کارت بودجه (پیشرفت تعهد نسبت به بودجه) --- */
    function basketCard(key, title, fieldsBlock) {
      const bar = h('i'), pctEl = h('b', { class: 'num' }), line = h('small', { class: 'muted' }), badge = h('span', { class: 'status-box' });
      live.push(() => {
        const b = result.baskets[key];
        const p = b.pool > 0 ? Math.min(100, b.committed / b.pool * 100) : (b.committed ? 100 : 0);
        bar.style.width = p.toFixed(1) + '%'; bar.parentNode.className = 'meter ' + b.status;
        pctEl.textContent = calc.toFaDigits(p.toFixed(0)) + '٪';
        badge.className = 'status-box ' + b.status; badge.textContent = b.status === 'short' ? 'کسری' : b.status === 'empty' ? 'بدون داده' : 'کافی';
        line.textContent = `بودجه ${fa(b.pool)} (${fa(b.perDevice)} × ${fa(b.devices)} دستگاه) · تعهد ${fa(b.committed)} · ${b.remaining < 0 ? 'کسری ' + fa(-b.remaining) : 'مانده ' + fa(b.remaining)}`;
      });
      return h('article', { class: 'card-d' },
        h('header', null, h('h3', { text: title }), badge), fieldsBlock,
        h('div', { class: 'meter-wrap' }, h('div', { class: 'meter' }, bar), pctEl), line);
    }

    const partnerBlock = h('div', { class: 'fgrid' },
      field('B3', 'قیمت مصوب دستگاه'),
      field('C3', 'بودجه پاداش شریک از افزایش قیمت'),
      calcField('A3', 'قیمت دستگاه برای شریک', 'strong'),
      field('B5', 'حق ثبت شریک (هر دستگاه)'),
      field('C5', 'حق تارگت شریک (هر دستگاه)', 'پیش‌فرض = بودجه − حق ثبت'));
    const agentBlock = h('div', { class: 'fgrid' },
      field('B8', 'قیمت مصوب دستگاه'),
      field('C8', 'بودجه پاداش نماینده و شریک از فعالیت نماینده'),
      calcField('A8', 'قیمت دستگاه برای نماینده', 'strong'));

    const agentRates = h('article', { class: 'card-d' },
      h('header', null, h('h3', { text: 'نرخ پاداش نماینده (به‌ازای هر دستگاه)' })),
      h('div', { class: 'fgrid' },
        field('B12', 'حق ثبت نماینده'), field('C12', 'حق تارگت نماینده'), field('D12', 'حق معرفی (وقتی معرف، نماینده است)')));
    const partnerRates = h('article', { class: 'card-d' },
      h('header', null, h('h3', { text: 'نرخ پاداش شریک از نمایندگان شبکه (به‌ازای هر دستگاه)' })),
      h('div', { class: 'fgrid' },
        field('E12', 'حق معرفی (وقتی معرف، شریک است)'), field('F12', 'حق ثبت شبکه — دستگاه قدیم'), field('G12', 'حق ثبت شبکه — دستگاه جدید')));


    const checksBox = h('div');
    const ctl = h('section', { class: 'sec' },
      h('div', { class: 'sec-head' }, h('div', null, h('h2', { text: 'کنترل‌های مالی' }), h('p', { text: 'نتیجهٔ زندهٔ تطبیق نرخ‌ها با ورودی‌های ثبت‌شده.' }))), checksBox);

    root.append(
      h('div', { class: 'dash-head' }, h('div', null, h('h2', { text: 'داشبورد پاداش شبکه فروش' }),
        h('p', { text: 'نرخ‌ها و بودجه‌ها را اینجا تنظیم کنید؛ همهٔ بخش‌ها لحظه‌ای به‌روز می‌شوند. بودجهٔ هر سبد = بودجهٔ هر دستگاه × تعداد دستگاه‌های ثبت‌شدهٔ همان گروه، و دو سبد کاملاً مستقل‌اند.' }))),
      kpis,
      h('div', { class: 'cols2' },
        basketCard('partner', L_PARTNER, partnerBlock),
        basketCard('agent', L_AGENT, agentBlock)),
      h('div', { class: 'cols2' }, agentRates, partnerRates),
      ctl);

    function refresh() {
      const c = result.cells;
      Object.keys(bound).forEach(ref => {
        const b = bound[ref];
        if (b.kind === 'calc') b.el.textContent = fa(c.values[ref]);
        else {
          b.el.refresh();
          if (b.kind === 'ov') { const o = !!c.overrides[ref]; b.el.classList.toggle('override', o); b.rst.hidden = !o; }
        }
      });
      live.forEach(f => f());
      renderChecks(checksBox);
    }
    refresh();
    return { refresh };
  }

  function renderChecks(box) {
    clear(box);
    box.append(h('ul', { class: 'checks' }, result.controls.map(c => h('li', { class: c.ok ? 'pass' : 'fail' },
      h('span', { class: 'pill', text: c.ok ? 'PASS' : 'FAIL' }), h('div', null, h('b', { text: c.title }), h('small', { text: c.detail }))))));
  }

  /* ================= ۲) شبکه (ساختار درختی) ================= */
  function viewNetwork(root) {
    const MAX_BULK = 100;
    const live = [];
    if (!state.players.some(p => p.id === ui.selected)) ui.selected = state.players[0] ? state.players[0].id : null;

    const PP = id => result.perPlayer[id];
    const sub = p => PP(p.id).referral + PP(p.id).network;     // درآمد از زیرمجموعه

    /* ---- افزودن شریک ---- */
    const pName = h('input', { type: 'text', placeholder: 'نام شریک جدید', 'aria-label': 'نام شریک جدید', maxlength: 60 });
    const addPartner = () => {
      const n = state.players.filter(p => p.type === 'partner').length + 1;
      const r = players.addPlayer(state, { name: pName.value.trim() || `شریک ${fa(n)}`, type: 'partner' });
      if (!r.ok) { toast(r.reason, true); return; }
      pName.value = ''; ui.selected = r.player.id; commit(true);
    };
    pName.addEventListener('keydown', e => { if (e.key === 'Enter') addPartner(); });

    /* ---- افزودن گروهی نماینده زیر یک گره ---- */
    function addAgents(parent, n) {
      n = Math.floor(Number(n));
      if (!Number.isFinite(n) || n < 1) { toast('تعداد را حداقل ۱ وارد کنید.', true); return; }
      if (n > MAX_BULK) { toast(`در هر بار حداکثر ${fa(MAX_BULK)} نماینده اضافه می‌شود.`, true); n = MAX_BULK; }
      const used = new Set(state.players.map(p => p.name));
      let k = state.players.filter(p => p.type === 'agent').length;
      let last = null;
      for (let i = 0; i < n; i++) {
        let name; do { k += 1; name = `نماینده ${fa(k)}`; } while (used.has(name));
        used.add(name);
        const r = players.addPlayer(state, { name, type: 'agent', referrerId: parent.id });
        if (!r.ok) { toast(r.reason, true); break; }
        last = r.player;
      }
      if (last) { ui.selected = last.id; commit(true); toast(`${fa(n)} نماینده زیر «${parent.name}» اضافه شد.`); }
    }

    /* ---- گره درخت ---- */
    function nodeEl(p) {
      const pp = PP(p.id);
      const card = h('div', { class: 'node ' + p.type + (ui.selected === p.id ? ' sel' : ''), tabindex: '0', role: 'button', 'aria-label': 'انتخاب ' + p.name,
        onclick: e => { if (e.target.closest('.n-add')) return; ui.selected = p.id; renderTree(); renderPanel(); },
        onkeydown: e => { if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('.n-add')) { e.preventDefault(); ui.selected = p.id; renderTree(); renderPanel(); } } });
      card.append(h('div', { class: 'n-top' }, h('span', { class: 'tag ' + p.type, text: reports.typeLabel(p) }), h('b', { text: p.name })));
      card.append(h('div', { class: 'n-row' }, h('span', { text: 'از فعالیت خود' }), num(pp.own)));
      card.append(h('div', { class: 'n-row' }, h('span', { text: 'از زیرمجموعه' }), num(sub(p))));
      card.append(h('div', { class: 'n-total' }, h('span', { text: 'جمع درآمد' }), num(pp.total)));
      if (p.type === 'agent') {
        if (!p.referrerId) card.append(h('div', { class: 'chip warn', text: 'بدون معرف و شریک' }));
        else {
          const st = referrals.referralStatus(state, p);
          card.append(h('div', { class: 'chip ' + (st.eligible ? 'ok' : 'warn'), title: st.eligible ? '' : 'کم‌شده: ' + st.missing.join('، '),
            text: st.eligible ? 'حق معرفی: مستحق' : 'حق معرفی: ناقص' }));
        }
      }
      const cnt = h('input', { type: 'text', inputmode: 'numeric', value: '1', 'aria-label': 'تعداد نماینده برای افزودن', class: 'cnt' });
      cnt.addEventListener('focus', () => cnt.select());
      card.append(h('div', { class: 'n-add' }, cnt, h('button', { class: 'btn btn-ghost btn-sm', text: '+ نماینده',
        title: 'افزودن تعداد دلخواه نماینده زیر این گره', onclick: () => addAgents(p, calc.parseNumber(cnt.value) || 0) })));
      return card;
    }
    function branch(p, seen) {
      const li = h('li', null, nodeEl(p));
      const kids = referrals.referralsOf(state, p.id).filter(k => !seen.has(k.id));
      if (kids.length) { kids.forEach(k => seen.add(k.id)); li.append(h('ul', null, kids.map(k => branch(k, seen)))); }
      return li;
    }
    const treeBox = h('div', { class: 'tree-scroll' });
    function renderTree() {
      clear(treeBox);
      if (!state.players.length) {
        treeBox.append(h('div', { class: 'empty-state' }, h('p', { text: 'هنوز شریکی ثبت نشده است. یک شریک اضافه کنید و زیر آن نماینده بچینید.' }),
          h('button', { class: 'btn btn-ghost', text: 'بارگذاری نمونه', onclick: () => { state = players.sampleState(); ui.selected = state.players[0].id; commit(true); } })));
        return;
      }
      const seen = new Set();
      const roots = state.players.filter(p => p.type === 'partner' || !p.referrerId);
      roots.forEach(r => seen.add(r.id));
      const forest = h('div', { class: 'forest' }, roots.map(r => h('ul', { class: 'tree' }, branch(r, seen))));
      treeBox.append(forest);
    }

    /* ---- پنل گرهٔ انتخاب‌شده ---- */
    const panel = h('aside', { class: 'sec node-panel' });
    const incomeBox = h('div');
    function renderIncome() {
      clear(incomeBox);
      const p = players.getPlayer(state, ui.selected); if (!p) return;
      const pp = PP(p.id), rates = result.rates;
      const rows = [];
      const own = p.type === 'partner' ? [['P_REG', 'حق ثبت (دستگاه ثبت‌شده)'], ['P_TARGET', 'حق تارگت (دستگاه مشمول تارگت)']] : [['A_REG', 'حق ثبت (دستگاه ثبت‌شده)'], ['A_TARGET', 'حق تارگت (دستگاه مشمول تارگت)']];
      rows.push(h('tr', { class: 'sub' }, h('td', { colspan: 2, text: 'از فعالیت خود' }), h('td', { class: 'n' }, num(pp.own))));
      own.forEach(([c, label]) => rows.push(h('tr', null, h('td', { text: label }), h('td', { class: 'n' }, h('span', { class: 'num', text: `${fa(pp.byCode[c].qty)} × ${fa(rates[c])}` })), h('td', { class: 'n' }, num(pp.byCode[c].amount)))));
      rows.push(h('tr', { class: 'sub' }, h('td', { colspan: 2, text: 'از زیرمجموعه' }), h('td', { class: 'n' }, num(sub(p)))));
      const refCode = p.type === 'partner' ? 'REF_PARTNER' : 'REF_AGENT';
      const src = {};
      pp.byCode[refCode].entries.forEach(e => { (src[e.sourceId] = src[e.sourceId] || []).push({ label: 'حق معرفی', e }); });
      if (p.type === 'partner') ['OLD_REG_PARTNER', 'NEW_REG_PARTNER'].forEach(c => pp.byCode[c].entries.forEach(e => {
        (src[e.sourceId] = src[e.sourceId] || []).push({ label: c === 'OLD_REG_PARTNER' ? 'حق ثبت شبکه (قدیم)' : 'حق ثبت شبکه (جدید)', e });
      }));
      const ids = Object.keys(src);
      if (!ids.length) rows.push(h('tr', null, h('td', { colspan: 3, class: 'muted', text: p.type === 'partner' ? 'هنوز نمایندهٔ زیرمجموعه‌ای با دستگاه ثبت نشده است.' : 'هنوز نمایندهٔ معرفی‌شده‌ای با خرید اولیه (و شرایط کامل) ندارد.' })));
      ids.forEach(id => {
        const who = players.getPlayer(state, id);
        src[id].forEach(x => rows.push(h('tr', null, h('td', { text: `${x.label} — ${who ? who.name : '—'}` }),
          h('td', { class: 'n' }, h('span', { class: 'num', text: `${fa(x.e.qty)} × ${fa(x.e.rate)}` })), h('td', { class: 'n' }, num(x.e.amount)))));
      });
      incomeBox.append(h('div', { class: 'tbl-wrap' }, h('table', { class: 'dt' },
        h('thead', null, h('tr', null, ['شرح', 'تعداد × نرخ', 'مبلغ (تومان)'].map(t => h('th', { text: t })))),
        h('tbody', null, rows),
        h('tfoot', null, h('tr', null, h('td', { colspan: 2, text: 'جمع درآمد' }), h('td', { class: 'n' }, num(pp.total)))))));
    }
    function renderPanel() {
      clear(panel); live.length = 0;
      const p = players.getPlayer(state, ui.selected);
      if (!p) { panel.append(h('p', { class: 'muted', text: 'یک گره از درخت را انتخاب کنید.' })); return; }
      const fld = (label, el) => h('label', { class: 'field' }, h('span', { text: label }), el);
      const nameIn = h('input', { type: 'text', value: p.name, 'aria-label': 'نام', maxlength: 60, onchange: e => { players.updatePlayer(state, p.id, { name: e.target.value }); commit(true); } });
      const regIn = numInput({ label: 'دستگاه ثبت‌شده (تعداد خرید)', get: () => p.regDevices, set: n => { players.updatePlayer(state, p.id, { regDevices: n }); commit(false); } });
      const tgtIn = numInput({ label: 'دستگاه مشمول تارگت', get: () => p.targetDevices, set: n => { players.updatePlayer(state, p.id, { targetDevices: n }); commit(false); } });
      const grid = h('div', { class: 'pgrid' }, fld('نام', nameIn), fld('تعداد دستگاه ثبت‌شده (خرید)', regIn), fld('دستگاه مشمول تارگت', tgtIn));
      live.push(() => { tgtIn.classList.toggle('invalid', p.targetDevices > p.regDevices); regIn.refresh(); tgtIn.refresh(); });
      if (p.type === 'agent') {
        const desc = new Set(referrals.descendantsOf(state, p.id).map(x => x.id));
        const refSel = h('select', { 'aria-label': 'معرف', onchange: e => { const r = players.updatePlayer(state, p.id, { referrerId: e.target.value || null }); if (!r.ok) toast(r.reason, true); commit(true); } },
          h('option', { value: '', text: '— بدون معرف —' }),
          state.players.filter(x => x.id !== p.id && !desc.has(x.id)).map(x => h('option', { value: x.id, selected: p.referrerId === x.id ? true : null, text: `${x.name} (${reports.typeLabel(x)})` })));
        const fpIn = numInput({
          label: 'خرید اولیه', allowEmpty: true, placeholder: 'ثبت نشده',
          get: () => { const e = referrals.getFirstPurchase(state, p.id); return e ? e.devices : null; },
          set: n => { if (!n) return; const e = referrals.getFirstPurchase(state, p.id);
            const r = e ? referrals.updateFirstPurchase(state, e.id, n) : referrals.registerFirstPurchase(state, p.id, n); if (!r.ok) toast(r.reason, true); commit(false); },
          commit: async n => {
            const e = referrals.getFirstPurchase(state, p.id);
            if (!n && e) { const ok = await dialog({ title: 'حذف خرید اولیه', danger: true, okText: 'حذف', body: `خرید اولیهٔ «${p.name}» حذف و حق معرفی مربوط به آن لغو می‌شود. ادامه می‌دهید؟` });
              if (ok) { referrals.removeFirstPurchase(state, e.id); commit(true); } else fpIn.refresh(); }
          } });
        const chk = (f, label) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: p[f] ? true : null, onchange: e => { players.updatePlayer(state, p.id, { [f]: e.target.checked }); commit(true); } }), label);
        grid.append(fld('معرف مستقیم', refSel), fld('دستگاه خرید اولیه', fpIn));
        live.push(() => { fpIn.refresh(); const e = referrals.getFirstPurchase(state, p.id); fpIn.classList.toggle('invalid', !!e && e.devices > p.regDevices); });
        grid.append(h('div', { class: 'checks-row' }, chk('registrationCompleted', 'ثبت‌نام تکمیل شد'), chk('docsApproved', 'مدارک تأیید شد')));
      }
      const del = h('button', { class: 'btn btn-danger btn-sm', text: 'حذف از شبکه', onclick: async () => {
        const kids = referrals.referralsOf(state, p.id).length;
        const ok = await dialog({ title: 'حذف از شبکه', danger: true, okText: 'حذف', body: `«${p.name}» حذف می‌شود${kids ? ` و ${fa(kids)} زیرمجموعهٔ مستقیمش به معرف بالاتر وصل می‌شوند` : ''}. ادامه می‌دهید؟` });
        if (ok) { storage.snapshotPrev(state); players.removePlayer(state, p.id); ui.selected = null; commit(true); toast('حذف شد. (بازگردانی در تب «داده و پشتیبان»)'); }
      } });
      panel.append(h('div', { class: 'sec-head' }, h('div', null, h('h2', null, p.name, ' ', h('span', { class: 'tag ' + p.type, text: reports.typeLabel(p) })),
        h('p', { text: p.type === 'partner' ? 'درآمد شریک = خرید خودش + حق معرفی نمایندگان مستقیمش + حق ثبت همهٔ نمایندگان زیر او.' : 'درآمد نماینده = خرید خودش + حق معرفی نمایندگانی که مستقیم معرفی کرده.' })), del),
        grid, incomeBox);
      renderIncome();
    }

    const bar = h('div', { class: 'row net-bar' },
      h('label', { class: 'field grow' }, h('span', { text: 'افزودن شریک' }), pName),
      h('button', { class: 'btn', text: 'افزودن شریک', onclick: addPartner }),
      h('span', { class: 'muted small', text: 'برای افزودن نماینده، روی هر گره عدد را بنویسید و «+ نماینده» را بزنید.' }));

    root.append(
      h('div', { class: 'dash-head' }, h('div', null, h('h2', { text: 'شبکهٔ فروش' }),
        h('p', { text: 'هر کارت نشان می‌دهد آن پلیر چقدر از فعالیت خودش و چقدر از زیرمجموعه‌اش درآمد دارد. روی کارت بزنید تا جزئیات و ورودی‌هایش را ببینید.' }))),
      h('section', { class: 'sec' }, bar),
      h('div', { class: 'net-layout' }, h('section', { class: 'sec tree-sec' }, treeBox), panel));
    renderTree(); renderPanel();
    return { refresh() { renderTree(); renderIncome(); live.forEach(f => f()); } };
  }

  /* ================= ۳) گزارش نهایی توزیع ================= */
  function viewReport(root) {
    const dist = reports.distribution(state, result, { sort: ui.sortTotal ? 'total' : 'order' });
    const B = result.baskets;
    const statusBadge = b => h('span', { class: 'status-box ' + b.status, text: b.status === 'short' ? 'کسری' : b.status === 'empty' ? 'بدون داده' : 'کافی' });
    const bRow = b => h('tr', null, h('td', { text: b.label }), h('td', { class: 'n' }, num(b.pool)), h('td', { class: 'n' }, num(b.committed)),
      h('td', { class: 'n ' + (b.remaining < 0 ? 'bad-t' : '') }, b.remaining < 0 ? h('span', null, 'کسری ', num(-b.remaining)) : num(b.remaining)), h('td', { class: 'n' }, statusBadge(b)));
    const anyShort = B.partner.status === 'short' || B.agent.status === 'short';
    const sum = h('section', { class: 'sec' },
      h('div', { class: 'sec-head' }, h('div', null, h('h2', { text: 'گزارش توزیع پاداش' }), h('p', { text: 'دو سبد بودجه مستقل‌اند؛ مازاد یکی کسری دیگری را پوشش نمی‌دهد.' })),
        h('div', { class: 'row no-print' },
          h('button', { class: 'btn', text: 'چاپ / ذخیره PDF', onclick: doPrint }),
          h('button', { class: 'btn btn-ghost', text: 'CSV گزارش', onclick: () => exporter.download(`reward-report-${exporter.stamp()}.csv`, reports.reportCSV(state, result), 'text/csv') }),
          h('button', { class: 'btn btn-ghost', text: 'CSV پلیرها', onclick: () => exporter.download(`players-${exporter.stamp()}.csv`, reports.playersCSV(state, result), 'text/csv') }))),
      h('div', { class: 'banner ' + (anyShort ? 'err' : (state.players.length ? 'ok' : 'warn')), role: 'status' },
        anyShort ? h('span', null, h('strong', { text: 'کسری بودجه: ' }), [B.partner, B.agent].filter(b => b.status === 'short').map(b => h('span', null, `${b.label}: `, num(b.shortfall), ' تومان  '))) :
          state.players.length ? h('strong', { text: 'بودجهٔ هر دو سبد برای تعهدات محاسبه‌شده کافی است.' }) : 'پلیری ثبت نشده است.'),
      h('div', { class: 'tbl-wrap', style: { marginTop: '10px' } }, h('table', { class: 'dt' },
        h('thead', null, h('tr', null, ['سبد بودجه', 'بودجه کل', 'مجموع تعهد', 'مانده', 'وضعیت'].map(t => h('th', { text: t })))),
        h('tbody', null, bRow(B.partner), bRow(B.agent)))));

    const dRows = dist.rows.map(r => h('tr', null, h('td', { text: r.name }), h('td', null, h('span', { class: 'tag ' + r.type, text: r.typeLabel })),
      h('td', { class: 'n', text: fa(r.referralCount) }), h('td', { class: 'n' }, num(r.own)), h('td', { class: 'n' }, num(r.referral)), h('td', { class: 'n' }, num(r.network)),
      h('td', { class: 'n' }, num(r.total)), h('td', { class: 'n', text: pct(r.share) })));
    const dsec = h('section', { class: 'sec' },
      h('div', { class: 'sec-head' }, h('div', null, h('h2', { text: 'توزیع پاداش به تفکیک دریافت‌کننده' }),
        h('p', { text: 'خرید خود = حق ثبت و تارگت · معرفی = حق معرفی نمایندگان مستقیم · ثبت شبکه = حق ثبت نمایندگان زیر شریک (فقط شریک)' })),
        h('label', { class: 'chk no-print' }, h('input', { type: 'checkbox', checked: ui.sortTotal ? true : null, onchange: e => { ui.sortTotal = e.target.checked; renderView(); } }), 'مرتب‌سازی بر اساس جمع پاداش')),
      state.players.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'dt' },
        h('thead', null, h('tr', null, ['دریافت‌کننده', 'نقش', 'تعداد معرفی', 'خرید خود', 'معرفی', 'ثبت شبکه', 'جمع کل (تومان)', 'سهم'].map(t => h('th', { text: t })))),
        h('tbody', null, dRows),
        h('tfoot', null, h('tr', null, h('td', { colspan: 2, text: 'جمع کل' }), h('td', { class: 'n', text: fa(dist.totals.referralCount) }), h('td', { class: 'n' }, num(dist.totals.own)),
          h('td', { class: 'n' }, num(dist.totals.referral)), h('td', { class: 'n' }, num(dist.totals.network)), h('td', { class: 'n' }, num(dist.totals.total)), h('td', { class: 'n', text: dist.totals.total ? pct(1) : pct(0) }))))) :
        h('div', { class: 'empty-state', text: 'پلیری ثبت نشده است.' }));
    root.append(sum, dsec);
    return { refresh() { renderView(); } };
  }
  const pct = s => calc.toFaDigits((s * 100).toFixed(1)) + '٪';

  function doPrint() {
    document.getElementById('print-date').textContent = new Date().toLocaleDateString('fa-IR-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' }).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
    exporter.printPage();
  }

  /* ================= ۴) فرمول‌ها و فرض‌ها ================= */
  function viewGuide(root) {
    const li = (...k) => h('li', null, ...k);
    const rule = c => h('tr', null, h('td', { text: calc.TYPE_BY_CODE[c].label }), h('td', { class: 'n' }, num(result.rates[c])), h('td', { text: ruleText(c) }));
    root.append(
      h('section', { class: 'sec' }, h('h2', { text: 'سه قانون موتور' }),
        h('ol', { class: 'assume' },
          li(h('b', { text: 'پاداش خرید خود. ' }), 'هر شریک یا نماینده: تعداد دستگاه ثبت‌شده × نرخ ثبت، و تعداد دستگاه مشمول تارگت × نرخ تارگت.'),
          li(h('b', { text: 'حق معرفی. ' }), 'هر کس (شریک یا نماینده) که مستقیم نماینده‌ای را معرفی کند: دستگاه‌های خرید اولیهٔ آن نماینده × نرخ معرفی؛ فقط یک‌بار، فقط به معرف مستقیم، و فقط وقتی ثبت‌نام، مدارک و خرید اولیه (حداقل ۱ دستگاه) کامل باشد.'),
          li(h('b', { text: 'حق ثبت شبکه (فقط شریک). ' }), 'شریک از هر نماینده‌ای که خودش یا نمایندگان زیر او معرفی کرده‌اند: دستگاه‌های قدیم × نرخ قدیم و دستگاه‌های جدید × نرخ جدید.'))),
      h('section', { class: 'sec' }, h('h2', { text: 'نرخ‌های جاری' }),
        h('div', { class: 'tbl-wrap' }, h('table', { class: 'dt' },
          h('thead', null, h('tr', null, ['نوع پاداش', 'نرخ (تومان)', 'قاعده'].map(t => h('th', { text: t })))),
          h('tbody', null, ['P_REG', 'P_TARGET', 'A_REG', 'A_TARGET', 'REF_AGENT', 'REF_PARTNER', 'OLD_REG_PARTNER', 'NEW_REG_PARTNER'].map(rule))))),
      h('section', { class: 'sec' }, h('h2', { text: 'فرض‌ها (برای تأیید تیم فنی)' }),
        h('ol', { class: 'assume' },
          li(h('b', { text: 'مبنای بودجه. ' }), 'نرخ‌ها «به‌ازای هر دستگاه» هستند. بودجهٔ هر سبد = بودجهٔ هر دستگاه × تعداد دستگاه‌های ثبت‌شدهٔ همان گروه؛ دو سبد مستقل‌اند و سقف دستی وجود ندارد.'),
          li(h('b', { text: 'نماینده جدید / قدیم. ' }), 'دستگاه‌های خرید اولیهٔ هر نماینده «جدید» و بقیهٔ دستگاه‌های ثبت‌شدهٔ او «قدیم» حساب می‌شود.'),
          li(h('b', { text: 'شریک هر نماینده. ' }), 'با بالا رفتن از زنجیر معرف‌ها تا اولین شریک مشخص می‌شود؛ فیلد جداگانه‌ای وجود ندارد. نمایندهٔ بدون شریک در بالای زنجیر، حق ثبت شبکه‌ای برای هیچ شریکی نمی‌سازد.'),
          li(h('b', { text: 'خرید اولیه. ' }), 'یک رویداد یکتا برای هر نماینده است؛ ثبت دوم رد می‌شود و خریدهای بعدی حق معرفی جدیدی نمی‌سازد.'),
          li(h('b', { text: 'سقف تعداد معرفی. ' }), 'تعداد معرفی‌های مستقیم هر پلیر سقف ندارد. شریک معرف‌شونده نیست و فقط نماینده معرفی می‌شود.'))));
    return { refresh() { /* ایستا */ } };
  }
  function ruleText(code) {
    return ({
      P_REG: 'تعداد دستگاه ثبت‌شدهٔ شریک × نرخ',
      P_TARGET: 'تعداد دستگاه مشمول تارگت شریک × نرخ',
      A_REG: 'تعداد دستگاه ثبت‌شدهٔ نماینده × نرخ',
      A_TARGET: 'تعداد دستگاه مشمول تارگت نماینده × نرخ',
      REF_AGENT: 'دستگاه‌های خرید اولیهٔ نمایندهٔ معرفی‌شده × نرخ؛ به نمایندهٔ معرف مستقیم، یک‌بار',
      REF_PARTNER: 'دستگاه‌های خرید اولیهٔ نمایندهٔ معرفی‌شده × نرخ؛ به شریک معرف مستقیم، یک‌بار',
      OLD_REG_PARTNER: 'دستگاه‌های قدیمِ نمایندگان زیر شریک × نرخ',
      NEW_REG_PARTNER: 'دستگاه‌های خرید اولیهٔ نمایندگان زیر شریک × نرخ'
    })[code];
  }

  /* ================= ۶) داده و پشتیبان ================= */
  function viewData(root) {
    const prev = storage.loadPrev();
    const testOut = h('div');
    const runTests = () => {
      const go = () => {
        const res = TT.tests.runAll(); clear(testOut);
        const fail = res.filter(r => !r.pass).length;
        testOut.append(h('div', { class: 'banner ' + (fail ? 'err' : 'ok') }, h('strong', { text: `${fa(res.length - fail)} از ${fa(res.length)} آزمون PASS` + (fail ? ` — ${fa(fail)} FAIL` : '') })),
          h('ul', { class: 'tests-out' }, res.map(r => h('li', { class: r.pass ? 'p' : 'f' }, h('span', { class: 'pill', text: r.pass ? 'PASS' : 'FAIL' }), h('span', null, r.name, r.pass ? null : h('div', { class: 'small bad-t', text: r.error }))))));
      };
      if (TT.tests) return go();
      const s = h('script', { src: 'tests/calculation-tests.js' }); s.onload = go; s.onerror = () => toast('بارگذاری فایل آزمون ناموفق بود.', true); document.head.append(s);
    };
    const act = (title, desc, ...btns) => h('div', { class: 'sec' }, h('h3', { text: title }), h('p', { class: 'muted small', text: desc }), h('div', { class: 'row' }, btns));
    root.append(
      h('section', null,
        act('پشتیبان‌گیری', 'نسخهٔ کامل اطلاعات (تنظیمات، پلیرها، معرفی‌ها و خرید اولیه‌ها) در یک فایل JSON.',
          h('button', { class: 'btn', text: 'دانلود پشتیبان JSON', onclick: () => { exporter.download(`techno-reward-backup-${exporter.stamp()}.json`, storage.buildBackup(state), 'application/json'); toast('پشتیبان دانلود شد.'); } })),
        act('بازیابی از فایل پشتیبان', 'داده‌های فعلی جایگزین می‌شوند؛ پیش از آن، یک نسخهٔ قابل بازگردانی نگه داشته می‌شود.',
          h('button', { class: 'btn btn-ghost', text: 'انتخاب فایل JSON…', onclick: async () => {
            try {
              const f = await exporter.pickTextFile('.json,application/json');
              const b = storage.parseBackup(f.text);
              const ok = await dialog({ title: 'بازیابی اطلاعات', okText: 'جایگزین کن', danger: true, body: `فایل «${f.name}» شامل ${fa(b.summary.players)} پلیر و ${fa(b.summary.firstPurchases)} خرید اولیه است. داده‌های فعلی جایگزین می‌شوند.` });
              if (ok) { storage.snapshotPrev(state); state = b.state; commit(true); toast('اطلاعات بازیابی شد.'); }
            } catch (e) { if (e && e.message !== 'فایلی انتخاب نشد.') toast(e.message, true); }
          } })),
        act('داده نمونه', 'چهار پلیر نمونه (یک شریک و سه نماینده با زنجیرهٔ معرفی) برای دیدن عملکرد موتور.',
          h('button', { class: 'btn btn-ghost', text: 'بارگذاری داده نمونه', onclick: async () => {
            if (state.players.length) { const ok = await dialog({ title: 'جایگزینی با داده نمونه', okText: 'ادامه', danger: true, body: 'پلیرهای فعلی با داده نمونه جایگزین می‌شوند. (قابل بازگردانی)' }); if (!ok) return; }
            storage.snapshotPrev(state); state = players.sampleState(); commit(true); toast('داده نمونه بارگذاری شد.');
          } })),
        act('پاک‌سازی', 'حذف پلیرها و بازگشت تنظیمات به مقادیر اکسل. پیش از پاک‌سازی یک نسخهٔ قابل بازگردانی ذخیره می‌شود.',
          h('button', { class: 'btn btn-danger', text: 'پاک‌سازی همهٔ اطلاعات', onclick: async () => {
            const ok = await dialog({ title: 'پاک‌سازی همهٔ اطلاعات', okText: 'بله، پاک شود', danger: true, body: `${fa(state.players.length)} پلیر، ${fa(state.firstPurchases.length)} خرید اولیه و تنظیمات شما حذف می‌شود. پیشنهاد می‌شود ابتدا پشتیبان JSON بگیرید.` });
            if (ok) { storage.snapshotPrev(state); state = players.newState(); commit(true); toast('پاک‌سازی انجام شد. بازگردانی ممکن است.'); }
          } }),
          prev ? h('button', { class: 'btn btn-ghost', text: 'بازگردانی حالت قبلی', onclick: () => { const cur = state; state = prev.state; storage.snapshotPrev(cur); commit(true); toast('حالت قبلی بازگردانی شد.'); } }) : null),
        act('وضعیت ذخیره‌سازی', storage.isPersistent() ? 'اطلاعات به‌صورت خودکار در حافظهٔ همین مرورگر ذخیره می‌شود و پس از بستن/باز کردن برنامه می‌ماند.' : 'ذخیره‌سازی مرورگر در دسترس نیست — حتماً پشتیبان JSON بگیرید.',
          h('button', { class: 'btn btn-ghost', text: 'درخواست ذخیرهٔ پایدار', onclick: async () => { const r = await storage.requestPersistence(); toast(r ? 'ذخیرهٔ پایدار فعال شد.' : 'مرورگر ذخیرهٔ پایدار را تأیید نکرد.'); } })),
        h('div', { class: 'sec' }, h('h3', { text: 'آزمون‌های خودکار محاسبات' }), h('p', { class: 'muted small', text: 'سناریوهای ۱ تا ۹ و تطبیق با اکسل؛ روی داده‌های موقت اجرا می‌شود و اطلاعات شما را تغییر نمی‌دهد.' }),
          h('button', { class: 'btn', text: 'اجرای آزمون‌ها', onclick: runTests }), testOut)));
    return { refresh() { /* ایستا */ } };
  }

  /* ================= راه‌اندازی ================= */
  function init() {
    storage.setOnSaved(setSaveStatus);
    renderTabs(); renderBanner(); renderView();
    if (loaded.source === 'saved') document.getElementById('save-status').textContent = 'اطلاعات قبلی بازیابی شد';
    if (loaded.source === 'error') toast('داده ذخیره‌شده خراب بود؛ با حالت پیش‌فرض شروع شد.', true);
    storage.requestPersistence();
    window.addEventListener('pagehide', storage.flush);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') storage.flush(); });
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault(); deferredInstall = e;
      const b = document.getElementById('btn-install'); b.hidden = false;
      b.onclick = async () => { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; b.hidden = true; };
    });
    window.addEventListener('appinstalled', () => { document.getElementById('btn-install').hidden = true; });
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* آفلاین‌نبودن، مانع کار برنامه نیست */ });
    }
    // Splash: دقیقاً ۵ ثانیه، سپس انتقال نرم به داشبورد
    const left = Math.max(0, SPLASH_MS - (performance.now() - splashStart));
    setTimeout(() => {
      const sp = document.getElementById('splash');
      document.getElementById('app').hidden = false;
      sp.classList.add('leaving');
      setTimeout(() => sp.remove(), 700);
    }, left);
  }
  window.TT.app = { get state() { return state; }, get result() { return result; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
