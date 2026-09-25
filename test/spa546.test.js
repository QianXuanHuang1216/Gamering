// SPA-546：「我到底发出去没有」要成为一个能回答的问题。
// 缺陷：push 路由的顺序是 sendCard → addMessage → 写响应。响应在回程被截断时（TCP 复位 /
// 代理掐断 / CDN 插页），卡可能已经进了 Discord，而 SPA-545 的「没有收到服务端的回复，
// 请再试一次」正在教用户再点一次 —— 那就是多一张卡。文案从空白变成误导，伤害没少。
// AC1 只读查询接口（判据 = event_messages）｜AC2 三种说法：已经发出 / 没发出 / 不确定｜
// AC3 enforce_nonce：同一次发送手势的重发在 Discord 侧去重。
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

const { getDb, createEvent, addMessage, markMessageDead, latestLiveCard, migrate, openDb } = await import("../lib/db.js");
const { signSession } = await import("../lib/session.js");
const { sendCard } = await import("../lib/discord-rest.js");
const pushRoute = await import("../app/api/events/[id]/push/route.js");
const { POST: pushEvent } = pushRoute;
// RED 期这些还不存在：整模块导入，让每条断言各自独立失败而不是整文件挂掉。
const pushLib = await import("../lib/push.js");

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = (p) => readFileSync(path.join(root, p), "utf8");

const db = getDb();

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const jsonRes = (status, data = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: new Map(),
  json: async () => data,
});

const mkReq = (user, body) => ({
  headers: {
    get: (k) => (String(k).toLowerCase() === "cookie" && user ? `gamer_session=${signSession(user)}` : null),
  },
  json: async () => body,
});

const mkGet = (user, query = "") => ({
  url: `https://example.test/api/events/e/push${query}`,
  headers: {
    get: (k) => (String(k).toLowerCase() === "cookie" && user ? `gamer_session=${signSession(user)}` : null),
  },
});

const isJson = (res) => (res.headers.get("content-type") ?? "").includes("application/json");
const CJK = /[一-鿿]/;
const chinese = (s) => typeof s === "string" && s.length > 0 && CJK.test(s);
const RETRY = /再试|重试|再点一次/;

function liveEvent(id) {
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
}

/** 放行预检的 GET；POST /messages 交给 handler，并记下真正发出去的 body。 */
function stubDiscord(handler) {
  const sent = [];
  globalThis.fetch = async (url, init) => {
    if (!url.endsWith("/messages")) return jsonRes(200, { id: "chan-1", type: 0, guild_id: "guild-9" });
    sent.push(JSON.parse(init.body));
    return handler(url, init);
  };
  return sent;
}

describe("SPA-546 AC1：推送后能查这张卡在不在", () => {
  it("卡在 → sent:true + message_id（外加能拼直链的 guild_id/channel_id）", async () => {
    liveEvent("e-verify-yes");
    addMessage(db, { eventId: "e-verify-yes", guildId: "guild-9", channelId: "chan-1", messageId: "msg-42" });
    const res = await pushRoute.GET(mkGet("owner", "?channel_id=chan-1"), { params: { id: "e-verify-yes" } });
    assert.equal(res.status, 200);
    assert.ok(isJson(res));
    const body = await res.json();
    assert.equal(body.sent, true);
    assert.equal(body.message_id, "msg-42");
    assert.equal(body.guild_id, "guild-9", "前端要靠它拼 Discord 直链");
    assert.equal(body.channel_id, "chan-1");
  });

  it("不在 → sent:false，且不泄露 message_id（别让人以为有链接可用）", async () => {
    liveEvent("e-verify-no");
    addMessage(db, { eventId: "e-verify-no", guildId: "guild-9", channelId: "other-chan", messageId: "msg-1" });
    const res = await pushRoute.GET(mkGet("owner", "?channel_id=chan-1"), { params: { id: "e-verify-no" } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.sent, false, "事件有卡不等于这个频道有卡");
    assert.ok(!("message_id" in body), `sent:false 不该带 message_id：${JSON.stringify(body)}`);
  });

  it("死卡（alive=0）不算数：卡被删了就是没发出去", async () => {
    liveEvent("e-verify-dead");
    addMessage(db, { eventId: "e-verify-dead", guildId: "guild-9", channelId: "chan-1", messageId: "msg-dead" });
    const row = db.prepare("SELECT id FROM event_messages WHERE event_id = ?").get("e-verify-dead");
    markMessageDead(db, row.id);
    const res = await pushRoute.GET(mkGet("owner", "?channel_id=chan-1"), { params: { id: "e-verify-dead" } });
    assert.equal((await res.json()).sent, false);
  });

  it("同一个频道多张活卡 → 报最近那张（重发之后要给最新的那张）", async () => {
    liveEvent("e-verify-many");
    for (const m of ["old", "mid", "new"]) {
      addMessage(db, { eventId: "e-verify-many", guildId: "guild-9", channelId: "chan-1", messageId: m });
    }
    const res = await pushRoute.GET(mkGet("owner", "?channel_id=chan-1"), { params: { id: "e-verify-many" } });
    assert.equal((await res.json()).message_id, "new");
  });

  it("非创建者查询 → 403，且响应里没有任何推送记录", async () => {
    liveEvent("e-verify-403");
    addMessage(db, { eventId: "e-verify-403", guildId: "guild-9", channelId: "chan-1", messageId: "msg-secret" });
    const res = await pushRoute.GET(mkGet("stranger", "?channel_id=chan-1"), { params: { id: "e-verify-403" } });
    assert.equal(res.status, 403);
    assert.ok(isJson(res), "403 也要 JSON");
    const raw = JSON.stringify(await res.json());
    assert.ok(!raw.includes("msg-secret"), `别人的推送记录不能漏出去：${raw}`);
    assert.ok(!raw.includes("guild-9"), `频道/群 id 也不能漏：${raw}`);
  });

  it("未登录 401 / 事件不存在 404 / 缺 channel_id 400，全是 JSON", async () => {
    liveEvent("e-verify-auth");
    const cases = [
      [null, "?channel_id=chan-1", "e-verify-auth", 401],
      ["owner", "?channel_id=chan-1", "e-nope", 404],
      ["owner", "", "e-verify-auth", 400],
    ];
    for (const [user, query, id, want] of cases) {
      const res = await pushRoute.GET(mkGet(user, query), { params: { id } });
      assert.equal(res.status, want);
      assert.ok(isJson(res), `${want} 分支必须返 JSON`);
    }
  });

  it("latestLiveCard 复用 liveMessages 口径（不再另写一套 SQL 判活）", () => {
    liveEvent("e-verify-helper");
    addMessage(db, { eventId: "e-verify-helper", guildId: "g", channelId: "c1", messageId: "m1" });
    addMessage(db, { eventId: "e-verify-helper", guildId: "g", channelId: "c2", messageId: "m2" });
    assert.equal(latestLiveCard(db, "e-verify-helper", "c1").message_id, "m1");
    assert.equal(latestLiveCard(db, "e-verify-helper", "c2").message_id, "m2");
    assert.equal(latestLiveCard(db, "e-verify-helper", "nope"), null);
    markMessageDead(db, db.prepare("SELECT id FROM event_messages WHERE event_id = ? AND message_id = 'm1'").get("e-verify-helper").id);
    assert.equal(latestLiveCard(db, "e-verify-helper", "c1"), null, "死卡不算活卡");
  });
});

describe("SPA-546 P1：查询要问「刚才那一下」，不是「这个频道以前有没有卡」", () => {
  it("PM 复现：同频道上一次留下的活卡，不能被当成本次手势的结果", async () => {
    liveEvent("e-gesture");
    addMessage(db, { eventId: "e-gesture", guildId: "guild-9", channelId: "chan-1", messageId: "msg-A", nonce: "A" });
    const mine = await pushRoute.GET(mkGet("owner", "?channel_id=chan-1&nonce=B"), { params: { id: "e-gesture" } });
    assert.equal(mine.status, 200);
    const body = await mine.json();
    assert.equal(body.sent, false, "上一次那张卡不是这一次的结果，说成「发出去了」就是让人少发一张");
    assert.ok(!("message_id" in body), `sent:false 不该带 message_id：${JSON.stringify(body)}`);
    const theirs = await pushRoute.GET(mkGet("owner", "?channel_id=chan-1&nonce=A"), { params: { id: "e-gesture" } });
    assert.equal((await theirs.json()).message_id, "msg-A", "按 nonce 查时要能查回自己那一张");
  });

  it("端到端：gesture 1 成功 → gesture 2 回程截断（什么都没建）→ 不能被告知「已经发出去了」", async () => {
    liveEvent("e-gesture-e2e");
    stubDiscord(() => jsonRes(200, { id: "msg-1" }));
    const first = await pushEvent(mkReq("owner", { channel_id: "chan-1", nonce: "n1" }), { params: { id: "e-gesture-e2e" } });
    assert.equal(first.status, 201);
    // 第二次手势：nonce 已轮换，Discord 侧传输层失败，一张卡都没建。
    globalThis.fetch = async (url) => {
      if (url.endsWith("/messages")) throw new TypeError("fetch failed");
      return jsonRes(200, { id: "chan-1", type: 0, guild_id: "guild-9" });
    };
    const second = await pushEvent(mkReq("owner", { channel_id: "chan-1", nonce: "n2" }), { params: { id: "e-gesture-e2e" } });
    assert.ok(second.status >= 500);
    const v = await pushRoute.GET(mkGet("owner", "?channel_id=chan-1&nonce=n2"), { params: { id: "e-gesture-e2e" } });
    const out = pushLib.pushOutcome({ ok: true, data: await v.json() });
    assert.equal(out.text, pushLib.PUSH_ERROR.notSent, "这一下确实没发出去，该说没发出去");
    assert.equal(out.url, null, "不能给一个点开是上一次的链接");
  });

  it("落库要记住这次手势的 nonce，否则查询无从判别", () => {
    liveEvent("e-gesture-store");
    addMessage(db, { eventId: "e-gesture-store", guildId: "g", channelId: "c", messageId: "m", nonce: "xyz" });
    const row = db.prepare("SELECT nonce FROM event_messages WHERE event_id = ? AND message_id = 'm'").get("e-gesture-store");
    assert.equal(row.nonce, "xyz");
    assert.equal(latestLiveCard(db, "e-gesture-store", "c", { nonce: "xyz" }).message_id, "m");
    assert.equal(latestLiveCard(db, "e-gesture-store", "c", { nonce: "other" }), null);
    assert.equal(latestLiveCard(db, "e-gesture-store", "c").message_id, "m", "不传 nonce 时保留 AC1 字面要求的那条口径");
  });

  it("老库要能补上 nonce 列（migrate 幂等，不许炸已有部署）", () => {
    const old = openDb(":memory:");
    old.exec("ALTER TABLE event_messages DROP COLUMN nonce"); // 装成没这列的老库
    assert.ok(!old.prepare("PRAGMA table_info(event_messages)").all().some((c) => c.name === "nonce"));
    migrate(old);
    const cols = old.prepare("PRAGMA table_info(event_messages)").all().map((c) => c.name);
    assert.ok(cols.includes("nonce"), `老库补不上 nonce 列：${cols.join(",")}`);
    migrate(old); // 幂等：再跑一次不许报错
    addMessage(old, { eventId: "e", guildId: "g", channelId: "c", messageId: "m2", nonce: "n" });
    assert.equal(latestLiveCard(old, "e", "c", { nonce: "n" }).message_id, "m2");
    assert.equal(latestLiveCard(old, "e", "c", { nonce: "old" }), null, "老库里的历史行没有手势，不能被当成本次结果");
  });

  it("查询带了非法 nonce → 400，别把整个查询降级成「历史上有没有卡」", async () => {
    liveEvent("e-gesture-bad");
    addMessage(db, { eventId: "e-gesture-bad", guildId: "g", channelId: "c", messageId: "m", nonce: "A" });
    for (const q of ["?channel_id=c&nonce=", "?channel_id=c&nonce=" + "x".repeat(26)]) {
      const res = await pushRoute.GET(mkGet("owner", q), { params: { id: "e-gesture-bad" } });
      assert.equal(res.status, 400, q);
      assert.ok(isJson(res));
    }
  });

  it("前端：查询必须带上这次手势的 nonce（同一个 nonce 既是 POST 的也是 GET 的）", () => {
    const box = src("app/e/[id]/push-box.jsx");
    const send = box.slice(box.indexOf("async function send()"), box.indexOf("function close()"));
    assert.match(send, /nonce \?\? newPushNonce\(\)/, "nonce 为 null 时要就地生成，别让 validNonce 静默当成「没带」");
    assert.match(send, /JSON\.stringify\(\{[^}]*nonce: gestureNonce/, "POST 要带手势 nonce");
    assert.match(send, /URLSearchParams\(\{[^}]*nonce: gestureNonce/, "GET 查询也要带同一个 nonce，否则问的还是历史");
  });

  it("P2-1：nonce 校验失败的用户可见文案也归 PUSH_ERROR 管（不留第二个口子）", async () => {
    liveEvent("e-nonce-copy");
    const res = await pushEvent(mkReq("owner", { channel_id: "chan-1", nonce: "x".repeat(26) }), { params: { id: "e-nonce-copy" } });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, pushLib.PUSH_ERROR.nonceInvalid);
    const route = src("app/api/events/[id]/push/route.js");
    assert.ok(!route.includes("nonce 只能"), "路由里不该硬编码用户可见文案");
  });

  it("P2-2：同一张卡先被摘成死卡、之后又被 enforce_nonce 返回一次 → 要补插回活卡", () => {
    liveEvent("e-revive");
    addMessage(db, { eventId: "e-revive", guildId: "g", channelId: "c", messageId: "m", nonce: "n" });
    const row = db.prepare("SELECT id FROM event_messages WHERE event_id = ? AND message_id = 'm'").get("e-revive");
    markMessageDead(db, row.id);
    assert.equal(latestLiveCard(db, "e-revive", "c"), null);
    addMessage(db, { eventId: "e-revive", guildId: "g", channelId: "c", messageId: "m", nonce: "n" });
    assert.equal(
      latestLiveCard(db, "e-revive", "c", { nonce: "n" })?.message_id,
      "m",
      "活卡得回来：否则 fanout 从此不再更新这张卡",
    );
  });
});

describe("SPA-546 AC2：三种状态三句文案，互不相同", () => {
  it("卡在 → 已经发出去了 + Discord 直链", () => {
    const out = pushLib.pushOutcome({ ok: true, data: { sent: true, message_id: "m1", guild_id: "g9", channel_id: "c1" } });
    assert.equal(out.text, pushLib.PUSH_ERROR.alreadySent);
    assert.equal(out.url, "https://discord.com/channels/g9/c1/m1");
  });

  it("没查到 → 说没发出去，这才允许提重试", () => {
    const out = pushLib.pushOutcome({ ok: true, data: { sent: false } });
    assert.equal(out.text, pushLib.PUSH_ERROR.notSent);
    assert.equal(out.url, null);
    assert.match(out.text, /重试/, "只有这一态该给重试指令");
  });

  it("查询本身失败 → 不确定，绝不默认说没发出去", () => {
    for (const v of [{ ok: false, status: 0 }, { ok: false, status: 500, data: null }, { ok: false, status: 403 }]) {
      const out = pushLib.pushOutcome(v);
      assert.equal(out.text, pushLib.PUSH_ERROR.sendUnknown, JSON.stringify(v));
      assert.equal(out.url, null);
    }
  });

  it("三句文案两两不同，且都是产品里真实存在的说法（非空中文）", () => {
    for (const k of ["alreadySent", "notSent", "sendUnknown"]) {
      assert.ok(chinese(pushLib.PUSH_ERROR[k]), `PUSH_ERROR.${k} 应为非空中文`);
    }
    const three = ["alreadySent", "notSent", "sendUnknown"].map((k) => pushLib.PUSH_ERROR[k]);
    assert.equal(new Set(three).size, 3, `三句不能重复：${JSON.stringify(three)}`);
  });

  it("卡已存在 / 不确定这两态，一个字都不能提重试（那正是这个工单要拔掉的刺）", () => {
    for (const k of ["alreadySent", "sendUnknown"]) {
      assert.ok(!RETRY.test(pushLib.PUSH_ERROR[k]), `PUSH_ERROR.${k} 不该出现重试指令：${pushLib.PUSH_ERROR[k]}`);
    }
  });

  it("这三种说法只出现在 PUSH_ERROR（单一来源，组件里不另写一套）", () => {
    const box = src("app/e/[id]/push-box.jsx");
    for (const k of ["alreadySent", "notSent", "sendUnknown"]) {
      assert.ok(!box.includes(`"${pushLib.PUSH_ERROR[k]}"`), `push-box 硬编码了 ${k} 的文案`);
    }
    assert.ok(box.includes("pushOutcome"), "push-box 未走统一映射 pushOutcome");
  });

  it("discordMessageUrl：缺 id 不给假链接", () => {
    assert.equal(
      pushLib.discordMessageUrl({ guild_id: "g", channel_id: "c", message_id: "m" }),
      "https://discord.com/channels/g/c/m",
    );
    assert.equal(pushLib.discordMessageUrl({ guild_id: "g", channel_id: "c" }), null);
    assert.equal(pushLib.discordMessageUrl({ guild_id: "g", message_id: "m" }), null);
    assert.equal(pushLib.discordMessageUrl({}), null);
  });
});

describe("SPA-546 AC2：push-box 在「没收到回复」之后先查库再说话", () => {
  const sendBody = () => {
    const box = src("app/e/[id]/push-box.jsx");
    return box.slice(box.indexOf("async function send()"), box.indexOf("function close()"));
  };

  it("unreadable 分支查 AC1 接口，用 pushOutcome 出文案", () => {
    const send = sendBody();
    assert.ok(send.includes("if (r.unreadable)"), "没有 unreadable 分支");
    const branch = send.slice(send.indexOf("if (r.unreadable)"), send.indexOf("setMsg(pushErrorMessage(r))"));
    assert.ok(branch.includes("URLSearchParams("), "unreadable 分支必须查 AC1 的只读接口");
    assert.match(branch, /channel_id: channelId/, "查询要指明是哪个频道");
    assert.ok(branch.includes("pushOutcome"), "unreadable 分支必须走 pushOutcome");
    assert.equal(
      (send.match(/setMsg\(pushErrorMessage\(r\)\)/g) ?? []).length,
      1,
      "旧文案只剩一处：非 unreadable 的失败分支，unreadable 走不到它",
    );
  });

  it("unreadable 分支不再直接说「请再试一次」（那正是本工单拔掉的误导）", () => {
    const send = sendBody();
    const branch = send.slice(send.indexOf("if (r.unreadable)"), send.indexOf("setMsg(pushErrorMessage(r))"));
    assert.ok(branch.length > 0, "unreadable 分支还没写，先看上面那条");
    assert.ok(!branch.includes("setMsg("), "unreadable 分支还在用旧的错误文案");
  });

  it("三态有地方显示，且带链接（能点开是最省事的确认方式）", () => {
    const box = src("app/e/[id]/push-box.jsx");
    assert.ok(box.includes("outcome"), "组件没接住 pushOutcome 的结果");
    assert.ok(/outcome\.url[\s\S]{0,200}href=\{outcome\.url\}/.test(box), "outcome.url 没渲染成可点的链接");
  });
});

describe("SPA-546 AC3：enforce_nonce 从源头防重复", () => {
  it("客户端带 nonce → 发出去的 payload 带 nonce + enforce_nonce", async () => {
    liveEvent("e-nonce");
    const sent = stubDiscord(() => jsonRes(200, { id: "msg-n1" }));
    const res = await pushEvent(mkReq("owner", { channel_id: "chan-1", nonce: "abc123" }), { params: { id: "e-nonce" } });
    assert.equal(res.status, 201);
    assert.equal(sent[0].nonce, "abc123");
    assert.equal(sent[0].enforce_nonce, true, "不带 enforce_nonce，Discord 根本不去重");
    assert.equal(sent[0].flags, 1 << 15, "Components V2 标志位不受影响");
  });

  it("没带 nonce → 不塞 enforce_nonce（不装一副防了重复的样子）", async () => {
    liveEvent("e-nonce-none");
    const sent = stubDiscord(() => jsonRes(200, { id: "msg-n2" }));
    const res = await pushEvent(mkReq("owner", { channel_id: "chan-1" }), { params: { id: "e-nonce-none" } });
    assert.equal(res.status, 201);
    assert.ok(!("enforce_nonce" in sent[0]), `没 nonce 就别声明去重：${JSON.stringify(sent[0])}`);
  });

  it("nonce 超 25 字符 / 类型不对 → 400，一张卡都不发", async () => {
    for (const [name, nonce] of [["long", "x".repeat(26)], ["obj", { a: 1 }], ["blank", "  "]]) {
      const id = `e-nonce-bad-${name}`;
      liveEvent(id);
      const sent = stubDiscord(() => jsonRes(200, { id: "msg-x" }));
      const res = await pushEvent(mkReq("owner", { channel_id: "chan-1", nonce }), { params: { id } });
      assert.equal(res.status, 400, `nonce=${name} 应 400`);
      assert.ok(isJson(res));
      assert.equal(sent.length, 0, "校验没过就不该发卡");
    }
  });

  it("sendCard 显式带 nonce 时才加 enforce_nonce（判据只有一处）", async () => {
    const bodies = [];
    globalThis.fetch = async (url, init) => {
      bodies.push(JSON.parse(init.body));
      return jsonRes(200, { id: "m" });
    };
    await sendCard("c1", { flags: 1 << 15, components: [] });
    await sendCard("c1", { flags: 1 << 15, components: [] }, { nonce: "n1" });
    assert.ok(!("enforce_nonce" in bodies[0]));
    assert.equal(bodies[1].nonce, "n1");
    assert.equal(bodies[1].enforce_nonce, true);
    assert.equal(bodies[1].components.length, 0, "payload 原样带上，不许被就地改坏");
  });

  it("newPushNonce 每次不同且 ≤25 字符；validNonce 只放行合规值", () => {
    const a = pushLib.newPushNonce();
    const b = pushLib.newPushNonce();
    assert.notEqual(a, b, "nonce 撞了就等于没去重");
    assert.ok(a.length > 0 && a.length <= 25, `nonce 长度 ${a.length} 超出 Discord 的 25 字符上限`);
    assert.equal(pushLib.validNonce("abc"), "abc");
    assert.equal(pushLib.validNonce(123), 123);
    assert.equal(pushLib.validNonce(1.5), null);
    assert.equal(pushLib.validNonce(undefined), undefined, "没带 = 不参与去重");
    assert.equal(pushLib.validNonce("x".repeat(26)), null);
    assert.equal(pushLib.validNonce("  "), null);
    assert.equal(pushLib.validNonce({ a: 1 }), null);
  });

  it("同 nonce 重发拿回同一张卡 → event_messages 只记一行（否则 fanout 会 PATCH 同一张两次）", async () => {
    liveEvent("e-nonce-dedupe");
    const sent = stubDiscord(() => jsonRes(200, { id: "msg-same" }));
    const first = await pushEvent(mkReq("owner", { channel_id: "chan-1", nonce: "dup" }), { params: { id: "e-nonce-dedupe" } });
    const second = await pushEvent(mkReq("owner", { channel_id: "chan-1", nonce: "dup" }), { params: { id: "e-nonce-dedupe" } });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal((await second.json()).message_id, "msg-same", "enforce_nonce 命中时 Discord 拿回原来那张");
    assert.equal(sent.length, 2, "两次请求都发了出去（去重发生在 Discord 侧）");
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM event_messages WHERE event_id = ?").get("e-nonce-dedupe").n,
      1,
      "同一张 Discord 消息只能记一行",
    );
  });

  it("换新 nonce 的主动再发 → 真的多一张卡（「再次发送会新增一张卡」不能被去重吞掉）", async () => {
    liveEvent("e-nonce-again");
    stubDiscord((url, init) => jsonRes(200, { id: `msg-${JSON.parse(init.body).nonce}` }));
    await pushEvent(mkReq("owner", { channel_id: "chan-1", nonce: "aaa1" }), { params: { id: "e-nonce-again" } });
    await pushEvent(mkReq("owner", { channel_id: "chan-1", nonce: "bbb2" }), { params: { id: "e-nonce-again" } });
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM event_messages WHERE event_id = ?").get("e-nonce-again").n,
      2,
    );
  });

  it("前端：请求带上 nonce；确认成功后换新的（否则「再次发送会新增一张卡」会被去重掉）", () => {
    const box = src("app/e/[id]/push-box.jsx");
    const send = box.slice(box.indexOf("async function send()"), box.indexOf("function close()"));
    assert.match(send, /JSON\.stringify\(\{[^}]*nonce/, "推送请求必须带上 nonce");
    assert.ok(box.includes("newPushNonce()"), "组件没生成 nonce");
    const okBranch = send.slice(send.indexOf("if (r.ok)"), send.indexOf("if (r.unreadable)"));
    assert.ok(okBranch.includes("newPushNonce()"), "确认成功后必须换新 nonce，否则用户主动再发会被 Discord 当重复吞掉");
    const failBranch = send.slice(send.indexOf("if (r.unreadable)"));
    assert.ok(!failBranch.includes("newPushNonce()"), "失败后换 nonce 就等于把去重窗口关掉了");
  });
});
