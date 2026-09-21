import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = (p) => readFileSync(path.join(root, p), "utf8");

/** SPA-497 P2 polish：纯样式断言，逻辑/API 不动。 */
describe("SPA-497 P2 polish", () => {
  it("P2-1：.scrolled 有 scroll 监听接线（非死样式）", () => {
    const css = src("app/globals.css");
    assert.ok(css.includes(".app-topbar.scrolled"), "globals.css 应保留 .scrolled 滚动态");
    const layout = src("app/layout.jsx");
    const topbar = (() => {
      try {
        return src("app/topbar-scrolled.jsx");
      } catch {
        return "";
      }
    })();
    const wired = layout.includes("TopbarScrolled") || layout.includes("scroll");
    assert.ok(wired, "layout.jsx 应接上 scroll 监听（TopbarScrolled 或 scroll listener）");
    assert.ok(topbar.includes("scroll") && topbar.includes("scrolled"), "topbar-scrolled.jsx 应切换 .scrolled");
  });

  it("P2-2：未登录零导航在稿有注（代码注释说明设计意图）", () => {
    const nav = src("app/nav.jsx");
    assert.ok(nav.includes("if (!loggedIn) return null"), "未登录仍 return null（现状可接受，保持）");
    assert.ok(nav.includes("未登录") || nav.includes("顶栏"), "nav.jsx 应注释说明未登录无底导航的设计意图");
  });

  it("P2-3：空态齐全（各 Tab event_busy + CTA / 选群空态）", () => {
    const tabs = src("app/me/tabs-box.jsx");
    assert.ok(tabs.includes("event_busy"), "Tabs 空态应有 event_busy 插画");
    assert.ok(tabs.includes("/events/new"), "scheduled 空态应有创建事件 CTA");
    for (const t of ["scheduled", "live", "ended", "cancelled"]) {
      assert.ok(tabs.includes(t), `Tabs 应覆盖 ${t} 空态`);
    }
    const push = src("app/e/[id]/push-box.jsx");
    assert.ok(push.includes("push-empty-guilds"), "选群空态应存在");
  });

  it("P2-4：桌面 Modal 无 grab 条（min-width:600px 隐藏）", () => {
    const css = src("app/globals.css");
    assert.ok(css.includes(".sheet .grab"), "grab 条样式应存在（bottom sheet 用）");
    const m = css.match(/@media\s*\(min-width:\s*600px\)\s*\{[^@]*\.sheet\s+\.grab\s*\{\s*display:\s*none/);
    assert.ok(m, "600px+ 断点应隐藏 .sheet .grab（桌面 dialog 无 grab handle）");
  });

  it("P2-5：占位行与真人行视觉可辨（variant 色或小 Label）", () => {
    const page = src("app/e/[id]/page.jsx");
    assert.ok(page.includes("占位"), "占位行应存在");
    const distinguished =
      page.includes("chip-label") && page.includes("on-surface-variant");
    assert.ok(distinguished, "占位行应用 on-surface-variant 色并加占位小 Label");
  });
});
