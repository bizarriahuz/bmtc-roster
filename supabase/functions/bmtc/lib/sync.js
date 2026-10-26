// Core sync: parse sheet tabs -> diff against stored schedule -> write -> notify.
import { parseTab, tabStartDate, diffAssignments, describe, SLOT_LABEL } from './parser.js';
import { listTabs, fetchGrids } from './google.js';
import { sgDate, addDays, fmtDate, relDay, esc, notify, APP_URL, getSetting, setSetting, sha256 } from './common.js';

// Which tabs to read: weeks starting from 6 days ago up to 3 weeks ahead
export function pickTabs(titles, today = sgDate(0)) {
  const lo = addDays(today, -6), hi = addDays(today, 21);
  return titles.filter((t) => { const s = tabStartDate(t); return s && s >= lo && s <= hi; });
}

async function loadRoster(db) {
  const { data } = await db.from('instructors').select('id,name,aliases,active').eq('active', true);
  return data || [];
}

function lineFor(ch) {
  const a = ch.after, b = ch.before;
  if (ch.kind === 'added') return `➕ <b>${esc(ch.company)}</b>: ${esc(describe(a))}`;
  if (ch.kind === 'removed') return `❌ <b>${esc(ch.company)}</b>: removed (was ${esc(describe(b))})`;
  return `✏️ <b>${esc(ch.company)}</b>: ${esc(describe(b))} → <b>${esc(describe(a))}</b>`;
}

function groupByDate(items) {
  const m = new Map();
  for (const it of items) { if (!m.has(it.date)) m.set(it.date, []); m.get(it.date).push(it); }
  return [...m.entries()].sort(([x], [y]) => (x < y ? -1 : 1));
}

export function changeMessage(items) {
  const lastMinute = items.some((i) => i.last_minute);
  const lines = [lastMinute ? '⚠️ <b>Last-minute schedule change</b>' : '📋 <b>Schedule change</b>', ''];
  for (const [date, list] of groupByDate(items)) {
    lines.push(`<b>${fmtDate(date)}${relDay(date)}</b>`);
    list.forEach((c) => lines.push(lineFor(c)));
    lines.push('');
  }
  lines.push(`<a href="${APP_URL()}">Open roster</a>`);
  const first = items[0];
  const push = {
    title: lastMinute ? '⚠️ Last-minute change' : 'Schedule change',
    body: items.length === 1
      ? `${fmtDate(first.date)}${relDay(first.date)} · ${first.company}: ${first.kind === 'removed' ? 'removed' : describe(first.after)}`
      : `${items.length} changes to your schedule`,
  };
  return { html: lines.join('\n'), push };
}

export function weekMessage(title, list) {
  const lines = [`🗓 <b>New week published</b> (${esc(title.trim())})`, ''];
  if (!list.length) lines.push('No PT slots for you this week.');
  for (const [date, l] of groupByDate(list)) {
    lines.push(`<b>${fmtDate(date)}</b>`);
    l.forEach((a) => lines.push(`• ${esc(a.company)}: ${esc(describe(a))}`));
  }
  lines.push('', `<a href="${APP_URL()}">Open roster</a>`);
  return { html: lines.join('\n'), push: { title: 'New week published', body: `${list.length} slot(s) for you in ${title.trim()}` } };
}

/**
 * Run a sync.
 * opts.grids: optional {title: grid} to use instead of Google (tests)
 * opts.force: re-parse even if the tab content is unchanged
 */
export async function runSync(db, opts = {}) {
  const today = sgDate(0), tomorrow = sgDate(1);
  const roster = await loadRoster(db);
  const rosterSig = await sha256(JSON.stringify(roster.map((r) => [r.id, r.name, r.aliases])));
  const initialized = (await getSetting(db, 'initialized')) === 'true';

  let grids = opts.grids;
  if (!grids) {
    const sheetId = await getSetting(db, 'sheet_id');
    if (!sheetId) throw new Error('No Google Sheet linked yet (Admin → Settings)');
    const titles = pickTabs(await listTabs(sheetId), today);
    grids = await fetchGrids(sheetId, titles);
  }

  const { data: knownTabs } = await db.from('sheet_tabs').select('*');
  const known = new Map((knownTabs || []).map((t) => [t.title, t]));
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

    const { data: oldRows } = await db.from('assignments').select('date,company,instructor_id,slots,lessons').in('date', dates);
    const old = (oldRows || []).map((r) => ({ ...r, lessons: r.lessons || {} }));

    // write fresh data
    const { error } = await db.rpc('replace_days', {
      p_dates: dates,
      p_assignments: p.assignments,
      p_notes: p.notes.map((n) => ({ ...n })),
      p_remarks: p.remarks,
    });
    if (error) throw new Error('DB write failed: ' + error.message);
    await db.from('companies').upsert(p.companies.map((c) => ({ name: c.name, school: c.school, sort: c.order })));
    await db.from('sheet_tabs').upsert({ title, start_date: dates[0], end_date: dates[dates.length - 1], content_hash: hash, last_synced: new Date().toISOString(), first_seen: prev?.first_seen });

    if (dates[dates.length - 1] >= today) unknownAll.push(...p.unknown);
    if (!initialized) continue; // first ever sync: baseline only, no alerts

    if (!prev) {
      // A brand-new week tab: send each person their week, not dozens of "added" alerts
      if (dates[0] > today) {
        for (const r of roster) {
          const list = p.assignments.filter((a) => a.instructor_id === r.id);
          if (list.length) newWeek.set(r.id, { title, list });
        }
        continue;
      }
    }

    const diffs = diffAssignments(old, p.assignments, today);
    if (diffs.length) {
      const rows = diffs.map((d) => ({
        instructor_id: d.instructor_id, date: d.date, company: d.company, kind: d.type,
        before: d.before, after: d.after, last_minute: d.date <= tomorrow,
      }));
      const { data: inserted } = await db.from('changes').insert(rows).select('id,instructor_id,date,company,kind,before,after,last_minute');
      for (const c of inserted || []) {
        if (!perInstructor.has(c.instructor_id)) perInstructor.set(c.instructor_id, []);
        perInstructor.get(c.instructor_id).push(c);
      }
      totalChanges += diffs.length;
    }
  }

  // unmatched words -> admin review list
  if (unknownAll.length) {
    const agg = new Map();
    for (const u of unknownAll) for (const w of u.words) {
      const k = w.toLowerCase();
      if (/^oil\b/.test(k) || /^(am|pm|mid|hrs?|fis?|sft|observe|trainer|pt|sch|course|assessment|conduct|ippt|mc|permstaff)$/.test(k)) continue;
      const e = agg.get(k) || { word: k, sample: u.cell, last_date: u.date, company: u.company, seen: 0 };
      e.seen++; if (u.date > e.last_date) { e.last_date = u.date; e.sample = u.cell; e.company = u.company; }
      agg.set(k, e);
    }
    const { data: existing } = await db.from('unmatched_names').select('word,ignored').in('word', [...agg.keys()]);
    const ign = new Map((existing || []).map((e) => [e.word, e.ignored]));
    const rows = [...agg.values()].map((e) => ({ ...e, ignored: ign.get(e.word) || false, updated_at: new Date().toISOString() }));
    if (rows.length) await db.from('unmatched_names').upsert(rows);
  }

  // send notifications
  let notified = 0;
  for (const [id, items] of perInstructor) {
    const { html, push } = changeMessage(items);
    if (await notify(db, id, html, push)) notified++;
    await db.from('changes').update({ notified: true }).in('id', items.map((i) => i.id));
  }
  for (const [id, w] of newWeek) {
    const { html, push } = weekMessage(w.title, w.list);
    if (await notify(db, id, html, push)) notified++;
  }

  if (!initialized && parsedTabs) await setSetting(db, 'initialized', 'true');
  const msg = `${parsedTabs} tab(s) updated, ${skipped} unchanged, ${totalChanges} change(s), ${notified} person(s) notified`;
  await setSetting(db, 'last_sync_at', new Date().toISOString());
  await setSetting(db, 'last_sync_status', 'ok: ' + msg);
  if (parsedTabs || totalChanges) await db.from('sync_log').insert({ ok: true, message: msg, changes: totalChanges });
  return { ok: true, message: msg, changes: totalChanges, parsedTabs, skipped, newWeeks: newWeek.size, notified };
}
