// SPA-506 A：事件两层评论（L1 主评论 + L2 回复，压平无 L3）。
// 删除权限：作者本人 + 事件创建人；有回复的 L1 软删占位，其余硬删。

export const COMMENT_MAX = 500;

export function validateCommentBody(body) {
  const t = String(body ?? "").trim();
  if (!t) return "评论不能为空";
  if ([...t].length > COMMENT_MAX) return `评论 ≤${COMMENT_MAX} 字`;
  return null;
}

function mapRow(r) {
  return {
    id: r.id,
    eventId: r.event_id,
    parentId: r.parent_id,
    authorDiscordId: r.author_discord_id,
    authorUsername: r.author_username,
    body: r.body,
    requestId: r.request_id,
    editedAt: r.edited_at,
    edited: r.edited_at != null,
    deletedAt: r.deleted_at,
    deleted: r.deleted_at != null,
    createdAt: r.created_at,
  };
}

export function getComment(db, id) {
  const r = db.prepare("SELECT * FROM event_comments WHERE id = ?").get(id);
  return r ? mapRow(r) : null;
}

export function listComments(db, eventId) {
  return db
    .prepare("SELECT * FROM event_comments WHERE event_id = ? ORDER BY created_at ASC, id ASC")
    .all(eventId)
    .map(mapRow);
}

/** L2 压平成组：[{ l1, replies }]（含软删占位 L1）。 */
export function groupComments(rows) {
  const groups = [];
  const byId = new Map();
  for (const r of rows) {
    if (r.parentId == null) {
      const g = { l1: r, replies: [] };
      groups.push(g);
      byId.set(r.id, g);
    }
  }
  for (const r of rows) {
    if (r.parentId != null) byId.get(r.parentId)?.replies.push(r);
  }
  return groups;
}

/**
 * 发评论。parentId 指向 L2 时自动压平到同一 L1（永不写 L3；
 * DB trigger 做最后一道兜底，直接裸写 L3 会抛错）。
 * requestId 幂等：重复提交返回首写行，不落第二行。
 */
export function createComment(db, { eventId, parentId = null, authorDiscordId, authorUsername, body, requestId = null }) {
  const err = validateCommentBody(body);
  if (err) throw new Error(err);
  if (requestId != null) {
    const dup = db.prepare("SELECT * FROM event_comments WHERE request_id = ?").get(requestId);
    if (dup) return mapRow(dup);
  }
  let l1Id = null;
  if (parentId != null) {
    const parent = getComment(db, parentId);
    if (!parent || parent.eventId !== eventId) throw new Error("parent 不存在");
    l1Id = parent.parentId ?? parent.id; // L2 → 归入同一 L1
  }
  const now = Date.now();
  try {
    const out = db
      .prepare(
        "INSERT INTO event_comments (event_id, parent_id, author_discord_id, author_username, body, request_id, created_at) VALUES (?,?,?,?,?,?,?)",
      )
      .run(eventId, l1Id, authorDiscordId, authorUsername, String(body).trim(), requestId, now);
    return getComment(db, Number(out.lastInsertRowid));
  } catch (e) {
    if (requestId != null && String(e.message).includes("UNIQUE")) {
      return mapRow(db.prepare("SELECT * FROM event_comments WHERE request_id = ?").get(requestId));
    }
    throw e;
  }
}

export function canEditComment({ comment, meId }) {
  return !!meId && comment.authorDiscordId === meId;
}

export function canDeleteComment({ comment, meId, creatorId }) {
  return !!meId && (comment.authorDiscordId === meId || meId === creatorId);
}

export function editComment(db, { id, meId, body }) {
  const c = getComment(db, id);
  if (!c) throw new Error("评论不存在");
  if (!canEditComment({ comment: c, meId })) throw new Error("forbidden");
  const err = validateCommentBody(body);
  if (err) throw new Error(err);
  const now = Date.now();
  db.prepare("UPDATE event_comments SET body = ?, edited_at = ? WHERE id = ?").run(String(body).trim(), now, id);
  return { ...c, body: String(body).trim(), editedAt: now, edited: true };
}

/**
 * 删除：有回复的 L1 → 软删（deleted_at，保楼层上下文）；
 * 无回复的 L1 / 任何 L2 → 硬删。
 */
export function deleteComment(db, { id, meId, creatorId }) {
  const c = getComment(db, id);
  if (!c) throw new Error("评论不存在");
  if (!canDeleteComment({ comment: c, meId, creatorId })) throw new Error("forbidden");
  const kids = db.prepare("SELECT COUNT(*) AS n FROM event_comments WHERE parent_id = ?").get(id).n;
  if (c.parentId == null && kids > 0) {
    db.prepare("UPDATE event_comments SET deleted_at = ? WHERE id = ?").run(Date.now(), id);
    return { kind: "soft" };
  }
  db.prepare("DELETE FROM event_comments WHERE id = ?").run(id);
  return { kind: "hard" };
}
