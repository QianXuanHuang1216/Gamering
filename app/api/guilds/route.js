import { getDb, getUser } from "@/lib/db";
import { readSession } from "@/lib/session";
import { botGuilds, userGuilds, manageableIds, botInviteLink } from "@/lib/discord-rest";

/** 选群：用户可管理 ∩ Bot 已在。空交集 → 空状态 + 一键邀请链接。 */
export async function GET(req) {
  const discordId = readSession(req.headers.get("cookie"));
  if (!discordId) return Response.json({ error: "login_required" }, { status: 401 });
  const user = getUser(getDb(), discordId);
  if (!user?.access_token) return Response.json({ error: "login_required" }, { status: 401 });

  const [mine, bot] = await Promise.all([userGuilds(user.access_token), botGuilds()]);
  if (!mine.ok && mine.status === 401) return Response.json({ error: "login_required" }, { status: 401 });
  if (!mine.ok || !bot.ok) return Response.json({ error: "群列表拉取失败，稍后重试" }, { status: 502 });

  const managed = manageableIds(mine.data);
  const botIds = new Set((bot.data ?? []).map((g) => g.id));
  const guilds = (mine.data ?? [])
    .filter((g) => managed.has(g.id) && botIds.has(g.id))
    .map((g) => ({ id: g.id, name: g.name, icon: g.icon }));
  return Response.json({ guilds, invite_url: guilds.length === 0 ? botInviteLink() : null });
}
