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

/**
 * 去掉注释再扫。断言说的是代码，注释里出现同样的字样不算数——
 * 我自己写注释解释「别 setStep(2)」，就被自己那条断言挡下来了。
 * `[^:]` 是为了不把 https:// 里的双斜杠当注释起点。
 */
const code = (file) =>
  src(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
const body = (file, from, to) => between(code(file), code(file).indexOf(from), code(file).indexOf(to));

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

describe("SPA-550 AC2：state 的取值域被锁住，渲染期不可能拿到 undefined", () => {
  /**
   * 渲染期会解引用 guilds.length / guilds.map / channels.map，所以这两个 state
   * 的取值域必须只有「null 或数组」。这里不去逐行扫 JSX（条件会折行，逐行扫必假警报），
   * 而是钉住真正撑住这个不变量的三件事：初值是 null、写入点唯一、写入前有守卫且守卫会 return。
   * 三者合起来 → guilds/channels 要么是 null，要么是过了守卫的数组，永远不是 undefined。
   */
  const STATE = [
    { f: PUSH, var: "guilds", field: "guilds", op: "拉取群列表" },
    { f: PUSH, var: "channels", field: "channels", op: "读取频道" },
    { f: INVITE, var: "guilds", field: "guilds", op: "拉取群列表" },
  ];

  for (const { f, var: name, field, op } of STATE) {
    it(`${f} / ${name}：初值 null + 唯一写入点 + 写入前有会 return 的守卫`, () => {
      const s = code(f);
      const writes = [...s.matchAll(new RegExp(`set${name[0].toUpperCase()}${name.slice(1)}\\(`, "g"))];
      assert.equal(writes.length, 1, `${name} 有 ${writes.length} 个写入点：每多一个就多一条塞 undefined 的路`);
      const write = writes[0].index;
      const guard = s.lastIndexOf(`fieldErrorMessage(r, "${field}", "${op}")`, write);
      assert.ok(guard > -1, `${name} 的写入点前面没有 fieldErrorMessage(r, "${field}", …) 守卫`);
      assert.ok(guard < write, `${name}：守卫必须排在写入之前`);
      assert.ok(/return;/.test(s.slice(guard, write)), `${name}：守卫分支没有 return，照旧会写进去`);
    });
  }

  it("push-box / guilds：守卫失败时停在加载态，不拿空数组顶替（那是「一个群都没进」）", () => {
    const s = code(PUSH);
    const b = between(s, s.indexOf('callApi("/api/guilds")'), s.indexOf("callApi(`/api/events/${id}`)"));
    const guard = b.indexOf('fieldErrorMessage(r, "guilds", "拉取群列表")');
    const branch = b.slice(guard, b.indexOf("setGuilds("));
    assert.ok(!branch.includes("setGuilds("), "守卫分支把 guilds 写成了别的值");
    assert.ok(s.includes("useState(null)"), "guilds 初值必须是 null（加载态）");
  });

  it("全 app/（组件层）不再有裸的 r.data.<字段> 解引用", () => {
    for (const f of THREE) {
      const s = code(f);
      for (const m of s.matchAll(/\br\.data(\??)\.(\w+)/g)) {
        const [deref, opt, field] = [m[0], m[1], m[2]];
        if (opt) continue;
        const guard = s.lastIndexOf(`fieldErrorMessage(r, "${field}",`, m.index);
        assert.ok(guard > -1, `${f} 的 ${deref} 是裸解引用：data 可能是 null（2xx + 字面量 null body）`);
      }
    }
  });

  it("可选字段一律 ?. ：invite_url / sendable / promotedId / preview", () => {
    for (const [f, expr] of [
      [INVITE, "r.data?.invite_url"],
      [PUSH, "r.data?.invite_url"],
      [PUSH, "r.data?.sendable"],
      [EDIT, "r.data?.promotedId"],
      [PUSH, "r.data?.event"],
    ]) {
      assert.ok(code(f).includes(expr), `${f} 的可选字段该用 ?. ：${expr}`);
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
    const s = code(EDIT);
    assert.ok(s.includes("r.data?.promotedId"), "promotedId 必须用 ?. 读");
    assert.equal(
      guardsOf(EDIT).filter((g) => g.field === "promotedId").length,
      0,
      "套了 fieldErrorMessage：没人被递补的时候（promotedId 缺失）会被报成「移除失败」",
    );
  });

  it("sendable 同样是可选的：查不到就是「不知道」，不是「不能发」", () => {
    const s = code(PUSH);
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
    const s = code(INVITE);
    const block = between(s, s.indexOf('data-testid="home-invite-error"'), s.indexOf("home-invite-empty"));
    assert.ok(block.includes("{err}"), "错误块写死了 LOAD_ERROR：守卫的话说了也白说");
    assert.ok(!block.includes(">群列表拉取失败"), "错误块里仍有第二处用户可见文案");
  });

  it("push-box 的守卫分支把消息挂到 msg（sheet 里的 role=alert）", () => {
    const s = code(PUSH);
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
