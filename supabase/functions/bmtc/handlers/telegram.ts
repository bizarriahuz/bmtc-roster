// Telegram webhook (optional alerts channel). Links a chat via the code from app Settings, answers /today etc.
import { admin, getSecret, json, sendTelegram, sgDate, addDays, fmtDate, esc, APP_URL, randomCode, sha256 } from '../lib/common.js';
import { describe } from '../lib/parser.js';

const HELP = [
  '<b>BMTC Roster bot</b>',
  '/login – get a sign-in link for the app',
  '/today – your slots today',
  '/tomorrow – your slots tomorrow',
  '/week – next 7 days',
  '/mute – pause Telegram alerts',
  '/unmute – resume alerts',
].join('\n');

async function loginLink(db, instructorId) {
  const code = randomCode(24);
  await db.from('login_codes').insert({ code_hash: await sha256(code), instructor_id: instructorId, expires_at: new Date(Date.now() + 15 * 60000).toISOString() });
  return `${APP_URL()}/#login=${code}`;
}

async function scheduleText(db, instructorId, from, to, title) {
  const { data } = await db.from('assignments').select('date,company,slots,lessons').eq('instructor_id', instructorId).gte('date', from).lte('date', to).order('date');
  if (!data?.length) return `${title}\nNothing on the roster for you.`;
  const lines = [title];
  let cur = '';
  for (const a of data) {
    if (a.date !== cur) { cur = a.date; if (from !== to) lines.push(`<b>${fmtDate(a.date)}</b>`); }
    lines.push(`• ${esc(a.company)}: ${esc(describe({ ...a, lessons: a.lessons || {} }))}`);
  }
  return lines.join('\n');
}

// Link a Telegram chat to an instructor
async function linkChat(db, chatId, from, inst) {
  await db.from('contacts').update({ telegram_chat_id: null }).eq('telegram_chat_id', chatId);
  await db.from('contacts').upsert({ instructor_id: inst.id, telegram_chat_id: chatId, telegram_username: from?.username || null, linked_at: new Date().toISOString() });
  await sendTelegram(chatId, `✅ Telegram alerts are on for <b>${esc(inst.name)}</b>. Schedule changes will come here.\n\nYou can also send /today, /tomorrow or /week anytime.`);
}

export default async function handler(req: Request): Promise<Response> {
  const db = admin();
  const secret = await getSecret(db, 'TELEGRAM_WEBHOOK_SECRET');
  if (!secret || req.headers.get('x-telegram-bot-api-secret-token') !== secret) return json({ error: 'forbidden' }, 403);
  const update = await req.json().catch(() => ({}));

  const msg = update.message;
  if (!msg?.text || msg.chat?.type !== 'private') return json({ ok: true });
  const chatId = msg.chat.id;
  const text = msg.text.trim();

  const { data: contact } = await db.from('contacts').select('*, instructors(id,name,active)').eq('telegram_chat_id', chatId).maybeSingle();
  const isLinked = contact && contact.instructors?.active;

  // personal link code: from /start payload, or a pasted link/code
  const inv = text.match(/inv_([A-Za-z0-9_-]{8,})/);
  if (inv) {
    const { data: code } = await db.from('invite_codes').select('*, instructors!invite_codes_instructor_id_fkey(id,name,active)').eq('code', inv[1]).maybeSingle();
    if (!code || code.used_at || !code.instructors?.active) {
      await sendTelegram(chatId, 'That link has expired. In the app, go to Settings → Get alerts on Telegram to get a new one.');
      return json({ ok: true });
    }
    await db.from('invite_codes').update({ used_at: new Date().toISOString() }).eq('code', inv[1]);
    await linkChat(db, chatId, msg.from, code.instructors);
    return json({ ok: true });
  }

  if (!isLinked) {
    await sendTelegram(chatId, 'This Telegram account isn\'t linked yet. Open the BMTC Roster app → Settings → <b>Get alerts on Telegram</b>.');
    return json({ ok: true });
  }
  const me = contact.instructors;
  const cmd = text.split(/\s+/)[0].replace(/@.*$/, '').toLowerCase();
  const today = sgDate(0);

  if (cmd === '/login' || cmd === '/start') {
    const link = await loginLink(db, me.id);
    await sendTelegram(chatId, `Hi ${esc(me.name)}, here's your sign-in link (one use, 15 min).`, {
      reply_markup: { inline_keyboard: [[{ text: 'Open BMTC Roster', url: link }]] },
    });
  } else if (cmd === '/today') {
    await sendTelegram(chatId, await scheduleText(db, me.id, today, today, `<b>Today, ${fmtDate(today)}</b>`));
  } else if (cmd === '/tomorrow') {
    const t = sgDate(1);
    await sendTelegram(chatId, await scheduleText(db, me.id, t, t, `<b>Tomorrow, ${fmtDate(t)}</b>`));
  } else if (cmd === '/week') {
    await sendTelegram(chatId, await scheduleText(db, me.id, today, addDays(today, 6), '<b>Next 7 days</b>'));
  } else if (cmd === '/mute') {
    await db.from('contacts').update({ notify_telegram: false }).eq('instructor_id', me.id);
    await sendTelegram(chatId, '🔕 Telegram alerts paused. Send /unmute to turn them back on.');
  } else if (cmd === '/unmute') {
    await db.from('contacts').update({ notify_telegram: true }).eq('instructor_id', me.id);
    await sendTelegram(chatId, '🔔 Telegram alerts are on.');
  } else {
    await sendTelegram(chatId, HELP);
  }
  return json({ ok: true });
}
