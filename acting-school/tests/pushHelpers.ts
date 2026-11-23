import { b64urlEncode } from '../src/server/lib/push/keys';
import type { PushPayload } from '../src/shared/schemas/notifications';

/**
 * A pretend browser for push tests: a P-256 key pair and auth secret like
 * pushManager.subscribe() makes, its subscription JSON, and RFC 8291
 * decryption of what the server sends it.
 */
export async function fakeBrowser(endpoint = `https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}`) {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const publicRaw = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    endpoint,
    subscription: { endpoint, expirationTime: null, keys: { p256dh: b64urlEncode(publicRaw), auth: b64urlEncode(auth) } },
    /** Decrypt a push body sent to this browser. */
    async decrypt(body: Uint8Array): Promise<PushPayload> {
      const salt = body.slice(0, 16);
      const idlen = body[20]!;
      const asPublic = body.slice(21, 21 + idlen);
      const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
      const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, pair.privateKey, 256));
      const enc = (t: string) => new Uint8Array(new TextEncoder().encode(t));
      const hkdf = async (s: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, n: number) =>
        new Uint8Array(
          await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: s, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8),
        );
      const ikm = await hkdf(auth, ecdh, new Uint8Array([...enc('WebPush: info\0'), ...publicRaw, ...asPublic]), 32);
      const cek = await hkdf(salt, ikm, enc('Content-Encoding: aes128gcm\0'), 16);
      const nonce = await hkdf(salt, ikm, enc('Content-Encoding: nonce\0'), 12);
      const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
      const record = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.slice(21 + idlen)));
      return JSON.parse(new TextDecoder().decode(record.subarray(0, record.lastIndexOf(2))));
    },
  };
}

export interface SentPush {
  url: string;
  headers: Record<string, string>;
  body: Uint8Array;
}

/**
 * A fetch that records pushes and answers with `status(url)` (default 201).
 * Pass as makeTestContext({ outboundFetch }).
 */
export function pushRecorder(status: (url: string) => number = () => 201) {
  const sent: SentPush[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    sent.push({ url, headers, body: new Uint8Array(init?.body as Uint8Array) });
    return new Response(null, { status: status(url) });
  }) as typeof globalThis.fetch;
  return { sent, fetch };
}
