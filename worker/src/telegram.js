// Telegram webhook (optional alerts channel). Links a chat via the code from app Settings, answers /today etc.
import { getSecret, json, sendTelegram, sgDate, addDays, fmtDate, esc, APP_URL, randomCode, sha256, first, all, run, nowIso, asAssignment } from './common.js';
import { describe } from './parser.js';

const HELP = [
  '<b>BMTC Roster bot</b>',
  '/login – get a sign-in link for the app',
  '/today – your slots today',
  '/tomorrow – your slots tomorrow',
  '/week – next 7 days',
  '/mute – pause Telegram alerts',
  '/unmute – resume alerts',
].join('\n');

async function loginLink(env, instructorId) {
  const code = randomCode(24);
  await run(env.DB, 'insert into login_codes(code_hash, instructor_id, expires_at) values (?, ?, ?)',
    await sha256(code), instructorId, new Date(Date.now() + 15 * 60000).toISOString());
  return `${APP_URL(env)}/#login=${code}`;
}

async function scheduleText(db, instructorId, from, to, title) {
  const data = (await all(db, 'select date, company, slots, lessons, info from assignments where instructor_id = ? and date between ? and ? order by date',
    instructorId, from, to)).map(asAssignment);
  const rem = await all(db, 'select date, text from remarks where instructor_id = ? and date between ? and ?', instructorId, from, to);
  const items = [...rem.map((r) => ({ date: r.date, line: `🌴 <b>${esc(r.text)}</b>${/\b(am|pm|mid)/i.test(r.text) ? '' : ', not on PT'}`, o: 0 })),
    ...data.map((a) => ({ date: a.date, line: `• ${esc(a.company)}: ${esc(describe(a))}`, o: 1 }))]
    .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.o - y.o));
  if (!items.length) return `${title}\nNothing on the roster for you.`;
  const lines = [title];
  let cur = '';
  for (const it of items) {
    if (it.date !== cur) { cur = it.date; if (from !== to) lines.push(`<b>${fmtDate(it.date)}</b>`); }
    lines.push(it.line);
  }
  return lines.join('\n');
}

// Link a Telegram chat to an instructor
async function linkChat(env, chatId, from, inst) {
  await env.DB.batch([
    env.DB.prepare('update contacts set telegram_chat_id = null where telegram_chat_id = ?').bind(chatId),
    env.DB.prepare(`insert into contacts(instructor_id, telegram_chat_id, telegram_username, linked_at) values (?, ?, ?, ?)
      on conflict(instructor_id) do update set telegram_chat_id = excluded.telegram_chat_id,
      telegram_username = excluded.telegram_username, linked_at = excluded.linked_at`).bind(inst.id, chatId, from?.username || null, nowIso()),
  ]);
  await sendTelegram(env, chatId, `✅ Telegram alerts are on for <b>${esc(inst.name)}</b>. Schedule changes will come here.\n\nYou can also send /today, /tomorrow or /week anytime.`);
}

export async function handleTelegram(req, env) {
  const db = env.DB;
  const secret = await getSecret(db, 'TELEGRAM_WEBHOOK_SECRET');
  if (!secret || req.headers.get('x-telegram-bot-api-secret-token') !== secret) return json({ error: 'forbidden' }, 403);
  const update = await req.json().catch(() => ({}));

  const msg = update.message;
  if (!msg?.text || msg.chat?.type !== 'private') return json({ ok: true });
  const chatId = msg.chat.id;
  const text = msg.text.trim();

  // personal link code: from /start payload, or a pasted link/code
  const inv = text.match(/inv_([A-Za-z0-9_-]{8,})/);
  if (inv) {
    const code = await first(db, `select c.*, i.id inst_id, i.name, i.active from invite_codes c join instructors i on i.id = c.instructor_id where c.code = ?`, inv[1]);
    if (!code || code.used_at || !code.active) {
      await sendTelegram(env, chatId, 'That link has expired. In the app, go to Settings → Get alerts on Telegram to get a new one.');
      return json({ ok: true });
    }
    await run(db, 'update invite_codes set used_at = ? where code = ?', nowIso(), inv[1]);
    await linkChat(env, chatId, msg.from, { id: code.inst_id, name: code.name });
    return json({ ok: true });
  }

  const me = await first(db, `select i.id, i.name from contacts c join instructors i on i.id = c.instructor_id and i.active = 1 where c.telegram_chat_id = ?`, chatId);
  if (!me) {
    await sendTelegram(env, chatId, 'This Telegram account isn\'t linked yet. Open the BMTC Roster app → Settings → <b>Get alerts on Telegram</b>.');
    return json({ ok: true });
  }
  const cmd = text.split(/\s+/)[0].replace(/@.*$/, '').toLowerCase();
  const today = sgDate(0);

  if (cmd === '/login' || cmd === '/start') {
    const link = await loginLink(env, me.id);
    await sendTelegram(env, chatId, `Hi ${esc(me.name)}, here's your sign-in link (one use, 15 min).`, {
      reply_markup: { inline_keyboard: [[{ text: 'Open BMTC Roster', url: link }]] },
    });
  } else if (cmd === '/today') {
    await sendTelegram(env, chatId, await scheduleText(db, me.id, today, today, `<b>Today, ${fmtDate(today)}</b>`));
  } else if (cmd === '/tomorrow') {
    const t = sgDate(1);
    await sendTelegram(env, chatId, await scheduleText(db, me.id, t, t, `<b>Tomorrow, ${fmtDate(t)}</b>`));
  } else if (cmd === '/week') {
    await sendTelegram(env, chatId, await scheduleText(db, me.id, today, addDays(today, 6), '<b>Next 7 days</b>'));
  } else if (cmd === '/mute') {
    await run(db, 'update contacts set notify_telegram = 0 where instructor_id = ?', me.id);
    await sendTelegram(env, chatId, '🔕 Telegram alerts paused. Send /unmute to turn them back on.');
  } else if (cmd === '/unmute') {
    await run(db, 'update contacts set notify_telegram = 1 where instructor_id = ?', me.id);
    await sendTelegram(env, chatId, '🔔 Telegram alerts are on.');
  } else {
    await sendTelegram(env, chatId, HELP);
  }
  return json({ ok: true });
}
