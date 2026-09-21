import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.DISCORD_CLIENT_ID = "1551430375874633810";
process.env.SESSION_SECRET = "test-secret";
process.env.SITE_URL = "https://site";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = (p) => readFileSync(path.join(root, p), "utf8");

/** SPA-499：主页邀请 Bot 入口（登录前置+列表+异常态）。RED 先行。 */
describe("SPA-499 invite helpers", () => {
  it("botInviteLink 参数与约定一致（client_id/scope/permissions=19456）", async () => {
    const { botInviteLink } = await import("../lib/discord-rest.js");
    const u = new URL(botInviteLink());
    assert.equal(u.hostname, "discord.com");
    assert.equal(u.searchParams.get("client_id"), "1551430375874633810");
    assert.equal(u.searchParams.get("scope"), "bot applications.commands");
    assert.equal(u.searchParams.get("permissions"), "19456");
  });

  it("isSafeNextPath：只放行站内路径，默认回 /me", async () => {
    const { isSafeNextPath, resolveNext } = await import("../lib/invite.js");
    assert.equal(isSafeNextPath("/?invite=1"), true);
    assert.equal(isSafeNextPath("/me"), true);
    assert.equal(isSafeNextPath("https://evil.com"), false);
    assert.equal(isSafeNextPath("//evil.com"), false);
    assert.equal(isSafeNextPath("/\\evil"), false);
    assert.equal(isSafeNextPath(""), false);
    assert.equal(isSafeNextPath(null), false);
    assert.equal(resolveNext("/?invite=1"), "/?invite=1");
    assert.equal(resolveNext("https://evil.com"), "/me");
    assert.equal(resolveNext(null), "/me");
  });

  it("loginHref：登录前置透传 next，不丢上下文", async () => {
    const { loginHref } = await import("../lib/invite.js");
    assert.equal(loginHref("/?invite=1"), "/api/auth/login?next=%2F%3Finvite%3D1");
    assert.equal(loginHref(null), "/api/auth/login");
  });

  it("guild 列表：按 id 去重 + 头像 URL + 新服 diff + 截断", async () => {
    const { guildIconUrl, dedupeGuilds, diffNewGuilds, visibleGuilds } = await import("../lib/invite.js");
    assert.equal(guildIconUrl({ id: "g1", icon: "h" }), "https://cdn.discordapp.com/icons/g1/h.png?size=64");
    assert.equal(guildIconUrl({ id: "g1", icon: null }), null);
    const dup = dedupeGuilds([
      { id: "a", name: "A" },
      { id: "a", name: "A2" },
      { id: "b", name: "B" },
    ]);
    assert.deepEqual(dup.map((g) => g.id), ["a", "b"]);
    assert.equal(dup[0].name, "A");
    const fresh = diffNewGuilds([{ id: "a" }], [{ id: "a" }, { id: "b", name: "B" }]);
    assert.deepEqual(fresh.map((g) => g.id), ["b"]);
    const six = [1, 2, 3, 4, 5, 6].map((i) => ({ id: `g${i}`, name: `G${i}` }));
    const v = visibleGuilds(six, 5);
    assert.equal(v.shown.length, 5);
    assert.equal(v.hiddenCount, 1);
    const all = visibleGuilds(six, 10);
    assert.equal(all.hiddenCount, 0);
  });
});

describe("SPA-499 homepage invite card", () => {
  it("S0 未登录：邀请卡常驻 + 登录前置 next 透传", () => {
    const page = src("app/page.jsx");
    assert.ok(page.includes("home-invite-card"), "主页应有 data-testid=home-invite-card");
    assert.ok(
      page.includes("/api/auth/login?next=") || (page.includes("loginHref") && page.includes("/?invite=1")),
      "未登录邀请入口应透传 next（loginHref('/?invite=1')）",
    );
    assert.ok(page.includes("登录后邀请 Bot"), "S0 主按钮文案应为“登录后邀请 Bot”");
    assert.ok(page.includes("id=\"invite\"") || page.includes('id="invite"'), "应有 #invite 锚点供回跳聚焦");
  });

  it("S1 已登录未装：权限一句话 + 一键邀请外链（新标签页）", () => {
    assert.ok(existsSync(path.join(root, "app/invite-card.jsx")), "应有 app/invite-card.jsx 客户端组件");
    const card = src("app/invite-card.jsx");
    assert.ok(card.includes("home-invite-empty"), "S1 空态应有 home-invite-empty");
    assert.ok(card.includes("19456"), "S1 应有一句话权限说明（含 19456）");
    assert.ok(card.includes("一键邀请 Bot"), "S1 主按钮文案应为“一键邀请 Bot”");
    assert.ok(card.includes('target="_blank"'), "邀请外链应在新标签页打开");
  });

  it("S2 已安装：列表 + 再加一个 + 按 id 去重 + 超 5 截断", () => {
    const card = src("app/invite-card.jsx");
    assert.ok(card.includes("home-invite-list"), "S2 列表应有 home-invite-list");
    assert.ok(card.includes("再加一个"), "S2 应有“再加一个服务器”次按钮");
    assert.ok(card.includes("check_circle"), "S2 行尾应有 check_circle（Bot 已在语义）");
    assert.ok(card.includes("+N") || card.includes("hiddenCount") || card.includes("avatar-more"), "超 5 个群应截断 +N");
  });

  it("异常态：E0 重试 / E1 取消中性条 / E3 去重成功条", () => {
    const card = src("app/invite-card.jsx");
    assert.ok(card.includes("重试"), "E0/E1 应有重试");
    assert.ok(card.includes("已取消邀请，可随时重试"), "E1 取消文案应为中性“已取消邀请，可随时重试”");
    assert.ok(card.includes("群列表拉取失败，稍后重试"), "E0 文案应复用“群列表拉取失败，稍后重试”");
    assert.ok(card.includes("直接去推送吧") || card.includes("去推送"), "E3 成功条应带“去推送” action");
  });

  it("后端：guilds 常返 invite_url；login/callback 支持 next 白名单回跳", () => {
    const guilds = src("app/api/guilds/route.js");
    assert.ok(!guilds.includes("guilds.length === 0 ? botInviteLink() : null"), "S2 不应返 null，应常返 invite_url（P2 注记）");
    assert.ok(guilds.includes("botInviteLink()"), "guilds 应常返 botInviteLink()");
    const login = src("app/api/auth/login/route.js");
    assert.ok(login.includes("next"), "login 应支持 next 透传");
    const cb = src("app/api/auth/callback/discord/route.js");
    assert.ok(cb.includes("next"), "callback 应支持 next 回跳");
    assert.ok(cb.includes("/me"), "callback 默认回跳应为 /me");
  });
});
