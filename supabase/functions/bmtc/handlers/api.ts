// App actions that need the service role: join/sign-in, push subscribe, Telegram connect, admin tools.
import { admin, getSecret, json, CORS, caller, sha256, randomCode, tg, notify, notifyAdmins, esc, getSetting, setSetting, APP_URL } from '../lib/common.js';
import { serviceAccountEmail } from '../lib/google.js';
import { runSync } from '../lib/sync.js';

const authEmail = (id: string) => `i-${id}@bmtc-roster.app`;

async function botLink(db, payload: string) {
  const u = await getSetting(db, 'bot_username');
  return u ? `https://t.me/${u}?start=${payload}` : null;
}

// Create the auth user on first use and return a one-time token the app exchanges for a session
async function issueSession(db, inst) {
  const email = authEmail(inst.id);
  if (!inst.user_id) {
    const { data: created, error } = await db.auth.admin.createUser({ email, email_confirm: true, user_metadata: { instructor_id: inst.id, name: inst.name } });
    if (error) throw error;
    await db.from('instructors').update({ user_id: created.user.id }).eq('id', inst.id);
  }
  const { data: link, error: le } = await db.auth.admin.generateLink({ type: 'magiclink', email });
  if (le) throw le;
  return link.properties.hashed_token;
}

async function teamCodeOk(db, code) {
  const t = await getSetting(db, 'team_code');
  return !!t && !!code && t === code;
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
      if (!lc || lc.used_at || new Date(lc.expires_at) < new Date()) return json({ error: 'This sign-in link has expired. Sign in with your name and PIN.' }, 400);
      await db.from('login_codes').update({ used_at: new Date().toISOString() }).eq('code_hash', lc.code_hash);
      const { data: inst } = await db.from('instructors').select('*').eq('id', lc.instructor_id).maybeSingle();
      if (!inst?.active) return json({ error: 'Your access has been removed.' }, 403);
      await db.from('login_codes').delete().lt('expires_at', new Date(Date.now() - 86400000).toISOString());
      return json({ token_hash: await issueSession(db, inst) });
    }

    // ---- joining with the team link + PIN ----
    if (action === 'join-names') {
      if (!(await teamCodeOk(db, body.code))) return json({ error: 'This join link is no longer active. Ask an admin for the current one.' }, 403);
      const { data: people } = await db.from('instructors').select('id,name').eq('active', true).order('name');
      const { data: pins } = await db.from('pins').select('instructor_id');
      const taken = new Set((pins || []).map((p) => p.instructor_id));
      return json({ names: (people || []).filter((p) => !taken.has(p.id)) });
    }

    if (action === 'join') {
      if (!(await teamCodeOk(db, body.code))) return json({ error: 'This join link is no longer active. Ask an admin for the current one.' }, 403);
      const pin = String(body.pin || '');
      if (!/^[0-9]{4,6}$/.test(pin)) return json({ error: 'PIN must be 4 to 6 digits' }, 400);
      const { data: inst } = await db.from('instructors').select('*').eq('id', body.instructor_id).eq('active', true).maybeSingle();
      if (!inst) return json({ error: 'That name is not on the roster' }, 400);
      const { data: existing } = await db.from('pins').select('instructor_id').eq('instructor_id', inst.id).maybeSingle();
      if (existing) return json({ error: `${inst.name} has already joined. If that's you, sign in with your PIN or ask an admin to reset it.` }, 409);
      const { error: pe } = await db.rpc('set_pin', { p_instructor: inst.id, p_pin: pin });
      if (pe) throw pe;
      await db.from('contacts').upsert({ instructor_id: inst.id }, { onConflict: 'instructor_id', ignoreDuplicates: true });
      await notifyAdmins(db, `👤 <b>${esc(inst.name)}</b> joined BMTC Roster.\nWrong person? Admin → People → Reset PIN.`, null);
      return json({ token_hash: await issueSession(db, inst), name: inst.name });
    }

    if (action === 'pin-login') {
      const name = String(body.name || '').trim().toLowerCase();
      const pin = String(body.pin || '');
      const fail = json({ error: 'Name or PIN is wrong' }, 401);
      if (!name || !pin) return fail;
      const { data: people } = await db.from('instructors').select('*').eq('active', true);
      const inst = (people || []).find((p) => p.name.toLowerCase() === name || (p.aliases || []).some((a) => a.toLowerCase() === name));
      if (!inst) return fail;
      const { data: res, error } = await db.rpc('check_pin', { p_instructor: inst.id, p_pin: pin });
      if (error) throw error;
      if (res === 'locked') return json({ error: 'Too many wrong tries. Wait 15 minutes, or ask an admin to reset your PIN.' }, 429);
      if (res === 'nopin') return json({ error: 'You haven\'t joined yet. Use the join link from your team group.' }, 401);
      if (res !== 'ok') return fail;
      return json({ token_hash: await issueSession(db, inst) });
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

    if (action === 'telegram-link') {
      await db.from('invite_codes').delete().eq('instructor_id', me.id).is('used_at', null);
      const code = randomCode(12);
      await db.from('invite_codes').insert({ code, instructor_id: me.id, created_by: me.id });
      const link = await botLink(db, `inv_${code}`);
      if (!link) return json({ error: 'Telegram alerts are not set up yet' }, 400);
      return json({ link });
    }

    if (action === 'test-notify') {
      const ok = await notify(db, me.id, '🔔 Test alert from BMTC Roster. Notifications are working.', { title: 'BMTC Roster', body: 'Test alert: notifications are working.' });
      return json({ ok });
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

    if (action === 'team-link') {
      if (body.off) { await setSetting(db, 'team_code', null); return json({ link: null }); }
      let code = await getSetting(db, 'team_code');
      if (!code || body.rotate) { code = randomCode(9); await setSetting(db, 'team_code', code); }
      return json({ link: `${APP_URL()}/#join=${code}` });
    }

    if (action === 'team-link-status') {
      const code = await getSetting(db, 'team_code');
      return json({ link: code ? `${APP_URL()}/#join=${code}` : null });
    }

    if (action === 'revoke') {
      const { data: inst } = await db.from('instructors').select('*').eq('id', body.instructor_id).maybeSingle();
      if (!inst) return json({ error: 'not found' }, 404);
      if (inst.id === me.id) return json({ error: 'You cannot revoke yourself' }, 400);
      await db.from('contacts').update({ telegram_chat_id: null }).eq('instructor_id', inst.id);
      await db.from('push_subscriptions').delete().eq('instructor_id', inst.id);
      await db.from('invite_codes').delete().eq('instructor_id', inst.id);
      await db.from('pins').delete().eq('instructor_id', inst.id);
      if (inst.user_id) { await db.auth.admin.deleteUser(inst.user_id); }
      await db.from('instructors').update({ user_id: null }).eq('id', inst.id);
      return json({ ok: true });
    }

    if (action === 'reset-pin') {
      const { data: inst } = await db.from('instructors').select('*').eq('id', body.instructor_id).maybeSingle();
      if (!inst) return json({ error: 'not found' }, 404);
      if (inst.id === me.id) return json({ error: 'Ask another admin to reset your PIN' }, 400);
      await db.from('pins').delete().eq('instructor_id', inst.id);
      if (inst.user_id) { await db.auth.admin.deleteUser(inst.user_id); await db.from('instructors').update({ user_id: null }).eq('id', inst.id); }
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
