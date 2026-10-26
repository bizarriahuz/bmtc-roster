import fs from 'node:fs';
import { parseTab, describe } from '../supabase/functions/bmtc/lib/parser.js';
const grids = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const names = ['Antonio','Rizqan','Wesley','Azim','Syasya','Danial','Eric','Haziq','Yong Yi','Amos','Ahmad','Azfar','Arif','Zul','Hefi','Izzuddin','Shahril','Azizi','Ziv','Irwan','Keith','Zaini','Hafiz','Shaf','Taufiq','Vikenesh','Darwisy','Fazli','Aswad','Sasthi','Haiqal','Nazim','Sulaiman','Danish','Zaki','Han Hui','Casper','Latfi'];
const al = { Izzuddin: ['Izzudin'], Keith: ['Keith Pereira'], Vikenesh: ['Vicknesh', 'Vick'], Latfi: ['Lafti'] };
const roster = names.map((n) => ({ id: n, name: n, aliases: al[n] || [] }));
const unk = new Map();
for (const t of ['19 Oct - 25 Oct 26', '26 Oct - 01 Nov 26', '02 Nov - 8 Nov 26']) {
  const p = parseTab(grids[t], roster);
  console.log(t, 'assignments', p.assignments.length, 'notes', p.notes.length, 'remarks', p.remarks.length, 'companies', p.companies.length);
  for (const u of p.unknown) for (const w of u.words) unk.set(w, (unk.get(w) || 0) + 1);
  if (t.startsWith('19')) {
    p.assignments.filter((a) => a.instructor_id === 'Wesley').forEach((a) => console.log('  Wesley', a.date, a.company, describe(a), '|', a.raw));
    console.log('  notes sample', p.notes.slice(0, 6));
  }
}
console.log('unknown in current weeks:', [...unk.entries()].sort((a, b) => b[1] - a[1]));
