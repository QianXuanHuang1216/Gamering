import { getDb, getEvent } from "@/lib/db";
import { readSession } from "@/lib/session";
import { eventStatus } from "@/lib/view";
import { getComment, editComment, deleteComment, validateCommentBody } from "@/lib/comments";

const TERMINAL = new Set(["ended", "cancelled"]);

/** PATCH：编辑自己发过的任何一层。终态事件只读（与 POST 一致）。 */
export async function PATCH(req, { params }) {
  const me = readSession(req.headers.get("cookie"));
  if (!me) return Response.json({ error: "login_required" }, { status: 401 });
  const { id, commentId } = await params;
  const db = getDb();
  const ev = getEvent(db, id);
  if (!ev) return Response.json({ error: "not_found" }, { status: 404 });
  if (TERMINAL.has(eventStatus(ev))) return Response.json({ error: "事件已终态，评论只读" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const bodyErr = validateCommentBody(b.body);
  if (bodyErr) return Response.json({ error: bodyErr }, { status: 400 });
  try {
    const c = editComment(db, { id: Number(commentId), meId: me, body: b.body });
    return Response.json({ comment: c });
  } catch (e) {
    if (e.message === "forbidden") return Response.json({ error: "forbidden" }, { status: 403 });
    if (e.message === "评论不存在") return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ error: e.message }, { status: 400 });
  }
}

/** DELETE：作者本人 + 事件创建人可删（有回复 L1 软删，其余硬删）。终态事件只读。 */
export async function DELETE(req, { params }) {
  const me = readSession(req.headers.get("cookie"));
  if (!me) return Response.json({ error: "login_required" }, { status: 401 });
  const { id, commentId } = await params;
  const db = getDb();
  const ev = getEvent(db, id);
  if (!ev) return Response.json({ error: "not_found" }, { status: 404 });
  if (TERMINAL.has(eventStatus(ev))) return Response.json({ error: "事件已终态，评论只读" }, { status: 403 });
  const c = getComment(db, Number(commentId));
  if (!c || c.eventId !== id) return Response.json({ error: "not_found" }, { status: 404 });
  try {
    const out = deleteComment(db, { id: Number(commentId), meId: me, creatorId: ev.creatorDiscordId });
    return Response.json(out);
  } catch (e) {
    if (e.message === "forbidden") return Response.json({ error: "forbidden" }, { status: 403 });
    return Response.json({ error: e.message }, { status: 400 });
  }
}
