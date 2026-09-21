import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  openDb, migrate, upsertUser, getUser, createEvent, getEvent, listParticipants,
  addMessage, liveMessages, markMessageDead, endEvent, cancelEvent,
  enqueueRetry, dueRetries, dropRetry, eventsWithLiveCards, transaction,
} from "../lib/db.js";

describe("db：约束与迁移", () => {
  let db;
  beforeEach(() => { db = openDb(":memory:"); });
  const evt = (id = "e1") => createEvent(db, {
    id, creatorDiscordId: "o", gameText: "Apex Legends", startAt: Date.now() + 3600_000, endAt: null, cap: 2, held: 0, description: "",
  });

  it("迁移幂等：重复 migrate 不报错，老库补列", () => {
    migrate(db); migrate(db);
    upsertUser(db, { discordId: "u", username: "n", accessToken: "tok", refreshToken: "r", tokenExpiresAt: 123 });
    const u = getUser(db, "u");
    assert.equal(u.access_token, "tok");
    assert.equal(u.token_expires_at, 123);
  });

  it("UNIQUE(event_id, discord_id)：重复落席抛错", () => {
    evt();
    db.prepare("INSERT INTO participants (event_id, discord_id, username, seat, joined_at) VALUES (?,?,?,?,?)")
      .run("e1", "a", "a", "confirmed", 1);
    assert.throws(() =>
      db.prepare("INSERT INTO participants (event_id, discord_id, username, seat, joined_at) VALUES (?,?,?,?,?)")
        .run("e1", "a", "a", "confirmed", 2));
  });

  it("end/cancel 写终态字段", () => {
    evt();
    endEvent(db, "e1");
    assert.ok(getEvent(db, "e1").endedAt > 0);
    cancelEvent(db, "e1");
    assert.equal(getEvent(db, "e1").cancelled, true);
  });

  it("重试队列：入队/去重合并/到期消费/删除", () => {
    enqueueRetry(db, { eventId: "e1", channelId: "c", messageId: "m", status: 429 });
    enqueueRetry(db, { eventId: "e1", channelId: "c", messageId: "m", status: 500 });
    assert.equal(dueRetries(db, Date.now() + 600_000).length, 1);
    assert.equal(dueRetries(db, Date.now()).length, 0);
    const [r] = dueRetries(db, Date.now() + 600_000);
    assert.equal(r.attempts, 1);
    dropRetry(db, r.id);
    assert.equal(dueRetries(db, Date.now() + 600_000).length, 0);
  });

  it("eventsWithLiveCards：只返回有活卡事件；markMessageDead 摘除", () => {
    evt("e1"); evt("e2");
    addMessage(db, { eventId: "e1", guildId: "g", channelId: "c", messageId: "m" });
    assert.deepEqual(eventsWithLiveCards(db).map((e) => e.id), ["e1"]);
    const [m] = liveMessages(db, "e1");
    markMessageDead(db, m.id);
    assert.deepEqual(eventsWithLiveCards(db), []);
  });

  it("transaction：异常回滚", () => {
    evt();
    assert.throws(() => transaction(db, () => {
      db.prepare("INSERT INTO participants (event_id, discord_id, username, seat, joined_at) VALUES (?,?,?,?,?)")
        .run("e1", "a", "a", "confirmed", 1);
      throw new Error("boom");
    }));
    assert.deepEqual(listParticipants(db, "e1"), []);
  });
});
