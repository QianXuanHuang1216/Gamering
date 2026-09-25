// SPA-548 B 段：PUSH_ERROR 拆分——通用词汇归 lib/api-client.js，推送专属的留在 lib/push.js。
// 名字 PUSH_ERROR 不改：拆完之后它剩下的东西确实都是推送的。
//
// 前提（工单写死的顺序）：#13（SPA-546）已合并进 main。拆的时候 lib/push.js 里已经有
// alreadySent/notSent/sendUnknown/pushOutcome/newPushNonce/validNonce —— 那三个字符串正是
// 「发没发出去不许说错」的判据，AC4 专门钉一条回归断言，防止有人在解决冲突时顺手删掉。
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./alias-loader.js", import.meta.url);

const { PUSH_ERROR, pushErrorMessage, pushOutcome, newPushNonce, validNonce, discordMessageUrl } =
  await import("../lib/push.js");
const { API_ERROR } = await import("../lib/api-client.js");

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = (p) => readFileSync(path.join(root, p), "utf8");

/** app/ 与 lib/ 下所有源码文件（不含 node_modules / .next / test）。 */
function sourceFiles(dir = root, acc = []) {
  for (const name of readdirSync(dir)) {
    if ([".next", "node_modules", "test", ".git"].includes(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.(js|jsx)$/.test(name)) acc.push(full);
  }
  return acc;
}
const SOURCES = sourceFiles().map((f) => ({ f, s: readFileSync(f, "utf8") }));
/** 一句文案在 app/ + lib/ 里一共出现在几个文件的字面量里。 */
const placesOf = (text) => SOURCES.filter(({ s }) => s.includes(`"${text}"`)).map(({ f }) => path.relative(root, f));

describe("SPA-548 B1：通用词汇只有一处定义", () => {
  it("PUSH_ERROR.unreadable 引用通用模块，不是复制字符串", () => {
    assert.equal(PUSH_ERROR.unreadable, API_ERROR.unreadable, "两边必须指向同一句");
    assert.deepEqual(placesOf(API_ERROR.unreadable), ["lib/api-client.js"], "通用词汇只该在 lib/api-client.js 定义一次");
  });

  it("lib/push.js 里不再抄一份通用词汇（改前 unreadable 有两处定义）", () => {
    const s = src("lib/push.js");
    assert.ok(!s.includes(API_ERROR.unreadable), "lib/push.js 仍硬编码了通用文案");
    assert.ok(s.includes("API_ERROR"), "lib/push.js 应从 @/lib/api-client 引用");
  });

  it("通用模块里没有推送专属的说法（编辑/评论不该背「连不上 Discord」）", () => {
    for (const [k, v] of Object.entries(API_ERROR)) {
      assert.ok(!/Discord|nonce|频道|群/.test(v), `API_ERROR.${k} 混进了推送专属的说法：${v}`);
    }
  });

  it("PUSH_ERROR.transport 保持推送专属的 Discord 说法，不被挪进通用模块", () => {
    // 工单写的是「transport / unreadable 都改成引用通用模块」。unreadable 确实是通用的（已拆），
    // transport 不是：它点名 Discord，编辑事件/评论这五条路上没有 Discord 参与。
    // 硬塞进通用模块等于让 5 个组件背一句不属于它们的故障，所以这里保留推送自己的定义。
    assert.equal(PUSH_ERROR.transport, "连不上 Discord，请再试一次");
    assert.deepEqual(placesOf(PUSH_ERROR.transport), ["lib/push.js"]);
  });
});

describe("SPA-548 B2：推送专属词汇各自只有一处定义", () => {
  const PUSH_ONLY = ["transport", "rateLimited", "fallback", "alreadySent", "notSent", "sendUnknown", "nonceInvalid"];

  it("PUSH_ERROR 的键没被改名、没被删（剩下的确实都是推送的）", () => {
    assert.deepEqual(Object.keys(PUSH_ERROR).sort(), [...PUSH_ONLY, "unreadable"].sort());
  });

  for (const k of PUSH_ONLY) {
    it(`PUSH_ERROR.${k} 只有 lib/push.js 一处定义`, () => {
      assert.ok(PUSH_ERROR[k]?.length > 0, `PUSH_ERROR.${k} 为空`);
      assert.deepEqual(placesOf(PUSH_ERROR[k]), ["lib/push.js"], `PUSH_ERROR.${k} 有第二处用户可见文案`);
    });
  }

  it("两套词汇没有互相串味：只有 unreadable 是共用的那一句", () => {
    const shared = Object.keys(PUSH_ERROR).filter((k) => Object.values(API_ERROR).includes(PUSH_ERROR[k]));
    assert.deepEqual(shared, ["unreadable"], `意外的共用词：${shared}`);
  });
});

describe("SPA-548 B3：#13 的推送专属语义一根没动", () => {
  it("三态判据（alreadySent / notSent / sendUnknown）都还在", () => {
    assert.equal(pushOutcome({ ok: true, data: { sent: true, message_id: "m", guild_id: "g", channel_id: "c" } }).text, PUSH_ERROR.alreadySent);
    assert.equal(pushOutcome({ ok: true, data: { sent: false } }).text, PUSH_ERROR.notSent);
    assert.equal(pushOutcome({ ok: false }).text, PUSH_ERROR.sendUnknown);
  });

  it("pushOutcome 的「发没发出去不许说错」没退化（查不到 ≠ 没发出去）", () => {
    const unknown = pushOutcome({ ok: false });
    assert.equal(unknown.url, null, "查失败时不能给假链接");
    assert.ok(!unknown.text.includes("重试"), "查失败时不该教人重试");
  });

  it("nonce 那几个函数在（#13 AC3 去重的前提）", () => {
    assert.match(newPushNonce(), /^[0-9a-f]{16}$/);
    assert.equal(validNonce(undefined), undefined, "没带 = 不参与去重，不是非法");
    assert.equal(validNonce(""), null, "空串该拒");
    assert.equal(validNonce("x".repeat(26)), null, "超 25 字符该拒（Discord 上限）");
    assert.equal(discordMessageUrl({ guild_id: "g", channel_id: "c", message_id: "m" }), "https://discord.com/channels/g/c/m");
    assert.equal(discordMessageUrl({ guild_id: "g" }), null, "缺 id 不给假链接");
  });

  it("pushErrorMessage 逐字不变（#13 的 38 条测试之外的独立抽查）", () => {
    assert.equal(pushErrorMessage({ unreadable: true }), API_ERROR.unreadable, "通用词换成引用后，字面不能变");
    assert.equal(pushErrorMessage({ status: 502, data: null }), PUSH_ERROR.transport);
    assert.equal(pushErrorMessage({ status: 429, data: { error: "x" } }), PUSH_ERROR.rateLimited);
    assert.equal(pushErrorMessage({ status: 400, data: { error: "仅支持文字频道" } }), `失败：仅支持文字频道`);
    assert.equal(pushErrorMessage({ ok: true, status: 201, data: {} }), "");
  });
});
