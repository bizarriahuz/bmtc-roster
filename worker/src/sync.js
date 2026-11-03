// Core sync: parse sheet tabs -> diff against stored schedule -> write -> queue alerts.
import { parseTab, tabStartDate, diffAssignments, describe, SLOT_LABEL } from './parser.js';
import { listTabs, fetchGrids } from './google.js';
import { sgDate, addDays, fmtDate, relDay, esc, APP_URL, getSetting, sha256, all, inList, nowIso, asAssignment } from './common.js';

// Which tabs to read: weeks starting from 6 days ago up to 3 weeks ahead
export const PARSER_VERSION = '2'; // 2026-11-03: Mid fix, BMTC event times

export function pickTabs(titles, today = sgDate(0)) {
  const lo = addDays(today, -6), hi = addDays(today, 21);
  return titles.filter((t) => { const s = tabStartDate(t); return s && s >= lo && s <= hi; });
}

function lineFor(ch) {
  const a = ch.after, b = ch.before;
  if (ch.company === 'Remark') {
    if (ch.kind === 'added') return `🌴 <b>${esc(a.text)}</b>${/\b(am|pm|mid)/i.test(a.text) ? '' : ' (not on PT)'}`;
    if (ch.kind === 'removed') return `🌴 Removed: ${esc(b.text)}`;
    return `🌴 ${esc(b.text)} → <b>${esc(a.text)}</b>`;
  }
  if (a?.activated) return `🚨 <b>ACTIVATED from reserve</b> → <b>${esc(ch.company)}</b>: ${esc(describe(a))}`;
  if (ch.company === 'Reserves' && ch.kind === 'added') return `🟡 You're on <b>reserve standby</b> (${esc(a.slots ? a.slots.map((x) => SLOT_LABEL[x]).join('/') : 'all day')})`;
  if (ch.kind === 'added') return `➕ <b>${esc(ch.company)}</b>: ${esc(describe(a))}`;
  if (ch.kind === 'removed') return `❌ <b>${esc(ch.company)}</b>: removed (was ${esc(describe(b))})`;
  return `✏️ <b>${esc(ch.company)}</b>: ${esc(describe(b))} → <b>${esc(describe(a))}</b>`;
}

function groupByDate(items) {
  const m = new Map();
  for (const it of items) { if (!m.has(it.date)) m.set(it.date, []); m.get(it.date).push(it); }
  return [...m.entries()].sort(([x], [y]) => (x < y ? -1 : 1));
}

export function changeMessage(env, items) {
  const lastMinute = items.some((i) => i.last_minute);
  const activated = items.some((i) => i.after?.activated);
  const leaveOnly = items.every((i) => i.company === 'Remark');
  const lines = [activated ? '🚨 <b>You have been activated</b>' : leaveOnly ? '🌴 <b>Leave / off update</b>' : lastMinute ? '⚠️ <b>Last-minute schedule change</b>' : '📋 <b>Schedule change</b>', ''];
  for (const [date, list] of groupByDate(items)) {
    lines.push(`<b>${fmtDate(date)}${relDay(date)}</b>`);
    list.forEach((c) => lines.push(lineFor(c)));
    lines.push('');
  }
  lines.push(`<a href="${APP_URL(env)}">Open roster</a>`);
  const first = items[0];
  const push = {
    title: activated ? '🚨 Reserve activated' : leaveOnly ? '🌴 Leave / off update' : lastMinute ? '⚠️ Last-minute change' : 'Schedule change',
    body: items.length === 1
      ? `${fmtDate(first.date)}${relDay(first.date)} · ${first.company === 'Remark' ? (first.after?.text || 'remark removed') : `${first.company}: ${first.kind === 'removed' ? 'removed' : describe(first.after)}`}`
      : `${items.length} changes to your schedule`,
  };
  return { html: lines.join('\n'), push };
}

export function weekMessage(env, title, list) {
  const lines = [`🗓 <b>New week published</b> (${esc(title.trim())})`, ''];
  if (!list.length) lines.push('No PT slots for you this week.');
  for (const [date, l] of groupByDate(list)) {
    lines.push(`<b>${fmtDate(date)}</b>`);
    l.forEach((a) => lines.push(`• ${esc(a.company)}: ${esc(describe(a))}`));
  }
  lines.push('', `<a href="${APP_URL(env)}">Open roster</a>`);
  return { html: lines.join('\n'), push: { title: 'New week published', body: `${list.length} slot(s) for you in ${title.trim()}` } };
}

/**
 * Run a sync.
 * opts.grids: optional {title: grid} to use instead of Google (tests)
 * opts.force: re-parse even if the tab content is unchanged
 */
export async function runSync(env, opts = {}) {
  const db = env.DB;
  const today = sgDate(0), tomorrow = sgDate(1);
  const [rosterRes, tabsRes, setRes] = await db.batch([
    db.prepare('select id, name, aliases, active from instructors where active = 1'),
    db.prepare('select * from sheet_tabs'),
    db.prepare("select key, value from settings where key in ('initialized', 'sheet_id', 'parser_version')"),
  ]);
  const roster = rosterRes.results.map((r) => ({ ...r, aliases: JSON.parse(r.aliases || '[]'), active: true }));
  const set = Object.fromEntries(setRes.results.map((r) => [r.key, r.value]));
  const rosterSig = await sha256(JSON.stringify(roster.map((r) => [r.id, r.name, r.aliases])));
  // When the parser changes how it reads the sheet, re-read every tab once without sending alerts.
  const reparse = set.parser_version !== PARSER_VERSION;
  const initialized = set.initialized === 'true' && !reparse;
  if (reparse) opts = { ...opts, force: true };

  let grids = opts.grids;
  if (!grids) {
    if (!set.sheet_id) throw new Error('No Google Sheet linked yet (Admin → Settings)');
    const titles = pickTabs(await listTabs(env, set.sheet_id), today);
    grids = await fetchGrids(env, set.sheet_id, titles);
  }

  const known = new Map(tabsRes.results.map((t) => [t.title, t]));
  const perInstructor = new Map(); // id -> [change items]
  const newWeek = new Map();       // id -> {title, list}
  let totalChanges = 0, parsedTabs = 0, skipped = 0;
  const unknownAll = [];

  for (const [title, grid] of Object.entries(grids)) {
    const hash = await sha256(JSON.stringify(grid) + rosterSig);
    const prev = known.get(title);
    if (prev && prev.content_hash === hash && !opts.force) { skipped++; continue; }

    const p = parseTab(grid, roster);
    if (!p || !p.days.length) continue;
    parsedTabs++;
    const dates = p.days.map((d) => d.date);

    const old = (await all(db, `select date, company, instructor_id, slots, lessons, info from assignments where date in (${inList(dates)})`, ...dates)).map(asAssignment);
    const oldRemarks = await all(db, `select date, instructor_id, text from remarks where date in (${inList(dates)})`, ...dates);

    // Replace those dates with the freshly parsed data, in one transaction.
    const w = [
      db.prepare(`delete from assignments where date in (${inList(dates)})`).bind(...dates),
      db.prepare(`delete from day_notes where date in (${inList(dates)})`).bind(...dates),
      db.prepare(`delete from remarks where date in (${inList(dates)})`).bind(...dates),
    ];
    // One statement per table: rows go in as a single JSON parameter (keeps us inside the per-run query limit).
    const J = (rows) => JSON.stringify(rows);
    w.push(db.prepare(`insert or ignore into assignments(date, company, instructor_id, slots, lessons, raw, info)
      select value->>'date', value->>'company', value->>'instructor_id', json_extract(value, '$.slots'),
             coalesce(json_extract(value, '$.lessons'), '{}'), value->>'raw', nullif(value->>'info', '') from json_each(?)`).bind(J(p.assignments)));
    w.push(db.prepare(`insert into day_notes(date, company, text, lessons)
      select value->>'date', value->>'company', value->>'text', coalesce(json_extract(value, '$.lessons'), '{}') from json_each(?) where true
      on conflict(date, company) do update set text = excluded.text`).bind(J(p.notes)));
    w.push(db.prepare(`insert into remarks(date, instructor_id, text)
      select value->>'date', nullif(value->>'instructor_id', ''), value->>'text' from json_each(?)`).bind(J(p.remarks)));
    w.push(db.prepare(`insert into companies(name, school, sort)
      select value->>'name', value->>'school', coalesce(value->>'order', 0) from json_each(?) where true
      on conflict(name) do update set school = excluded.school, sort = excluded.sort`).bind(J(p.companies)));
    w.push(db.prepare(`insert into sheet_tabs(title, start_date, end_date, content_hash, last_synced) values (?,?,?,?,?)
      on conflict(title) do update set start_date = excluded.start_date, end_date = excluded.end_date,
      content_hash = excluded.content_hash, last_synced = excluded.last_synced`)
      .bind(title, dates[0], dates[dates.length - 1], hash, nowIso()));

    if (dates[dates.length - 1] >= today) unknownAll.push(...p.unknown);

    let diffs = [];
    if (initialized) {
      if (!prev && dates[0] > today) {
        // A brand-new week tab: send each person their week, not dozens of "added" alerts
        for (const r of roster) {
          const list = p.assignments.filter((a) => a.instructor_id === r.id);
          if (list.length) newWeek.set(r.id, { title, list });
        }
      } else {
        diffs = diffAssignments(old, p.assignments, today);
        // reserve activation: moved out of Reserves into a company on the same day -> one "activated" alert
        for (const rm of diffs.filter((d) => d.type === 'removed' && d.company === 'Reserves')) {
          const add = diffs.find((d) => d.type === 'added' && d.company !== 'Reserves' && d.company !== 'BMTC' && d.instructor_id === rm.instructor_id && d.date === rm.date);
          if (add) { add.after = { ...add.after, activated: true }; add.before = rm.before; diffs = diffs.filter((d) => d !== rm); }
        }
        // staff remarks (leave / OIL / MC ...): alert only the named person
        const remarkMap = (rows) => {
          const m = new Map();
          for (const r of rows || []) if (r.instructor_id && r.date >= today) {
            const k = `${r.date}|${r.instructor_id}`; m.set(k, [...(m.get(k) || []), r.text].sort());
          }
          return m;
        };
        const ro = remarkMap(oldRemarks), rn = remarkMap(p.remarks);
        for (const [k, v] of rn) {
          const [date, iid] = k.split('|'); const was = ro.get(k);
          if (!was) diffs.push({ type: 'added', instructor_id: iid, date, company: 'Remark', before: null, after: { text: v.join(', ') } });
          else if (was.join('|') !== v.join('|')) diffs.push({ type: 'changed', instructor_id: iid, date, company: 'Remark', before: { text: was.join(', ') }, after: { text: v.join(', ') } });
        }
        for (const [k, v] of ro) if (!rn.has(k)) { const [date, iid] = k.split('|'); diffs.push({ type: 'removed', instructor_id: iid, date, company: 'Remark', before: { text: v.join(', ') }, after: null }); }
      }
    }
    const chRows = diffs.map((d) => ({ instructor_id: d.instructor_id, date: d.date, company: d.company, kind: d.type,
      before: d.before ? JSON.stringify(d.before) : null, after: d.after ? JSON.stringify(d.after) : null, last_minute: d.date <= tomorrow ? 1 : 0 }));
    if (chRows.length) {
      w.push(db.prepare(`insert into changes(instructor_id, date, company, kind, before, after, last_minute, notified)
        select value->>'instructor_id', value->>'date', value->>'company', value->>'kind', value->>'before', value->>'after', value->>'last_minute', 1
        from json_each(?) returning id, instructor_id, date, company, kind, before, after, last_minute`).bind(JSON.stringify(chRows)));
    }
    const res = await db.batch(w);
    for (const c of chRows.length ? res[res.length - 1].results : []) {
      const item = { ...c, before: c.before ? JSON.parse(c.before) : null, after: c.after ? JSON.parse(c.after) : null, last_minute: !!c.last_minute };
      if (!perInstructor.has(c.instructor_id)) perInstructor.set(c.instructor_id, []);
      perInstructor.get(c.instructor_id).push(item);
    }
    totalChanges += diffs.length;
  }

  const w = [];
  // unmatched words -> admin review list
  if (unknownAll.length) {
    const agg = new Map();
    for (const u of unknownAll) for (const word of u.words) {
      const k = word.toLowerCase();
      if (/^oil\b/.test(k) || /^(am|pm|mid|hrs?|fis?|sft|observe|trainer|pt|sch|course|assessment|conduct|ippt|mc|permstaff)$/.test(k)) continue;
      const e = agg.get(k) || { word: k, sample: u.cell, last_date: u.date, company: u.company, seen: 0 };
      e.seen++; if (u.date > e.last_date) { e.last_date = u.date; e.sample = u.cell; e.company = u.company; }
      agg.set(k, e);
    }
    const rows = [...agg.values()].map((e) => ({ ...e, updated_at: nowIso() }));
    w.push(db.prepare(`insert into unmatched_names(word, sample, last_date, company, seen, ignored, updated_at)
      select value->>'word', value->>'sample', value->>'last_date', value->>'company', value->>'seen', 0, value->>'updated_at'
      from json_each(?) where true
      on conflict(word) do update set sample = excluded.sample, last_date = excluded.last_date, company = excluded.company,
      seen = excluded.seen, updated_at = excluded.updated_at`).bind(JSON.stringify(rows)));
  }

  // queue alerts (sent by the every-minute job)
  const alerts = [];
  for (const [id, items] of perInstructor) { const m = changeMessage(env, items); alerts.push({ id, html: m.html, push: JSON.stringify(m.push) }); }
  for (const [id, wk] of newWeek) { const m = weekMessage(env, wk.title, wk.list); alerts.push({ id, html: m.html, push: JSON.stringify(m.push) }); }
  const notified = alerts.length;
  if (alerts.length) {
    w.push(db.prepare(`insert into outbox(instructor_id, html, push) select value->>'id', value->>'html', value->>'push' from json_each(?)`)
      .bind(JSON.stringify(alerts)));
  }

  if (!initialized && parsedTabs) {
    w.push(db.prepare("insert into settings(key, value) values ('initialized', 'true') on conflict(key) do update set value = 'true'"));
    w.push(db.prepare("insert into settings(key, value) values ('parser_version', ?) on conflict(key) do update set value = excluded.value").bind(PARSER_VERSION));
  }
  const msg = `${parsedTabs} tab(s) updated, ${skipped} unchanged, ${totalChanges} change(s), ${notified} person(s) notified`;
  const setS = db.prepare('insert into settings(key, value) values (?, ?) on conflict(key) do update set value = excluded.value');
  w.push(setS.bind('last_sync_at', nowIso()), setS.bind('last_sync_status', 'ok: ' + msg));
  if (parsedTabs || totalChanges) w.push(db.prepare('insert into sync_log(ok, message, changes) values (1, ?, ?)').bind(msg, totalChanges));
  await db.batch(w);
  return { ok: true, message: msg, changes: totalChanges, parsedTabs, skipped, newWeeks: newWeek.size, notified };
}

export async function recordSyncError(db, e) {
  const msg = String(e?.message || e);
  const setS = db.prepare('insert into settings(key, value) values (?, ?) on conflict(key) do update set value = excluded.value');
  await db.batch([
    setS.bind('last_sync_status', 'error: ' + msg), setS.bind('last_sync_at', nowIso()),
    db.prepare('insert into sync_log(ok, message) values (0, ?)').bind(msg),
  ]);
  return msg;
}
