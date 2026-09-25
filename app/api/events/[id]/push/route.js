import { getDb, getEvent, addMessage } from "@/lib/db";
import { readSession } from "@/lib/session";
import { cardPayload } from "@/lib/view";
import { precheckChannel, sendCard } from "@/lib/discord-rest";
import { PUSH_ERROR, discordUnreachable } from "@/lib/push";

/** POST { channel_id }：权限预检 → 发 Components V2 卡 → 存 event_messages。 */
export async function POST(req, { params }) {
  const { id } = await params;
  const discordId = readSession(req.headers.get("cookie"));
  if (!discordId) return Response.json({ error: "login_required" }, { status: 401 });
  const db = getDb();
  const ev = getEvent(db, id);
  if (!ev) return Response.json({ error: "not_found" }, { status: 404 });
  if (ev.creatorDiscordId !== discordId) return Response.json({ error: "forbidden" }, { status: 403 });
  const { channel_id } = await req.json().catch(() => ({}));
  if (!channel_id) return Response.json({ error: "channel_id required" }, { status: 400 });

  // SPA-545：预检/发送都只返回不抛，这里仍兜一层——任何异常都不能变成 Next 的 HTML 500。
  // HTML 到了前端，res.json() 抛 SyntaxError，会被误报成「客户端断网」。
  try {
    const pre = await precheckChannel(channel_id);
    if (!pre.ok) {
      return pre.transport === "ok" ? Response.json({ error: pre.reason }, { status: 400 }) : discordUnreachable();
    }

    const payload = cardPayload(db, getEvent(db, id), process.env.SITE_URL);
    const r = await sendCard(channel_id, payload);
    if (!r.ok) {
      if (r.transport !== "ok") return discordUnreachable();
      if (r.status === 403) return Response.json({ error: "Bot 在该频道没有发送权限，换个频道试试" }, { status: 502 });
      if (r.status === 429) return Response.json({ error: PUSH_ERROR.rateLimited }, { status: 429 });
      console.error("push send failed", { eventId: id, channelId: channel_id, status: r.status });
      return Response.json({ error: "发送失败，请稍后重试" }, { status: 502 });
    }
    addMessage(db, { eventId: id, guildId: pre.channel.guild_id, channelId: channel_id, messageId: r.data.id });
    return Response.json({ message_id: r.data.id, channel_id }, { status: 201 });
  } catch (e) {
    console.error("push failed", id, e);
    return discordUnreachable();
  }
}
