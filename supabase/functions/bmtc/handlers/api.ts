// App actions that need the service role: login exchange, push subscribe, swaps, admin tools.
import { admin, getSecret, json, CORS, caller, sha256, randomCode, tg, notify, notifyAdmins, esc, fmtDate, getSetting, setSetting, sgDate, APP_URL } from '../lib/common.js';
import { serviceAccountEmail } from '../lib/google.js';
import { runSync } from '../lib/sync.js';
import { describe } from '../lib/parser.js';

const authEmail = (id: string) => `i-${id}@bmtc-roster.app`;

async function botLink(db, payload: string) {
  const u = await getSetting(db, 'bot_username');
  return u ? `https://t.me/${u}?start=${payload}` : null;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const db = admin();
  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: 'bad request' }, 400); }
  const action = body.action;

  try {
    // ---------- public ----------
    if (action === 'public-config') {
      return json({ bot_username: await getSetting(db, 'bot_username'), vapid_public_key: await getSecret(db, 'VAPID_PUBLIC_KEY') });
    }

    if (action === 'exchange-login') {
      const code = String(body.code || '');
      if (code.length < 20) return json({ error: 'invalid code' }, 400);
      const { data: lc } = await db.from('login_codes').select('*').eq('code_hash', await sha256(code)).maybeSingle();
      if (!lc || lc.used_at || new Date(lc.expires_at) < new Date()) return json({ error: 'This sign-in link has expired. Send /login to the bot for a new one.' }, 400);
      await db.from('login_codes').update({ used_at: new Date().toISOString() }).eq('code_hash', lc.code_hash);
      const { data: inst } = await db.from('instructors').select('*').eq('id', lc.instructor_id).maybeSingle();
      if (!inst?.active) return json({ error: 'Your access has been removed.' }, 403);
      const email = authEmail(inst.id);
      if (!inst.user_id) {
        const { data: created, error } = await db.auth.admin.createUser({ email, email_confirm: true, user_metadata: { instructor_id: inst.id, name: inst.name } });
        if (error) throw error;
        await db.from('instructors').update({ user_id: created.user.id }).eq('id', inst.id);
      }
      const { data: link, error: le } = await db.auth.admin.generateLink({ type: 'magiclink', email });
      if (le) throw le;
      // housekeeping
      await db.from('login_codes').delete().lt('expires_at', new Date(Date.now() - 86400000).toISOString());
      return json({ token_hash: link.properties.hashed_token });
    }

    // ---------- signed-in ----------
    const me = await caller(req, db);
    if (!me) return json({ error: 'not signed in' }, 401);

    if (action === 'push-subscribe') {
      const s = body.subscription;
      if (!s?.endpoint || !s?.keys?.p256dh || !s?.keys?.auth) return json({ error: 'bad subscription' }, 400);
      await db.from('push_subscriptions').upsert({ instructor_id: me.id, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth }, { onConflict: 'endpoint' });
      await db.from('contacts').upsert({ instructor_id: me.id }, { onConflict: 'instructor_id', ignoreDuplicates: true });
      return json({ ok: true });
    }

    if (action === 'test-notify') {
      const ok = await notify(db, me.id, '🔔 Test alert from BMTC Roster. Notifications are working.', { title: 'BMTC Roster', body: 'Test alert: notifications are working.' });
      return json({ ok });
    }

    if (action === 'swap-create') {
      const { target_id, date, company, note } = body;
      if (!target_id || !date || !company || target_id === me.id) return json({ error: 'missing fields' }, 400);
      if (date < sgDate(0)) return json({ error: 'That date has passed' }, 400);
      const { data: a } = await db.from('assignments').select('*').eq('instructor_id', me.id).eq('date', date).eq('company', company).maybeSingle();
      if (!a) return json({ error: 'You are not on that slot' }, 400);
      const { data: target } = await db.from('instructors').select('id,name').eq('id', target_id).eq('active', true).maybeSingle();
      if (!target) return json({ error: 'Unknown instructor' }, 400);
      const { data: sw, error } = await db.from('swap_requests').insert({ requester_id: me.id, target_id, date, company, note: note?.slice(0, 300) || null }).select().single();
      if (error) throw error;
      await notify(db, target_id,
        `🔄 <b>${esc(me.name)}</b> asks you to cover <b>${esc(company)}</b>, ${fmtDate(date)}: ${esc(describe({ ...a, lessons: a.lessons || {} }))}${note ? `\n“${esc(note)}”` : ''}\n\n<a href="${APP_URL()}/#swaps">Accept or decline in the app</a>`,
        { title: 'Swap request', body: `${me.name}: ${company}, ${fmtDate(date)}` });
      return json({ ok: true, id: sw.id });
    }

    if (action === 'swap-respond' || action === 'swap-decide' || action === 'swap-cancel') {
      const { data: sw } = await db.from('swap_requests').select('*').eq('id', body.id).maybeSingle();
      if (!sw) return json({ error: 'not found' }, 404);
      const names = new Map(((await db.from('instructors').select('id,name').in('id', [sw.requester_id, sw.target_id])).data || []).map((x) => [x.id, x.name]));
      const R = names.get(sw.requester_id), T = names.get(sw.target_id);
      const what = `${esc(sw.company)}, ${fmtDate(sw.date)}`;

      if (action === 'swap-cancel') {
        if (sw.requester_id !== me.id || !['pending', 'accepted'].includes(sw.status)) return json({ error: 'not allowed' }, 403);
        await db.from('swap_requests').update({ status: 'cancelled' }).eq('id', sw.id);
        await notify(db, sw.target_id, `🔄 ${esc(R)} cancelled the swap request for ${what}.`, { title: 'Swap cancelled', body: `${R}: ${sw.company}` });
        return json({ ok: true });
      }
      if (action === 'swap-respond') {
        if (sw.target_id !== me.id || sw.status !== 'pending') return json({ error: 'not allowed' }, 403);
        const status = body.accept ? 'accepted' : 'declined';
        await db.from('swap_requests').update({ status }).eq('id', sw.id);
        await notify(db, sw.requester_id, `🔄 ${esc(T)} <b>${status}</b> your swap for ${what}.${body.accept ? ' Waiting for admin approval.' : ''}`, { title: `Swap ${status}`, body: `${T}: ${sw.company}, ${fmtDate(sw.date)}` });
        if (body.accept) await notifyAdmins(db, `🔄 Swap needs approval: <b>${esc(R)}</b> → <b>${esc(T)}</b> for ${what}.\n<a href="${APP_URL()}/#swaps">Review</a>`, { title: 'Swap needs approval', body: `${R} → ${T}: ${sw.company}` });
        return json({ ok: true });
      }
      // swap-decide (admin)
      if (!me.is_admin || sw.status !== 'accepted') return json({ error: 'not allowed' }, 403);
      const status = body.approve ? 'approved' : 'rejected';
      await db.from('swap_requests').update({ status, decided_by: me.id, decided_at: new Date().toISOString() }).eq('id', sw.id);
      const tail = body.approve ? ' The sheet will be updated and you\'ll get a change alert when it is.' : '';
      for (const id of [sw.requester_id, sw.target_id]) {
        await notify(db, id, `🔄 Swap ${R} → ${T} for ${what} was <b>${status}</b> by ${esc(me.name)}.${tail}`, { title: `Swap ${status}`, body: `${R} → ${T}: ${sw.company}` });
      }
      return json({ ok: true });
    }

    // ---------- admin ----------
    if (!me.is_admin) return json({ error: 'admins only' }, 403);

    if (action === 'invite') {
      const { data: inst } = await db.from('instructors').select('id,name').eq('id', body.instructor_id).maybeSingle();
      if (!inst) return json({ error: 'not found' }, 404);
      await db.from('invite_codes').delete().eq('instructor_id', inst.id).is('used_at', null);
      const code = randomCode(12);
      await db.from('invite_codes').insert({ code, instructor_id: inst.id, created_by: me.id });
      const link = await botLink(db, `inv_${code}`);
      if (!link) return json({ error: 'Connect the Telegram bot first (Admin → Settings).' }, 400);
      return json({ link, name: inst.name });
    }

    if (action === 'revoke') {
      // remove someone's access immediately
      const { data: inst } = await db.from('instructors').select('*').eq('id', body.instructor_id).maybeSingle();
      if (!inst) return json({ error: 'not found' }, 404);
      if (inst.id === me.id) return json({ error: 'You cannot revoke yourself' }, 400);
      await db.from('contacts').update({ telegram_chat_id: null }).eq('instructor_id', inst.id);
      await db.from('push_subscriptions').delete().eq('instructor_id', inst.id);
      await db.from('invite_codes').delete().eq('instructor_id', inst.id);
      if (inst.user_id) { await db.auth.admin.deleteUser(inst.user_id); }
      await db.from('instructors').update({ user_id: null }).eq('id', inst.id);
      return json({ ok: true });
    }

    if (action === 'bot-setup') {
      const meBot = await tg('getMe', {});
      if (!meBot.ok) return json({ error: 'Bot token missing or wrong: ' + (meBot.description || '') }, 400);
      await setSetting(db, 'bot_username', meBot.result.username);
      const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/bmtc/telegram`;
      const wh = await tg('setWebhook', { url, secret_token: await getSecret(db, 'TELEGRAM_WEBHOOK_SECRET'), allowed_updates: ['message'], drop_pending_updates: true });
      await tg('setMyCommands', { commands: [
        { command: 'today', description: 'Your slots today' }, { command: 'tomorrow', description: 'Your slots tomorrow' },
        { command: 'week', description: 'Next 7 days' }, { command: 'login', description: 'Sign-in link for the app' },
        { command: 'mute', description: 'Pause alerts' }, { command: 'unmute', description: 'Resume alerts' },
      ] });
      return json({ ok: wh.ok, bot_username: meBot.result.username, webhook: wh.description });
    }

    if (action === 'sheet-info') {
      return json({ service_account: serviceAccountEmail(), sheet_id: await getSetting(db, 'sheet_id') });
    }

    if (action === 'sync-now') {
      const res = await runSync(db, { force: !!body.force });
      return json(res);
    }

    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
}
