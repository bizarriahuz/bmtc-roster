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
  swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 7h13l-4-4M17 17H4l4 4"/></svg>',
  set: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg>',
};
const MARK = '<svg class="mark" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#3d5a2e"/><path d="M14 22h36M14 32h36M14 42h24" stroke="#e3ead9" stroke-width="5" stroke-linecap="round"/><circle cx="46" cy="42" r="5" fill="#f0a16a"/></svg>';

// ---------- auth ----------
async function boot() {
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
  try { S.config = await api('public-config'); } catch { S.config = {}; }
  const bot = S.config.bot_username;
  $app.innerHTML = `<div class="login">
    ${MARK}
    <h1>BMTC Roster</h1>
    <p class="muted">PT deployment schedule for BMTC instructors.</p>
    ${err ? `<div class="banner">${esc(err)}</div>` : ''}
    ${bot ? `<a class="btn primary block" style="display:block;text-decoration:none;margin-top:18px" href="https://t.me/${esc(bot)}?start=login">Sign in with Telegram</a>
      <p class="small muted" style="margin-top:14px">The bot sends you a one-time sign-in link. First time? Use the invite link an admin sent you.</p>`
    : '<p class="small muted">Sign-in is not set up yet.</p>'}
  </div>`;
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
  const { count } = await sb.from('swap_requests').select('id', { count: 'exact', head: true })
    .or(`and(target_id.eq.${S.me.id},status.eq.pending)${S.me.is_admin ? ',status.eq.accepted' : ''}`);
  const tab = (id, label, ic, badge) => `<a href="#${id}" class="${active === id ? 'on' : ''}">${ic}${label}${badge ? `<span class="dot">${badge}</span>` : ''}</a>`;
  $app.innerHTML = `
    <header class="top"><span class="brand">BMTC Roster</span><span class="who">${esc(S.me.name)}</span></header>
    <main id="view">${html}</main>
    <nav class="tabs">
      ${tab('me', 'My roster', icon.me)}${tab('grid', 'All coys', icon.grid)}${tab('swaps', 'Swaps', icon.swap, count || 0)}
      ${tab('settings', 'Settings', icon.set)}${S.me.is_admin ? tab('admin', 'Admin', icon.admin) : ''}
    </nav>`;
}

function route() {
  const h = (location.hash.replace('#', '').split('&')[0]) || 'me';
  ({ me: viewMe, grid: viewGrid, swaps: viewSwaps, settings: viewSettings, admin: S.me.is_admin ? viewAdmin : viewMe }[h] || viewMe)();
  window.scrollTo(0, 0);
}

// ---------- shared pieces ----------
function slotRow(lessons, mySlots, highlightAll) {
  const used = SLOTS.filter((s) => lessons?.[s] || (mySlots && mySlots.includes(s)));
  if (!used.length) return '';
  return `<div class="slots">${used.map((s) => {
    const mine = highlightAll ? (!mySlots || mySlots.includes(s)) : false;
    return `<span class="slot ${mine ? 'mine ' + s : ''}"><b>${SLOT_LABEL[s]}</b>${esc(lessons?.[s] || '—')}</span>`;
  }).join('')}</div>`;
}
function personChip(id, slots) {
  const p = S.byId.get(id);
  const label = p ? p.name : '?';
  return `<span class="chip ${id === S.me.id ? 'me' : ''}">${esc(label)}${slots ? ` <span class="mono" style="font-size:10px;opacity:.75">${slots.map((s) => SLOT_LABEL[s]).join('/')}</span>` : ''}</span>`;
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
      ${remarkByDate.get(date) ? `<span class="chip warn">${esc(remarkByDate.get(date))}</span>` : ''}</div>
      ${list.length ? list.map((a) => {
        const co = others.filter((o) => o.date === a.date && o.company === a.company);
        return `<div style="margin-top:12px">
          <div class="row between"><span class="coy">${esc(a.company)}</span>
            <button class="btn sm" data-swap="${a.date}|${esc(a.company)}">Swap</button></div>
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
  document.querySelectorAll('[data-swap]').forEach((b) => b.onclick = () => openSwap(...b.dataset.swap.split('|')));
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
    <div class="seg">${schools.map((s) => `<button data-s="${esc(s)}" class="${s === S.school ? 'on' : ''}">${esc(s)}</button>`).join('')}</div>`;

  if (remarks?.length && (S.school === 'All')) {
    html += `<div class="card"><div class="small muted" style="margin-bottom:6px;font-weight:600">STAFF REMARKS</div><div class="row wrap" style="gap:4px">${remarks.map((r) => `<span class="chip ${r.instructor_id === S.me.id ? 'warn' : ''}">${esc(r.text)}</span>`).join('')}</div></div>`;
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
      ${note ? `<div class="note">${esc(note.text)}</div>` : ''}
    </div>`;
  }
  if (!shown) html += '<div class="empty">Nothing scheduled for this day.</div>';
  document.getElementById('view').innerHTML = html;
  document.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => { S.gridDate = b.dataset.d; viewGrid(); });
  document.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { S.school = b.dataset.s; viewGrid(); });
}

// ---------- Swaps ----------
function openSwap(date, company) {
  const others = S.people.filter((p) => p.active && p.id !== S.me.id).sort((a, b) => a.name.localeCompare(b.name));
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<div class="in">
    <div class="big">Ask for a swap</div>
    <p class="muted small">${esc(company)} · ${fmt(date, true)}</p>
    <label class="small muted">Who should cover?</label>
    <select id="sw-t"><option value="">Choose instructor…</option>${others.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
    <label class="small muted" style="display:block;margin-top:10px">Note (optional)</label>
    <textarea id="sw-n" maxlength="300" placeholder="e.g. I'll take your Friday AM in return"></textarea>
    <p class="small muted">They accept or decline, then an admin approves. The planner still updates the sheet.</p>
    <div class="row" style="justify-content:flex-end;margin-top:6px"><button class="btn" id="sw-x">Cancel</button><button class="btn primary" id="sw-go">Send request</button></div>
  </div>`;
  document.body.appendChild(dlg); dlg.showModal();
  dlg.querySelector('#sw-x').onclick = () => dlg.remove();
  dlg.querySelector('#sw-go').onclick = async (e) => {
    const t = dlg.querySelector('#sw-t').value; if (!t) return toast('Pick someone first');
    e.target.disabled = true;
    try { await api('swap-create', { target_id: t, date, company, note: dlg.querySelector('#sw-n').value }); toast('Swap request sent'); dlg.remove(); }
    catch (err) { toast(err.message); e.target.disabled = false; }
  };
}

async function viewSwaps() {
  await shell('swaps', '<div class="spin"></div>');
  const { data } = await sb.from('swap_requests').select('*').order('created_at', { ascending: false }).limit(60);
  const all = data || [];
  const name = (id) => esc(S.byId.get(id)?.name || '?');
  const statusChip = (s) => `<span class="chip ${s === 'approved' ? 'ok' : s === 'pending' || s === 'accepted' ? 'warn' : 'bad'}">${s === 'accepted' ? 'awaiting admin' : s}</span>`;
  const item = (s, actions) => `<div><div class="row between"><b>${esc(s.company)} · ${fmt(s.date)}</b>${statusChip(s.status)}</div>
    <div class="small">${name(s.requester_id)} → ${name(s.target_id)}</div>${s.note ? `<div class="small muted">“${esc(s.note)}”</div>` : ''}
    ${actions ? `<div class="row" style="margin-top:8px;gap:6px">${actions}</div>` : ''}</div>`;

  const incoming = all.filter((s) => s.target_id === S.me.id && s.status === 'pending');
  const toApprove = S.me.is_admin ? all.filter((s) => s.status === 'accepted') : [];
  const mine = all.filter((s) => s.requester_id === S.me.id || (s.target_id === S.me.id && s.status !== 'pending'));
  let html = '<h1>Swaps</h1><p class="small muted">To request a swap, tap <b>Swap</b> on one of your slots in My roster.</p>';
  if (toApprove.length) html += `<h2>Needs your approval</h2><div class="card list">${toApprove.map((s) => item(s, `<button class="btn sm primary" data-act="decide" data-id="${s.id}" data-v="1">Approve</button><button class="btn sm danger" data-act="decide" data-id="${s.id}" data-v="0">Reject</button>`)).join('')}</div>`;
  if (incoming.length) html += `<h2>Asked of you</h2><div class="card list">${incoming.map((s) => item(s, `<button class="btn sm primary" data-act="respond" data-id="${s.id}" data-v="1">Accept</button><button class="btn sm" data-act="respond" data-id="${s.id}" data-v="0">Decline</button>`)).join('')}</div>`;
  html += `<h2>Your swaps</h2>${mine.length ? `<div class="card list">${mine.map((s) => item(s, s.requester_id === S.me.id && ['pending', 'accepted'].includes(s.status) ? `<button class="btn sm" data-act="cancel" data-id="${s.id}">Cancel request</button>` : '')).join('')}</div>` : '<div class="empty">No swaps yet.</div>'}`;
  if (S.me.is_admin) {
    const past = all.filter((s) => !toApprove.includes(s) && !mine.includes(s) && !incoming.includes(s)).slice(0, 15);
    if (past.length) html += `<h2>Other recent swaps</h2><div class="card list">${past.map((s) => item(s)).join('')}</div>`;
  }
  document.getElementById('view').innerHTML = html;
  document.querySelectorAll('[data-act]').forEach((b) => b.onclick = async () => {
    b.disabled = true;
    try {
      const id = b.dataset.id, v = b.dataset.v === '1';
      if (b.dataset.act === 'decide') await api('swap-decide', { id, approve: v });
      if (b.dataset.act === 'respond') await api('swap-respond', { id, accept: v });
      if (b.dataset.act === 'cancel') await api('swap-cancel', { id });
      toast('Done'); viewSwaps();
    } catch (e) { toast(e.message); b.disabled = false; }
  });
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
  const theme = (() => { try { return localStorage.getItem('theme') || 'auto'; } catch { return 'auto'; } })();

  document.getElementById('view').innerHTML = `<h1>Settings</h1>
    <div class="card">
      <div class="row between"><div><b>Telegram</b><div class="small muted">${c?.telegram_chat_id ? `Linked${c.telegram_username ? ' as @' + esc(c.telegram_username) : ''}` : 'Not linked. Ask an admin for your invite link.'}</div></div>
      ${c?.telegram_chat_id ? '<span class="chip ok">On</span>' : '<span class="chip bad">Off</span>'}</div>
    </div>
    <div class="card">
      <div class="row between"><div><b>Phone notifications</b><div class="small muted">Backup to Telegram, shown by this browser/app.</div></div>
      ${pushOn ? '<span class="chip ok">On</span>' : ''}</div>
      ${!pushSupported ? `<p class="small muted">${isIOS && !standalone ? 'On iPhone: tap Share → <b>Add to Home Screen</b>, open the app from there, then come back here.' : 'This browser does not support notifications.'}</p>`
        : pushOn ? '' : `<button class="btn primary" id="push-on" style="margin-top:10px">Turn on notifications</button>`}
    </div>
    <div class="card">
      <label class="tog"><span>Alerts on Telegram</span><input type="checkbox" data-k="notify_telegram" ${c?.notify_telegram !== false ? 'checked' : ''} ${c ? '' : 'disabled'}></label>
      <label class="tog"><span>Alerts as phone notifications</span><input type="checkbox" data-k="notify_push" ${c?.notify_push !== false ? 'checked' : ''} ${c ? '' : 'disabled'}></label>
      <label class="tog"><span>Evening reminder of tomorrow's slots</span><input type="checkbox" data-k="nightly_reminder" ${c?.nightly_reminder !== false ? 'checked' : ''} ${c ? '' : 'disabled'}></label>
    </div>
    <div class="card"><div class="row between"><b>Theme</b>
      <select id="theme" style="width:auto">${['auto', 'light', 'dark'].map((t) => `<option ${t === theme ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
    <div class="row" style="gap:8px;margin-top:14px">
      <button class="btn" id="test">Send test alert</button>
      <button class="btn danger" id="out" style="margin-left:auto">Sign out</button>
    </div>`;
  document.querySelectorAll('[data-k]').forEach((i) => i.onchange = async () => {
    const { error } = await sb.from('contacts').update({ [i.dataset.k]: i.checked }).eq('instructor_id', S.me.id);
    toast(error ? error.message : 'Saved');
  });
  document.getElementById('push-on')?.addEventListener('click', enablePush);
  document.getElementById('test').onclick = async () => { try { const r = await api('test-notify'); toast(r.ok ? 'Test alert sent' : 'No channel is set up yet'); } catch (e) { toast(e.message); } };
  document.getElementById('out').onclick = async () => { await sb.auth.signOut(); location.hash = ''; location.reload(); };
  document.getElementById('theme').onchange = (e) => { const v = e.target.value; try { localStorage.setItem('theme', v); } catch {} applyTheme(); };
}

function applyTheme() {
  let t = 'auto'; try { t = localStorage.getItem('theme') || 'auto'; } catch {}
  if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
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
  const { data: contacts } = await sb.from('contacts').select('instructor_id,telegram_chat_id,telegram_username');
  const linked = new Map((contacts || []).map((c) => [c.instructor_id, c]));
  const el = document.getElementById('adm');
  const linkedCount = S.people.filter((p) => linked.get(p.id)?.telegram_chat_id).length;
  el.innerHTML = `<div class="row" style="gap:8px;margin-bottom:10px"><input type="search" id="q" placeholder="Search name"><button class="btn primary" id="add">Add</button></div>
    <p class="small muted">${S.people.filter((p) => p.active).length} active · ${linkedCount} linked to Telegram</p>
    <div class="card list" id="plist"></div>`;
  const draw = (q = '') => {
    document.getElementById('plist').innerHTML = S.people.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())).map((p) => {
      const c = linked.get(p.id);
      return `<div>
        <div class="row between"><div><b>${esc(p.name)}</b> ${p.is_admin ? '<span class="chip ok">admin</span>' : ''} ${!p.active ? '<span class="chip bad">inactive</span>' : ''}
          <div class="small muted">${esc(p.school || 'No school')}${p.aliases?.length ? ' · also: ' + p.aliases.map(esc).join(', ') : ''}</div></div>
          ${c?.telegram_chat_id ? '<span class="chip ok">linked</span>' : '<span class="chip">not linked</span>'}</div>
        <div class="row wrap" style="gap:6px;margin-top:8px">
          <button class="btn sm primary" data-inv="${p.id}">${c?.telegram_chat_id ? 'New invite link' : 'Invite link'}</button>
          <button class="btn sm" data-edit="${p.id}">Edit</button>
          ${p.user_id || c?.telegram_chat_id ? `<button class="btn sm danger" data-rev="${p.id}">Remove access</button>` : ''}
        </div></div>`;
    }).join('');
    bind();
  };
  const bind = () => {
    document.querySelectorAll('[data-inv]').forEach((b) => b.onclick = async () => {
      b.disabled = true;
      try {
        const r = await api('invite', { instructor_id: b.dataset.inv });
        const dlg = document.createElement('dialog');
        dlg.innerHTML = `<div class="in"><div class="big">Invite ${esc(r.name)}</div>
          <p class="small muted">Send this link to ${esc(r.name)} privately (e.g. Telegram DM). It works once and links their Telegram to their name.</p>
          <p><code class="k">${esc(r.link)}</code></p>
          <div class="row" style="justify-content:flex-end;gap:6px"><button class="btn" id="cl">Close</button>${navigator.share ? '<button class="btn" id="sh">Share</button>' : ''}<button class="btn primary" id="cp">Copy</button></div></div>`;
        document.body.appendChild(dlg); dlg.showModal();
        dlg.querySelector('#cl').onclick = () => dlg.remove();
        dlg.querySelector('#cp').onclick = async () => { try { await navigator.clipboard.writeText(r.link); toast('Copied'); } catch { toast('Copy failed, long-press the link'); } };
        dlg.querySelector('#sh')?.addEventListener('click', () => navigator.share({ text: `BMTC Roster invite for ${r.name}: ${r.link}` }).catch(() => {}));
      } catch (e) { toast(e.message); }
      b.disabled = false;
    });
    document.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => editPerson(S.byId.get(b.dataset.edit)));
    document.querySelectorAll('[data-rev]').forEach((b) => b.onclick = async () => {
      const p = S.byId.get(b.dataset.rev);
      if (!confirm(`Remove ${p.name}'s access now? They will be signed out and stop getting alerts. You can invite them again later.`)) return;
      try { await api('revoke', { instructor_id: p.id }); toast('Access removed'); admPeople(); } catch (e) { toast(e.message); }
    });
  };
  document.getElementById('q').oninput = (e) => draw(e.target.value);
  document.getElementById('add').onclick = () => editPerson(null);
  draw();
}

function editPerson(p) {
  const dlg = document.createElement('dialog');
  const schools = [...new Set(S.people.map((x) => x.school).filter(Boolean))].sort();
  dlg.innerHTML = `<div class="in"><div class="big">${p ? 'Edit ' + esc(p.name) : 'Add instructor'}</div>
    <label class="small muted">Name (as written in the sheet)</label><input type="text" id="e-n" value="${esc(p?.name || '')}">
    <label class="small muted" style="display:block;margin-top:8px">Other spellings in the sheet (comma separated)</label><input type="text" id="e-a" value="${esc((p?.aliases || []).join(', '))}">
    <label class="small muted" style="display:block;margin-top:8px">School</label>
    <input type="text" id="e-s" list="schools" value="${esc(p?.school || '')}"><datalist id="schools">${schools.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
    <label class="tog"><span>Admin (can manage people and approve swaps)</span><input type="checkbox" id="e-ad" ${p?.is_admin ? 'checked' : ''}></label>
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
