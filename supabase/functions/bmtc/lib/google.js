// Read-only Google Sheets access with a service account (no public sharing of the sheet).

function b64url(bytes) {
  const s = typeof bytes === 'string' ? bytes : String.fromCharCode(...new Uint8Array(bytes));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let cached = null;
async function accessToken() {
  if (cached && cached.exp > Date.now() + 60000) return cached.token;
  const raw = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON secret is not set');
  const sa = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claim}`));
  const jwt = `${header}.${claim}.${b64url(sig)}`;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('Google auth failed: ' + (j.error_description || j.error || r.status));
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cached.token;
}

export function serviceAccountEmail() {
  try { return JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') || '{}').client_email || null; } catch { return null; }
}

export async function listTabs(sheetId) {
  const t = await accessToken();
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.title`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Sheet not readable (${r.status}): ${j.error?.message || ''}. Is it shared with the service account?`);
  return j.sheets.map((s) => s.properties.title);
}

export async function fetchGrids(sheetId, titles) {
  if (!titles.length) return {};
  const t = await accessToken();
  const q = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' });
  for (const title of titles) q.append('ranges', `'${title.replace(/'/g, "''")}'!A1:AP240`);
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchGet?${q}`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Sheet read failed (${r.status}): ${j.error?.message || ''}`);
  const out = {};
  j.valueRanges.forEach((vr, i) => { out[titles[i]] = vr.values || []; });
  return out;
}
