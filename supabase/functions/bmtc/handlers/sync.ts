// Called by pg_cron every few minutes (x-cron-secret header). Also accepts {grids} test payloads with the same secret.
import { admin, getSecret, json, CORS } from '../lib/common.js';
import { runSync } from '../lib/sync.js';

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const db = admin();
  const secret = await getSecret(db, 'CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return json({ error: 'forbidden' }, 403);
  let body: any = {};
  try { body = await req.json(); } catch { /* cron sends empty body */ }
  try {
    const res = await runSync(db, { grids: body.grids, force: !!body.force });
    return json(res);
  } catch (e) {
    const msg = String(e?.message || e);
    await db.from('settings').upsert({ key: 'last_sync_status', value: 'error: ' + msg });
    await db.from('settings').upsert({ key: 'last_sync_at', value: new Date().toISOString() });
    await db.from('sync_log').insert({ ok: false, message: msg });
    return json({ ok: false, error: msg }, 500);
  }
}
