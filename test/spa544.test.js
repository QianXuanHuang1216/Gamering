// SPA-544：卡片发不出去的真实原因。
//
// 现象：事件「R6」描述为空，推送永远失败。Discord 自己的答复是
//   400 / code 50035 Invalid Form Body
//   components.0.components.4.content: Must be between 1 and 4000 in length.
// 组件 4 是描述那一行 Text Display，content 是空串。Discord 的 Text Display（type 10）
// 要求 content 长度 1–4000，**空串会让整条消息被拒**——不是那行不显示，是整张卡发不出去。
//
// 前四张子工单（SPA-545/546/548/549）都在修「失败时说的话是不是真的」，没一个碰到这个 400：
// 路由把 Discord 的错误体扔了，日志里只剩 `status: 400`，看不出是哪一行出的问题。
// 所以这里修两件事：载荷不再产出空文字行；Discord 拒收时错误可诊断，且不骗人说「稍后重试」。
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

process.env.SESSION_SECRET ??= "test-secret";
process.env.SITE_URL ??= "https://example.test";
process.env.DISCORD_BOT_TOKEN = "bot-token";

register("./alias-loader.js", import.meta.url);

const { getDb, getEvent, createEvent } = await import("../lib/db.js");
const { signSession } = await import("../lib/session.js");
const { buildCardPayload } = await import("../lib/card.js");
const { cardPayload } = await import("../lib/view.js");
const { PUSH_ERROR } = await import("../lib/push.js");
const { POST: pushEvent } = await import("../app/api/events/[id]/push/route.js");

const db = getDb();
const realFetch = globalThis.fetch;
const realError = console.error;
afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realError;
});

const inner = (p) => p.components[0].components;
const textRows = (p) => inner(p).filter((c) => c.type === 10);

/** Discord Text Display 的硬规则：content 长度 1–4000。空串 = 整条消息 400。 */
const discordAccepts = (content) => typeof content === "string" && content.length >= 1 && content.length <= 4000;

const base = {
  id: "evt-544", gameName: "R6", startUnix: 1790380800, endUnix: 1790395140,
  cap: 5, confirmed: 0, held: 0, waitlisted: 0, participants: [],
  description: "", status: "scheduled",
};

/** 真实发生过的那一组：描述为空 / 只有空白 / 有内容 / 超长 / 满员排队 / 终态 / 带参加者。 */
const shapes = [
  ["描述为空（本次线上事故）", { description: "" }],
  ["描述为 null", { description: null }],
  ["描述为 undefined", { description: undefined }],
  ["描述只有空格", { description: "   \n  " }],
  ["描述有内容", { description: "老西螃蟹玩家社区常规联机" }],
  ["描述超长（走截断）", { description: "x".repeat(900) }],
  ["满员 + 排队", { confirmed: 5, cap: 5, waitlisted: 3 }],
  ["带参加者（头像墙）", { participants: [{ discordId: "1", seat: "confirmed", joinedAt: 1 }] }],
  ["参加者超墙（溢出行）", { participants: Array.from({ length: 30 }, (_, i) => ({ discordId: String(i), seat: "confirmed", joinedAt: i })) }],
  ["终态 ended", { status: "ended" }],
  ["终态 cancelled", { status: "cancelled" }],
  ["待定结束时间", { endUnix: null }],
];

describe("SPA-544 缺陷：空文字行让 Discord 拒收整张卡（50035 / BASE_TYPE_BAD_LENGTH）", () => {
  for (const [name, patch] of shapes) {
    it(`buildCardPayload：${name} → 每个文字行都过得了 Discord 的 1–4000`, () => {
      for (const status of ["scheduled", "live", "ended", "cancelled"]) {
        const p = buildCardPayload({ ...base, ...patch, status }, "https://site");
        for (const [i, row] of textRows(p).entries()) {
          assert.ok(
            discordAccepts(row.content),
            `${name}/${status}：第 ${i} 行 content=${JSON.stringify(row.content)} 长度 ${String(row.content).length}，` +
              `Discord 会以 50035 拒掉整条消息`,
          );
        }
      }
    });
  }

  it("回归锁：描述为空时不得再出现 content:\"\" 的文字行", () => {
    const p = buildCardPayload({ ...base, description: "" }, "https://site");
    assert.ok(!textRows(p).some((c) => c.content === ""), "空的描述行还在，Discord 一定拒收");
  });

  it("描述为空时其余行照旧（不是把整张卡清空）", () => {
    const rows = textRows(buildCardPayload({ ...base, description: "" }, "https://site"));
    assert.ok(rows[0].content.includes("R6"));
    assert.ok(rows.some((c) => c.content.includes("还差")));
    assert.ok(inner(buildCardPayload({ ...base, description: "" }, "https://site")).some((c) => c.type === 1), "按钮行没了");
  });

  it("描述有内容时那一行必须在（不能顺手把描述也删了）", () => {
    const rows = textRows(buildCardPayload({ ...base, description: "有事说事" }, "https://site"));
    assert.ok(rows.some((c) => c.content === "有事说事"));
  });

  it("cardPayload（真库路径）同样不产出空行", () => {
    createEvent(db, {
      id: "evt-544-db", creatorDiscordId: "owner", gameText: "R6", startAt: Date.now() + 3600_000,
      endAt: null, cap: 5, held: 0, description: "",
    });
    const ev = getEvent(db, "evt-544-db");
    const p = cardPayload(db, ev, "https://site");
    for (const row of textRows(p)) assert.ok(discordAccepts(row.content), `空行：${JSON.stringify(row.content)}`);
  });
});

describe("SPA-544 第二个洞：Discord 拒收的错误被扔了，四张工单都没看见它", () => {
  const mkReq = (user, body) => ({
    headers: { get: (k) => (String(k).toLowerCase() === "cookie" && user ? `gamer_session=${signSession(user)}` : null) },
    json: async () => body,
  });
  const ctx = (id) => ({ params: Promise.resolve({ id }) });

  function liveEvent(id) {
    createEvent(db, {
      id, creatorDiscordId: "owner", gameText: "R6", startAt: Date.now() + 3600_000,
      endAt: null, cap: 5, held: 0, description: "",
    });
  }

  /** 放行预检，POST /messages 交给 handler（复刻线上那次 400 的应答体）。 */
  const discordSays = (status, data) => {
    globalThis.fetch = async (url) =>
      url.endsWith("/messages")
        ? { status, ok: false, headers: new Map(), json: async () => data }
        : { status: 200, ok: true, headers: new Map(), json: async () => ({ id: "c1", type: 0, guild_id: "g1" }) };
  };
  const captureError = () => {
    const lines = [];
    console.error = (...a) => lines.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
    return lines;
  };

  const discordInvalidForm = {
    message: "Invalid Form Body",
    code: 50035,
    errors: { components: { "0": { components: { "4": { content: { _errors: [{ code: "BASE_TYPE_BAD_LENGTH" }] } } } } } },
  };

  it("Discord 400：应答体里带上它的错误码和出错字段（不然又是一次查不出原因）", async () => {
    liveEvent("evt-544-400");
    discordSays(400, discordInvalidForm);
    const logged = captureError();
    await pushEvent(mkReq("owner", { channel_id: "ch-1", nonce: "abc123" }), ctx("evt-544-400"));
    const blob = logged.join("\n");
    assert.match(blob, /50035/, "日志里必须有 Discord 的错误码");
    assert.match(blob, /BASE_TYPE_BAD_LENGTH/, "日志里必须有 Discord 指出的字段错误");
  });

  it("Discord 400：不许说「请稍后重试」——同一个 payload 再发一次还是 400", async () => {
    liveEvent("evt-544-400b");
    discordSays(400, discordInvalidForm);
    captureError();
    const res = await pushEvent(mkReq("owner", { channel_id: "ch-1", nonce: "abc123" }), ctx("evt-544-400b"));
    const body = await res.json();
    assert.equal(res.headers.get("content-type")?.includes("application/json"), true);
    assert.ok(body.error.length > 0, "得有话可说");
    assert.ok(!body.error.includes("重试"), `400 是确定性的，不该请人重试：${body.error}`);
    assert.match(body.error, /50035/, "把 Discord 的错误码带给用户，他能直接转述");
  });

  it("Discord 5xx 仍然说「请稍后重试」（那个是真能重试的）", async () => {
    liveEvent("evt-544-500");
    discordSays(500, {});
    captureError();
    const res = await pushEvent(mkReq("owner", { channel_id: "ch-1", nonce: "abc123" }), ctx("evt-544-500"));
    const body = await res.json();
    assert.match(body.error, /重试/, `5xx 该请人重试：${body.error}`);
  });

  it("403 / 429 的既有说法不许被这次改动带坏", async () => {
    liveEvent("evt-544-403");
    discordSays(403, {});
    captureError();
    assert.match((await (await pushEvent(mkReq("owner", { channel_id: "ch-1" }), ctx("evt-544-403"))).json()).error, /权限/);
    liveEvent("evt-544-429");
    discordSays(429, { retry_after: 1 });
    captureError();
    assert.equal((await (await pushEvent(mkReq("owner", { channel_id: "ch-1" }), ctx("evt-544-429"))).json()).error, PUSH_ERROR.rateLimited);
  });
});
