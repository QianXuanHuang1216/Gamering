import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { openDb, createEvent } from "../lib/db.js";
import {
  validateCommentBody,
  createComment,
  listComments,
  groupComments,
  editComment,
  deleteComment,
  canEditComment,
  canDeleteComment,
} from "../lib/comments.js";
import {
  capFloor,
  validateEventEdit,
  validateTimes,
  defaultStartParts,
  isPastDate,
} from "../lib/edit-validate.js";
import { removeMember } from "../lib/members.js";

process.env.SESSION_SECRET ??= "test-secret";

const evt = (db, id = "e1", extra = {}) =>
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

describe("SPA-506 A 评论：两层约束（L3 写不进）", () => {
  let db;
  beforeEach(() => {
    db = openDb(":memory:");
    evt(db);
  });

  it("L1 parent_id 为 NULL；L2 挂 L1 下", () => {
    const l1 = createComment(db, { eventId: "e1", authorDiscordId: "a", authorUsername: "Ada", body: "集合" });
    assert.equal(l1.parentId, null);
    const l2 = createComment(db, { eventId: "e1", parentId: l1.id, authorDiscordId: "c", authorUsername: "Chen", body: "@ Ada 收到" });
    assert.equal(l2.parentId, l1.id);
  });

  it("以 L2 为 parent 时自动压平到同一 L1（永无 L3）", () => {
    const l1 = createComment(db, { eventId: "e1", authorDiscordId: "a", authorUsername: "Ada", body: "集合" });
    const l2 = createComment(db, { eventId: "e1", parentId: l1.id, authorDiscordId: "c", authorUsername: "Chen", body: "收到" });
    const l3attempt = createComment(db, { eventId: "e1", parentId: l2.id, authorDiscordId: "b", authorUsername: "Bryan", body: "@ Chen 好" });
    assert.equal(l3attempt.parentId, l1.id);
    const rows = listComments(db, "e1");
    for (const r of rows) {
      if (r.parentId != null) {
        const parent = rows.find((x) => x.id === r.parentId);
        assert.equal(parent.parentId, null, "L2 的 parent 必须是 L1");
      }
    }
  });

  it("DB trigger 兜底：裸写 L3 直接抛错", () => {
    const l1 = createComment(db, { eventId: "e1", authorDiscordId: "a", authorUsername: "Ada", body: "集合" });
    const l2 = createComment(db, { eventId: "e1", parentId: l1.id, authorDiscordId: "c", authorUsername: "Chen", body: "收到" });
    assert.throws(() =>
      db
        .prepare(
          "INSERT INTO event_comments (event_id, parent_id, author_discord_id, author_username, body, created_at) VALUES (?,?,?,?,?,?)",
        )
        .run("e1", l2.id, "x", "X", "hack", Date.now()),
    );
  });

  it("groupComments 把 L2 压平到同一 L1 下", () => {
    const l1 = createComment(db, { eventId: "e1", authorDiscordId: "a", authorUsername: "Ada", body: "集合" });
    createComment(db, { eventId: "e1", parentId: l1.id, authorDiscordId: "c", authorUsername: "Chen", body: "收到" });
    const groups = groupComments(listComments(db, "e1"));
    assert.equal(groups.length, 1);
    assert.equal(groups[0].replies.length, 1);
  });

  it("body 校验：空/超 500 字拒绝", () => {
    assert.ok(validateCommentBody(""));
    assert.ok(validateCommentBody("   "));
    assert.ok(validateCommentBody("x".repeat(501)));
    assert.equal(validateCommentBody("ok"), null);
    assert.throws(() => createComment(db, { eventId: "e1", authorDiscordId: "a", authorUsername: "A", body: "" }));
  });

  it("幂等：同一 request_id 只写一行", () => {
    const a = createComment(db, { eventId: "e1", authorDiscordId: "a", authorUsername: "A", body: "hi", requestId: "r1" });
    const b = createComment(db, { eventId: "e1", authorDiscordId: "a", authorUsername: "A", body: "hi", requestId: "r1" });
    assert.equal(a.id, b.id);
    assert.equal(listComments(db, "e1").length, 1);
  });
});

describe("SPA-506 A 评论：edited 标记与删除权限", () => {
  let db;
  beforeEach(() => {
    db = openDb(":memory:");
    evt(db);
  });

  it("作者编辑后 edited=true，非作者不可编辑", () => {
    const c = createComment(db, { eventId: "e1", authorDiscordId: "a", authorUsername: "Ada", body: "v1" });
    assert.equal(canEditComment({ comment: c, meId: "a" }), true);
    assert.equal(canEditComment({ comment: c, meId: "stranger" }), false);
    assert.throws(() => editComment(db, { id: c.id, meId: "stranger", body: "hack" }));
    const out = editComment(db, { id: c.id, meId: "a", body: "v2" });
    assert.equal(out.body, "v2");
    assert.ok(out.editedAt > 0);
    assert.equal(listComments(db, "e1")[0].edited, true);
  });

  it("删除权限：作者/房主可、路人不可", () => {
    const c = createComment(db, { eventId: "e1", authorDiscordId: "a", authorUsername: "Ada", body: "hi" });
    assert.equal(canDeleteComment({ comment: c, meId: "a", creatorId: "owner" }), true);
    assert.equal(canDeleteComment({ comment: c, meId: "owner", creatorId: "owner" }), true);
    assert.equal(canDeleteComment({ comment: c, meId: "stranger", creatorId: "owner" }), false);
    assert.throws(() => deleteComment(db, { id: c.id, meId: "stranger", creatorId: "owner" }));
  });

  it("无回复 L1 硬删（行消失）；L2 硬删", () => {
    const c = createComment(db, { eventId: "e1", authorDiscordId: "a", authorUsername: "Ada", body: "hi" });
    const r = deleteComment(db, { id: c.id, meId: "a", creatorId: "owner" });
    assert.equal(r.kind, "hard");
    assert.deepEqual(listComments(db, "e1"), []);
  });

  it("有回复 L1 软删：保留占位保楼层上下文", () => {
    const l1 = createComment(db, { eventId: "e1", authorDiscordId: "a", authorUsername: "Ada", body: "集合" });
    createComment(db, { eventId: "e1", parentId: l1.id, authorDiscordId: "c", authorUsername: "Chen", body: "收到" });
    const r = deleteComment(db, { id: l1.id, meId: "owner", creatorId: "owner" });
    assert.equal(r.kind, "soft");
    const groups = groupComments(listComments(db, "e1"));
    assert.equal(groups.length, 1);
    assert.equal(groups[0].l1.deleted, true);
    assert.equal(groups[0].replies.length, 1);
  });
});

describe("SPA-506 B 编辑：cap 下限与移除递补", () => {
  let db;
  beforeEach(() => {
    db = openDb(":memory:");
    evt(db, "e1", { cap: 5 });
    db.prepare("INSERT INTO participants (event_id, discord_id, username, seat, joined_at) VALUES (?,?,?,?,?)").run(
      "e1", "owner", "Bryan", "confirmed", 1,
    );
    db.prepare("INSERT INTO participants (event_id, discord_id, username, seat, joined_at) VALUES (?,?,?,?,?)").run(
      "e1", "a", "Ada", "confirmed", 2,
    );
    db.prepare("INSERT INTO participants (event_id, discord_id, username, seat, joined_at) VALUES (?,?,?,?,?)").run(
      "e1", "c", "Chen", "confirmed", 3,
    );
  });

  it("capFloor = confirmed + held；3 人参加时 cap=2 存不上", () => {
    assert.equal(capFloor({ confirmed: 3, held: 0 }), 3);
    const err = validateEventEdit({ patch: { cap: 2 }, confirmed: 3, held: 0 });
    assert.ok(err);
    assert.ok(err.includes("1"));
    assert.equal(validateEventEdit({ patch: { cap: 3 }, confirmed: 3, held: 0 }), null);
  });

  it("移除 1 人后 cap=2 可存", () => {
    const out = removeMember(db, { eventId: "e1", discordId: "a", creatorId: "owner" });
    assert.equal(out.removed, "a");
    assert.equal(validateEventEdit({ patch: { cap: 2 }, confirmed: 2, held: 0 }), null);
  });

  it("房主不可被移除", () => {
    assert.throws(() => removeMember(db, { eventId: "e1", discordId: "owner", creatorId: "owner" }));
  });

  it("移除直接删除该行；有排队时队首递补", () => {
    db.prepare("INSERT INTO participants (event_id, discord_id, username, seat, joined_at) VALUES (?,?,?,?,?)").run(
      "e1", "w", "Wait", "waitlisted", 4,
    );
    const out = removeMember(db, { eventId: "e1", discordId: "a", creatorId: "owner" });
    assert.equal(out.promotedId, "w");
    const seats = new Map(listComments.length ? [] : db.prepare("SELECT discord_id, seat FROM participants WHERE event_id='e1'").all().map((r) => [r.discord_id, r.seat]));
    assert.equal(seats.get("w"), "confirmed");
    assert.equal(seats.has("a"), false);
  });

  it("字段校验：标题/描述超长、held 越界、结束<=开始报错", () => {
    assert.ok(validateEventEdit({ patch: { game_text: "" }, confirmed: 1, held: 0 }));
    assert.ok(validateEventEdit({ patch: { game_text: "x".repeat(81) }, confirmed: 1, held: 0 }));
    assert.ok(validateEventEdit({ patch: { held: 9 }, confirmed: 1, held: 0, cap: 5 }));
    assert.ok(validateEventEdit({ patch: { description: "x".repeat(2001) }, confirmed: 1, held: 0 }));
    assert.ok(validateEventEdit({ patch: { cap: 0 }, confirmed: 0, held: 0 }));
  });
});

describe("SPA-506 C 时间：默认填充与校验", () => {
  it("默认今天 + 当前分钟", () => {
    const now = new Date("2026-09-21T21:36:00");
    const d = defaultStartParts(now);
    assert.equal(d.date, "2026-09-21");
    assert.equal(d.hour, 21);
    assert.equal(d.minute, 36);
  });

  it("结束 <= 开始报错", () => {
    assert.ok(validateTimes({ startAt: 100, endAt: 100 }));
    assert.ok(validateTimes({ startAt: 200, endAt: 100 }));
    assert.equal(validateTimes({ startAt: 100, endAt: 200 }), null);
    assert.equal(validateTimes({ startAt: 100, endAt: null }), null);
  });

  it("过去日期 disabled（按天比较）", () => {
    const today = new Date("2026-09-21T12:00:00");
    assert.equal(isPastDate("2026-09-20", today), true);
    assert.equal(isPastDate("2026-09-21", today), false);
    assert.equal(isPastDate("2026-09-22", today), false);
  });
});
