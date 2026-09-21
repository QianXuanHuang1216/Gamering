// SPA-507 RED：终态事件 API 层只读加固（路由层用例）。
// 缺口：op:edit/op:remove 未校验终态；评论 PATCH/DELETE 未校验终态；
// op:remove 的 removeMember forbidden 误返回 400。
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

process.env.SESSION_SECRET ??= "test-secret";
process.env.SITE_URL ??= "https://example.test";

register("./alias-loader.js", import.meta.url);

const { getDb, createEvent, endEvent, cancelEvent } = await import("../lib/db.js");
const { signSession } = await import("../lib/session.js");
const { createComment } = await import("../lib/comments.js");
const { PATCH: patchEvent } = await import("../app/api/events/[id]/route.js");
const { GET: getComments } = await import("../app/api/events/[id]/comments/route.js");
const {
  PATCH: patchComment,
  DELETE: deleteComment,
} = await import("../app/api/events/[id]/comments/[commentId]/route.js");

const db = getDb();

const mkReq = (user, body) => ({
  headers: {
    get: (k) => (String(k).toLowerCase() === "cookie" && user ? `gamer_session=${signSession(user)}` : null),
  },
  json: async () => body,
});

function liveEvent(id, extra = {}) {
  createEvent(db, {
    id,
    creatorDiscordId: "owner",
    gameText: "Helldivers 2",
    startAt: Date.now() + 3600_000,
    endAt: null,
    cap: 5,
    held: 0,
    description: "",
    ...extra,
  });
}

function addParticipant(eventId, discordId, seat = "confirmed") {
  db.prepare(
    "INSERT INTO participants (event_id, discord_id, username, avatar_hash, seat, joined_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(eventId, discordId, discordId, null, seat, Date.now());
}

describe("SPA-507：终态事件 op:edit/op:remove 只读（403）", () => {
  it("ended 事件上 op:edit 返回 403，且标题未被改写", async () => {
    liveEvent("t-edit");
    endEvent(db, "t-edit");
    const res = await patchEvent(mkReq("owner", { op: "edit", game_text: "HACK" }), { params: { id: "t-edit" } });
    assert.equal(res.status, 403);
    assert.equal(db.prepare("SELECT game_text AS g FROM events WHERE id = ?").get("t-edit").g, "Helldivers 2");
  });

  it("cancelled 事件上 op:remove 返回 403，且名单不变", async () => {
    liveEvent("t-remove");
    addParticipant("t-remove", "guest");
    cancelEvent(db, "t-remove");
    const res = await patchEvent(mkReq("owner", { op: "remove", discord_id: "guest" }), {
      params: { id: "t-remove" },
    });
    assert.equal(res.status, 403);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM participants WHERE event_id = ?").get("t-remove").n, 1);
  });

  it("非终态 op:edit 仍可写（行为不变）", async () => {
    liveEvent("t-live-edit");
    const res = await patchEvent(mkReq("owner", { op: "edit", game_text: "新标题" }), {
      params: { id: "t-live-edit" },
    });
    assert.equal(res.status, 200);
    assert.equal(db.prepare("SELECT game_text AS g FROM events WHERE id = ?").get("t-live-edit").g, "新标题");
  });
});

describe("SPA-507：终态事件评论 PATCH/DELETE 只读（403），GET 仍公开", () => {
  it("ended 事件上评论 PATCH/DELETE 返回 403", async () => {
    liveEvent("t-cmt");
    const c = createComment(db, { eventId: "t-cmt", authorDiscordId: "ada", authorUsername: "Ada", body: "集合" });
    endEvent(db, "t-cmt");
    const p = await patchComment(mkReq("ada", { body: "HACK" }), {
      params: { id: "t-cmt", commentId: String(c.id) },
    });
    assert.equal(p.status, 403);
    const d = await deleteComment(mkReq("ada", {}), { params: { id: "t-cmt", commentId: String(c.id) } });
    assert.equal(d.status, 403);
    assert.equal(db.prepare("SELECT body AS b FROM event_comments WHERE id = ?").get(c.id).b, "集合");
  });

  it("终态事件评论 GET 仍公开可读（含未登录）", async () => {
    const res = await getComments(mkReq(null, {}), { params: { id: "t-cmt" } });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.groups.length, 1);
  });

  it("非终态评论 PATCH 仍可写（行为不变）", async () => {
    liveEvent("t-cmt-live");
    const c = createComment(db, { eventId: "t-cmt-live", authorDiscordId: "ada", authorUsername: "Ada", body: "v1" });
    const res = await patchComment(mkReq("ada", { body: "v2" }), {
      params: { id: "t-cmt-live", commentId: String(c.id) },
    });
    assert.equal(res.status, 200);
  });
});

describe("SPA-507：op:remove 鉴权失败返回 403（非 400）", () => {
  it("非房主调 op:remove 返回 403", async () => {
    liveEvent("t-rm-auth");
    addParticipant("t-rm-auth", "guest");
    const res = await patchEvent(mkReq("stranger", { op: "remove", discord_id: "guest" }), {
      params: { id: "t-rm-auth" },
    });
    assert.equal(res.status, 403);
  });
});
