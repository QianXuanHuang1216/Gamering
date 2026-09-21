import { getDb, getEvent, endEvent, cancelEvent } from "@/lib/db";
import { readSession } from "@/lib/session";
import { eventStatus } from "@/lib/view";

export async function GET(_req, { params }) {
  const ev = getEvent(getDb(), params.id);
  if (!ev) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ event: ev, status: eventStatus(ev) });
}

/** PATCH { op: "end" } 写 ended_at；{ op: "cancel" } 写 cancelled（终态，仅房主，仅网页）。 */
export async function PATCH(req, { params }) {
  const discordId = readSession(req.headers.get("cookie"));
  if (!discordId) return Response.json({ error: "login_required" }, { status: 401 });
  const db = getDb();
  const ev = getEvent(db, params.id);
  if (!ev) return Response.json({ error: "not_found" }, { status: 404 });
  if (ev.creatorDiscordId !== discordId) return Response.json({ error: "forbidden" }, { status: 403 });
  const { op } = await req.json().catch(() => ({}));
  if (op === "end") endEvent(db, params.id);
  else if (op === "cancel") cancelEvent(db, params.id);
  else return Response.json({ error: "unknown_op" }, { status: 400 });
  const next = getEvent(db, params.id);
  return Response.json({ event: next, status: eventStatus(next) });
}
