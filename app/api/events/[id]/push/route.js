import { getDb, getEvent, addMessage, latestLiveCard } from "@/lib/db";
import { readSession } from "@/lib/session";
import { cardPayload } from "@/lib/view";
import { precheckChannel, sendCard } from "@/lib/discord-rest";
import { PUSH_ERROR, discordUnreachable, validNonce } from "@/lib/push";

/** POST { channel_id, nonce? }：权限预检 → 发 Components V2 卡 → 存 event_messages。 */
export async function POST(req, { params }) {
  const { id } = await params;
  const discordId = readSession(req.headers.get("cookie"));
  if (!discordId) return Response.json({ error: "login_required" }, { status: 401 });
  const db = getDb();
  const ev = getEvent(db, id);
  if (!ev) return Response.json({ error: "not_found" }, { status: 404 });
  if (ev.creatorDiscordId !== discordId) return Response.json({ error: "forbidden" }, { status: 403 });
  const { channel_id, nonce } = await req.json().catch(() => ({}));
  if (!channel_id) return Response.json({ error: "channel_id required" }, { status: 400 });
  const pushNonce = validNonce(nonce);
  if (pushNonce === null) return Response.json({ error: "nonce 只能是不超过 25 字符的字符串或整数" }, { status: 400 });

  // SPA-545：预检/发送都只返回不抛，这里仍兜一层——任何异常都不能变成 Next 的 HTML 500。
  // HTML 到了前端，res.json() 抛 SyntaxError，会被误报成「客户端断网」。
  try {
    const pre = await precheckChannel(channel_id);
    if (!pre.ok) {
      return pre.transport === "ok" ? Response.json({ error: pre.reason }, { status: 400 }) : discordUnreachable();
    }

    const payload = cardPayload(db, getEvent(db, id), process.env.SITE_URL);
    const r = await sendCard(channel_id, payload, { nonce: pushNonce });
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

/**
 * GET ?channel_id=：这条推送到底成没成（只读）。
 * 存在的理由：sendCard → addMessage → 写响应 这个顺序里，响应在回程被掐断时卡已经进了
 * Discord，界面却只能猜。查 event_messages 是唯一不靠猜的答案。
 * 鉴权跟 POST 完全一致（只有创建者）：event_messages 里有 channel_id/guild_id，
 * 别人的推送记录不能从这里漏出去。
 */
export async function GET(req, { params }) {
  const { id } = await params;
  const discordId = readSession(req.headers.get("cookie"));
  if (!discordId) return Response.json({ error: "login_required" }, { status: 401 });
  const db = getDb();
  const ev = getEvent(db, id);
  if (!ev) return Response.json({ error: "not_found" }, { status: 404 });
  if (ev.creatorDiscordId !== discordId) return Response.json({ error: "forbidden" }, { status: 403 });
  const channelId = new URL(req.url).searchParams.get("channel_id");
  if (!channelId) return Response.json({ error: "channel_id required" }, { status: 400 });
  const card = latestLiveCard(db, id, channelId);
  if (!card) return Response.json({ sent: false });
  return Response.json({ sent: true, message_id: card.message_id, channel_id: card.channel_id, guild_id: card.guild_id });
}
