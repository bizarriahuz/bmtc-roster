// Telegram webhook. Links chats to instructors (personal invites or the team join link),
// hands out login links, answers /today etc.
import { admin, getSecret, getSetting, json, tg, sendTelegram, notifyAdmins, sgDate, addDays, fmtDate, esc, APP_URL, randomCode, sha256 } from '../lib/common.js';
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

// Link a Telegram chat to an instructor and send the welcome + app link
async function linkChat(db, chatId, from, inst) {
  await db.from('contacts').update({ telegram_chat_id: null }).eq('telegram_chat_id', chatId);
  await db.from('contacts').upsert({ instructor_id: inst.id, telegram_chat_id: chatId, telegram_username: from?.username || null, linked_at: new Date().toISOString() });
  const link = await loginLink(db, inst.id);
  await sendTelegram(chatId, `✅ Linked as <b>${esc(inst.name)}</b>. You'll get schedule changes here.\n\nSend /today or /week anytime. Tap below to open the app (link works once, for 15 min; send /login for a new one).`, {
    reply_markup: { inline_keyboard: [[{ text: 'Open BMTC Roster', url: link }]] },
  });
}

// Names still free to claim with the team link
async function unclaimed(db) {
  const { data: people } = await db.from('instructors').select('id,name').eq('active', true).order('name');
  const { data: linked } = await db.from('contacts').select('instructor_id').not('telegram_chat_id', 'is', null);
  const taken = new Set((linked || []).map((c) => c.instructor_id));
  return (people || []).filter((p) => !taken.has(p.id));
}

async function showNamePicker(db, chatId, code) {
  const free = await unclaimed(db);
  if (!free.length) { await sendTelegram(chatId, 'Everyone on the roster is already linked. If your name is missing, ask an admin to add you.'); return; }
  const rows = [];
  for (let i = 0; i < free.length; i += 3) rows.push(free.slice(i, i + 3).map((p) => ({ text: p.name, callback_data: `c:${p.id}:${code}` })));
  await sendTelegram(chatId, '👋 Welcome to <b>BMTC Roster</b>.\n\nTap <b>your own name</b> below. You can only pick once, and admins are told who joined as whom.\n\nName not here? Ask an admin to add you.', {
    reply_markup: { inline_keyboard: rows },
  });
}

async function handleCallback(db, cq) {
  const chatId = cq.message?.chat?.id;
  const m = String(cq.data || '').match(/^c:([0-9a-f-]{36}):([A-Za-z0-9_-]+)$/);
  const answer = (text) => tg('answerCallbackQuery', { callback_query_id: cq.id, text, show_alert: true });
  if (!m || !chatId || cq.message?.chat?.type !== 'private') { await answer('Something went wrong. Try the join link again.'); return; }
  const [, instId, code] = m;
  const teamCode = await getSetting(db, 'team_code');
  if (!teamCode || teamCode !== code) { await answer('This join link has been turned off. Ask an admin for the current one.'); return; }
  const { data: already } = await db.from('contacts').select('instructor_id').eq('telegram_chat_id', chatId).maybeSingle();
  if (already) { await answer('This Telegram account is already linked. Send /login to open the app.'); return; }
  const { data: inst } = await db.from('instructors').select('id,name,active').eq('id', instId).maybeSingle();
  if (!inst?.active) { await answer('That name is no longer on the roster.'); return; }
  const { data: taken } = await db.from('contacts').select('telegram_chat_id').eq('instructor_id', instId).maybeSingle();
  if (taken?.telegram_chat_id) { await answer(`${inst.name} has already been claimed. If that's you, tell an admin.`); return; }

  await tg('answerCallbackQuery', { callback_query_id: cq.id, text: `Linked as ${inst.name}` });
  await tg('editMessageText', { chat_id: chatId, message_id: cq.message.message_id, text: `You picked <b>${esc(inst.name)}</b>.`, parse_mode: 'HTML' });
  await linkChat(db, chatId, cq.from, inst);
  const who = [cq.from?.first_name, cq.from?.last_name].filter(Boolean).join(' ');
  await notifyAdmins(db, `👤 <b>${esc(inst.name)}</b> joined via the team link (Telegram: ${esc(who)}${cq.from?.username ? ' @' + esc(cq.from.username) : ''}).\nWrong person? Admin → People → Remove access.`, null);
}

export default async function handler(req: Request): Promise<Response> {
  const db = admin();
  const secret = await getSecret(db, 'TELEGRAM_WEBHOOK_SECRET');
  if (!secret || req.headers.get('x-telegram-bot-api-secret-token') !== secret) return json({ error: 'forbidden' }, 403);
  const update = await req.json().catch(() => ({}));

  if (update.callback_query) { await handleCallback(db, update.callback_query); return json({ ok: true }); }

  const msg = update.message;
  if (!msg?.text || msg.chat?.type !== 'private') return json({ ok: true });
  const chatId = msg.chat.id;
  const text = msg.text.trim();

  const { data: contact } = await db.from('contacts').select('*, instructors(id,name,active)').eq('telegram_chat_id', chatId).maybeSingle();
  const isLinked = contact && contact.instructors?.active;

  // personal invite: from /start payload, or a pasted link/code
  const inv = text.match(/inv_([A-Za-z0-9_-]{8,})/);
  if (inv) {
    const { data: code } = await db.from('invite_codes').select('*, instructors!invite_codes_instructor_id_fkey(id,name,active)').eq('code', inv[1]).maybeSingle();
    if (!code || code.used_at || !code.instructors?.active) {
      await sendTelegram(chatId, 'That invite link is invalid or already used. Ask an admin for a new one.');
      return json({ ok: true });
    }
    await db.from('invite_codes').update({ used_at: new Date().toISOString() }).eq('code', inv[1]);
    await linkChat(db, chatId, msg.from, code.instructors);
    return json({ ok: true });
  }

  // team join link
  const team = text.match(/team_([A-Za-z0-9_-]{6,})/);
  if (team) {
    if (isLinked) { await sendTelegram(chatId, `You're already linked as <b>${esc(contact.instructors.name)}</b>. Send /login to open the app.`); return json({ ok: true }); }
    const teamCode = await getSetting(db, 'team_code');
    if (!teamCode || teamCode !== team[1]) { await sendTelegram(chatId, 'This join link has been turned off. Ask an admin for the current one.'); return json({ ok: true }); }
    await showNamePicker(db, chatId, teamCode);
    return json({ ok: true });
  }

  if (!isLinked) {
    await sendTelegram(chatId, 'This Telegram account isn\'t linked to the roster yet. Use the team join link from your group chat, or paste the invite link an admin sent you here.');
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
