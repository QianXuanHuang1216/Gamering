import { readSession } from "@/lib/session";
import { guildTextChannels, guildSendable } from "@/lib/discord-rest";
import { discordUnreachable } from "@/lib/push";

/** 选频道：Bot 可见的文字频道 + 群级发送权限徽章。 */
export async function GET(req, { params }) {
  const { id } = await params;
  if (!readSession(req.headers.get("cookie"))) return Response.json({ error: "login_required" }, { status: 401 });
  // SPA-545：两次 Discord 调用都只返回不抛，传输层失败返 5xx JSON。
  const [channels, perms] = await Promise.all([
    guildTextChannels(id),
    guildSendable(id, process.env.DISCORD_CLIENT_ID),
  ]);
  if (channels.transport !== "ok" || perms.transport !== "ok") return discordUnreachable();
  if (!channels.ok) return Response.json({ error: "频道列表拉取失败，稍后重试" }, { status: 502 });
  return Response.json({
    channels: (channels.data ?? []).map((c) => ({ id: c.id, name: c.name, topic: c.topic }),
    ),
    sendable: perms.ok ? perms.send && perms.embed : null,
  });
}
