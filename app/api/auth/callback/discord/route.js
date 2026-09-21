import { getDb, upsertUser } from "@/lib/db";
import { signSession, sessionCookie, OAUTH_STATE_COOKIE } from "@/lib/session";

async function discord(path, token, init = {}) {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
  });
  if (!res.ok) throw new Error(`discord ${path}: ${res.status}`);
  return res.json();
}

export async function GET(req) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookies = req.headers.get("cookie") ?? "";
  const saved = /(?:^|;\s*)gamer_oauth_state=([^;]+)/.exec(cookies)?.[1];
  if (!code || !state || state !== saved) {
    return Response.redirect(`${process.env.SITE_URL}/?error=oauth_state`, 302);
  }
  const tokenRes = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: `${process.env.SITE_URL}/api/auth/callback/discord`,
    }),
  });
  if (!tokenRes.ok) {
    const t = await tokenRes.text();
    return Response.json({ error: "token_exchange_failed", detail: t }, { status: 502 });
  }
  const tok = await tokenRes.json();
  const me = await discord("/users/@me", tok.access_token);
  upsertUser(getDb(), {
    discordId: me.id,
    username: me.username,
    avatarHash: me.avatar ?? null,
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token ?? null,
    tokenExpiresAt: tok.expires_in ? Date.now() + tok.expires_in * 1000 : null,
  });
  const res = new Response(null, {
    status: 302,
    headers: {
      Location: `${process.env.SITE_URL}/me`,
      "Set-Cookie": sessionCookie(signSession(me.id)),
    },
  });
  return res;
}
