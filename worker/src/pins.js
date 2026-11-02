// PIN hashing. New PINs: PBKDF2-SHA256 (Web Crypto). PINs carried over from Supabase are bcrypt
// and are checked with bcryptjs once, then re-saved as PBKDF2 on the next successful sign-in.
import bcrypt from 'bcryptjs';

const ITER = 20000;
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => Uint8Array.from(s.match(/../g).map((h) => parseInt(h, 16)));

async function pbkdf2(pin, salt, iter) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}

export async function hashPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITER}$${hex(salt)}$${await pbkdf2(pin, salt, ITER)}`;
}

// Returns { ok, legacy } — legacy = true when the stored hash should be upgraded.
export async function verifyPin(pin, stored) {
  if (stored.startsWith('pbkdf2$')) {
    const [, iter, salt, want] = stored.split('$');
    const got = await pbkdf2(pin, unhex(salt), Number(iter));
    let diff = got.length ^ want.length;
    for (let i = 0; i < Math.min(got.length, want.length); i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
    return { ok: diff === 0, legacy: false };
  }
  if (/^\$2[aby]\$/.test(stored)) return { ok: bcrypt.compareSync(pin, stored), legacy: true };
  return { ok: false, legacy: false };
}
