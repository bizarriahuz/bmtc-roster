import fs from 'node:fs';
import { parseTab, tabStartDate } from '../supabase/functions/_shared/parser.js';
const grids = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
// pass 1: roster names from roster rows of every tab
const names = new Map();
for (const [t, g] of Object.entries(grids)) {
  const p = parseTab(g, []); if (!p) continue;
  for (const r of p.roster) names.set(r.name.toLowerCase(), r);
}
const roster = [...names.values()].map((r, i) => ({ id: r.name, name: r.name, aliases: [] }));
console.log('roster from sheet:', roster.length, roster.map(r=>r.name).join(', '));
const unk = new Map(); let tabs=0, nA=0, bad=[];
for (const [t, g] of Object.entries(grids)) {
  const p = parseTab(g, roster);
  if (!p) { if (/\d/.test(t)) bad.push(t); continue; }
  tabs++; nA += p.assignments.length;
  const sd = tabStartDate(t);
  if (sd !== p.days[0]?.date) bad.push(`${t}: title=${sd} row=${p.days[0]?.date} days=${p.days.length}`);
  for (const u of p.unknown) for (const w of u.words) unk.set(w.toLowerCase(), (unk.get(w.toLowerCase())||0)+1);
}
console.log('tabs', tabs, 'assignments', nA);
console.log('date mismatches/bad:', bad);
console.log('unknown words:', [...unk.entries()].sort((a,b)=>b[1]-a[1]).slice(0,80));
