// SPA-548 A 段：剩下 5 个组件的裸 res.json() 收敛到 lib/api-client.js。
// 缺陷：服务端一旦吐 HTML（任何未捕获异常），res.json() 抛 SyntaxError，
// 前端把「服务端崩了」说成「网络错误」；comments-box 三处连失败提示都没有（promise 拒绝没人接）。
// AC1 callApi 提成共享出口且绝不 throw｜AC2 5 个组件都不再有裸 json()｜
// AC3 每处失败文案对得上该操作（保存失败 ≠ 发送失败 ≠ 评论失败）。
// B 段（拆分 PUSH_ERROR，等 PR #13 合并后）不在本文件。
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./alias-loader.js", import.meta.url);

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = (p) => readFileSync(path.join(root, p), "utf8");

// RED 期这两个模块还不存在：容错导入，让其余断言各自独立失败而不是整文件挂掉。
const { callApi, apiErrorMessage, API_ERROR } = await import("../lib/api-client.js").catch(() => ({}));

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** 服务端返 HTML（未捕获异常逃出去）的响应：json() 必然抛 SyntaxError。 */
const htmlRes = (status = 500) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => {
    throw new SyntaxError("Unexpected token '<' in JSON at position 0");
  },
});
const jsonRes = (status, data = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => data });

/**
 * 每个组件 → 请求站点数 + 这些站点覆盖的操作名。
 * 操作名是用户能看见的那半句：保存失败 ≠ 发送失败 ≠ 评论失败，manage-box 一个站点分两态。
 */
const SITES = {
  "app/e/[id]/manage-box.jsx": { sites: 1, ops: ["结束", "取消"] },
  "app/e/[id]/edit-box.jsx": { sites: 2, ops: ["保存", "移除"] },
  "app/e/[id]/comments-box.jsx": { sites: 3, ops: ["发送评论", "保存评论", "删除评论"] },
  "app/events/new/page.jsx": { sites: 1, ops: ["创建"] },
};
/** invite-card 有 SPA-499 定的 E0 文案，不走 apiErrorMessage（见 test/invite.test.js 的断言）。 */
const INVITE_CARD = "app/invite-card.jsx";
const INVITE_COPY = "群列表拉取失败，稍后重试";
const ALL_LABELS = Object.values(SITES).flatMap((v) => v.ops);
const FIVE = [...Object.keys(SITES), INVITE_CARD];

describe("SPA-548 AC1：callApi 是共享出口，绝不 throw", () => {
  it("HTML 500 → 不抛，unreadable=true 且 ok=false", async () => {
    globalThis.fetch = async () => htmlRes(500);
    const r = await callApi("/api/events/e1");
    assert.deepEqual(r, { ok: false, status: 500, data: null, unreadable: true });
  });

  it("2xx + body 读不懂 ≠ 成功（unreadable 优先于 ok）", async () => {
    globalThis.fetch = async () => htmlRes(201);
    const r = await callApi("/api/events/e1");
    assert.equal(r.ok, false, "body 截断时服务端可能已落库，界面空白会让人再点一次");
    assert.equal(r.unreadable, true);
  });

  it("fetch 本身失败（TypeError）→ 不抛，status=0 + unreadable=true", async () => {
    globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };
    assert.deepEqual(await callApi("/api/events/e1"), { ok: false, status: 0, data: null, unreadable: true });
  });

  it("正常 JSON → 形状不变 { ok, status, data, unreadable }", async () => {
    globalThis.fetch = async () => jsonRes(200, { event: { id: "e1" } });
    assert.deepEqual(await callApi("/api/events/e1"), {
      ok: true,
      status: 200,
      data: { event: { id: "e1" } },
      unreadable: false,
    });
  });

  it("init 原样透传给 fetch（method / headers / body 不被改写）", async () => {
    let seen = null;
    globalThis.fetch = async (url, init) => {
      seen = { url, init };
      return jsonRes(200, {});
    };
    await callApi("/api/events/e1", { method: "PATCH", headers: { "X": "1" }, body: "{}" });
    assert.equal(seen.url, "/api/events/e1");
    assert.equal(seen.init.method, "PATCH");
    assert.equal(seen.init.body, "{}");
    assert.equal(seen.init.headers["X"], "1");
  });

  it("全前端只有一处 await fetch(（共享出口）", () => {
    const bare = src("lib/api-client.js").match(/await fetch\(/g) ?? [];
    assert.equal(bare.length, 1, `共享出口应只有一处 await fetch(，实际 ${bare.length}`);
  });
});

describe("SPA-548 AC2：5 个组件都不再有裸 res.json()", () => {
  for (const f of [...FIVE, "app/e/[id]/push-box.jsx"]) {
    it(`${f}：没有 .json()、没有自带 fetch()`, () => {
      const s = src(f);
      assert.ok(!/\.json\(\)/.test(s), `${f} 仍有裸 res.json()（HTML 500 会抛 SyntaxError）`);
      assert.ok(!/\bfetch\(/.test(s), `${f} 绕过 callApi 自己 fetch`);
    });
  }

  for (const f of FIVE) {
    it(`${f}：走 lib/api-client 的 callApi`, () => {
      const s = src(f);
      assert.ok(/from "@\/lib\/api-client"/.test(s), `${f} 未从 @/lib/api-client 引入`);
      assert.ok(s.includes("callApi("), `${f} 未调用 callApi`);
    });
  }

  it("push-box 只改 import：文案仍走推送专属的 pushErrorMessage", () => {
    const s = src("app/e/[id]/push-box.jsx");
    assert.ok(s.includes('from "@/lib/api-client"'), "push-box 应从共享出口取 callApi");
    assert.ok(s.includes('from "@/lib/push"'), "push-box 的推送文案仍归 lib/push.js 管");
    assert.ok(s.includes("pushErrorMessage("), "push-box 未使用 pushErrorMessage");
  });

  it("全 app/（不含路由层）不再有「网络错误 / 网络失败」这类甩锅文案", () => {
    for (const f of [...FIVE, "app/e/[id]/push-box.jsx"]) {
      const s = src(f);
      assert.ok(!s.includes("网络错误"), `${f} 仍把服务端崩溃说成客户端断网`);
      assert.ok(!s.includes("网络失败"), `${f} 仍把服务端崩溃说成客户端断网`);
    }
  });
});

describe("SPA-548 AC3：失败文案对得上该操作（服务端返回非 JSON 时）", () => {
  it("unreadable → 「<操作>失败：没有收到服务端的回复，请再试一次」", async () => {
    globalThis.fetch = async () => htmlRes(500);
    for (const op of ALL_LABELS) {
      const r = await callApi("/api/x", { method: "POST" });
      const msg = apiErrorMessage(r, op);
      assert.equal(msg, `${op}失败：没有收到服务端的回复，请再试一次`);
      assert.ok(!msg.includes("网络错误"), `${op} 的文案不该说客户端断网`);
    }
  });

  it("每个站点的文案都不同：保存失败不是发送失败，评论失败不是报名失败", () => {
    const texts = new Set(ALL_LABELS.map((op) => apiErrorMessage({ unreadable: true }, op)));
    assert.equal(texts.size, ALL_LABELS.length, `文案有复用：${JSON.stringify([...texts])}`);
    assert.notEqual(apiErrorMessage({ unreadable: true }, "保存"), apiErrorMessage({ unreadable: true }, "发送评论"));
  });

  it("拿到了 JSON 错误体 → 照传服务端的话，仍带操作名", () => {
    globalThis.fetch = async () => jsonRes(400, { error: "cap 小于当前参加人数" });
    return callApi("/api/x").then((r) => {
      assert.equal(apiErrorMessage(r, "保存"), "保存失败：cap 小于当前参加人数");
    });
  });

  it("JSON 错误体没有 error → 兜底也带操作名，不是空串", () => {
    const msg = apiErrorMessage({ ok: false, status: 400, data: {} }, "删除评论");
    assert.equal(msg, `删除评论失败：${API_ERROR.fallback}`);
    // SPA-549：前面已经拼了「删除评论失败：」，fallback 自己再说一遍「操作失败」就叠句了。
    assert.equal(msg.split("失败").length - 1, 1, `「失败」说了两遍：${msg}`);
    assert.ok(msg.length > 0);
  });

  it("成功 → 空串（不产生错误文案）", () => {
    assert.equal(apiErrorMessage({ ok: true, status: 200, data: { ok: 1 } }, "保存"), "");
  });

  for (const [f, { sites: want, ops }] of Object.entries(SITES)) {
    it(`${f}：${want} 个请求站点各自报了名（${ops.join("/")}）`, () => {
      const s = src(f);
      const sites = (s.match(/callApi\(/g) ?? []).length;
      const msgs = (s.match(/apiErrorMessage\(/g) ?? []).length;
      assert.equal(sites, want, `${f} 请求站点数与预期不符（${sites}）`);
      assert.equal(sites, msgs, `${f} 有 ${sites} 个请求站点但只接了 ${msgs} 个失败提示（没人接的 promise＝界面上什么都不发生）`);
      for (const op of ops) {
        assert.ok(s.includes(`"${op}"`), `${f} 的失败文案没有报出「${op}」这个操作名`);
      }
    });
  }

  it("comments-box 三处都补上了失败提示（改前连 catch 都没有）", () => {
    const s = src("app/e/[id]/comments-box.jsx");
    for (const op of ["发送评论", "保存评论", "删除评论"]) {
      assert.ok(s.includes(`"${op}"`), `评论的「${op}」失败没有提示`);
    }
    // 重试条直接用 apiErrorMessage 的整句，别再在外面套一层「发送失败：」造成叠句
    assert.ok(!s.includes("发送失败：{"), "重试条仍会叠成「发送失败：发送失败：…」");
  });

  it("invite-card：保留 SPA-499 的 E0 文案，且全文只有一处定义", () => {
    const s = src(INVITE_CARD);
    const hits = s.split(INVITE_COPY).length - 1;
    assert.equal(hits, 1, `E0 文案应在组件里只有一处定义（实际 ${hits} 处）`);
    assert.ok(s.includes("LOAD_ERROR"), "E0 文案应提成常量，别在 JSX 里再写一遍");
  });

  it("登录过期 / 拉取失败两态在非 JSON 响应下仍能分开", () => {
    const s = src(INVITE_CARD);
    const body = s.slice(s.indexOf("const load ="), s.indexOf("useEffect(() =>"));
    assert.ok(body.length > 0, "没找到 load 函数，测试本身该更新");
    assert.ok(body.includes("login_required") && body.includes("401"), "401/login_required 仍要走登录过期分支");
    assert.ok(body.includes("LOAD_ERROR"), "其余失败仍要落到 E0 文案");
  });
});
