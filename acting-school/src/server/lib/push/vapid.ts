/**
 * VAPID (RFC 8292): the server proves who it is to the push service with a
 * short JWT signed ES256 (ECDSA P-256 + SHA-256) by its VAPID private key.
 *
 *   Authorization: vapid t=<JWT>, k=<VAPID public key, base64url>
 *   JWT header { typ: "JWT", alg: "ES256" }, claims { aud: <push service origin>, exp: now + 12 h, sub: "mailto:…" | "https://…" }
 *
 * WebCrypto only. WebCrypto's ECDSA signature is already the raw r‖s
 * (64 bytes) a JWS uses. A token is reused per push service origin while it
 * has more than an hour left.
 */
import { b64urlDecode, b64urlEncode, p256PrivateJwk, type VapidKeys } from './keys';

const enc = new TextEncoder();

/** Token lifetime (RFC 8292 allows up to 24 h). */
export const VAPID_TOKEN_SECONDS = 12 * 60 * 60;

const keyCache = new Map<string, Promise<CryptoKey>>();
const tokenCache = new Map<string, { token: string; exp: number }>();

function signingKey(keys: VapidKeys): Promise<CryptoKey> {
  let key = keyCache.get(keys.publicKey);
  if (!key) {
    const publicPoint = b64urlDecode(keys.publicKey)!;
    const d = b64urlDecode(keys.privateKey)!;
    key = crypto.subtle.importKey('jwk', p256PrivateJwk(publicPoint, d), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    // A failed import shouldn't be cached for good.
    key.catch(() => keyCache.delete(keys.publicKey));
    keyCache.set(keys.publicKey, key);
  }
  return key;
}

/** The signed JWT for one push service origin (`aud`), expiring at `exp` (epoch seconds). */
export async function vapidToken(keys: VapidKeys, aud: string, sub: string, exp: number): Promise<string> {
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(enc.encode(JSON.stringify({ aud, exp, sub })));
  const input = `${header}.${claims}`;
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await signingKey(keys), enc.encode(input));
  return `${input}.${b64urlEncode(new Uint8Array(signature))}`;
}

/** The Authorization header for a push to `endpoint` (`nowMs` epoch ms). */
export async function vapidAuthorization(keys: VapidKeys, endpoint: string, subject: string, nowMs: number): Promise<string> {
  const aud = new URL(endpoint).origin;
  const now = Math.floor(nowMs / 1000);
  const cacheKey = `${keys.publicKey}|${aud}|${subject}`;
  let cached = tokenCache.get(cacheKey);
  if (!cached || cached.exp - now < 60 * 60) {
    const exp = now + VAPID_TOKEN_SECONDS;
    cached = { token: await vapidToken(keys, aud, subject, exp), exp };
    tokenCache.set(cacheKey, cached);
  }
  return `vapid t=${cached.token}, k=${keys.publicKey}`;
}
