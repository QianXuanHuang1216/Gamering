import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.SESSION_SECRET = "test-secret";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = (p) => readFileSync(path.join(root, p), "utf8");

/** SPA-501：全站可达的退出入口 + 清 cookie 属性对齐。RED 先行。 */
describe("SPA-501 logout", () => {
  it("clearSessionCookie 与 sessionCookie 属性对齐（SameSite/HttpOnly/Path + https Secure）", async () => {
    const prev = process.env.SITE_URL;
    try {
      process.env.SITE_URL = "https://gamering.example.com";
      const { sessionCookie, clearSessionCookie } = await import("../lib/session.js?spa501-https");
      const set = sessionCookie("v");
      const clear = clearSessionCookie();
      assert.ok(clear.includes("gamer_session="), "应清除 gamer_session");
      assert.ok(clear.includes("Path=/"), "清除头应含 Path=/");
      assert.ok(clear.includes("HttpOnly"), "清除头应含 HttpOnly");
      assert.ok(clear.includes("SameSite=Lax"), "清除头应含 SameSite=Lax（与写入对齐）");
      assert.ok(clear.includes("Max-Age=0"), "清除头应 Max-Age=0");
      assert.ok(clear.includes("Secure"), "https 下清除头应带 Secure（与写入对齐）");
      assert.ok(set.includes("SameSite=Lax"), "写入头应含 SameSite=Lax");
    } finally {
      process.env.SITE_URL = prev;
    }
  });

  it("http 下 clear/set 均不带 Secure（行为一致）", async () => {
    const prev = process.env.SITE_URL;
    try {
      process.env.SITE_URL = "http://localhost:3000";
      const { sessionCookie, clearSessionCookie } = await import("../lib/session.js?spa501-http");
      assert.ok(!sessionCookie("v").includes("Secure"), "http 写入不应带 Secure");
      assert.ok(!clearSessionCookie().includes("Secure"), "http 清除不应带 Secure");
      assert.ok(clearSessionCookie().includes("SameSite=Lax"), "http 清除仍应含 SameSite=Lax");
    } finally {
      process.env.SITE_URL = prev;
    }
  });

  it("退出路由 302 回 / 且 Set-Cookie 走 clearSessionCookie", () => {
    const route = src("app/api/auth/logout/route.js");
    assert.ok(route.includes("302"), "退出路由应 302");
    assert.ok(route.includes("clearSessionCookie"), "退出路由应使用 clearSessionCookie");
    assert.ok(route.includes("Location"), "退出路由应带 Location 跳转");
  });

  it("顶栏已登录态有退出入口（指向 /api/auth/logout）", () => {
    const layout = src("app/layout.jsx");
    assert.ok(layout.includes("/api/auth/logout"), "顶栏已登录态应有指向 /api/auth/logout 的退出入口");
    assert.ok(layout.includes("退出"), "顶栏退出入口文案应含“退出”");
  });

  it("首页卡片现有退出保留", () => {
    const page = src("app/page.jsx");
    assert.ok(page.includes("/api/auth/logout"), "首页卡片应保留退出链接");
  });
});
