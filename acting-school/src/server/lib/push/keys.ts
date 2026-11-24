/**
 * Base64url and the VAPID key pair (RFC 8292) — WebCrypto and plain JS only,
 * so it runs in the Durable Object as well as on Node.
 *
 * Keys are kept as the web-push convention has them: the public key is the
 * 65-byte uncompressed P-256 point (what the browser's
 * pushManager.subscribe({ applicationServerKey }) takes), the private key the
 * 32-byte scalar `d`, both base64url without padding.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const LOOKUP = new Map([...ALPHABET].map((ch, i) => [ch, i]));

export function b64urlEncode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!;
    if (i + 1 < bytes.length) out += ALPHABET[(n >> 6) & 63]!;
    if (i + 2 < bytes.length) out += ALPHABET[n & 63]!;
  }
  return out;
}

/** Decodes base64url (padding and standard-base64 `+/` tolerated); null when it isn't valid. */
export function b64urlDecode(text: string): Uint8Array<ArrayBuffer> | null {
  const clean = text.trim().replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  if (clean.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let at = 0;
  for (const ch of clean) {
    const v = LOOKUP.get(ch);
    if (v === undefined) return null;
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (value >> bits) & 0xff;
    }
  }
  return out;
}

export interface VapidKeys {
  /** base64url, 65-byte uncompressed P-256 point. */
  publicKey: string;
  /** base64url, 32-byte private scalar. */
  privateKey: string;
}

/** A P-256 public key as the browser sends it (p256dh) or VAPID uses it: 65 bytes starting 0x04. */
export function isUncompressedP256(bytes: Uint8Array | null): bytes is Uint8Array<ArrayBuffer> {
  return !!bytes && bytes.length === 65 && bytes[0] === 0x04;
}

/** The key pair when both halves have the right shape; null otherwise (push stays off). */
export function parseVapidKeys(publicKey: string, privateKey: string): VapidKeys | null {
  const pub = b64urlDecode(publicKey);
  const priv = b64urlDecode(privateKey);
  if (!isUncompressedP256(pub) || priv?.length !== 32) return null;
  return { publicKey: b64urlEncode(pub), privateKey: b64urlEncode(priv) };
}

/** JWK for a P-256 private key from its raw public point and scalar (WebCrypto can't import a raw private EC key). */
export function p256PrivateJwk(publicPoint: Uint8Array, d: Uint8Array): JsonWebKey {
  return {
    kty: 'EC',
    crv: 'P-256',
    x: b64urlEncode(publicPoint.subarray(1, 33)),
    y: b64urlEncode(publicPoint.subarray(33, 65)),
    d: b64urlEncode(d),
    ext: true,
  };
}

/** A fresh VAPID key pair (`npm run vapid-keys`; the operator sets them at deploy). */
export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const publicRaw = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  return { publicKey: b64urlEncode(publicRaw), privateKey: jwk.d! };
}
