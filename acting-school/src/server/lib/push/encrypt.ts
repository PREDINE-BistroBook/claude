/**
 * Web Push message encryption, RFC 8291 ("aes128gcm" content coding, RFC 8188),
 * with WebCrypto only — no Node-only crypto, so it runs in the Durable Object.
 *
 *   ecdh_secret = ECDH(as_private, ua_public)
 *   IKM   = HKDF(salt = auth_secret, ecdh_secret, "WebPush: info" 0x00 ua_public as_public, 32)
 *   CEK   = HKDF(salt, IKM, "Content-Encoding: aes128gcm" 0x00, 16)
 *   NONCE = HKDF(salt, IKM, "Content-Encoding: nonce" 0x00, 12)
 *   body  = salt(16) | rs(4, BE) | idlen(1) = 65 | as_public(65) | AES-128-GCM(CEK, NONCE, plaintext 0x02)
 *
 * One record (plaintext ≤ 3993 bytes with the default record size), a fresh
 * ephemeral key pair and salt per message. tests/unit/push.test.ts checks it
 * against the RFC 8291 section 5 example.
 */

const enc = new TextEncoder();
const utf8 = (text: string) => new Uint8Array(enc.encode(text));

export const RECORD_SIZE = 4096;
/** Largest plaintext in one record: rs − 16 (tag) − 1 (delimiter); push services cap the body at 4096 anyway. */
export const MAX_PLAINTEXT = RECORD_SIZE - 16 - 1 - 86;

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, bytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/** The application server's key pair for one message: the private key and its raw public point. */
export interface ServerKeyPair {
  privateKey: CryptoKey;
  publicRaw: Uint8Array<ArrayBuffer>;
}

export async function generateServerKeyPair(): Promise<ServerKeyPair> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  return { privateKey: pair.privateKey, publicRaw: new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer) };
}

/** The intermediate values of RFC 8291 section 3.4 (exported for the test vectors). */
export async function deriveContentKeys(
  server: ServerKeyPair,
  uaPublic: Uint8Array<ArrayBuffer>,
  authSecret: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
): Promise<{ ecdhSecret: Uint8Array<ArrayBuffer>; ikm: Uint8Array<ArrayBuffer>; cek: Uint8Array<ArrayBuffer>; nonce: Uint8Array<ArrayBuffer> }> {
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  // `public` is what WebCrypto reads (the Workers types spell it `$public`, so the cast).
  const ecdh = { name: 'ECDH', public: uaKey } as unknown as Parameters<typeof crypto.subtle.deriveBits>[0];
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(ecdh, server.privateKey, 256));
  const keyInfo = concat(utf8('WebPush: info\0'), uaPublic, server.publicRaw);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);
  return { ecdhSecret, ikm, cek, nonce };
}

/**
 * Encrypt `plaintext` for one push subscription (its p256dh public key and
 * auth secret, raw bytes). `salt` and `server` are for tests; normally both
 * are fresh random values.
 */
export async function encryptPushMessage(
  plaintext: Uint8Array,
  uaPublic: Uint8Array<ArrayBuffer>,
  authSecret: Uint8Array<ArrayBuffer>,
  opts: { salt?: Uint8Array<ArrayBuffer>; server?: ServerKeyPair } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  if (plaintext.length > MAX_PLAINTEXT) throw new Error(`Push payload too large (${plaintext.length} bytes)`);
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const server = opts.server ?? (await generateServerKeyPair());
  const { cek, nonce } = await deriveContentKeys(server, uaPublic, authSecret, salt);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // One record, the last: the plaintext, then the 0x02 delimiter (no padding).
  const record = concat(plaintext, Uint8Array.of(2));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, key, record));
  const header = new Uint8Array(16 + 4 + 1);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = server.publicRaw.length;
  return concat(header, server.publicRaw, ciphertext);
}
