import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { openDb, createEvent, addMessage, liveMessages, dueRetries, listParticipants } from "../lib/db.js";
import { runOnce, _resetTick } from "../lib/worker.js";
import { handleButtonClick, _clearCooldown } from "../lib/interactions.js";
import { fanout, manageableIds, botInviteLink } from "../lib/discord-rest.js";
import { markMessageDead, enqueueRetry } from "../lib/db.js";

process.env.DISCORD_CLIENT_ID = "1551430375874633810";
process.env.SITE_URL = "https://site";

const realFetch = globalThis.fetch;

function stubFetch(handler) {
  globalThis.fetch = async (url, init) => handler(url, init);
}
afterEach(() => { globalThis.fetch = realFetch; });

const jsonRes = (status, data = {}) => ({ status, ok: status >= 200 && status < 300, headers: new Map(), json: async () => data });

describe("并发抢席：N 并行点击只有 cap 个确认", () => {
  it("10 人抢 3 席 → 3 confirmed + 7 waitlisted，序号连续", async () => {
    _clearCooldown();
    const db = openDb(":memory:");
    createEvent(db, { id: "race", creatorDiscordId: "o", gameText: "G", startAt: Date.now() + 3600_000, endAt: null, cap: 3, held: 0, description: "" });
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        Promise.resolve(handleButtonClick(db, {
          customId: "join:v1:race",
          user: { id: `u${i}`, username: `u${i}`, avatar: null },
          now: 1000 * (i + 1),
        }))),
    );
    assert.ok(results.every((r) => r.kind === "update"));
    const parts = listParticipants(db, "race");
    assert.equal(parts.filter((p) => p.seat === "confirmed").length, 3);
    assert.equal(parts.filter((p) => p.seat === "waitlisted").length, 7);
    const notes = results.map((r) => r.note).filter(Boolean);
    assert.equal(notes.length, 7); // 每个排队者都收到序号
  });
});

describe("fanout：404/403 标 dead，429/5xx 进重试", () => {
  it("混合结果分类正确", async () => {
    const db = openDb(":memory:");
    createEvent(db, { id: "e", creatorDiscordId: "o", gameText: "G", startAt: Date.now() + 3600_000, endAt: null, cap: 5, held: 0, description: "" });
    for (const mid of ["ok", "gone", "denied", "limited", "broken"]) {
      addMessage(db, { eventId: "e", guildId: "g", channelId: "c", messageId: mid });
    }
    const code = { ok: 200, gone: 404, denied: 403, limited: 429, broken: 503 };
    stubFetch(async (url) => {
      const mid = url.split("/").pop();
      return jsonRes(code[mid], code[mid] === 429 ? { retry_after: 2 } : {});
    });
    const msgs = liveMessages(db, "e");
    const out = await fanout(db, { markMessageDead, enqueueRetry }, "e", msgs, { flags: 32768, components: [] });
    assert.equal(out.find((o) => o.messageId === "ok").ok, true);
    assert.equal(out.find((o) => o.messageId === "gone").dead, true);
    assert.equal(out.find((o) => o.messageId === "denied").dead, true);
    assert.equal(out.find((o) => o.messageId === "limited").retryAfter, 2);
    assert.equal(liveMessages(db, "e").length, 3);
    assert.equal(dueRetries(db, Date.now() + 3600_000).length, 2); // limited + broken
  });
});

describe("worker runOnce：重试消费 + 时间跨越重绘", () => {
  let db;
  beforeEach(() => {
    _resetTick(Date.now() - 65_000);
    db = openDb(":memory:");
  });

  it("到期重试 PATCH 成功即删", async () => {
    createEvent(db, { id: "e", creatorDiscordId: "o", gameText: "G", startAt: Date.now() + 3600_000, endAt: null, cap: 5, held: 0, description: "" });
    addMessage(db, { eventId: "e", guildId: "g", channelId: "c", messageId: "m" });
    enqueueRetry(db, { eventId: "e", channelId: "c", messageId: "m", status: 503 });
    stubFetch(async () => jsonRes(200, {}));
    const out = await runOnce(db, Date.now() + 3600_000);
    assert.equal(out.retried, 1);
    assert.equal(dueRetries(db, Date.now() + 3600_000).length, 0);
  });

  it("end 跨越 → 状态翻转即重绘活卡", async () => {
    const now = Date.now();
    createEvent(db, { id: "e", creatorDiscordId: "o", gameText: "G", startAt: now - 7200_000, endAt: now - 1000, cap: 5, held: 0, description: "" });
    addMessage(db, { eventId: "e", guildId: "g", channelId: "c", messageId: "m" });
    _resetTick(now - 3600_000); // 上次 tick 还在进行中
    let patched = 0;
    stubFetch(async () => { patched++; return jsonRes(200, {}); });
    const out = await runOnce(db, now);
    assert.equal(out.crossed, 1);
    assert.equal(patched, 1);
  });

  it("无跨越 → 不打扰 Discord", async () => {
    createEvent(db, { id: "e", creatorDiscordId: "o", gameText: "G", startAt: Date.now() + 3600_000, endAt: null, cap: 5, held: 0, description: "" });
    addMessage(db, { eventId: "e", guildId: "g", channelId: "c", messageId: "m" });
    _resetTick(Date.now());
    let patched = 0;
    stubFetch(async () => { patched++; return jsonRes(200, {}); });
    const out = await runOnce(db, Date.now());
    assert.equal(out.crossed, 0);
    assert.equal(patched, 0);
  });
});

describe("discord-rest 纯函数", () => {
  it("manageableIds 只认 0x20 位", () => {
    assert.deepEqual([...manageableIds([{ id: "a", permissions: "8" }, { id: "b", permissions: "32" }])], ["b"]);
  });
  it("botInviteLink 最小权限 19456", () => {
    assert.ok(botInviteLink().includes("permissions=19456"));
  });
});
