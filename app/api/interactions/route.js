import { getDb, getEvent, liveMessages, markMessageDead, enqueueRetry } from "@/lib/db";
import { cardPayload } from "@/lib/view";
import {
  verifySignature,
  handleButtonClick,
  interactionUser,
  PING,
  MESSAGE_COMPONENT,
  RESP_PONG,
  RESP_EPHEMERAL,
  RESP_UPDATE_MESSAGE,
} from "@/lib/interactions";
import { ephemeralFollowup, fanout } from "@/lib/discord-rest";

export async function POST(req) {
  const rawBody = await req.text();
  const sig = req.headers.get("x-signature-ed25519");
  const ts = req.headers.get("x-signature-timestamp");
  if (
    !sig ||
    !ts ||
    !verifySignature({ publicKeyHex: process.env.DISCORD_PUBLIC_KEY, signatureHex: sig, timestamp: ts, rawBody })
  ) {
    return new Response("bad signature", { status: 401 });
  }
  let interaction;
  try {
    interaction = JSON.parse(rawBody);
  } catch {
    return new Response("bad body", { status: 400 });
  }
  if (interaction.type === PING) return Response.json({ type: RESP_PONG });
  if (interaction.type !== MESSAGE_COMPONENT) return Response.json({ type: RESP_EPHEMERAL, data: { content: "暂不支持", flags: 64 } });

  const user = interactionUser(interaction);
  if (!user) return Response.json({ type: RESP_EPHEMERAL, data: { content: "取不到身份", flags: 64 } });

  const db = getDb();
  const out = handleButtonClick(db, { customId: interaction.data?.custom_id, user });
  if (out.kind === "noop") {
    return Response.json({ type: RESP_EPHEMERAL, data: { content: out.message, flags: 64 } });
  }

  // 状态变了：重建 payload，以 UPDATE_MESSAGE 回源卡（3 秒内 ACK），再 fan-out 其余卡。
  const ev = getEvent(db, out.eventId);
  const payload = cardPayload(db, ev, process.env.SITE_URL);
  const others = liveMessages(db, out.eventId).filter(
    (m) => !(m.channel_id === interaction.channel_id && m.message_id === interaction.message?.id),
  );
  void (async () => {
    try {
      await fanout(db, { markMessageDead, enqueueRetry }, out.eventId, others, payload);
      if (out.note) {
        await ephemeralFollowup(process.env.DISCORD_CLIENT_ID, interaction.token, out.note);
      }
    } catch (e) {
      console.error("fanout failed", e);
    }
  })();
  return Response.json({ type: RESP_UPDATE_MESSAGE, data: { flags: payload.flags, components: payload.components } });
}
