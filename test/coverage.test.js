import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { openDb, createEvent, addMessage } from "../lib/db.js";
import { loadEventView } from "../lib/view.js";
import { newOAuthState, sessionCookie, clearSessionCookie, OAUTH_STATE_COOKIE } from "../lib/session.js";
import { precheckChannel, sendCard, patchCard, ephemeralFollowup, botGuilds, userGuilds, guildTextChannels, guildSendable } from "../lib/discord-rest.js";
import { startWorker } from "../lib/worker.js";

process.env.DISCORD_CLIENT_ID = "1551430375874633810";
process.env.DISCORD_BOT_TOKEN = "t";
process.env.SESSION_SECRET = "test-secret";
process.env.SITE_URL = "https://site";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const jsonRes = (status, data = {}) => ({ status, ok: status >= 200 && status < 300, headers: new Map(), json: async () => data });

describe("覆盖补齐", () => {
  it("session helpers", () => {
    assert.equal(newOAuthState().length, 32);
    assert.ok(sessionCookie("v").startsWith("gamer_session=v"));
    assert.ok(clearSessionCookie().includes("Max-Age=0"));
    assert.equal(OAUTH_STATE_COOKIE, "gamer_oauth_state");
  });

  it("P2-3：https 下 cookie 带 Secure，http 下不带", () => {
    const prev = process.env.SITE_URL;
    process.env.SITE_URL = "https://gamering.bryan-huang.com";
    assert.ok(sessionCookie("v").includes("; Secure;"));
    process.env.SITE_URL = "http://localhost:3000";
    assert.ok(!sessionCookie("v").includes("Secure"));
    process.env.SITE_URL = prev;
  });

  it("loadEventView：有/无", () => {
    const db = openDb(":memory:");
    assert.equal(loadEventView(db, "nope"), null);
    createEvent(db, { id: "e", creatorDiscordId: "o", gameText: "G", startAt: Date.now() + 3600_000, endAt: null, cap: 2, held: 0, description: "d" });
    const v = loadEventView(db, "e");
    assert.equal(v.status, "scheduled");
    assert.deepEqual(v.participants, []);
  });

  it("precheck：404/403/非文字频道/通过", async () => {
    globalThis.fetch = async (url) => {
      if (url.endsWith("/c404")) return jsonRes(404, {});
      if (url.endsWith("/c403")) return jsonRes(403, {});
      if (url.endsWith("/cvoice")) return jsonRes(200, { id: "cvoice", type: 2 });
      return jsonRes(200, { id: "ctext", type: 0, guild_id: "g" });
    };
    assert.equal((await precheckChannel("c404")).reason.includes("404"), true);
    assert.equal((await precheckChannel("c403")).reason.includes("403"), true);
    assert.equal((await precheckChannel("cvoice")).ok, false);
    assert.equal((await precheckChannel("ctext")).ok, true);
  });

  it("send/patch/followup 走通", async () => {
    globalThis.fetch = async () => jsonRes(200, { id: "m1" });
    assert.equal((await sendCard("c", {})).data.id, "m1");
    assert.equal((await patchCard("c", "m", {})).ok, true);
    assert.equal((await ephemeralFollowup("app", "tok", "hi")).ok, true);
    assert.equal((await botGuilds()).ok, true);
    assert.equal((await userGuilds("u")).status, 200);
  });

  it("guildTextChannels 过滤 + guildSendable 位运算", async () => {
    globalThis.fetch = async (url) => {
      if (url.endsWith("/channels")) return jsonRes(200, [{ id: "t", type: 0 }, { id: "v", type: 2 }]);
      if (url.endsWith("/roles")) return jsonRes(200, [{ id: "gid", permissions: "104324673" }, { id: "r1", permissions: "0" }]);
      return jsonRes(200, { roles: ["r1"] });
    };
    const ch = await guildTextChannels("gid");
    assert.deepEqual(ch.data.map((c) => c.id), ["t"]);
    const p = await guildSendable("gid", "bot");
    assert.equal(p.send && p.embed, true);
  });

  it("startWorker 幂等", () => {
    const db = openDb(":memory:");
    const t1 = startWorker(db, { intervalMs: 60_000 });
    assert.equal(startWorker(db), t1);
    clearInterval(t1);
  });
});
