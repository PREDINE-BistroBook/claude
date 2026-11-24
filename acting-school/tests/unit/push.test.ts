import { describe, expect, it } from 'vitest';
import { deriveContentKeys, encryptPushMessage, type ServerKeyPair } from '../../src/server/lib/push/encrypt';
import { b64urlDecode, b64urlEncode, generateVapidKeys, p256PrivateJwk, parseVapidKeys } from '../../src/server/lib/push/keys';
import { encodePayload, isPushServiceEndpoint, MAX_PUSH_PAYLOAD_BYTES } from '../../src/server/lib/push/send';
import { vapidAuthorization, vapidToken } from '../../src/server/lib/push/vapid';
import { configFromVars } from '../../src/server/config';

/**
 * Web Push crypto with WebCrypto only (it runs in the Durable Object): RFC 8291
 * message encryption checked against the RFC's own example (section 5 /
 * appendix A), and the RFC 8292 VAPID token.
 */

const d = (s: string) => b64urlDecode(s)!;

/** RFC 8291 section 5: the example message, every intermediate value and the final body. */
const RFC8291 = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  ecdhSecret: 'kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs',
  ikm: 'S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg',
  cek: 'oIhVW04MRdy2XN9CiKLxTg',
  nonce: '4h_95klXJ5E_qnoN',
  header: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_' +
    'yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

async function rfcServerKeys(): Promise<ServerKeyPair> {
  const privateKey = await crypto.subtle.importKey('jwk', p256PrivateJwk(d(RFC8291.asPublic), d(RFC8291.asPrivate)), { name: 'ECDH', namedCurve: 'P-256' }, false, [
    'deriveBits',
  ]);
  return { privateKey, publicRaw: d(RFC8291.asPublic) };
}

/** RFC 8291 decryption as a browser does it (to check messages encrypted with fresh keys). */
async function decryptPushMessage(body: Uint8Array, uaPrivate: CryptoKey, uaPublic: Uint8Array<ArrayBuffer>, authSecret: Uint8Array<ArrayBuffer>): Promise<string> {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0);
  const idlen = body[20]!;
  const asPublic = body.slice(21, 21 + idlen);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, uaPrivate, 256));
  const hkdf = async (s: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, n: number) =>
    new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: s, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8));
  const enc = (t: string) => new Uint8Array(new TextEncoder().encode(t));
  const keyInfo = new Uint8Array([...enc('WebPush: info\0'), ...uaPublic, ...asPublic]);
  const ikm = await hkdf(authSecret, ecdh, keyInfo, 32);
  const cek = await hkdf(salt, ikm, enc('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const record = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.slice(21 + idlen)));
  expect(rs).toBe(4096);
  // Last record: the plaintext, then the 0x02 delimiter (then any zero padding).
  let end = record.length - 1;
  while (end >= 0 && record[end] === 0) end--;
  expect(record[end]).toBe(2);
  return new TextDecoder().decode(record.subarray(0, end));
}

describe('RFC 8291 message encryption', () => {
  it('derives the example’s ECDH secret, IKM, CEK and nonce', async () => {
    const keys = await deriveContentKeys(await rfcServerKeys(), d(RFC8291.uaPublic), d(RFC8291.authSecret), d(RFC8291.salt));
    expect(b64urlEncode(keys.ecdhSecret)).toBe(RFC8291.ecdhSecret);
    expect(b64urlEncode(keys.ikm)).toBe(RFC8291.ikm);
    expect(b64urlEncode(keys.cek)).toBe(RFC8291.cek);
    expect(b64urlEncode(keys.nonce)).toBe(RFC8291.nonce);
  });

  it('produces the example’s exact message body (header + ciphertext)', async () => {
    const body = await encryptPushMessage(new TextEncoder().encode(RFC8291.plaintext), d(RFC8291.uaPublic), d(RFC8291.authSecret), {
      salt: d(RFC8291.salt),
      server: await rfcServerKeys(),
    });
    expect(b64urlEncode(body.subarray(0, 86))).toBe(RFC8291.header);
    expect(b64urlEncode(body)).toBe(RFC8291.body);
  });

  it('the example decrypts with the user agent’s private key', async () => {
    const uaPrivate = await crypto.subtle.importKey('jwk', p256PrivateJwk(d(RFC8291.uaPublic), d(RFC8291.uaPrivate)), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    expect(await decryptPushMessage(d(RFC8291.body), uaPrivate, d(RFC8291.uaPublic), d(RFC8291.authSecret))).toBe(RFC8291.plaintext);
  });

  it('fresh keys and salt each time; a browser can decrypt it (Arabic included)', async () => {
    const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    const uaPublic = new Uint8Array((await crypto.subtle.exportKey('raw', ua.publicKey)) as ArrayBuffer);
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const text = JSON.stringify({ title: 'طلب من داليا: الحضور إلى المكتب', body: 'Bring the shortlist', link: '/team', kind: 'summon', tag: 'summons-1' });
    const a = await encryptPushMessage(new TextEncoder().encode(text), uaPublic, auth);
    const b = await encryptPushMessage(new TextEncoder().encode(text), uaPublic, auth);
    expect(b64urlEncode(a.subarray(0, 16))).not.toBe(b64urlEncode(b.subarray(0, 16)));
    expect(b64urlEncode(a.subarray(21, 86))).not.toBe(b64urlEncode(b.subarray(21, 86)));
    expect(await decryptPushMessage(a, ua.privateKey, uaPublic, auth)).toBe(text);
    expect(await decryptPushMessage(b, ua.privateKey, uaPublic, auth)).toBe(text);
  });

  it('refuses a payload too large for one record', async () => {
    const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    const uaPublic = new Uint8Array((await crypto.subtle.exportKey('raw', ua.publicKey)) as ArrayBuffer);
    await expect(encryptPushMessage(new Uint8Array(5000), uaPublic, new Uint8Array(16))).rejects.toThrow(/too large/);
  });
});

describe('RFC 8292 VAPID', () => {
  it('a JWT with header { typ, alg: ES256 }, claims { aud, exp, sub } and a valid P-256 signature', async () => {
    const keys = await generateVapidKeys();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = await vapidToken(keys, 'https://fcm.googleapis.com', 'mailto:studio@example.com', exp);
    const [h, c, sig] = token.split('.');
    expect(JSON.parse(new TextDecoder().decode(d(h!)))).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(JSON.parse(new TextDecoder().decode(d(c!)))).toEqual({ aud: 'https://fcm.googleapis.com', exp, sub: 'mailto:studio@example.com' });
    // ES256 in a JWS is the raw 64-byte r‖s.
    expect(d(sig!).length).toBe(64);
    const publicKey = await crypto.subtle.importKey('raw', d(keys.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, d(sig!), new TextEncoder().encode(`${h}.${c}`));
    expect(ok).toBe(true);
  });

  it('the Authorization header: vapid t=<jwt>, k=<public key>; audience is the push service origin, at most 24 h ahead', async () => {
    const keys = await generateVapidKeys();
    const now = Date.UTC(2026, 10, 23, 10, 0, 0);
    const header = await vapidAuthorization(keys, 'https://updates.push.services.mozilla.com/wpush/v2/abc?x=1', 'https://turquoisestudio.app', now);
    const m = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
    expect(m[2]).toBe(keys.publicKey);
    const claims = JSON.parse(new TextDecoder().decode(d(m[1]!.split('.')[1]!)));
    expect(claims.aud).toBe('https://updates.push.services.mozilla.com');
    expect(claims.sub).toBe('https://turquoisestudio.app');
    expect(claims.exp - now / 1000).toBeGreaterThan(3600);
    expect(claims.exp - now / 1000).toBeLessThanOrEqual(24 * 3600);
    // Reused while it has more than an hour left.
    expect(await vapidAuthorization(keys, 'https://updates.push.services.mozilla.com/other', 'https://turquoisestudio.app', now + 60_000)).toBe(header);
  });

  it('keys: generated pairs have the browser’s shape; config only takes a well-formed pair', async () => {
    const keys = await generateVapidKeys();
    expect(d(keys.publicKey).length).toBe(65);
    expect(d(keys.publicKey)[0]).toBe(4);
    expect(d(keys.privateKey).length).toBe(32);
    expect(parseVapidKeys(keys.publicKey, keys.privateKey)).toEqual(keys);
    expect(parseVapidKeys(keys.publicKey, 'short')).toBeNull();
    expect(parseVapidKeys('BAAA', keys.privateKey)).toBeNull();
    const defaults = { cookieSecure: false, isProduction: false, requireSetupCode: false };
    expect(configFromVars({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey }, defaults).vapid).toEqual(keys);
    expect(configFromVars({ VAPID_PUBLIC_KEY: keys.publicKey }, defaults).vapid).toBeNull();
    expect(configFromVars({}, defaults).vapid).toBeNull();
  });

  it('base64url round trip, padding and standard alphabet tolerated, junk refused', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(37));
    expect(b64urlDecode(b64urlEncode(bytes))).toEqual(bytes);
    expect(b64urlDecode('_-8=')).toEqual(b64urlDecode('/+8'));
    expect(b64urlDecode('a$b')).toBeNull();
  });
});

describe('push sending rules', () => {
  it('only the browsers’ push services are accepted as endpoints', () => {
    for (const ok of [
      'https://fcm.googleapis.com/fcm/send/abc:def',
      'https://updates.push.services.mozilla.com/wpush/v2/gAAA',
      'https://web.push.apple.com/QGrZ',
      'https://wns2-par02p.notify.windows.com/w/?token=x',
    ]) {
      expect(isPushServiceEndpoint(ok), ok).toBe(true);
    }
    for (const bad of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com:8443/fcm/send/abc',
      'https://evil.example/fcm.googleapis.com',
      'https://fcm.googleapis.com.evil.example/x',
      'https://localhost/push',
      'https://169.254.169.254/latest',
      'https://user:pw@fcm.googleapis.com/x',
      'not a url',
    ]) {
      expect(isPushServiceEndpoint(bad), bad).toBe(false);
    }
  });

  it('payloads are capped at 3 KB by shortening the text', () => {
    const big = encodePayload({ title: 'T', body: 'ب'.repeat(5000), link: '/messages/1', kind: 'message', tag: 'conversation-1' });
    expect(big.length).toBeLessThanOrEqual(MAX_PUSH_PAYLOAD_BYTES);
    const parsed = JSON.parse(new TextDecoder().decode(big));
    expect(parsed.link).toBe('/messages/1');
    expect(parsed.body.length).toBeGreaterThan(0);
  });
});
