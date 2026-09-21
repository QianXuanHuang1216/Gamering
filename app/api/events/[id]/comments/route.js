import { getDb, getEvent } from "@/lib/db";
import { readSession } from "@/lib/session";
import { eventStatus } from "@/lib/view";
import { listComments, groupComments, createComment, validateCommentBody } from "@/lib/comments";

const TERMINAL = new Set(["ended", "cancelled"]);

/** GET：分组评论（公开可读，未登录只读）。 */
export async function GET(_req, { params }) {
  const { id } = await params;
  const db = getDb();
  if (!getEvent(db, id)) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ groups: groupComments(listComments(db, id)) });
}

/** POST：发 L1 / 回 L2。终态事件只读；未登录 401。 */
export async function POST(req, { params }) {
  const me = readSession(req.headers.get("cookie"));
  if (!me) return Response.json({ error: "login_required" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const ev = getEvent(db, id);
  if (!ev) return Response.json({ error: "not_found" }, { status: 404 });
  if (TERMINAL.has(eventStatus(ev))) return Response.json({ error: "事件已终态，评论只读" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const bodyErr = validateCommentBody(b.body);
  if (bodyErr) return Response.json({ error: bodyErr }, { status: 400 });
  try {
    const c = createComment(db, {
      eventId: id,
      parentId: b.parent_id ?? null,
      authorDiscordId: me,
      authorUsername: String(b.username ?? me),
      body: b.body,
      requestId: b.request_id ?? null,
    });
    return Response.json({ comment: c }, { status: 201 });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}
