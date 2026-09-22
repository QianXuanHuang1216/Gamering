// HMAC 签名 cookie 会话（零依赖，node:crypto）。
// { discord_id, exp } base64 + "." + hex(hmac)。SESSION_SECRET 只在服务端 .env。

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "gamer_session";
export const OAUTH_STATE_COOKIE = "gamer_oauth_state";
const TTL_MS = 30 * 24 * 3600 * 1000;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET missing");
  return s;
}

export function signSession(discordId) {
  const payload = Buffer.from(JSON.stringify({ discord_id: discordId, exp: Date.now() + TTL_MS })).toString("base64url");
  const sig = createHmac("sha256", secret()).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function readSession(cookieHeader) {
  const m = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`).exec(cookieHeader ?? "");
  if (!m) return null;
  const [payload, sig] = m[1].split(".");
  if (!payload || !sig) return null;
  const want = createHmac("sha256", secret()).update(payload).digest();
  const got = Buffer.from(sig, "hex");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (data.exp < Date.now()) return null;
    return data.discord_id;
  } catch {
    return null;
  }
}

export function newOAuthState() {
  return randomBytes(16).toString("hex");
}

export function sessionCookie(value) {
  const secure = (process.env.SITE_URL ?? "").startsWith("https://") ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${TTL_MS / 1000}`;
}

export function clearSessionCookie() {
  const secure = (process.env.SITE_URL ?? "").startsWith("https://") ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`;
}
