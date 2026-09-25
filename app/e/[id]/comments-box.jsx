"use client";

import { useState } from "react";
import { apiErrorMessage, callApi } from "@/lib/api-client";
import { COMMENT_MAX, visibleCommentActions } from "@/lib/comments";
import { avatarUrl } from "@/lib/discord";
import AvatarImg from "@/app/avatar-img";

const rid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const fmtT = (ts) =>
  new Date(ts).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const LONG_AT = 200;

function useClamp(text) {
  const [open, setOpen] = useState(false);
  const long = text.length > LONG_AT;
  return { long, open, setOpen };
}

function Body({ text }) {
  const { long, open, setOpen } = useClamp(text);
  const m = /^(@ \S+)\s+([\s\S]+)$/.exec(text);
  const mention = m?.[1];
  const rest = m?.[2] ?? text;
  return (
    <>
      <p className={`comment-text${long && !open ? " clamped" : ""}`}>
        {mention && <><span className="chip-replyto">{mention}</span>{" "}</>}
        {rest}
      </p>
      {long && (
        <div className="comment-actions">
          <button type="button" onClick={() => setOpen(!open)}>
            {open ? "收起" : "展开"}
          </button>
        </div>
      )}
    </>
  );
}

/** SPA-506 A：事件两层评论卡（mock comments.html 为准）。 */
export default function CommentsBox({ eventId, meId, creatorId, terminal, initialGroups }) {
  const [groups, setGroups] = useState(initialGroups ?? null);
  const [loading, setLoading] = useState(initialGroups == null);
  const [draft, setDraft] = useState("");
  const [reply, setReply] = useState(null); // { l1Id, who }
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(null); // { body, parentId, requestId }
  const [editing, setEditing] = useState(null); // { id, body, busy, err }
  const [deleting, setDeleting] = useState(null); // comment row
  const [busy, setBusy] = useState(false);
  const [snack, setSnack] = useState("");

  const guest = !meId;
  const readOnly = terminal || guest;
  const count = (groups ?? []).reduce((n, g) => n + 1 + g.replies.length, 0);

  function upsertLocal(c) {
    setGroups((gs) => {
      gs = gs ?? [];
      if (c.parentId == null) return [...gs, { l1: c, replies: [] }];
      return gs.map((g) => (g.l1.id === c.parentId ? { ...g, replies: [...g.replies, c] } : g));
    });
  }

  async function send(body, parentId, requestId) {
    setSending(true);
    setFailed(null);
    try {
      const r = await callApi(`/api/events/${eventId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, parent_id: parentId, request_id: requestId }),
      });
      if (!r.ok) {
        // 带上原 requestId：重试是同一条评论，不会发成两条。
        setFailed({ body, parentId, requestId, msg: apiErrorMessage(r, "发送评论") });
        return;
      }
      upsertLocal(r.data.comment);
      setDraft("");
      setReply(null);
    } finally {
      setSending(false);
    }
  }

  function onSend() {
    const body = draft.trim();
    if (!body || sending) return;
    send(body, reply?.l1Id ?? null, rid());
  }

  async function saveEdit() {
    if (!editing || editing.busy) return;
    setEditing({ ...editing, busy: true, err: "" });
    const r = await callApi(`/api/events/${eventId}/comments/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: editing.body }),
    });
    if (!r.ok) {
      setEditing({ ...editing, busy: false, err: apiErrorMessage(r, "保存评论") });
      return;
    }
    const c = r.data.comment;
    setGroups((gs) =>
      (gs ?? []).map((g) => ({
        l1: g.l1.id === c.id ? { ...g.l1, body: c.body, editedAt: c.editedAt, edited: true } : g.l1,
        replies: g.replies.map((rep) => (rep.id === c.id ? { ...rep, body: c.body, editedAt: c.editedAt, edited: true } : rep)),
      })),
    );
    setEditing(null);
  }

  async function confirmDelete() {
    if (!deleting || busy) return;
    setBusy(true);
    try {
      const r = await callApi(`/api/events/${eventId}/comments/${deleting.id}`, { method: "DELETE" });
      if (!r.ok) {
        setSnack(apiErrorMessage(r, "删除评论"));
        return;
      }
      if (r.data.kind === "soft") {
        setGroups((gs) =>
          (gs ?? []).map((g) =>
            g.l1.id === deleting.id ? { ...g, l1: { ...g.l1, deleted: true, body: "" } } : g,
          ),
        );
      } else {
        setGroups((gs) =>
          (gs ?? [])
            .map((g) => ({
              l1: g.l1,
              replies: g.replies.filter((rep) => rep.id !== deleting.id),
            }))
            .filter((g) => g.l1.id !== deleting.id),
        );
      }
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  }

  function actionsFor(c) {
    if (readOnly) return null;
    const { reply, edit: canEdit, del: canDel } = visibleCommentActions({
      comment: c, meId, creatorId, terminal,
    });
    if (!reply && !canEdit && !canDel) return null;
    return (
      <div className="comment-actions">
        {reply && (
        <button type="button" onClick={() => {
          const g = (groups ?? []).find((x) => x.l1.id === (c.parentId ?? c.id));
          const who = c.authorUsername;
          setReply({ l1Id: g ? g.l1.id : c.parentId ?? c.id, who });
          setDraft(`@ ${who} `);
        }}>
          <span className="msr md-18">reply</span>回复
        </button>
        )}
        {canEdit && (
          <button type="button" onClick={() => setEditing({ id: c.id, body: c.body, busy: false, err: "" })}>
            <span className="msr md-18">edit</span>编辑
          </button>
        )}
        {canDel && (
          <button type="button" onClick={() => setDeleting(c)} aria-label="删除评论">
            <span className="msr md-18">delete</span>删除
          </button>
        )}
      </div>
    );
  }

  function renderComment(c, isL2) {
    if (editing?.id === c.id) {
      return (
        <div className="comment-body">
          <textarea
            className="textarea"
            value={editing.body}
            maxLength={COMMENT_MAX}
            rows={3}
            onChange={(e) => setEditing({ ...editing, body: e.target.value })}
            aria-label="编辑评论"
          />
          {editing.err && <span className="field-error">{editing.err}</span>}
          <div className="comment-actions">
            <button type="button" className="btn btn-filled" style={{ minHeight: 40, padding: "0 20px" }} onClick={saveEdit} disabled={editing.busy || !editing.body.trim()}>
              {editing.busy ? "保存中…" : "保存"}
            </button>
            <button type="button" onClick={() => setEditing(null)} disabled={editing.busy}>取消</button>
          </div>
        </div>
      );
    }
    return (
      <div className="comment-body">
        <div className="comment-meta">
          <span className="who">{c.authorUsername}</span>
          <time>{fmtT(c.createdAt)}</time>
          {c.edited && <span className="comment-edited">已修改 · Edited</span>}
        </div>
        {c.deleted ? (
          <p className="comment-deleted">此评论已删除</p>
        ) : (
          <>
            <Body text={c.body} />
          </>
        )}
        {!c.deleted && actionsFor(c)}
      </div>
    );
  }

  return (
    <section className="card" aria-label="讨论" data-testid="comments-card" id="comments">
      <div className="row">
        <h2 className="t-title-medium" style={{ flex: 1 }}>讨论（{count}）</h2>
      </div>

      {loading && (
        <div aria-label="评论加载中">
          {[0, 1].map((i) => (
            <div className="comment-skel-row" key={i}>
              <div className="skel" style={{ width: 32, height: 32, borderRadius: "50%" }} />
              <div style={{ flex: 1, display: "grid", gap: 8 }}>
                <div className="skel" style={{ height: 14, width: "40%" }} />
                <div className="skel" style={{ height: 20 }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && (groups ?? []).length === 0 && (
        <div className="empty" data-testid="comments-empty">
          <span className="empty-illo"><span className="msr">forum</span></span>
          <p className="t-title-medium">还没有讨论</p>
          <p className="t-body-medium">抢先发起第一条评论吧。</p>
        </div>
      )}

      {!loading && (groups ?? []).length > 0 && (
        <ul className="comment-list">
          {(groups ?? []).map((g) => (
            <li className="comment-l1-group" key={g.l1.id}>
              <div className="comment-l1">
                <AvatarImg className="avatar" src={avatarUrl(g.l1.authorDiscordId, g.l1.authorAvatarHash)} seed={g.l1.authorDiscordId} alt="" size={32} />
                {renderComment(g.l1, false)}
              </div>
              {g.replies.length > 0 && (
                <div className="comment-l2-wrap" aria-label="回复">
                  {g.replies.map((r) => (
                    <div className="comment-l2" key={r.id}>
                      <AvatarImg className="avatar" src={avatarUrl(r.authorDiscordId, r.authorAvatarHash)} seed={r.authorDiscordId} alt="" size={32} />
                      {renderComment(r, true)}
                    </div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && reply && (
        <div className="comment-reply-context">
          <span className="msr md-18">reply</span>
          <span>回复 @ {reply.who}（将归入该主评论下，不产生 L3）</span>
          <span className="spacer" />
          <button type="button" aria-label="取消回复" onClick={() => { setReply(null); }}>✕</button>
        </div>
      )}

      {!readOnly && (
        <>
          <div className="comment-composer">
            <input
              className="input"
              value={draft}
              maxLength={COMMENT_MAX}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") onSend(); }}
              placeholder="写下评论…（Enter 发送）"
              aria-label="写下评论"
              disabled={sending}
            />
            <button className="btn btn-filled" type="button" onClick={onSend} disabled={sending || !draft.trim()}>
              {sending ? "发送中…" : "发送"}
            </button>
          </div>
          <div className="counter">{draft.length}/{COMMENT_MAX}</div>
        </>
      )}

      {guest && (
        <div className="login-strip">
          <span className="msr">login</span>
          <span style={{ flex: 1 }}>登录后可参与讨论（访客只读）。</span>
          <a className="btn btn-filled" href="/api/auth/login" style={{ minHeight: 48 }}>登录</a>
        </div>
      )}
      {terminal && (
        <p className="t-body-medium" style={{ margin: "12px 0 0" }}>事件已终态，评论只读。</p>
      )}

      {failed && (
        <div className="snackbar snackbar-error" role="alert">
          {failed.msg}
          <span className="spacer" />
          <button className="snack-action" onClick={() => send(failed.body, failed.parentId, failed.requestId)}>重试</button>
        </div>
      )}

      {deleting && (
        <div className="scrim" onClick={() => !busy && setDeleting(null)}>
          <div className="sheet" role="alertdialog" aria-modal="true" aria-label="删除评论确认" onClick={(e) => e.stopPropagation()}>
            <div className="grab" aria-hidden />
            <h3 className="t-title-large">删除这条评论？</h3>
            <div className="dialog-danger-strip">有回复的主评论将保留「此评论已删除」占位；其余直接删除。不可恢复。</div>
            <div className="dialog-actions">
              <button type="button" className="btn btn-text" onClick={() => setDeleting(null)} disabled={busy}>取消</button>
              <button type="button" className="btn btn-error" onClick={confirmDelete} disabled={busy}>
                {busy && <span className="spin" aria-hidden />}
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {snack && (
        <div className="snackbar" role="status">{snack}<span className="spacer" />
          <button className="snack-action" onClick={() => setSnack("")}>关闭</button>
        </div>
      )}
    </section>
  );
}
