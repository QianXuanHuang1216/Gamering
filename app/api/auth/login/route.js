import { newOAuthState, OAUTH_STATE_COOKIE } from "@/lib/session";

export async function GET() {
  const state = newOAuthState();
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: `${process.env.SITE_URL}/api/auth/callback/discord`,
    response_type: "code",
    scope: "identify guilds",
    state,
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://discord.com/oauth2/authorize?${params}`,
      "Set-Cookie": `${OAUTH_STATE_COOKIE}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
    },
  });
}
