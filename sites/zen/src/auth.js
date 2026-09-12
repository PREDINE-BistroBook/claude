// Cookies, signing, magic-link tokens and password hashing — all WebCrypto, nothing to install.

const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export const randomId = (bytes = 12) => hex(crypto.getRandomValues(new Uint8Array(bytes)));
export const referralCode = () => { const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; const r = crypto.getRandomValues(new Uint8Array(6)); return [...r].map((x) => a[x % a.length]).join(""); };

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}
function safeEq(a, b) { if (a.length !== b.length) return false; let o = 0; for (let i = 0; i < a.length; i++) o |= a.charCodeAt(i) ^ b.charCodeAt(i); return o === 0; }

// ----- signed cookies -----
export async function signPayload(secret, obj) {
  const body = b64u(enc.encode(JSON.stringify(obj)));
  return `${body}.${await hmac(secret, body)}`;
}
export async function verifyPayload(secret, token) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  if (!safeEq(sig, await hmac(secret, body))) return null;
  try {
    const obj = JSON.parse(new TextDecoder().decode(unb64u(body)));
    if (obj.exp && obj.exp < Date.now() / 1000) return null;
    return obj;
  } catch { return null; }
}
export function getCookie(req, name) {
  const m = (req.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}
export function setCookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
export const clearCookie = (name) => `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

// ----- passwords (PBKDF2-SHA256, 100k iterations (the Workers runtime rejects more)) -----
export async function hashPassword(password, saltHex) {
  const salt = saltHex ? unb64u(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256);
  return { hash: b64u(bits), salt: b64u(salt) };
}
export async function verifyPassword(password, hash, salt) {
  const { hash: h } = await hashPassword(password, salt);
  return safeEq(h, hash);
}
