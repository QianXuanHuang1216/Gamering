import { getDb, getEvent, endEvent, cancelEvent, liveMessages, markMessageDead, enqueueRetry } from "@/lib/db";
import { readSession } from "@/lib/session";
import { eventStatus, cardPayload } from "@/lib/view";
import { fanout } from "@/lib/discord-rest";
import { validateEventEdit, validateTimes } from "@/lib/edit-validate";
import { removeMember } from "@/lib/members";

export async function GET(_req, { params }) {
  const { id } = await params;
  const ev = getEvent(getDb(), id);
  if (!ev) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ event: ev, status: eventStatus(ev) });
}

/** PATCH（终态，仅房主，仅网页）：
 * { op: "end" } 写 ended_at；{ op: "cancel" } 写 cancelled；
 * { op: "edit", ...fields } 改标题/时间/cap/held/描述（cap 下限约束）；
 * { op: "remove", discord_id } 移除参加者（房主除外，直接删除 + 排队递补）。 */
export async function PATCH(req, { params }) {
  const discordId = readSession(req.headers.get("cookie"));
  if (!discordId) return Response.json({ error: "login_required" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const ev = getEvent(db, id);
  if (!ev) return Response.json({ error: "not_found" }, { status: 404 });
  if (ev.creatorDiscordId !== discordId) return Response.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const { op } = b;
  if (op === "end") endEvent(db, id);
  else if (op === "cancel") cancelEvent(db, id);
  else if (op === "edit") {
    const patch = {};
    if (b.game_text !== undefined) patch.game_text = b.game_text;
    if (b.cap !== undefined) patch.cap = Number(b.cap);
    if (b.held !== undefined) patch.held = Number(b.held);
    if (b.description !== undefined) patch.description = b.description;
    let startMs;
    let endMs = null;
    if (b.start_at !== undefined) {
      startMs = typeof b.start_at === "number" ? b.start_at : Date.parse(b.start_at);
      if (Number.isNaN(startMs)) return Response.json({ error: "开始时间无效" }, { status: 400 });
      patch.start_at = startMs;
    }
    if (b.end_at !== undefined) {
      if (b.end_at == null) {
        patch.end_at = null;
      } else {
        endMs = typeof b.end_at === "number" ? b.end_at : Date.parse(b.end_at);
        if (Number.isNaN(endMs)) return Response.json({ error: "结束时间无效" }, { status: 400 });
        patch.end_at = endMs;
      }
    }
    if (patch.start_at === undefined && patch.end_at !== undefined) {
      const tErr = validateTimes({ startAt: ev.startAt, endAt: patch.end_at });
      if (tErr) return Response.json({ error: tErr }, { status: 400 });
    }
    const err = validateEventEdit({ patch, confirmed: ev.confirmed, held: ev.held, cap: ev.cap });
    if (err) return Response.json({ error: err }, { status: 400 });
    const sets = [];
    const vals = [];
    if (patch.game_text !== undefined) {
      sets.push("game_text = ?");
      vals.push(String(patch.game_text).trim());
    }
    if (patch.start_at !== undefined) {
      sets.push("start_at = ?");
      vals.push(patch.start_at);
    }
    if (patch.end_at !== undefined) {
      sets.push("end_at = ?");
      vals.push(patch.end_at);
    }
    if (patch.cap !== undefined) {
      sets.push("cap = ?");
      vals.push(patch.cap);
    }
    if (patch.held !== undefined) {
      sets.push("held = ?");
      vals.push(patch.held);
    }
    if (patch.description !== undefined) {
      sets.push("description = ?");
      vals.push(String(patch.description));
    }
    if (sets.length === 0) return Response.json({ error: "无改动" }, { status: 400 });
    db.prepare(`UPDATE events SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
  } else if (op === "remove") {
    try {
      var removed = removeMember(db, { eventId: id, discordId: b.discord_id, creatorId: discordId });
    } catch (e) {
      return Response.json({ error: e.message }, { status: 400 });
    }
  } else {
    return Response.json({ error: "unknown_op" }, { status: 400 });
  }
  const next = getEvent(db, id);
  // 终态/编辑/移除后即时同步 Discord 卡。
  const payload = cardPayload(db, next, process.env.SITE_URL);
  await fanout(db, { markMessageDead, enqueueRetry }, id, liveMessages(db, id), payload);
  return Response.json({ event: next, status: eventStatus(next), ...(removed ? { removed: removed.removed, promotedId: removed.promotedId } : {}) });
}
