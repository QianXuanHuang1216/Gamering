// SPA-550：#16（comments-box / events/new）之外的另外三处，2xx 但响应体缺字段/null。
//
// callApi 不 throw 之后（#14 删对了那两处的 try/catch），「2xx + JSON 合法 + 缺字段」
// 从「有提示的失败」变成了裸的未处理 promise 拒绝。这三处比 #16 的两处更靠后：
//
//   edit-box:106   r.data.promotedId  抛在 setRemoved 之后——人已经从名单里消失、
//                  父组件没刷新、提示条不出现。状态停在中间，比「什么都不发生」更难查
//   invite-card:39 r.data.guilds      :35 的 r.data?.error 挡不住 r.data 本身是 null
//                  （undefined 为假，直接落到 :39 抛）
//   push-box:36/37 setGuilds(r.data.guilds) → guilds 变 undefined → :141/:156 的
//                  guilds.length 在渲染期抛，整页白掉；:30 的 guilds !== null 还会让它不再重拉
//   push-box:54/55 setChannels(r.data.channels) → :190 的 channels.map 渲染期抛
//
// AC1 必需字段有守卫（fieldErrorMessage），可选字段用 ?. 而不是守卫
// AC2 渲染期不可能再拿到 undefined（state 的取值域被守卫锁住）
// AC3 行为：stub 返 {ok:true,data:{}} 时，说出的是该操作自己的文案
// AC4 可选字段不许套 fieldErrorMessage：它会把「本来就没有」当成失败
// AC5 守卫的消息要真能到用户眼前
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./alias-loader.js", import.meta.url);

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = (p) => readFileSync(path.join(root, p), "utf8");

const { callApi, fieldErrorMessage, API_ERROR } = await import("../lib/api-client.js").catch(() => ({}));

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const PUSH = "app/e/[id]/push-box.jsx";
const EDIT = "app/e/[id]/edit-box.jsx";
const INVITE = "app/invite-card.jsx";
const THREE = [EDIT, INVITE, PUSH];

/** 2xx + 合法 JSON + 一个字段都没有（甚至整个 body 是 null）。 */
const SHAPELESS = [
  { status: 200, data: {} },
  { status: 200, data: null },
  { status: 201, data: { guilds: undefined } },
];

/** 组件文件里每一处 fieldErrorMessage 守卫：位置、字段、操作名。 */
const guardsOf = (file) => {
  const s = src(file);
  return [...s.matchAll(/fieldErrorMessage\(r, "(\w+)", "([^"]+)"\)/g)].map((m) => ({ at: m.index, field: m[1], op: m[2], s }));
};
const between = (s, from, to) => s.slice(from, to === -1 ? s.length : to);
const body = (file, from, to) => between(src(file), src(file).indexOf(from), src(file).indexOf(to));

describe("SPA-550 AC1：三处都接上了（push-box / edit-box / invite-card）", () => {
  it("工单点名的守卫一处不少", () => {
    assert.deepEqual(
      THREE.flatMap((f) => guardsOf(f).map(({ field, op }) => `${f} ${op} → ${field}`)),
      [
        `${INVITE} 拉取群列表 → guilds`,
        `${PUSH} 拉取群列表 → guilds`,
        `${PUSH} 读取频道 → channels`,
      ],
    );
  });

  it("push-box / 拉群列表：守卫排在 setGuilds 之前，且分支里 return", () => {
    const b = body(PUSH, 'callApi("/api/guilds")', "callApi(`/api/events/${id}`)");
    const guard = b.indexOf('fieldErrorMessage(r, "guilds", "拉取群列表")');
    const set = b.indexOf("setGuilds(");
    assert.ok(guard > -1, "拉群列表没问「guilds 在不在」就 setGuilds");
    assert.ok(set > -1 && guard < set, "守卫必须排在 setGuilds 之前");
    assert.ok(/return;/.test(b.slice(guard, set)), "守卫分支没有 return，会照旧把 undefined 存进 state");
    assert.ok(!b.slice(guard, set).includes("setInvite("), "setInvite 也得在守卫之后");
  });

  it("push-box / 读频道：守卫排在 setChannels 之前，且不进 step 2", () => {
    const b = body(PUSH, "async function pickGuild(", "/**\n   * SPA-546");
    const guard = b.indexOf('fieldErrorMessage(r, "channels", "读取频道")');
    const set = b.indexOf("setChannels(");
    const step = b.indexOf("setStep(2)");
    assert.ok(guard > -1, "读频道没问「channels 在不在」就 setChannels");
    assert.ok(set > -1 && guard < set, "守卫必须排在 setChannels 之前");
    assert.ok(step > -1 && guard < step, "守卫必须排在 setStep(2) 之前，否则会进到 channels.map 的渲染分支");
    assert.ok(/return;/.test(b.slice(guard, set)), "守卫分支没有 return");
  });

  it("invite-card：守卫排在 setGuilds 之前（r.data?.error 挡不住 data 本身是 null）", () => {
    const b = body(INVITE, "const load =", "useEffect(() =>");
    const guard = b.indexOf('fieldErrorMessage(r, "guilds", "拉取群列表")');
    const use = b.indexOf("r.data.guilds");
    assert.ok(guard > -1, "拉群列表没问「guilds 在不在」");
    assert.ok(guard < use, "守卫必须排在 r.data.guilds 之前");
    assert.ok(/return;/.test(b.slice(guard, use)), "守卫分支没有 return");
  });
});

describe("SPA-550 AC2：渲染期不可能再拿到 undefined", () => {
  it("push-box / guilds：state 的取值域被锁成 null 或数组", () => {
    const s = src(PUSH);
    assert.equal(
      (s.match(/setGuilds\(/g) ?? []).length,
      1,
      "setGuilds 只该被调用一次：多一个调用点就多一条能塞进 undefined 的路",
    );
    assert.ok(s.includes("useState(null)"), "guilds 初值必须是 null（加载态），不是 undefined");
    // 三处渲染期解引用（空态 / 列表 / map）都得挂在 guilds 的 null 检查之后
    const lines = s.split("\n");
    const derefs = lines
      .map((text, i) => [i + 1, text])
      .filter(([, text]) => /guilds\.(length|map)\b/.test(text))
      .map(([n]) => n);
    assert.ok(derefs.length >= 3, `guilds 的渲染期解引用只剩 ${derefs.length} 处，测试该更新了`);
    for (const n of derefs) {
      assert.ok(
        lines[n - 1].includes("guilds !== null") || lines[n - 1].includes("guilds === null"),
        `push-box 第 ${n} 行在没查 null 的分支里解引用了 guilds`,
      );
    }
  });

  it("push-box / channels：只有过了守卫才会被赋值", () => {
    const b = body(PUSH, "async function pickGuild(", "/**\n   * SPA-546");
    const guard = b.indexOf('fieldErrorMessage(r, "channels", "读取频道")');
    const set = b.indexOf("setChannels(");
    assert.ok(b.slice(0, guard).indexOf("setChannels(") === -1, "守卫之前不该有 setChannels");
    assert.equal((b.match(/setChannels\(/g) ?? []).length, 1, "setChannels 只该被调用一次");
  });

  it("invite-card：guilds 的渲染期解引用都在 null 检查之后", () => {
    const s = src(INVITE);
    for (const m of s.matchAll(/guilds\.(length|map|filter)/g)) {
      const line = s.slice(0, m.index).split("\n").length;
      const text = s.split("\n")[line - 1];
      assert.ok(
        text.includes("guilds !== null") || text.includes("guilds === null"),
        `invite-card 第 ${line} 行在没查 null 的情况下解引用了 guilds`,
      );
    }
  });

  it("全 app/（组件层）不再有裸的 r.data.<字段> 解引用", () => {
    for (const f of THREE) {
      const s = src(f);
      for (const m of s.matchAll(/\br\.data(\??)\.(\w+)/g)) {
        const [deref, opt, field] = [m[0], m[1], m[2]];
        if (opt) continue;
        const guard = s.lastIndexOf(`fieldErrorMessage(r, "${field}",`, m.index);
        assert.ok(guard > -1, `${f} 的 ${deref} 是裸解引用：data 可能是 null（2xx + 字面量 null body）`);
      }
    }
  });
});

describe("SPA-550 AC3：stub 返 {ok:true,data:{}} 时说的是该操作自己的话", () => {
  it("push-box 两个守卫：拉群列表 / 读频道 文案各不相同，都不是空串", async () => {
    globalThis.fetch = async () => ({ status: 200, ok: true, json: async () => ({}) });
    const r = await callApi("/api/guilds");
    assert.deepEqual(r, { ok: true, status: 200, data: {}, unreadable: false });
    const texts = new Set(["拉取群列表", "读取频道"].map((op) => fieldErrorMessage(r, fieldOf(op), op)));
    assert.equal(texts.size, 2, "两个操作复用了同一句文案");
    for (const t of texts) {
      assert.ok(t.length > 0, "守卫说了等于没说");
      assert.ok(!t.includes("网络错误"), "守卫文案不该把服务端的锅甩给客户端网络");
    }
  });

  for (const { data } of SHAPELESS) {
    it(`data=${JSON.stringify(data)}：两个守卫都拦得住`, () => {
      for (const [field, op] of [["guilds", "拉取群列表"], ["channels", "读取频道"]]) {
        const msg = fieldErrorMessage({ ok: true, status: 200, data }, field, op);
        assert.equal(msg, `${op}失败：${API_ERROR.fallback}`, `${field}（${op}）漏过去了`);
      }
    });
  }

  it("字段在 → 守卫放行（空数组是合法的「一个群都没有」，不能当成失败）", () => {
    assert.equal(fieldErrorMessage({ ok: true, status: 200, data: { guilds: [] } }, "guilds", "拉取群列表"), "");
    assert.equal(fieldErrorMessage({ ok: true, status: 200, data: { channels: [] } }, "channels", "读取频道"), "");
  });

  it("!ok / unreadable → 守卫不插嘴（传输失败已经由 pushErrorMessage 报过）", () => {
    assert.equal(fieldErrorMessage({ ok: false, status: 500, data: null, unreadable: true }, "guilds", "拉取群列表"), "");
  });
});

describe("SPA-550 AC4：可选字段用 ?. ，不许套 fieldErrorMessage", () => {
  it("promotedId 是可选的：路由只在真的移除时才带这个键（没人递补时是 null）", () => {
    const route = src("app/api/events/[id]/route.js");
    assert.ok(
      /\.\.\.\(removed \? \{ removed:.*promotedId.*\} : \{\}\)/.test(route),
      "promotedId 本来就是条件字段——上游形状变了这条会先报",
    );
  });

  it("edit-box 用 ?. 读它：没递补是常态，报成失败才是 bug", () => {
    const s = src(EDIT);
    assert.ok(s.includes("r.data?.promotedId"), "promotedId 必须用 ?. 读");
    assert.equal(
      guardsOf(EDIT).filter((g) => g.field === "promotedId").length,
      0,
      "套了 fieldErrorMessage：没人被递补的时候（promotedId 缺失）会被报成「移除失败」",
    );
  });

  it("sendable 同样是可选的：查不到就是「不知道」，不是「不能发」", () => {
    const s = src(PUSH);
    assert.ok(s.includes("r.data?.sendable"), "sendable 用 ?. 读");
    assert.equal(
      guardsOf(PUSH).filter((g) => g.field === "sendable").length,
      0,
      "套了 fieldErrorMessage：sendable 缺失会被报成「读取频道失败」",
    );
  });

  it("?. 之后不会抛：2xx + 字面量 null body 也能把移除做完", () => {
    const s = src(EDIT);
    const b = body(EDIT, "async function confirmRemove(", "function cancel(");
    assert.ok(!/r\.data\.promotedId/.test(b), "confirmRemove 里还有裸解引用");
    assert.equal(
      (b.match(/r\.data\?\.promotedId/g) ?? []).length,
      1,
      "读一次就够：读两次就又有了第二次解引用的机会",
    );
  });
});

describe("SPA-550 AC5：守卫的消息要真能到用户眼前", () => {
  it("invite-card 的错误块渲染的是 err，不是写死的常量", () => {
    const s = src(INVITE);
    const block = between(s, s.indexOf('data-testid="home-invite-error"'), s.indexOf("home-invite-empty"));
    assert.ok(block.includes("{err}"), "错误块写死了 LOAD_ERROR：守卫的话说了也白说");
    assert.ok(!block.includes(">群列表拉取失败"), "错误块里仍有第二处用户可见文案");
  });

  it("push-box 的守卫分支把消息挂到 msg（sheet 里的 role=alert）", () => {
    const s = src(PUSH);
    assert.ok(s.includes('role="alert"'), "msg 没有渲染成 alert，守卫的话用户看不见");
    const b = body(PUSH, 'callApi("/api/guilds")', "callApi(`/api/events/${id}`)");
    const guard = b.indexOf('fieldErrorMessage(r, "guilds", "拉取群列表")');
    assert.ok(/setMsg\(missing\)/.test(b.slice(guard)), "守卫分支没有 setMsg");
  });

  it("push-box 拉群列表失败时 state 留在 null（加载态），不会变成假空态", () => {
    const b = body(PUSH, 'callApi("/api/guilds")', "callApi(`/api/events/${id}`)");
    const guard = b.indexOf('fieldErrorMessage(r, "guilds", "拉取群列表")');
    const branch = b.slice(guard, b.indexOf("setGuilds("));
    assert.ok(!branch.includes("setGuilds("), "守卫分支把 guilds 写成了别的值");
    assert.ok(!branch.includes("setGuilds([])"), "拿空数组顶替 = 骗用户说「Bot 一个群都没进」");
  });
});

function fieldOf(op) {
  return op === "拉取群列表" ? "guilds" : "channels";
}
