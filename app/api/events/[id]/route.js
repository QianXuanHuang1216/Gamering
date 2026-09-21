import { getDb, getEvent, endEvent, cancelEvent } from "@/lib/db";
import { readSession } from "@/lib/session";
import { eventStatus } from "@/lib/view";

export async function GET(_req, { params }) {
  const { id } = await params;
  const ev = getEvent(getDb(), id);
  if (!ev) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ event: ev, status: eventStatus(ev) });
}

/** PATCH { op: "end" } 写 ended_at；{ op: "cancel" } 写 cancelled（终态，仅房主，仅网页）。 */
export async function PATCH(req, { params }) {
  const discordId = readSession(req.headers.get("cookie"));
  if (!discordId) return Response.json({ error: "login_required" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const ev = getEvent(db, id);
  if (!ev) return Response.json({ error: "not_found" }, { status: 404 });
  if (ev.creatorDiscordId !== discordId) return Response.json({ error: "forbidden" }, { status: 403 });
  const { op } = await req.json().catch(() => ({}));
  if (op === "end") endEvent(db, id);
  else if (op === "cancel") cancelEvent(db, id);
  else return Response.json({ error: "unknown_op" }, { status: 400 });
  const next = getEvent(db, id);
  return Response.json({ event: next, status: eventStatus(next) });
}
