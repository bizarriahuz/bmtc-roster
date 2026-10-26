// Single edge function with routes: /bmtc/sync, /bmtc/reminder, /bmtc/telegram, /bmtc/api
import sync from './handlers/sync.ts';
import reminder from './handlers/reminder.ts';
import telegram from './handlers/telegram.ts';
import api from './handlers/api.ts';
import { CORS, json } from './lib/common.js';

const routes: Record<string, (r: Request) => Promise<Response>> = { sync, reminder, telegram, api };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const seg = new URL(req.url).pathname.split('/').filter(Boolean).pop() || '';
  const h = routes[seg];
  if (!h) return json({ error: 'not found' }, 404);
  return h(req);
});
