// SPA-549：2xx、JSON 合法、但响应体里没有我要的字段——这条路以前是被 catch 接住的。
// SPA-545 起 callApi 不再 throw（#14 就把这两处的 try/catch 删了，删得对：传输失败不该靠 catch 接），
// 于是「2xx 但结构不对」从「有提示的失败」变成了裸的未处理 promise 拒绝：
//   comments-box 保存评论：抛在 setEditing(null) 之前 → editing.busy 永久停在 true，
//                          编辑框一直转圈、没有任何提示，用户只能刷新页面。
//   events/new 建事件：finally 会跑，按钮解锁，但页面上什么都不发生，也没有 err。
// AC1 缺字段按失败说话（该操作自己的文案），不叠句｜AC2 三处都接上了，busy 一定解开｜
// AC3 API_ERROR.fallback 不再说第二遍「失败」。
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./alias-loader.js", import.meta.url);

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = (p) => readFileSync(path.join(root, p), "utf8");

const { callApi, apiErrorMessage, fieldErrorMessage, API_ERROR } = await import("../lib/api-client.js").catch(() => ({}));

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const jsonRes = (status, data = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => data });

describe("SPA-549 AC1：2xx 但缺字段，按失败说话", () => {
  it("字段在 → 空串，调用方照常往下走", async () => {
    globalThis.fetch = async () => jsonRes(201, { comment: { id: "c1", body: "hi" } });
    const r = await callApi("/api/events/e1/comments", { method: "POST" });
    assert.equal(fieldErrorMessage(r, "comment", "发送评论"), "");
  });

  it("2xx 但缺 comment/event → 该操作自己的失败文案，不是空串", () => {
    for (const [field, op] of [["comment", "发送评论"], ["comment", "保存评论"], ["event", "创建"]]) {
      const msg = fieldErrorMessage({ ok: true, status: 200, data: {}, unreadable: false }, field, op);
      assert.ok(msg.length > 0, `${op}：2xx 缺 ${field} 却什么都没说`);
      assert.equal(msg, `${op}失败：${API_ERROR.fallback}`);
    }
  });

  it("2xx 但 body 是 JSON null / 数组 → 同样算缺，不许漏过去", () => {
    for (const data of [null, [], "ok", 42]) {
      assert.ok(fieldErrorMessage({ ok: true, status: 200, data }, "comment", "保存评论").length > 0, `data=${JSON.stringify(data)} 漏了`);
    }
  });

  it("根因：2xx + body 是字面量 null 时 data:null 但 ok 仍为 true（不落 UNPARSED 哨兵）", async () => {
    globalThis.fetch = async () => jsonRes(200, null);
    const r = await callApi("/api/events/e1/comments/c1");
    assert.deepEqual(r, { ok: true, status: 200, data: null, unreadable: false });
    // res.json() 解析成功、值就是 null，所以不算 unreadable——但调用点解引用一样会抛。
    // 取字段只有两条出路：?. 兜住，或先问 fieldErrorMessage。
    assert.throws(() => r.data.kind, TypeError);
  });

  it("字段值是 null / 空串 / 0 → 算缺（界面拿它没法渲染）", () => {
    for (const comment of [null, "", 0, false]) {
      assert.ok(
        fieldErrorMessage({ ok: true, status: 200, data: { comment } }, "comment", "保存评论").length > 0,
        `comment=${JSON.stringify(comment)} 被当成了有`,
      );
    }
  });

  it("文案按操作名分开：发送评论 ≠ 保存评论 ≠ 创建", () => {
    const ops = ["发送评论", "保存评论", "创建"];
    const texts = new Set(ops.map((op) => fieldErrorMessage({ ok: true, status: 200, data: {} }, "comment", op)));
    assert.equal(texts.size, ops.length, `文案有复用：${JSON.stringify([...texts])}`);
  });

  it("!ok → 空串：失败已经由 !r.ok 那条路报了，不在这里说第二遍", () => {
    const r = { ok: false, status: 400, data: {}, unreadable: false };
    assert.equal(fieldErrorMessage(r, "comment", "发送评论"), "");
  });

  it("unreadable → 空串：同理，apiErrorMessage 已经在 !r.ok 之后报过", () => {
    const r = { ok: false, status: 500, data: null, unreadable: true };
    assert.equal(fieldErrorMessage(r, "comment", "发送评论"), "");
  });

  it("缺字段不替服务端猜成没成：文案里不许出现「已保存」「已创建」这种断言", () => {
    const msg = fieldErrorMessage({ ok: true, status: 200, data: {} }, "comment", "保存评论");
    assert.ok(!/已(保存|创建|发送|删除)/.test(msg), `文案替服务端下了结论：${msg}`);
  });
});

describe("SPA-549 AC2：三处都接上了，没人接的 promise 不复存在", () => {
  const COMMENTS = "app/e/[id]/comments-box.jsx";
  const NEW = "app/events/new/page.jsx";
  /** 组件文件里每一处守卫的位置，从上往下按出现顺序返回。 */
  const guardsOf = (file) => {
    const s = src(file);
    return [...s.matchAll(/fieldErrorMessage\(r, "(\w+)", "([^"]+)"\)/g)].map((m) => ({ at: m.index, field: m[1], op: m[2], s }));
  };
  const between = (s, from, to) => s.slice(from, to === -1 ? s.length : to);

  it("工单点名的三处都接上了，没有第四处", () => {
    assert.deepEqual(
      [COMMENTS, NEW].flatMap((f) => guardsOf(f).map(({ field, op }) => `${f} ${op} → ${field}`)),
      [
        `${COMMENTS} 发送评论 → comment`,
        `${COMMENTS} 保存评论 → comment`,
        `${NEW} 创建 → event`,
      ],
    );
  });

  it("comments-box / send：守卫排在 upsertLocal(r.data.comment) 之前", () => {
    const s = src(COMMENTS);
    const body = between(s, s.indexOf("async function send("), s.indexOf("function onSend("));
    const guard = body.indexOf('fieldErrorMessage(r, "comment", "发送评论")');
    const deref = body.indexOf("upsertLocal(r.data.comment)");
    assert.ok(guard > -1, "send 没问「comment 在不在」就 upsertLocal(r.data.comment)");
    assert.ok(deref > -1 && guard < deref, "守卫必须排在取字段之前，否则还是裸的未处理拒绝");
  });

  it("comments-box / saveEdit：守卫排在 r.data.comment 之前，且把 busy 解开", () => {
    const s = src(COMMENTS);
    const body = between(s, s.indexOf("async function saveEdit("), s.indexOf("async function confirmDelete("));
    const guard = body.indexOf('fieldErrorMessage(r, "comment", "保存评论")');
    const deref = body.indexOf("r.data.comment");
    assert.ok(guard > -1, "saveEdit 没问「comment 在不在」就 const c = r.data.comment");
    assert.ok(deref > -1 && guard < deref, "守卫必须排在取字段之前");
    // 编辑框卡死就是这么来的：抛在 setEditing(null) 之前，busy 再没人改。
    const branch = body.slice(guard, deref);
    assert.ok(/busy: false/.test(branch), "守卫分支没有把 editing.busy 置回 false（编辑框会永远转圈）");
    assert.ok(/err:/.test(branch), "守卫分支没有把失败文案挂到 editing.err 上（用户看不到任何提示）");
  });

  it("events/new：守卫排在 r.data.event.id 之前，且落进 err", () => {
    const s = src(NEW);
    const body = between(s, s.indexOf("async function submit("), s.indexOf("const clamp ="));
    const guard = body.indexOf('fieldErrorMessage(r, "event", "创建")');
    const deref = body.indexOf("r.data.event.id");
    assert.ok(guard > -1, "submit 没问「event 在不在」就 setCreatedId(r.data.event.id)");
    assert.ok(deref > -1 && guard < deref, "守卫必须排在取字段之前");
    assert.ok(/setErr\(/.test(body.slice(guard, deref)), "守卫分支没有 setErr（按钮解锁后页面上什么都不发生）");
  });

  it("每一处守卫都跑在 !r.ok 分支之后，失败不会被报两遍", () => {
    for (const f of [COMMENTS, NEW]) {
      for (const { at, op, s } of guardsOf(f)) {
        const notOk = s.lastIndexOf("if (!r.ok)", at);
        assert.ok(notOk > -1, `${f}「${op}」的守卫跑在了 !r.ok 分支之前，传输失败会走不到它`);
        assert.ok(
          s.slice(notOk, at).includes("return;"),
          `${f}「${op}」的 !r.ok 分支没 return，两条失败路径会连着报`,
        );
      }
    }
  });

  it("删评论那处不用守卫：它只比较 r.data?.kind，不解引用", () => {
    const s = src(COMMENTS);
    assert.ok(s.includes('r.data?.kind === "soft"'), "删评论仍按 kind 分软删/硬删");
    assert.ok(!/r\.data\.kind\./.test(s), "kind 是比较用的，不该再往上解一层");
  });

  /**
   * 钉的是「这个解引用有保护」，不是源码里出现了 ?. 这两个字符——
   * 用 s.includes 钉可选字符，会把正确的修法当成回归挡下来。
   * 只扫本票涉及的这两个文件：push-box / edit-box / invite-card 归 SPA-550。
   */
  it("不留裸解引用：r.data.<字段> 要么有 ?.，要么前面有 fieldErrorMessage", () => {
    for (const f of [COMMENTS, NEW]) {
      const s = src(f);
      for (const m of s.matchAll(/\br\.data(\??)\.(\w+)/g)) {
        const [deref, opt, field] = [m[0], m[1], m[2]];
        if (opt) continue;
        const guard = s.lastIndexOf(`fieldErrorMessage(r, "${field}",`, m.index);
        assert.ok(guard > -1, `${f} 的 ${deref} 是裸解引用：data 可能是 null（2xx + 字面量 null body），会抛`);
      }
    }
  });
});

describe("SPA-549 AC3：兜底文案不叠句", () => {
  it("API_ERROR.fallback 自己不带「失败」", () => {
    assert.ok(!API_ERROR.fallback.includes("失败"), `apiErrorMessage 前面已经拼了「<操作>失败：」：${API_ERROR.fallback}`);
  });

  it("兜底句整串不叠：<操作>失败：原因不明，请再试一次", () => {
    for (const op of ["保存", "发送评论", "保存评论", "删除评论", "创建", "结束", "取消", "移除"]) {
      const msg = apiErrorMessage({ ok: false, status: 400, data: {} }, op);
      assert.equal(msg, `${op}失败：原因不明，请再试一次`);
      assert.equal(msg.split("失败").length - 1, 1, `「失败」说了两遍：${msg}`);
    }
  });

  it("服务端带了 error 就照传它的话，不被兜底覆盖", () => {
    assert.equal(apiErrorMessage({ ok: false, data: { error: "cap 小于当前参加人数" } }, "保存"), "保存失败：cap 小于当前参加人数");
  });

  it("推送自己的 PUSH_ERROR.fallback 归 lib/push.js 管，这张票不动它", async () => {
    const { PUSH_ERROR } = await import("../lib/push.js");
    assert.equal(PUSH_ERROR.fallback, "发送失败");
    assert.notEqual(PUSH_ERROR.fallback, API_ERROR.fallback, "推送的兜底不该跟着通用兜底一起改");
  });
});
