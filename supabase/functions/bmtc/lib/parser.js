// Parser for the BMTC deployment sheet (one tab per week).
// Works on a 2D grid of cell values as returned by the Google Sheets API
// (valueRenderOption=UNFORMATTED_VALUE, dateTimeRenderOption=SERIAL_NUMBER).
// Shared by the sync edge function (Deno) and local tests (Node).

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// Rows in column A that are never company blocks.
const NOT_BLOCK = /^(coy|s\/no|0\/12|sch\s*\d.*|sch1\/2|staff remarks)$/i;

const NOTE_WORDS = /\boil\b|off in lieu|no pt|deepavali|hari raya|christmas|new year|chinese new|vesak|good friday|national day|labour|ph\b|public holiday|enlist|camp|\bday\b|ifc|holiday|briefing|meeting|conf|\bfis?\b|leave|cancel|stand ?down|book ?out|range|route|march|exercise|ex\b|tbc|nil|mess|candidates|interview|sfts?|mfts?/i;

export const SLOT_ORDER = ['AM', 'MID1', 'MID2', 'PM'];
export const SLOT_LABEL = { AM: 'AM', MID1: 'Mid 1', MID2: 'Mid 2', PM: 'PM' };

const str = (v) => (v === null || v === undefined ? '' : String(v)).replace(/\s+/g, ' ').trim();

export function serialToISO(n) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(n)) * 86400000);
  return d.toISOString().slice(0, 10);
}

function cellDate(v) {
  if (typeof v === 'number' && v > 30000 && v < 80000) return serialToISO(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = str(v);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  }
  return null;
}

// "19 Oct - 25 Oct 26", "09  June -  15 June 25", "29 Dec - 04 Jan 26" -> start date ISO (best effort)
export function tabStartDate(title) {
  const t = str(title).toLowerCase();
  const m = t.match(/^(\d{1,2})\s*([a-z]+)\s*-\s*(\d{1,2})\s*([a-z]+)\s*(\d{2,4})$/);
  if (!m) return null;
  const m1 = MONTHS[m[2].slice(0, 3)], m2 = MONTHS[m[4].slice(0, 3)];
  if (m1 === undefined || m2 === undefined) return null;
  let y = +m[5]; if (y < 100) y += 2000;
  const y1 = m1 > m2 ? y - 1 : y; // week spanning new year: year belongs to end date
  return new Date(Date.UTC(y1, m1, +m[1])).toISOString().slice(0, 10);
}

// ---- name / slot tokenising ----

const SLOT_WORDS = {
  am: ['AM'], pm: ['PM'], mid: ['MID1', 'MID2'], mid1: ['MID1'], mid2: ['MID2'],
};

function normKey(s) { return str(s).toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim(); }

// roster: [{ id, name, aliases: [] }]
export function buildMatcher(roster) {
  const map = new Map(); // normalized phrase -> id
  let maxWords = 1;
  for (const p of roster) {
    for (const n of [p.name, ...(p.aliases || [])]) {
      const k = normKey(n);
      if (!k) continue;
      map.set(k, p.id);
      maxWords = Math.max(maxWords, k.split(' ').length);
    }
  }
  return { map, maxWords };
}

// Parse one instructor cell like "Wesley/Zul PM", "Faizal(am) / Ahmad (pm)", "Aswad/AM/MID2",
// "Vicknesh, Shaf, Fazli(am)", "Darwisy(Mid pm)", "Latfi/Kelvin AM/Mid".
// A slot qualifier applies to every name since the previous qualifier. No qualifier = whole day.
export function parseNameCell(text, matcher) {
  const raw = str(text);
  // split "mid1"/"mid 1" etc. into tokens
  const prepared = raw
    .replace(/mid\s*([12])/gi, ' mid$1 ')
    .replace(/mid(am|pm)\b/gi, ' mid $1 ')
    .replace(/[\/,&()+]|\band\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = prepared ? prepared.split(' ') : [];
  const people = []; // {id, slots:Set|null}
  const unknown = [];
  let pending = [];
  let lastGroup = [];
  let cur = [];
  const flush = () => { if (cur.length) { unknown.push(cur.join(' ')); cur = []; } };
  let i = 0;
  while (i < words.length) {
    const w = words[i].toLowerCase().replace(/[^a-z0-9]/g, '');
    if (SLOT_WORDS[w]) {
      flush();
      const target = pending.length ? pending : lastGroup;
      for (const p of target) { p.slots = p.slots || new Set(); SLOT_WORDS[w].forEach((s) => p.slots.add(s)); }
      if (pending.length) { lastGroup = pending; pending = []; }
      i++; continue;
    }
    let matched = false;
    for (let n = Math.min(matcher.maxWords, words.length - i); n >= 1; n--) {
      const phrase = normKey(words.slice(i, i + n).join(' '));
      if (phrase && matcher.map.has(phrase)) {
        const id = matcher.map.get(phrase);
        let p = people.find((x) => x.id === id);
        if (!p) { p = { id, slots: null }; people.push(p); }
        pending.push(p);
        flush();
        i += n; matched = true; break;
      }
    }
    if (!matched) {
      const clean = words[i].replace(/[^A-Za-z]/g, '');
      if (clean && clean.length > 1) cur.push(clean); else flush();
      i++;
    }
  }
  flush();
  return {
    people: people.map((p) => ({ id: p.id, slots: p.slots ? SLOT_ORDER.filter((s) => p.slots.has(s)) : null })),
    unknown,
  };
}

// ---- tab parsing ----

function slotFromHeader(h) {
  const s = str(h).toLowerCase().replace(/\s+/g, '');
  if (s === 'am') return 'AM';
  if (s === 'pm') return 'PM';
  if (s === 'mid1') return 'MID1';
  if (s === 'mid2') return 'MID2';
  return null;
}

/**
 * Parse a weekly tab.
 * Returns {
 *   days: [{date, col}],
 *   companies: [{name, school, order}],
 *   assignments: [{date, company, instructor_id, slots|null, lessons: {AM:..}, raw}],
 *   notes: [{date, company, text}],      // e.g. "NO PT", "Field Camp", lessons with nobody named
 *   remarks: [{date, instructor_id|null, text}],
 *   roster: [{name, school}],             // roster list at the bottom of the tab
 *   unknown: [{date, company, cell, words}]
 * }
 */
export function parseTab(grid, roster) {
  const matcher = buildMatcher(roster);
  const G = (r, c) => (grid[r] && grid[r][c] !== undefined ? grid[r][c] : '');
  const nRows = grid.length;
  const nCols = Math.max(...grid.map((r) => r.length), 0);

  // Header row = first row containing "Date/Day"
  let hdr = -1;
  for (let r = 0; r < Math.min(nRows, 10) && hdr < 0; r++) {
    for (let c = 0; c < nCols; c++) if (str(G(r, c)).toLowerCase() === 'date/day') { hdr = r; break; }
  }
  if (hdr < 0) return null;

  const dayCols = [];
  for (let c = 0; c < nCols; c++) if (str(G(hdr, c)).toLowerCase() === 'date/day') dayCols.push(c);

  // Slot label per column: from main header, falling back to any later section header row
  const sectionHdrRows = [hdr];
  for (let r = hdr + 1; r < nRows; r++) if (/^sch\s*\d/i.test(str(G(r, 0))) && str(G(r, 1)).toLowerCase() === 's/no') sectionHdrRows.push(r);
  const slotOf = {};
  for (let c = 0; c < nCols; c++) {
    for (const r of sectionHdrRows) { const s = slotFromHeader(G(r, c)); if (s) { slotOf[c] = s; break; } }
  }

  // Dates: the row under the header (or the next row that has a date under the first day col)
  let dateRow = hdr + 1;
  while (dateRow < hdr + 4 && !cellDate(G(dateRow, dayCols[0]))) dateRow++;
  const days = dayCols.map((c) => ({ col: c, date: cellDate(G(dateRow, c)) })).filter((d) => d.date);
  const slotColsFor = (dayIdx) => {
    const start = days[dayIdx].col + 1;
    const end = dayIdx + 1 < days.length ? days[dayIdx + 1].col : start + 4;
    const out = [];
    for (let c = start; c < end; c++) if (slotOf[c]) out.push({ c, slot: slotOf[c] });
    return out;
  };

  // Walk column A for blocks
  const labels = [];
  for (let r = dateRow + 1; r < nRows; r++) {
    const a = str(G(r, 0));
    if (a) labels.push({ r, a });
  }

  const companies = [], assignments = [], notes = [], remarks = [], rosterRows = [], unknown = [];
  let school = 'Sch 1';
  let order = 0;

  for (let i = 0; i < labels.length; i++) {
    const { r, a } = labels[i];
    const next = i + 1 < labels.length ? labels[i + 1].r : nRows;
    const sch = a.match(/^sch\s*(\d)$/i);
    if (sch && str(G(r, 1)).toLowerCase() === 's/no') { school = `Sch ${sch[1]}`; continue; }

    // Roster rows at the bottom: "Sch1/2" | n | Name
    if (/^sch\s*[\d\/]+$/i.test(a) && str(G(r, 1)) !== 'S/No' && str(G(r, 2))) {
      rosterRows.push({ name: str(G(r, 2)), school: a.replace(/\s+/g, ' ') });
      continue;
    }

    if (/^staff remarks$/i.test(a)) {
      for (let rr = r; rr < next; rr++) {
        days.forEach((d) => {
          const t = str(G(rr, d.col));
          if (!t) return;
          const p = parseNameCell(t, matcher);
          remarks.push({ date: d.date, instructor_id: p.people[0]?.id || null, text: t });
        });
      }
      continue;
    }
    if (NOT_BLOCK.test(a)) continue;

    // A company / duty block. Limit to 8 rows so stray rows far below don't attach.
    const end = Math.min(next, r + 8);
    const name = a;
    companies.push({ name, school: name === 'BMTC' || name === 'Reserves' ? 'BMTC' : school, order: order++ });

    days.forEach((d, di) => {
      const slotCols = slotColsFor(di);
      const lessons = {};
      for (const { c, slot } of slotCols) {
        const t = str(G(r, c));
        if (t) lessons[slot] = lessons[slot] ? `${lessons[slot]} / ${t}` : t;
      }
      const dayNotes = [];
      for (let rr = r; rr < end; rr++) {
        const t = str(G(rr, d.col));
        if (!t) continue;
        const p = parseNameCell(t, matcher);
        if (!p.people.length) {
          dayNotes.push(t);
          // looks like a person nobody recognises (e.g. "Kelvin AM") rather than a note like "NO PT"
          if (p.unknown.length && p.unknown.length <= 4 && !/\d/.test(t) && !NOTE_WORDS.test(t)) {
            unknown.push({ date: d.date, company: name, cell: t, words: p.unknown });
          }
          continue;
        }
        if (p.unknown.length) unknown.push({ date: d.date, company: name, cell: t, words: p.unknown });
        for (const person of p.people) {
          const existing = assignments.find((x) => x.date === d.date && x.company === name && x.instructor_id === person.id);
          if (existing) {
            if (existing.slots && person.slots) existing.slots = SLOT_ORDER.filter((s) => existing.slots.includes(s) || person.slots.includes(s));
            else existing.slots = null;
            continue;
          }
          assignments.push({ date: d.date, company: name, instructor_id: person.id, slots: person.slots, lessons, raw: t });
        }
      }
      // Extra non-name rows inside slot columns (e.g. BMTC event details) — keep as notes
      for (let rr = r + 1; rr < end; rr++) {
        for (const { c } of slotCols) { const t = str(G(rr, c)); if (t) dayNotes.push(t); }
      }
      const hasAnyone = assignments.some((x) => x.date === d.date && x.company === name);
      if (!hasAnyone && Object.keys(lessons).length) dayNotes.push(...Object.entries(lessons).map(([s, t]) => `${SLOT_LABEL[s]}: ${t}`));
      if (dayNotes.length) notes.push({ date: d.date, company: name, text: dayNotes.join(' · ') });
    });
  }

  return { days, companies, assignments, notes, remarks, roster: rosterRows, unknown };
}

// Stable key + comparable value for diffing
export function assignmentKey(a) { return `${a.date}|${a.company}|${a.instructor_id}`; }
export function assignmentSig(a) {
  const slots = a.slots ? a.slots.join(',') : 'ALL';
  const relevant = a.slots ? a.slots : SLOT_ORDER;
  const lessons = relevant.map((s) => (a.lessons[s] ? `${s}=${a.lessons[s]}` : '')).filter(Boolean).join(';');
  return `${slots}#${lessons}`;
}

// Human description of what an instructor is doing in an assignment
export function describe(a) {
  const relevant = a.slots || SLOT_ORDER.filter((s) => a.lessons[s]);
  const parts = relevant.map((s) => (a.lessons[s] ? `${SLOT_LABEL[s]} ${a.lessons[s]}` : SLOT_LABEL[s]));
  if (!parts.length) return a.slots ? a.slots.map((s) => SLOT_LABEL[s]).join('/') : 'full day';
  return parts.join(', ');
}

/**
 * Diff two lists of assignments (old snapshot vs new) for dates >= fromDate.
 * Returns [{type:'added'|'removed'|'changed', instructor_id, date, company, before, after}]
 */
export function diffAssignments(oldList, newList, fromDate) {
  const o = new Map(oldList.filter((a) => a.date >= fromDate).map((a) => [assignmentKey(a), a]));
  const n = new Map(newList.filter((a) => a.date >= fromDate).map((a) => [assignmentKey(a), a]));
  const out = [];
  for (const [k, a] of n) {
    const b = o.get(k);
    if (!b) out.push({ type: 'added', instructor_id: a.instructor_id, date: a.date, company: a.company, before: null, after: a });
    else if (assignmentSig(a) !== assignmentSig(b)) out.push({ type: 'changed', instructor_id: a.instructor_id, date: a.date, company: a.company, before: b, after: a });
  }
  for (const [k, b] of o) if (!n.has(k)) out.push({ type: 'removed', instructor_id: b.instructor_id, date: b.date, company: b.company, before: b, after: null });
  return out.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
}
