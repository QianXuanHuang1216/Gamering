// SPA-545：推送到 Discord 的传输层错误处理。
// 缺陷：lib/discord-rest.js 的裸 fetch 抛出后异常逃出路由 → Next 返 HTML 500 →
// push-box.jsx 的 res.json() 抛 SyntaxError → 被当成客户端断网，报成「网络错误」。
// AC1 discordApi 不再抛且有超时｜AC2 路由任何分支都返 JSON｜AC3 前端三态分开｜
// AC4 fanout 传输层失败显式上报。
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.SESSION_SECRET ??= "test-secret";
process.env.SITE_URL ??= "https://example.test";
process.env.DISCORD_BOT_TOKEN = "bot-token";

register("./alias-loader.js", import.meta.url);

const { getDb, createEvent, addMessage, markMessageDead, enqueueRetry, dueRetries, upsertUser } =
  await import("../lib/db.js");
const { signSession } = await import("../lib/session.js");
const { discordApi, DISCORD_TIMEOUT_MS, precheckChannel, userGuilds, fanout } =
  await import("../lib/discord-rest.js");
const { POST: pushEvent } = await import("../app/api/events/[id]/push/route.js");
const { GET: getGuilds } = await import("../app/api/guilds/route.js");
const { GET: getChannels } = await import("../app/api/guilds/[id]/channels/route.js");
// RED 期该模块还不存在：容错导入，让其余断言各自独立失败而不是整文件挂掉。
const { PUSH_ERROR, pushErrorMessage } = await import("../lib/push.js").catch(() => ({}));

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = (p) => readFileSync(path.join(root, p), "utf8");

const db = getDb();

const realFetch = globalThis.fetch;
const realError = console.error;
afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realError;
});

const jsonRes = (status, data = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: new Map(),
  json: async () => data,
});

/** 抓 console.error 上报用。 */
function captureError() {
  const lines = [];
  console.error = (...a) => lines.push(a.map(String).join(" "));
  return lines;
}

/** fetch 永远不 resolve，但尊重 abort signal（真实挂起请求的最小模拟）。 */
let lastInit = null;
const hangingFetch = (url, init) => {
  lastInit = init ?? null;
  // 没有 signal = 没有超时接线，模拟无从挂起，直接失败。
  if (!init?.signal) return Promise.reject(new TypeError("fetch got no signal: 超时未接线"));
  return new Promise((_res, rej) => {
    init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
  });
};

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

/** 放行预检的 GET（返回可用文字频道），POST /messages 交给 handler。 */
function stubDiscord(handler) {
  globalThis.fetch = async (url, init) =>
    url.endsWith("/messages") ? handler(url, init) : jsonRes(200, { id: "chan-1", type: 0, guild_id: "guild-9" });
}

const isJson = (res) => (res.headers.get("content-type") ?? "").includes("application/json");
const CJK = /[一-鿿]/;
const chinese = (s) => typeof s === "string" && s.length > 0 && CJK.test(s);

describe("SPA-545 AC1：discordApi 传输层不抛，且有超时", () => {
  it("fetch reject（TypeError: fetch failed）→ resolve，transport=network，不是 reject", async () => {
    globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };
    const r = await discordApi("/channels/c1");
    assert.equal(r.ok, false);
    assert.equal(r.transport, "network");
    assert.equal(r.status, 0);
  });

  it("返回值仍是 { status, ok, headers, data } + transport（现有调用方不改）", async () => {
    globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };
    const r = await discordApi("/channels/c1");
    for (const k of ["status", "ok", "headers", "data", "transport"]) {
      assert.ok(k in r, `返回值缺少 ${k}`);
    }
    assert.ok(r.headers, "headers 必须存在（失败态也要有占位）");
    assert.equal(typeof r.data, "object");
  });

  it("永不 resolve 的 fetch → 超时后 resolve，transport=timeout，不 reject", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    globalThis.fetch = hangingFetch;
    const p = discordApi("/channels/c1");
    t.mock.timers.tick(DISCORD_TIMEOUT_MS);
    const r = await p;
    assert.equal(r.ok, false);
    assert.equal(r.transport, "timeout");
    assert.equal(r.status, 0);
  });

  it("超时是 8000ms：未到点不 abort，到点才 abort", async (t) => {
    assert.equal(DISCORD_TIMEOUT_MS, 8000);
    t.mock.timers.enable({ apis: ["setTimeout"] });
    globalThis.fetch = hangingFetch;
    const p = discordApi("/channels/c1");
    let settled = false;
    p.then(() => {
      settled = true;
    });
    t.mock.timers.tick(DISCORD_TIMEOUT_MS - 1);
    await Promise.resolve();
    assert.equal(settled, false, "未到 8s 不该 abort");
    t.mock.timers.tick(1);
    assert.equal((await p).transport, "timeout");
  });

  it("超时接线：signal 真的传给 fetch", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    globalThis.fetch = hangingFetch;
    const p = discordApi("/channels/c1");
    t.mock.timers.tick(DISCORD_TIMEOUT_MS);
    const r = await p;
    assert.ok(lastInit?.signal, "fetch 必须收到 AbortSignal");
    assert.equal(r.transport, "timeout");
  });

  it("正常 HTTP 响应仍带 transport=ok（不回归现有契约）", async () => {
    globalThis.fetch = async () => jsonRes(200, { id: "c1", type: 0 });
    const r = await discordApi("/channels/c1");
    assert.equal(r.ok, true);
    assert.equal(r.transport, "ok");
    assert.equal(r.status, 200);
    assert.equal(r.data.id, "c1");
  });

  it("Discord 答了但报错（503）是 transport=ok，不是 network", async () => {
    globalThis.fetch = async () => jsonRes(503, {});
    const r = await discordApi("/channels/c1");
    assert.equal(r.transport, "ok");
    assert.equal(r.status, 503);
  });

  it("userGuilds 走同一个 helper：reject → resolve + transport=network", async () => {
    globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };
    const r = await userGuilds("user-token");
    assert.equal(r.ok, false);
    assert.equal(r.transport, "network");
    assert.equal(r.status, 0);
    assert.deepEqual(r.data, []);
  });

  it("userGuilds 正常路径仍是 Bearer + { status, ok, data }", async () => {
    let auth = null;
    globalThis.fetch = async (url, init) => {
      auth = init.headers.Authorization;
      return jsonRes(200, [{ id: "g1", name: "群", permissions: "32" }]);
    };
    const r = await userGuilds("user-token");
    assert.equal(auth, "Bearer user-token");
    assert.equal(r.ok, true);
    assert.equal(r.transport, "ok");
    assert.equal(r.data[0].id, "g1");
  });

  it("lib/discord-rest.js 只剩一处 await fetch(（共享出口，不再有裸 fetch）", () => {
    const bare = src("lib/discord-rest.js").match(/await fetch\(/g) ?? [];
    assert.equal(bare.length, 1, `应只有共享出口一处 await fetch(，实际 ${bare.length}`);
  });
});

describe("SPA-545 AC1/AC2：precheckChannel 传输失败不显示「（0）」", () => {
  it("transport 失败 → reason 讲人话，且带 transport 供路由定状态码", async () => {
    globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };
    const pre = await precheckChannel("c1");
    assert.equal(pre.ok, false);
    assert.equal(pre.transport, "network");
    assert.equal(pre.reason, PUSH_ERROR?.transport);
    assert.ok(!pre.reason.includes("（0）"), "status 不会是 0，读者会困惑");
  });

  it("真实 HTTP 状态码分类不变（404/403/非文字频道/通过）", async () => {
    globalThis.fetch = async (url) => {
      if (url.endsWith("/c404")) return jsonRes(404, {});
      if (url.endsWith("/c403")) return jsonRes(403, {});
      if (url.endsWith("/cvoice")) return jsonRes(200, { id: "cvoice", type: 2 });
      return jsonRes(200, { id: "ctext", type: 0, guild_id: "g" });
    };
    assert.ok((await precheckChannel("c404")).reason.includes("404"));
    assert.ok((await precheckChannel("c403")).reason.includes("403"));
    assert.equal((await precheckChannel("cvoice")).reason, "仅支持文字频道");
    assert.equal((await precheckChannel("ctext")).ok, true);
  });
});

describe("SPA-545 AC2：push 路由任何分支都返 JSON，绝不吐 HTML 500", () => {
  it("预检传输失败 → 5xx + JSON + 中文 error（POST 不 reject）", async () => {
    liveEvent("e-transport-pre");
    globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };
    const res = await pushEvent(mkReq("owner", { channel_id: "chan-1" }), { params: { id: "e-transport-pre" } });
    assert.equal(res.ok, false);
    assert.ok(res.status >= 500, `传输失败应为 5xx，实际 ${res.status}`);
    assert.ok(isJson(res), "Content-Type 必须是 JSON");
    const body = await res.json();
    assert.ok(chinese(body.error), `error 需是非空中文，实际 ${JSON.stringify(body.error)}`);
  });

  it("发送传输失败 → 5xx + JSON + 中文 error，且不写 event_messages", async () => {
    liveEvent("e-transport-send");
    globalThis.fetch = async (url) => {
      if (url.endsWith("/messages")) throw new TypeError("fetch failed");
      return jsonRes(200, { id: "chan-1", type: 0, guild_id: "guild-9" });
    };
    const res = await pushEvent(mkReq("owner", { channel_id: "chan-1" }), { params: { id: "e-transport-send" } });
    assert.equal(res.ok, false);
    assert.ok(res.status >= 500, `传输失败应为 5xx，实际 ${res.status}`);
    assert.ok(isJson(res));
    assert.ok(chinese((await res.json()).error), "error 需是非空中文");
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM event_messages WHERE event_id = ?").get("e-transport-send").n,
      0,
      "未确认发送成功就不该落 event_messages",
    );
  });

  it("Discord 全程挂起（超时）→ 也是 5xx JSON，不是 HTML 500", async (t) => {
    liveEvent("e-timeout");
    t.mock.timers.enable({ apis: ["setTimeout"] });
    globalThis.fetch = hangingFetch;
    const p = pushEvent(mkReq("owner", { channel_id: "chan-1" }), { params: { id: "e-timeout" } });
    t.mock.timers.tick(DISCORD_TIMEOUT_MS);
    const res = await p;
    assert.ok(res.status >= 500, `超时应为 5xx，实际 ${res.status}`);
    assert.ok(isJson(res));
    assert.ok(chinese((await res.json()).error));
  });

  it("预检 404/403/非文字频道 → 400 + JSON reason", async () => {
    for (const [cid, code, needle] of [
      ["c404", 404, "404"],
      ["c403", 403, "403"],
      ["cvoice", 200, "仅支持文字频道"],
    ]) {
      liveEvent(`e-pre-${cid}`);
      globalThis.fetch = async () => (code === 200 ? jsonRes(200, { id: cid, type: 2 }) : jsonRes(code, {}));
      const res = await pushEvent(mkReq("owner", { channel_id: cid }), { params: { id: `e-pre-${cid}` } });
      assert.equal(res.status, 400, `${cid} 预检失败应为 400`);
      assert.ok(isJson(res));
      assert.ok((await res.json()).error.includes(needle), `${cid} reason 应含 ${needle}`);
    }
  });

  it("发送 403 → 5xx + 可读中文（不甩裸状态码）", async () => {
    liveEvent("e-send-403");
    stubDiscord(() => jsonRes(403, {}));
    const res = await pushEvent(mkReq("owner", { channel_id: "chan-1" }), { params: { id: "e-send-403" } });
    assert.ok(res.status >= 500);
    assert.ok(isJson(res));
    const body = await res.json();
    assert.ok(chinese(body.error));
    assert.ok(!body.error.includes("403"), "面向用户不该甩裸状态码");
  });

  it("发送 429 → 429 + 限流文案，且不再谎称已加入重试", async () => {
    liveEvent("e-send-429");
    stubDiscord(() => jsonRes(429, { retry_after: 2 }));
    const res = await pushEvent(mkReq("owner", { channel_id: "chan-1" }), { params: { id: "e-send-429" } });
    assert.equal(res.status, 429, "限流要能被客户端识别成 429");
    assert.ok(isJson(res));
    const body = await res.json();
    assert.ok(chinese(body.error));
    assert.ok(!body.error.includes("已加入"), "没有真的入重试队列，不能说已加入");
  });

  it("发送 5xx → 5xx + 可读中文", async () => {
    liveEvent("e-send-500");
    stubDiscord(() => jsonRes(500, {}));
    const res = await pushEvent(mkReq("owner", { channel_id: "chan-1" }), { params: { id: "e-send-500" } });
    assert.ok(res.status >= 500);
    assert.ok(isJson(res));
    assert.ok(chinese((await res.json()).error));
  });

  it("鉴权/入参分支回归：401 / 404 / 403 / 400 全是 JSON", async () => {
    liveEvent("e-auth");
    globalThis.fetch = async () => jsonRes(200, { id: "chan-1", type: 0, guild_id: "g" });
    const cases = [
      [null, { channel_id: "c" }, "e-auth", 401],
      ["owner", { channel_id: "c" }, "e-nope", 404],
      ["stranger", { channel_id: "c" }, "e-auth", 403],
      ["owner", {}, "e-auth", 400],
    ];
    for (const [user, body, id, want] of cases) {
      const res = await pushEvent(mkReq(user, body), { params: { id } });
      assert.equal(res.status, want);
      assert.ok(isJson(res), `${want} 分支必须返 JSON`);
    }
  });

  it("成功路径回归：201 + 落 event_messages", async () => {
    liveEvent("e-ok");
    stubDiscord(() => jsonRes(200, { id: "msg-1" }));
    const res = await pushEvent(mkReq("owner", { channel_id: "chan-1" }), { params: { id: "e-ok" } });
    assert.equal(res.status, 201);
    assert.equal((await res.json()).message_id, "msg-1");
    assert.equal(db.prepare("SELECT message_id AS m FROM event_messages WHERE event_id = ?").get("e-ok").m, "msg-1");
  });

  it("路由源码里没有假话：不再承诺「稍后可在详情查看同步状态」", () => {
    for (const f of ["app/api/events/[id]/push/route.js", "app/api/guilds/route.js"]) {
      assert.ok(!src(f).includes("稍后可在详情查看同步状态"), `${f} 仍指向不存在的同步状态视图`);
    }
  });
});

describe("SPA-545 AC2：guilds / channels 路由不再崩成 HTML 500", () => {
  it("/api/guilds：Discord 不可达 → 5xx JSON，不 reject", async () => {
    upsertUser(db, { discordId: "u1", username: "U1", accessToken: "tok" });
    globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };
    const res = await getGuilds(mkReq("u1", {}));
    assert.equal(res.ok, false);
    assert.ok(isJson(res));
    assert.ok(chinese((await res.json()).error), "error 需是非空中文");
  });

  it("/api/guilds：无 access_token → 401", async () => {
    upsertUser(db, { discordId: "u2", username: "U2" });
    const res = await getGuilds(mkReq("u2", {}));
    assert.equal(res.status, 401);
    assert.ok(isJson(res));
  });

  it("/api/guilds：用户 token 401 → 401 JSON", async () => {
    upsertUser(db, { discordId: "u3", username: "U3", accessToken: "tok" });
    globalThis.fetch = async (url, init) =>
      String(init?.headers?.Authorization ?? "").startsWith("Bearer") ? jsonRes(401, {}) : jsonRes(200, []);
    const res = await getGuilds(mkReq("u3", {}));
    assert.equal(res.status, 401);
    assert.ok(isJson(res));
  });

  it("/api/guilds/[id]/channels：Discord 不可达 → 5xx JSON，不 reject", async () => {
    globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };
    const res = await getChannels(mkReq("u1", {}), { params: { id: "g1" } });
    assert.equal(res.ok, false);
    assert.ok(isJson(res));
    assert.ok(chinese((await res.json()).error));
  });
});

describe("SPA-545 AC3：前端三态分开 + 不再指向不存在的页面", () => {
  it("传输失败（5xx）→ 连不上 Discord，请再试一次", () => {
    assert.equal(pushErrorMessage({ status: 502, data: { error: "whatever" } }), "连不上 Discord，请再试一次");
    assert.equal(pushErrorMessage({ status: 500, data: null }), PUSH_ERROR?.transport);
  });

  it("响应无法解析 / fetch 失败 → 没有收到服务端的回复，请再试一次", () => {
    assert.equal(pushErrorMessage({ unreadable: true }), "没有收到服务端的回复，请再试一次");
    assert.equal(
      pushErrorMessage({ status: 500, data: null, unreadable: true }),
      "没有收到服务端的回复，请再试一次",
      "unreadable 优先于状态码：HTML 500 是服务端崩了，不是限流",
    );
  });

  it("429 → 发送太频繁，请过几秒再试", () => {
    assert.equal(pushErrorMessage({ status: 429, data: { error: "x" } }), "发送太频繁，请过几秒再试");
  });

  it("拿到 JSON 错误体 → 展示 data.error", () => {
    assert.equal(pushErrorMessage({ status: 400, data: { error: "仅支持文字频道" } }), "失败：仅支持文字频道");
    assert.ok(pushErrorMessage({ status: 502, data: { error: "" } }).length > 0, "空 error 也要有兜底文案");
  });

  it("成功 → 空串（不产生错误文案）", () => {
    assert.equal(pushErrorMessage({ ok: true, status: 201, data: { message_id: "m" } }), "");
  });

  it("三条文案都是产品里真实存在的说法（非空中文）", () => {
    assert.ok(PUSH_ERROR, "PUSH_ERROR 未导出");
    for (const k of ["transport", "unreadable", "rateLimited", "fallback"]) {
      assert.ok(chinese(PUSH_ERROR[k]), `PUSH_ERROR.${k} 应为非空中文`);
    }
  });

  it("push-box 真的接上 pushErrorMessage（不是死函数）", () => {
    const box = src("app/e/[id]/push-box.jsx");
    assert.ok(box.includes("pushErrorMessage"), "push-box 未使用 pushErrorMessage");
    assert.ok(!box.includes('setMsg("失败：网络错误'), "旧的 catch 文案还在");
  });

  it("「稍后可在详情查看同步状态」从这两处消失", () => {
    for (const f of ["app/e/[id]/push-box.jsx", "app/api/events/[id]/push/route.js"]) {
      assert.ok(!src(f).includes("稍后可在详情查看同步状态"), `${f} 仍写着产品里不存在的同步状态视图`);
    }
  });
});

describe("SPA-545 AC4：fanout 传输层失败不被静默吞掉", () => {
  it("真实状态码分类逐字不变（404/403 dead，429/5xx 入重试，结果带 transport=ok）", async () => {
    liveEvent("e-fan");
    for (const mid of ["ok", "gone", "denied", "limited", "broken"]) {
      addMessage(db, { eventId: "e-fan", guildId: "g", channelId: "c", messageId: mid });
    }
    const code = { ok: 200, gone: 404, denied: 403, limited: 429, broken: 503 };
    globalThis.fetch = async (url) => {
      const mid = url.split("/").pop();
      return jsonRes(code[mid], code[mid] === 429 ? { retry_after: 2 } : {});
    };
    const before = dueRetries(db, Date.now() + 3600_000).length;
    const rows = db.prepare("SELECT * FROM event_messages WHERE event_id = ?").all("e-fan");
    const out = await fanout(db, { markMessageDead, enqueueRetry }, "e-fan", rows, { flags: 1, components: [] });
    const by = (mid) => out.find((o) => o.messageId === mid);
    assert.equal(by("ok").ok, true);
    assert.equal(by("gone").dead, true);
    assert.equal(by("denied").dead, true);
    assert.equal(by("limited").retryAfter, 2);
    assert.equal(by("broken").status, 503);
    assert.ok(out.every((o) => o.transport === "ok"), "真实 HTTP 响应一律 transport=ok");
    assert.equal(dueRetries(db, Date.now() + 3600_000).length - before, 2, "limited + broken 应入重试");
  });

  it("传输层失败：结果里带 transport + 显式上报（console.error），当前不入重试", async () => {
    liveEvent("e-fan-transport");
    addMessage(db, { eventId: "e-fan-transport", guildId: "g", channelId: "c", messageId: "m1" });
    const lines = captureError();
    globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };
    const before = dueRetries(db, Date.now() + 3600_000).length;
    const row = db.prepare("SELECT * FROM event_messages WHERE event_id = ?").get("e-fan-transport");
    const out = await fanout(db, { markMessageDead, enqueueRetry }, "e-fan-transport", [row], { flags: 1, components: [] });
    assert.equal(out[0].ok, false);
    assert.equal(out[0].transport, "network", "结果必须能区分传输层失败与真实 HTTP 状态码");
    assert.equal(out[0].status, 0);
    assert.ok(lines.length > 0, "传输层失败必须被显式上报，不能静默吞掉");
    assert.ok(lines.some((l) => l.includes("m1")), `上报应带上 message_id：${JSON.stringify(lines)}`);
    assert.equal(dueRetries(db, Date.now() + 3600_000).length, before, "策略不变：传输层失败当前不入重试队列");
    assert.equal(row.alive, 1, "传输层失败不标 dead（Discord 根本没答）");
  });
});
