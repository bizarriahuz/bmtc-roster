import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

const SUPABASE_URL = 'https://zyjwmglfitwupjwnvpug.supabase.co';
const SUPABASE_KEY = 'sb_publishable_y68yv8xu29T5sdD5a2B46Q_-uH4Sdfe';
const API = `${SUPABASE_URL}/functions/v1/bmtc/api`;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const SLOTS = ['AM', 'MID1', 'MID2', 'PM'];
const SLOT_LABEL = { AM: 'AM', MID1: 'Mid 1', MID2: 'Mid 2', PM: 'PM' };
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const S = { me: null, people: [], byId: new Map(), companies: [], config: {}, gridDate: null, school: 'All', adminTab: 'people', changesSeen: 0 };
const $app = document.getElementById('app');

// ---------- utils ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function sgToday(off = 0) { return new Date(Date.now() + 8 * 3600e3 + off * 86400e3).toISOString().slice(0, 10); }
function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function fmt(iso, long) { const d = new Date(iso + 'T00:00:00Z'); return long ? `${DOW[d.getUTCDay()]}, ${d.getUTCDate()} ${MON[d.getUTCMonth()]}` : `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; }
function rel(iso) { return iso === sgToday() ? 'Today' : iso === sgToday(1) ? 'Tomorrow' : iso === sgToday(-1) ? 'Yesterday' : ''; }
function ago(ts) { const s = (Date.now() - new Date(ts)) / 1000; if (s < 90) return 'just now'; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`; return `${Math.round(s / 86400)} d ago`; }
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 3200); }
function describe(a) {
  const rel = a.slots || SLOTS.filter((s) => a.lessons?.[s]);
  const parts = rel.map((s) => (a.lessons?.[s] ? `${SLOT_LABEL[s]} ${a.lessons[s]}` : SLOT_LABEL[s]));
  return parts.length ? parts.join(', ') : 'Full day';
}
async function api(action, body = {}) {
  const { data: { session } } = await sb.auth.getSession();
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) },
    body: JSON.stringify({ action, ...body }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}
const icon = {
  me: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 4v17M14 4v17"/></svg>',
  set: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg>',
};
const MARK = '<svg class="mark" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#3d5a2e"/><path d="M14 22h36M14 32h36M14 42h24" stroke="#e3ead9" stroke-width="5" stroke-linecap="round"/><circle cx="46" cy="42" r="5" fill="#f0a16a"/></svg>';

// ---------- auth ----------
async function startSession(token_hash) {
  await sb.auth.signOut().catch(() => {});
  const { error } = await sb.auth.verifyOtp({ token_hash, type: 'magiclink' });
  if (error) throw error;
  history.replaceState(null, '', location.pathname + '#me');
  location.reload();
}

async function boot() {
  const j = location.hash.match(/join=([A-Za-z0-9_-]+)/);
  if (j) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return renderJoin(j[1]);
    history.replaceState(null, '', location.pathname + '#me');
  }
  const m = location.hash.match(/login=([A-Za-z0-9_-]+)/);
  if (m) {
    $app.innerHTML = '<div class="spin"></div>';
    try {
      await sb.auth.signOut().catch(() => {});
      const { token_hash } = await api('exchange-login', { code: m[1] });
      const { error } = await sb.auth.verifyOtp({ token_hash, type: 'magiclink' });
      if (error) throw error;
      history.replaceState(null, '', location.pathname + '#me');
    } catch (e) {
      history.replaceState(null, '', location.pathname);
      return renderLogin(e.message);
    }
  }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return renderLogin();
  const { data: me } = await sb.from('instructors').select('*').eq('user_id', session.user.id).maybeSingle();
  if (!me || !me.active) { await sb.auth.signOut(); return renderLogin('Your access has been removed. Ask an admin.'); }
  S.me = me;
  await loadBase();
  registerSW();
  window.addEventListener('hashchange', route);
  route();
}

async function renderLogin(err) {
  $app.innerHTML = `<div class="login">
    ${MARK}
    <h1>BMTC Roster</h1>
    <p class="muted">PT deployment schedule for BMTC instructors.</p>
    ${err ? `<div class="banner">${esc(err)}</div>` : ''}
    <form id="lf" style="text-align:left;margin-top:18px">
      <label class="small muted">Your name (as on the roster)</label>
      <input type="text" id="ln" autocomplete="username" autocapitalize="words" required>
      <label class="small muted" style="display:block;margin-top:10px">PIN</label>
      <input type="password" id="lp" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="current-password" required>
      <button class="btn primary block" style="margin-top:14px">Sign in</button>
    </form>
    <p class="small muted" style="margin-top:14px">First time? Open the join link posted in your team group.<br>Forgot your PIN? Ask an admin to reset it.</p>
  </div>`;
  document.getElementById('lf').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button'); btn.disabled = true;
    try {
      const { token_hash } = await api('pin-login', { name: document.getElementById('ln').value, pin: document.getElementById('lp').value });
      await startSession(token_hash);
    } catch (err2) { toast(err2.message); btn.disabled = false; }
  };
}

async function renderJoin(code) {
  $app.innerHTML = '<div class="spin"></div>';
  let names;
  try { ({ names } = await api('join-names', { code })); }
  catch (e) { history.replaceState(null, '', location.pathname); return renderLogin(e.message); }
  $app.innerHTML = `<div class="login">
    ${MARK}
    <h1>Join BMTC Roster</h1>
    <p class="muted">See your PT deployment schedule and get alerts when it changes.</p>
    <form id="jf" style="text-align:left;margin-top:18px">
      <label class="small muted">1. Pick your name</label>
      <select id="jn" required><option value="">Choose…</option>${names.map((n) => `<option value="${n.id}">${esc(n.name)}</option>`).join('')}</select>
      <label class="small muted" style="display:block;margin-top:10px">2. Choose a 4–6 digit PIN</label>
      <input type="password" id="jp" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" autocomplete="new-password" required>
      <label class="small muted" style="display:block;margin-top:10px">Type the PIN again</label>
      <input type="password" id="jp2" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" autocomplete="new-password" required>
      <button class="btn primary block" style="margin-top:14px">Join</button>
    </form>
    <p class="small muted" style="margin-top:14px">Name not in the list? It's either already taken or not on the roster yet. Ask an admin.<br>Already joined? <a href="#" id="tologin">Sign in</a></p>
  </div>`;
  document.getElementById('tologin').onclick = (e) => { e.preventDefault(); history.replaceState(null, '', location.pathname); renderLogin(); };
  document.getElementById('jf').onsubmit = async (e) => {
    e.preventDefault();
    const pin = document.getElementById('jp').value, pin2 = document.getElementById('jp2').value;
    if (!/^[0-9]{4,6}$/.test(pin)) return toast('PIN must be 4 to 6 digits');
    if (pin !== pin2) return toast("The two PINs don't match");
    const btn = e.target.querySelector('button'); btn.disabled = true;
    try {
      const { token_hash } = await api('join', { code, instructor_id: document.getElementById('jn').value, pin });
      await startSession(token_hash);
    } catch (err) { toast(err.message); btn.disabled = false; }
  };
}

async function loadBase() {
  const [p, c, cfg] = await Promise.all([
    sb.from('instructors').select('id,name,school,aliases,is_admin,active,user_id').order('name'),
    sb.from('companies').select('*').order('sort'),
    api('public-config').catch(() => ({})),
  ]);
  S.people = p.data || [];
  S.byId = new Map(S.people.map((x) => [x.id, x]));
  S.companies = c.data || [];
  S.config = cfg;
}

// ---------- shell ----------
async function shell(active, html) {
  const tab = (id, label, ic, badge) => `<a href="#${id}" class="${active === id ? 'on' : ''}">${ic}${label}${badge ? `<span class="dot">${badge}</span>` : ''}</a>`;
  $app.innerHTML = `
    <header class="top"><span class="brand">BMTC Roster</span><span class="who">${esc(S.me.name)}</span></header>
    <main id="view">${html}</main>
    <nav class="tabs">
      ${tab('me', 'My roster', icon.me)}${tab('grid', 'All coys', icon.grid)}
      ${tab('settings', 'Settings', icon.set)}${S.me.is_admin ? tab('admin', 'Admin', icon.admin) : ''}
    </nav>`;
}

function route() {
  const h = (location.hash.replace('#', '').split('&')[0]) || 'me';
  ({ me: viewMe, grid: viewGrid, settings: viewSettings, admin: S.me.is_admin ? viewAdmin : viewMe }[h] || viewMe)();
  window.scrollTo(0, 0);
}

// ---------- shared pieces ----------
// Colour-coded slot pills. On "My roster" (highlightAll) your own slots get an outline, the rest are faded.
function slotRow(lessons, mySlots, highlightAll) {
  const used = SLOTS.filter((s) => lessons?.[s] || (mySlots && mySlots.includes(s)));
  if (!used.length) return '';
  return `<div class="slots">${used.map((s) => {
    const mine = !mySlots || mySlots.includes(s);
    const cls = highlightAll ? (mine ? 'mine' : 'dim') : '';
    return `<span class="slot ${s} ${cls}"><b>${SLOT_LABEL[s]}</b>${esc(lessons?.[s] || '—')}</span>`;
  }).join('')}</div>`;
}
// Category colours for staff remarks (MC / leave / off / course) and company notes (NO PT / events / holidays)
function remarkCat(t) {
  const x = String(t).toLowerCase();
  if (/\bmc\b|medical|hospital|\bhl\b/.test(x)) return 'cat-mc';
  if (/\boil\b|\boff\b|in lieu/.test(x)) return 'cat-off';
  if (/course|school|assessment|refresher|training|sfa|\btrg\b/.test(x)) return 'cat-crs';
  if (/\bal\b|\bul\b|\bnpl\b|leave|\bloa\b|paternal|maternal|celebration|childcare/.test(x)) return 'cat-lv';
  return '';
}
function noteCat(t) {
  const x = String(t).toLowerCase();
  if (/deepavali|diwali|hari raya|christmas|new year|ny day|chinese new|vesak|good friday|national day|labour day|public holiday|\bph\b/.test(x)) return 'cat-hol';
  if (/no pt/.test(x)) return 'cat-nopt';
  if (/enlist|camp|ifc|field|route march|graduation|pop\b|ippt/.test(x)) return 'cat-ev';
  return '';
}
function personChip(id, slots) {
  const p = S.byId.get(id);
  const label = p ? p.name : '?';
  return `<span class="chip ${id === S.me.id ? 'me' : ''}">${esc(label)}${slots ? slots.map((s) => `<span class="st ${s}">${SLOT_LABEL[s]}</span>`).join('') : ''}</span>`;
}

// ---------- My roster ----------
async function viewMe() {
  await shell('me', '<div class="spin"></div>');
  const today = sgToday(), until = addDays(today, 20);
  const [{ data: mine }, { data: changes }, { data: myRemarks }] = await Promise.all([
    sb.from('assignments').select('*').eq('instructor_id', S.me.id).gte('date', today).lte('date', until).order('date'),
    sb.from('changes').select('*').eq('instructor_id', S.me.id).order('created_at', { ascending: false }).limit(8),
    sb.from('remarks').select('*').eq('instructor_id', S.me.id).gte('date', today).lte('date', until),
  ]);
  const keys = [...new Set((mine || []).map((a) => `${a.date}|${a.company}`))];
  let others = [];
  if (keys.length) {
    const dates = [...new Set((mine || []).map((a) => a.date))];
    const { data } = await sb.from('assignments').select('date,company,instructor_id,slots').in('date', dates);
    others = (data || []).filter((o) => keys.includes(`${o.date}|${o.company}`) && o.instructor_id !== S.me.id);
  }
  const byDate = new Map();
  for (const a of mine || []) { if (!byDate.has(a.date)) byDate.set(a.date, []); byDate.get(a.date).push(a); }
  const remarkByDate = new Map((myRemarks || []).map((r) => [r.date, r.text]));

  const dayCard = (date, list, isToday) => `
    <div class="card ${isToday ? 'today' : ''}">
      <div class="row between"><span class="big">${rel(date) ? `${rel(date)} <span class="muted small" style="font-weight:500">${fmt(date)}</span>` : fmt(date, true)}</span>
      ${remarkByDate.get(date) ? `<span class="chip cat ${remarkCat(remarkByDate.get(date)) || 'cat-lv'}">${esc(remarkByDate.get(date))}</span>` : ''}</div>
      ${list.length ? list.map((a) => {
        const co = others.filter((o) => o.date === a.date && o.company === a.company);
        return `<div style="margin-top:12px">
          <div class="coy">${esc(a.company)}</div>
          ${slotRow(a.lessons, a.slots, true)}
          ${co.length ? `<div class="row wrap" style="margin-top:8px;gap:4px"><span class="small muted">With</span>${co.map((o) => personChip(o.instructor_id, o.slots)).join('')}</div>` : ''}
        </div>`;
      }).join('') : '<div class="note">Nothing on the roster.</div>'}
    </div>`;

  let html = '';
  if (!S.config.bot_username) html += '';
  html += dayCard(today, byDate.get(today) || [], true);
  const tom = sgToday(1);
  if (!byDate.has(tom)) html += dayCard(tom, [], false);
  const upcoming = [...byDate.keys()].filter((d) => d !== today).sort();
  html += `<h2>Coming up</h2>`;
  html += upcoming.length ? upcoming.map((d) => dayCard(d, byDate.get(d), false)).join('') : '<div class="empty">No more slots in the next 3 weeks.</div>';

  if (changes?.length) {
    html += `<h2>Recent changes to your schedule</h2><div class="card">${changes.map((c) => `
      <div class="change ${c.kind}">
        <div><b>${fmt(c.date)}</b> · ${esc(c.company)} ${c.last_minute ? '<span class="chip warn">last-minute</span>' : ''}</div>
        <div class="small">${c.kind === 'added' ? 'Added: ' + esc(describe(c.after)) : c.kind === 'removed' ? 'Removed (was ' + esc(describe(c.before)) + ')' : esc(describe(c.before)) + ' → <b>' + esc(describe(c.after)) + '</b>'}</div>
        <div class="small muted">${ago(c.created_at)}</div>
      </div>`).join('')}</div>`;
  }
  document.getElementById('view').innerHTML = html;
}

// ---------- All companies (day view) ----------
async function viewGrid() {
  if (!S.gridDate) S.gridDate = sgToday();
  await shell('grid', '<div class="spin"></div>');
  const d = S.gridDate;
  const [{ data: as }, { data: notes }, { data: remarks }] = await Promise.all([
    sb.from('assignments').select('*').eq('date', d),
    sb.from('day_notes').select('*').eq('date', d),
    sb.from('remarks').select('*').eq('date', d),
  ]);
  // week strip (Mon-Sun around the date)
  const dt = new Date(d + 'T00:00:00Z'); const mon = addDays(d, -((dt.getUTCDay() + 6) % 7));
  const strip = [-7, 0, 1, 2, 3, 4, 5, 6, 7].map((i) => addDays(mon, i));
  const schools = ['All', ...new Set(S.companies.map((c) => c.school).filter(Boolean))];
  const coys = S.companies.filter((c) => S.school === 'All' || c.school === S.school);

  let html = `<div class="row between" style="margin-bottom:8px"><h1 style="margin:0">${fmt(d, true)}</h1>${rel(d) ? `<span class="chip">${rel(d)}</span>` : ''}</div>
    <div class="daybar">${strip.map((x, i) => i === 0 ? `<button data-d="${x}">‹<small>prev wk</small></button>`
      : i === 8 ? `<button data-d="${x}">›<small>next wk</small></button>`
      : `<button data-d="${x}" class="${x === d ? 'on' : ''}">${DOW[new Date(x + 'T00:00:00Z').getUTCDay()]}<small>${new Date(x + 'T00:00:00Z').getUTCDate()}</small></button>`).join('')}</div>
    <div class="seg">${schools.map((s) => `<button data-s="${esc(s)}" class="${s === S.school ? 'on' : ''}">${esc(s)}</button>`).join('')}</div>
    <div class="legend">${SLOTS.map((x) => `<span class="slot ${x}" style="padding:2px 8px;font-size:12px"><b style="margin:0">${SLOT_LABEL[x]}</b></span>`).join('')}</div>`;

  if (remarks?.length && (S.school === 'All')) {
    html += `<div class="card"><div class="small muted" style="margin-bottom:6px;font-weight:600">STAFF REMARKS</div><div class="row wrap" style="gap:4px">${remarks.map((r) => `<span class="chip cat ${remarkCat(r.text)}" ${r.instructor_id === S.me.id ? 'style="font-weight:700"' : ''}>${esc(r.text)}</span>`).join('')}</div></div>`;
  }
  let shown = 0;
  for (const c of coys) {
    const list = (as || []).filter((a) => a.company === c.name);
    const note = (notes || []).find((n) => n.company === c.name);
    if (!list.length && !note) continue;
    shown++;
    const lessons = list[0]?.lessons || {};
    const isMine = list.some((a) => a.instructor_id === S.me.id);
    html += `<div class="card ${isMine ? 'today' : ''}">
      <div class="row between"><span class="coy">${esc(c.name)}</span><span class="small muted">${esc(c.school || '')}</span></div>
      ${list.length ? slotRow(lessons, null, false) : ''}
      ${list.length ? `<div class="row wrap" style="gap:4px;margin-top:8px">${list.sort((x, y) => (S.byId.get(x.instructor_id)?.name || '').localeCompare(S.byId.get(y.instructor_id)?.name || '')).map((a) => personChip(a.instructor_id, a.slots)).join('')}</div>` : ''}
      ${note ? (noteCat(note.text) ? `<div style="margin-top:8px"><span class="chip cat ${noteCat(note.text)}">${esc(note.text)}</span></div>` : `<div class="note">${esc(note.text)}</div>`) : ''}
    </div>`;
  }
  if (!shown) html += '<div class="empty">Nothing scheduled for this day.</div>';
  document.getElementById('view').innerHTML = html;
  document.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => { S.gridDate = b.dataset.d; viewGrid(); });
  document.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { S.school = b.dataset.s; viewGrid(); });
}

// ---------- Settings ----------
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;

async function viewSettings() {
  await shell('settings', '<div class="spin"></div>');
  const { data: c } = await sb.from('contacts').select('*').eq('instructor_id', S.me.id).maybeSingle();
  const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window;
  let pushOn = false;
  if (pushSupported) { const reg = await navigator.serviceWorker.getRegistration(); pushOn = !!(await reg?.pushManager.getSubscription()); }
  const theme = (() => { try { return localStorage.getItem('theme') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; } })();

  document.getElementById('view').innerHTML = `<h1>Settings</h1>
    <div class="card">
      <div class="row between"><div><b>Telegram alerts</b><div class="small muted">${c?.telegram_chat_id ? `Linked${c.telegram_username ? ' as @' + esc(c.telegram_username) : ''}` : 'Optional. The most reliable way to get last-minute changes.'}</div></div>
      ${c?.telegram_chat_id ? '<span class="chip ok">On</span>' : ''}</div>
      ${c?.telegram_chat_id ? '' : '<button class="btn primary" id="tg-on" style="margin-top:10px">Get alerts on Telegram</button><p class="small muted" id="tg-hint" style="display:none">Telegram opens: press <b>Start</b>. Then come back here.</p>'}
    </div>
    <div class="card">
      <div class="row between"><div><b>Phone notifications</b><div class="small muted">Shown by this app on your phone.</div></div>
      ${pushOn ? '<span class="chip ok">On</span>' : ''}</div>
      ${!pushSupported ? `<p class="small muted">${isIOS && !standalone ? 'On iPhone: tap Share → <b>Add to Home Screen</b>, open the app from there, then come back here.' : 'This browser does not support notifications.'}</p>`
        : pushOn ? '' : `<button class="btn primary" id="push-on" style="margin-top:10px">Turn on notifications</button>`}
    </div>
    <div class="card">
      <label class="tog"><span>Alerts on Telegram</span><input type="checkbox" data-k="notify_telegram" ${c?.notify_telegram !== false ? 'checked' : ''} ${c ? '' : 'disabled'}></label>
      <label class="tog"><span>Alerts as phone notifications</span><input type="checkbox" data-k="notify_push" ${c?.notify_push !== false ? 'checked' : ''} ${c ? '' : 'disabled'}></label>
      <label class="tog"><span>Daily reminders<div class="small muted">6:30am today · 12pm afternoon · 7pm tomorrow</div></span><input type="checkbox" data-k="nightly_reminder" ${c?.nightly_reminder !== false ? 'checked' : ''} ${c ? '' : 'disabled'}></label>
    </div>
    <div class="card"><label class="tog" style="border:0;padding:0"><span><b>Dark mode</b></span><input type="checkbox" id="theme" ${theme === 'dark' ? 'checked' : ''}></label></div>
    <div class="row" style="gap:8px;margin-top:14px">
      <button class="btn" id="test">Send test alert</button>
      <button class="btn danger" id="out" style="margin-left:auto">Sign out</button>
    </div>`;
  document.querySelectorAll('[data-k]').forEach((i) => i.onchange = async () => {
    const { error } = await sb.from('contacts').update({ [i.dataset.k]: i.checked }).eq('instructor_id', S.me.id);
    toast(error ? error.message : 'Saved');
  });
  document.getElementById('push-on')?.addEventListener('click', enablePush);
  document.getElementById('tg-on')?.addEventListener('click', async (e) => {
    const w = window.open('', '_blank');
    try { const { link } = await api('telegram-link'); if (w) w.location = link; else location.href = link; document.getElementById('tg-hint').style.display = 'block'; }
    catch (err) { w?.close(); toast(err.message); }
  });
  document.getElementById('test').onclick = async () => { try { const r = await api('test-notify'); toast(r.ok ? 'Test alert sent' : 'No channel is set up yet'); } catch (e) { toast(e.message); } };
  document.getElementById('out').onclick = async () => { await sb.auth.signOut(); location.hash = ''; location.reload(); };
  document.getElementById('theme').onchange = (e) => { try { localStorage.setItem('theme', e.target.checked ? 'dark' : 'light'); } catch {} applyTheme(); };
}

function applyTheme() {
  let t = 'light'; try { t = localStorage.getItem('theme') === 'dark' ? 'dark' : 'light'; } catch {}
  document.documentElement.setAttribute('data-theme', t);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', t === 'dark' ? '#1f2a1a' : '#3d5a2e');
}
applyTheme();

function b64ToU8(b64) { const p = '='.repeat((4 - (b64.length % 4)) % 4); const s = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, (c) => c.charCodeAt(0)); }
async function enablePush() {
  try {
    if (!S.config.vapid_public_key) throw new Error('Push is not configured');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Notifications were blocked in browser settings');
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(S.config.vapid_public_key) });
    await api('push-subscribe', { subscription: sub.toJSON() });
    toast('Notifications on'); viewSettings();
  } catch (e) { toast(e.message); }
}
function registerSW() { if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {}); }

// ---------- Admin ----------
async function viewAdmin() {
  await shell('admin', '<div class="spin"></div>');
  const tabs = [['people', 'People'], ['names', 'Unknown names'], ['setup', 'Sync & setup']];
  const head = `<h1>Admin</h1><div class="seg">${tabs.map(([k, l]) => `<button data-at="${k}" class="${S.adminTab === k ? 'on' : ''}">${l}</button>`).join('')}</div><div id="adm"></div>`;
  document.getElementById('view').innerHTML = head;
  document.querySelectorAll('[data-at]').forEach((b) => b.onclick = () => { S.adminTab = b.dataset.at; viewAdmin(); });
  ({ people: admPeople, names: admNames, setup: admSetup })[S.adminTab]();
}

async function admPeople() {
  await loadBase();
  const [{ data: contacts }, { data: joinedRows }] = await Promise.all([
    sb.from('contacts').select('instructor_id,telegram_chat_id,telegram_username'),
    sb.from('joined').select('instructor_id'),
  ]);
  const linked = new Map((contacts || []).map((c) => [c.instructor_id, c]));
  const joined = new Set((joinedRows || []).map((r) => r.instructor_id));
  const el = document.getElementById('adm');
  const linkedCount = S.people.filter((p) => linked.get(p.id)?.telegram_chat_id).length;
  el.innerHTML = `<div class="card" id="team"><div class="spin" style="margin:6px auto"></div></div>
    <div class="row" style="gap:8px;margin-bottom:10px"><input type="search" id="q" placeholder="Search name"><button class="btn primary" id="add">Add</button></div>
    <p class="small muted">${S.people.filter((p) => p.active).length} on roster · ${S.people.filter((p) => joined.has(p.id)).length} joined · ${linkedCount} on Telegram</p>
    <div class="card list" id="plist"></div>`;
  const draw = (q = '') => {
    document.getElementById('plist').innerHTML = S.people.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())).map((p) => {
      const c = linked.get(p.id);
      return `<div>
        <div class="row between"><div><b>${esc(p.name)}</b> ${p.is_admin ? '<span class="chip ok">admin</span>' : ''} ${!p.active ? '<span class="chip bad">inactive</span>' : ''}
          <div class="small muted">${esc(p.school || 'No school')}${p.aliases?.length ? ' · also: ' + p.aliases.map(esc).join(', ') : ''}</div></div>
          <div class="row" style="gap:4px">${joined.has(p.id) ? '<span class="chip ok">joined</span>' : '<span class="chip">not joined</span>'}${c?.telegram_chat_id ? '<span class="chip">Telegram</span>' : ''}</div></div>
        <div class="row wrap" style="gap:6px;margin-top:8px">
          <button class="btn sm" data-edit="${p.id}">Edit</button>
          ${joined.has(p.id) && p.id !== S.me.id ? `<button class="btn sm" data-reset="${p.id}">Reset PIN</button>` : ''}
          ${(p.user_id || c?.telegram_chat_id || joined.has(p.id)) && p.id !== S.me.id ? `<button class="btn sm danger" data-rev="${p.id}">Remove access</button>` : ''}
        </div></div>`;
    }).join('');
    bind();
  };
  const bind = () => {
    document.querySelectorAll('[data-reset]').forEach((b) => b.onclick = async () => {
      const p = S.byId.get(b.dataset.reset);
      if (!confirm(`Reset ${p.name}'s PIN? They'll be signed out and can join again with the team link to set a new PIN.`)) return;
      try { await api('reset-pin', { instructor_id: p.id }); toast('PIN reset'); admPeople(); } catch (e) { toast(e.message); }
    });
    document.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => editPerson(S.byId.get(b.dataset.edit)));
    document.querySelectorAll('[data-rev]').forEach((b) => b.onclick = async () => {
      const p = S.byId.get(b.dataset.rev);
      if (!confirm(`Remove ${p.name}'s access now? They'll be signed out, their PIN cleared and Telegram alerts stopped. They can join again with the team link.`)) return;
      try { await api('revoke', { instructor_id: p.id }); toast('Access removed'); admPeople(); } catch (e) { toast(e.message); }
    });
  };
  drawTeam();
  document.getElementById('q').oninput = (e) => draw(e.target.value);
  document.getElementById('add').onclick = () => editPerson(null);
  draw();
}

async function drawTeam(action) {
  const box = document.getElementById('team'); if (!box) return;
  let r;
  try { r = action ? await api('team-link', action) : await api('team-link-status'); } catch (e) { box.innerHTML = `<b>Team join link</b><p class="small muted">${esc(e.message)}</p>`; return; }
  box.innerHTML = r.link ? `
    <div class="row between"><b>Team join link</b><span class="chip ok">on</span></div>
    <p class="small muted">Post this in the team's group chat. Each person opens it, picks their name and sets a PIN. Admins on Telegram get a message for every join.</p>
    <p><code class="k">${esc(r.link)}</code></p>
    <div class="row wrap" style="gap:6px">
      <button class="btn sm primary" id="t-copy">Copy</button>${navigator.share ? '<button class="btn sm" id="t-share">Share</button>' : ''}
      <button class="btn sm" id="t-new">New link</button><button class="btn sm danger" id="t-off">Turn off</button>
    </div>`
  : `<div class="row between"><b>Team join link</b><span class="chip">off</span></div>
    <p class="small muted">One link for the whole team instead of inviting people one by one. Turn it off once everyone has joined.</p>
    <button class="btn sm primary" id="t-on">Create team link</button>`;
  const msg = (l) => `Join BMTC Roster to see your PT deployment schedule and get alerts when it changes. Open the link, pick your name and set a PIN: ${l}`;
  box.querySelector('#t-on')?.addEventListener('click', () => drawTeam({}));
  box.querySelector('#t-new')?.addEventListener('click', () => { if (confirm('Make a new link? The current one stops working.')) drawTeam({ rotate: true }); });
  box.querySelector('#t-off')?.addEventListener('click', () => { if (confirm('Turn off the team link? People who already joined are not affected.')) drawTeam({ off: true }); });
  box.querySelector('#t-copy')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(msg(r.link)); toast('Copied with a short message'); } catch { toast('Copy failed, long-press the link'); } });
  box.querySelector('#t-share')?.addEventListener('click', () => navigator.share({ text: msg(r.link) }).catch(() => {}));
}

function editPerson(p) {
  const dlg = document.createElement('dialog');
  const schools = [...new Set(S.people.map((x) => x.school).filter(Boolean))].sort();
  dlg.innerHTML = `<div class="in"><div class="big">${p ? 'Edit ' + esc(p.name) : 'Add instructor'}</div>
    <label class="small muted">Name (as written in the sheet)</label><input type="text" id="e-n" value="${esc(p?.name || '')}">
    <label class="small muted" style="display:block;margin-top:8px">Other spellings in the sheet (comma separated)</label><input type="text" id="e-a" value="${esc((p?.aliases || []).join(', '))}">
    <label class="small muted" style="display:block;margin-top:8px">School</label>
    <input type="text" id="e-s" list="schools" value="${esc(p?.school || '')}"><datalist id="schools">${schools.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
    <label class="tog"><span>Admin (can manage people and settings)</span><input type="checkbox" id="e-ad" ${p?.is_admin ? 'checked' : ''}></label>
    <label class="tog"><span>Active</span><input type="checkbox" id="e-ac" ${!p || p.active ? 'checked' : ''}></label>
    <div class="row" style="justify-content:flex-end;gap:6px;margin-top:8px"><button class="btn" id="e-x">Cancel</button><button class="btn primary" id="e-ok">Save</button></div></div>`;
  document.body.appendChild(dlg); dlg.showModal();
  dlg.querySelector('#e-x').onclick = () => dlg.remove();
  dlg.querySelector('#e-ok').onclick = async () => {
    const row = {
      name: dlg.querySelector('#e-n').value.trim(),
      aliases: dlg.querySelector('#e-a').value.split(',').map((s) => s.trim()).filter(Boolean),
      school: dlg.querySelector('#e-s').value.trim() || null,
      is_admin: dlg.querySelector('#e-ad').checked,
      active: dlg.querySelector('#e-ac').checked,
    };
    if (!row.name) return toast('Name is required');
    if (p?.id === S.me.id && (!row.is_admin || !row.active)) return toast("You can't remove your own admin access");
    const { error } = p ? await sb.from('instructors').update(row).eq('id', p.id) : await sb.from('instructors').insert(row);
    if (error) return toast(error.message.includes('duplicate') ? 'That name already exists' : error.message);
    dlg.remove(); toast('Saved. Applies on the next sync.'); admPeople();
  };
}

async function admNames() {
  const { data } = await sb.from('unmatched_names').select('*').eq('ignored', false).order('last_date', { ascending: false });
  const el = document.getElementById('adm');
  const opts = S.people.filter((p) => p.active).map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  el.innerHTML = `<p class="small muted">Names in the sheet that don't match anyone on the roster. Those people won't get alerts until you link the name.</p>
    ${data?.length ? `<div class="card list">${data.map((u) => `<div>
      <div class="row between"><b>${esc(u.word.replace(/\b\w/g, (c) => c.toUpperCase()))}</b><span class="small muted">${u.seen}×</span></div>
      <div class="small muted">e.g. “${esc(u.sample)}” · ${esc(u.company)} · ${fmt(u.last_date)}</div>
      <div class="row wrap" style="gap:6px;margin-top:8px">
        <select data-w="${esc(u.word)}" style="width:auto;flex:1;min-width:140px"><option value="">Same person as…</option>${opts}</select>
        <button class="btn sm primary" data-new="${esc(u.word)}">New person</button>
        <button class="btn sm" data-ign="${esc(u.word)}">Not a name</button>
      </div></div>`).join('')}</div>` : '<div class="empty">All names in the current weeks are matched.</div>'}`;
  const done = async (word) => { await sb.from('unmatched_names').update({ ignored: true }).eq('word', word); };
  const title = (w) => w.replace(/\b\w/g, (c) => c.toUpperCase());
  el.querySelectorAll('select[data-w]').forEach((s) => s.onchange = async () => {
    const p = S.byId.get(s.value); if (!p) return;
    const { error } = await sb.from('instructors').update({ aliases: [...new Set([...(p.aliases || []), title(s.dataset.w)])] }).eq('id', p.id);
    if (error) return toast(error.message);
    await done(s.dataset.w); toast(`Added as another spelling of ${p.name}`); await loadBase(); admNames();
  });
  el.querySelectorAll('[data-new]').forEach((b) => b.onclick = async () => {
    const { error } = await sb.from('instructors').insert({ name: title(b.dataset.new) });
    if (error) return toast(error.message);
    await done(b.dataset.new); toast('Added to roster'); await loadBase(); admNames();
  });
  el.querySelectorAll('[data-ign]').forEach((b) => b.onclick = async () => { await done(b.dataset.ign); admNames(); });
}

async function admSetup() {
  const el = document.getElementById('adm');
  const [{ data: settings }, { data: log }, info] = await Promise.all([
    sb.from('settings').select('*'),
    sb.from('sync_log').select('*').order('at', { ascending: false }).limit(12),
    api('sheet-info').catch(() => ({})),
  ]);
  const st = Object.fromEntries((settings || []).map((s) => [s.key, s.value]));
  el.innerHTML = `
    <div class="card"><b>Google Sheet</b>
      <p class="small muted">Paste the sheet's link or ID. Share the sheet (Viewer) with: ${info.service_account ? `<code class="k">${esc(info.service_account)}</code>` : '<i>service account not set up yet</i>'}</p>
      <div class="row" style="gap:6px"><input type="text" id="sid" value="${esc(st.sheet_id || '')}" placeholder="https://docs.google.com/spreadsheets/d/…"><button class="btn primary" id="sid-save">Save</button></div>
    </div>
    <div class="card"><div class="row between"><b>Sync</b><button class="btn sm primary" id="sync">Sync now</button></div>
      <p class="small">${st.last_sync_at ? `Last run ${ago(st.last_sync_at)}: ` : 'Never run. '}<span class="${(st.last_sync_status || '').startsWith('error') ? 'chip bad' : 'muted'}">${esc(st.last_sync_status || '')}</span></p>
      <p class="small muted">Runs automatically every 5 minutes.</p>
      ${log?.length ? `<div class="list small">${log.map((l) => `<div><span class="${l.ok ? '' : 'chip bad'}">${esc(l.message)}</span> <span class="muted">· ${ago(l.at)}</span></div>`).join('')}</div>` : ''}
    </div>
    <div class="card"><div class="row between"><b>Telegram bot</b>${st.bot_username ? `<span class="chip ok">@${esc(st.bot_username)}</span>` : '<span class="chip bad">not connected</span>'}</div>
      <p class="small muted">After the bot token is saved in Supabase, tap Connect. It points the bot at this app and sets its commands.</p>
      <button class="btn" id="bot">${st.bot_username ? 'Reconnect bot' : 'Connect bot'}</button>
    </div>`;
  document.getElementById('sid-save').onclick = async () => {
    const v = document.getElementById('sid').value.trim();
    const id = (v.match(/\/d\/([a-zA-Z0-9_-]{20,})/) || [])[1] || v;
    const { error } = await sb.from('settings').update({ value: id || null }).eq('key', 'sheet_id');
    toast(error ? error.message : 'Saved'); admSetup();
  };
  document.getElementById('sync').onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = 'Syncing…';
    try { const r = await api('sync-now'); toast(r.message); } catch (err) { toast(err.message); }
    admSetup();
  };
  document.getElementById('bot').onclick = async () => {
    try { const r = await api('bot-setup'); toast(r.ok ? `Connected @${r.bot_username}` : r.webhook || 'Failed'); admSetup(); } catch (e) { toast(e.message); }
  };
}

// refresh when coming back to the app
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.me) route(); });
boot();
