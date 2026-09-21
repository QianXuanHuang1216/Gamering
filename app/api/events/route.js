import { randomUUID } from "node:crypto";
import { getDb, createEvent, listEventsByCreator } from "@/lib/db";
import { readSession } from "@/lib/session";

function me(req) {
  return readSession(req.headers.get("cookie"));
}

export async function GET(req) {
  const discordId = me(req);
  if (!discordId) return Response.json({ error: "login_required" }, { status: 401 });
  return Response.json({ events: listEventsByCreator(getDb(), discordId) });
}

export async function POST(req) {
  const discordId = me(req);
  if (!discordId) return Response.json({ error: "login_required" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const gameText = String(b.game_text ?? "").trim();
  const cap = Number(b.cap);
  const startAt = Date.parse(b.start_at);
  const endAt = b.end_at ? Date.parse(b.end_at) : null;
  const held = Number(b.held ?? 0);
  const description = String(b.description ?? "");
  if (!gameText || gameText.length > 80) return Response.json({ error: "game_text 必填且 ≤80 字" }, { status: 400 });
  if (!Number.isInteger(cap) || cap < 1 || cap > 100) return Response.json({ error: "cap 须为 1–100" }, { status: 400 });
  if (Number.isNaN(startAt) || startAt <= Date.now()) return Response.json({ error: "开始时间须晚于现在" }, { status: 400 });
  if (endAt != null && (Number.isNaN(endAt) || endAt <= startAt)) return Response.json({ error: "结束时间须晚于开始时间" }, { status: 400 });
  if (!Number.isInteger(held) || held < 0 || held > cap) return Response.json({ error: "占位须为 0–上限" }, { status: 400 });
  if (description.length > 2000) return Response.json({ error: "描述 ≤2000 字" }, { status: 400 });
  const ev = createEvent(getDb(), {
    id: randomUUID(),
    creatorDiscordId: discordId,
    gameText,
    gameId: null,
    startAt,
    endAt,
    cap,
    held,
    description,
  });
  return Response.json({ event: ev }, { status: 201 });
}
