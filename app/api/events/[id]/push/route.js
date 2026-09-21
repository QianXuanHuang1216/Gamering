import { getDb, getEvent, addMessage } from "@/lib/db";
import { readSession } from "@/lib/session";
import { cardPayload } from "@/lib/view";
import { precheckChannel, sendCard } from "@/lib/discord-rest";

/** POST { channel_id }：权限预检 → 发 Components V2 卡 → 存 event_messages。 */
export async function POST(req, { params }) {
  const discordId = readSession(req.headers.get("cookie"));
  if (!discordId) return Response.json({ error: "login_required" }, { status: 401 });
  const db = getDb();
  const ev = getEvent(db, params.id);
  if (!ev) return Response.json({ error: "not_found" }, { status: 404 });
  if (ev.creatorDiscordId !== discordId) return Response.json({ error: "forbidden" }, { status: 403 });
  const { channel_id } = await req.json().catch(() => ({}));
  if (!channel_id) return Response.json({ error: "channel_id required" }, { status: 400 });

  const pre = await precheckChannel(channel_id);
  if (!pre.ok) return Response.json({ error: pre.reason }, { status: 400 });

  const payload = cardPayload(db, getEvent(db, params.id), process.env.SITE_URL);
  const r = await sendCard(channel_id, payload);
  if (!r.ok) {
    if (r.status === 403) return Response.json({ error: "Bot 在该频道没有发送权限，换个频道试试" }, { status: 502 });
    if (r.status === 429) return Response.json({ error: "发送拥挤，已加入重试，稍后可在详情查看同步状态" }, { status: 502 });
    return Response.json({ error: `发送失败（${r.status}）` }, { status: 502 });
  }
  addMessage(db, { eventId: params.id, guildId: pre.channel.guild_id, channelId: channel_id, messageId: r.data.id });
  return Response.json({ message_id: r.data.id, channel_id }, { status: 201 });
}
