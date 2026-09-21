import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openDb, createEvent, upsertUser } from "../lib/db.js";
import { createComment, listComments } from "../lib/comments.js";
import { avatarUrl } from "../lib/discord.js";

process.env.SESSION_SECRET ??= "test-secret";

const evt = (db, id = "e1") =>
  createEvent(db, {
    id,
    creatorDiscordId: "owner",
    gameText: "Helldivers 2",
    startAt: Date.now() + 3600_000,
    endAt: null,
    cap: 5,
    held: 0,
    description: "",
  });

describe("SPA-510 P0-1 评论头像链路：listComments 返回 authorAvatarHash", () => {
  let db;
  beforeEach(() => {
    db = openDb(":memory:");
    evt(db);
  });

  it("写评论时落库 avatar_hash，读时返回", () => {
    upsertUser(db, { discordId: "a", username: "Ada", avatarHash: "hashAAA" });
    const c = createComment(db, {
      eventId: "e1",
      authorDiscordId: "a",
      authorUsername: "Ada",
      body: "hi",
      authorAvatarHash: "hashAAA",
    });
    assert.equal(c.authorAvatarHash, "hashAAA");
    assert.equal(listComments(db, "e1")[0].authorAvatarHash, "hashAAA");
  });

  it("旧评论无落库时读时 join users 回退", () => {
    const c = createComment(db, { eventId: "e1", authorDiscordId: "b", authorUsername: "Bryan", body: "hi" });
    assert.equal(c.authorAvatarHash ?? null, null);
    upsertUser(db, { discordId: "b", username: "Bryan", avatarHash: "hashBBB" });
    assert.equal(listComments(db, "e1")[0].authorAvatarHash, "hashBBB");
  });

  it("avatarUrl 与参加者名单一致（三处同一 URL）", () => {
    upsertUser(db, { discordId: "123", username: "Ada", avatarHash: "abc" });
    createComment(db, { eventId: "e1", authorDiscordId: "123", authorUsername: "Ada", body: "hi", authorAvatarHash: "abc" });
    const c = listComments(db, "e1")[0];
    assert.equal(avatarUrl(c.authorDiscordId, c.authorAvatarHash), avatarUrl("123", "abc"));
  });
});

describe("SPA-510 P0-2 讨论卡不再渲染「两层压平 · 无 L3」chip", () => {
  it("comments-box.jsx 无该字样", () => {
    const src = readFileSync(new URL("../app/e/[id]/comments-box.jsx", import.meta.url), "utf8");
    assert.ok(!src.includes("两层压平"), "comments-box 仍含两层压平 chip");
  });

  it("comments-box 使用 AvatarImg 真头像而非首字母圈", () => {
    const src = readFileSync(new URL("../app/e/[id]/comments-box.jsx", import.meta.url), "utf8");
    assert.ok(src.includes("AvatarImg"), "comments-box 未使用 AvatarImg");
    assert.ok(src.includes("avatarUrl"), "comments-box 未使用 avatarUrl");
  });

  it("edit-box 成员行使用 AvatarImg 真头像", () => {
    const src = readFileSync(new URL("../app/e/[id]/edit-box.jsx", import.meta.url), "utf8");
    assert.ok(src.includes("AvatarImg"), "edit-box 未使用 AvatarImg");
    assert.ok(src.includes("avatarUrl"), "edit-box 未使用 avatarUrl");
  });
});
