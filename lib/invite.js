// SPA-499 主页邀请 Bot 入口纯函数（可单测，无 Next 依赖）。
// next 白名单防开放重定向：只允许站内路径（单斜杠开头，非 //、无协议）。

export function isSafeNextPath(next) {
  if (typeof next !== "string" || !next.startsWith("/")) return false;
  if (next.startsWith("//") || next.startsWith("/\\")) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(next)) return false;
  if (next.includes("\\") || next.includes(" ") || next.includes("\n")) return false;
  return true;
}

export function resolveNext(next, fallback = "/me") {
  return isSafeNextPath(next) ? next : fallback;
}

/** 登录前置入口：未登录点邀请 → 先登录，回来继续（state 透传，不丢上下文）。 */
export function loginHref(next) {
  if (isSafeNextPath(next)) return `/api/auth/login?next=${encodeURIComponent(next)}`;
  return "/api/auth/login";
}

/** 群头像（沿用 push-box guildIcon 口径；无 icon 返回 null 走占位）。 */
export function guildIconUrl(g) {
  if (g?.icon) return `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64`;
  return null;
}

/** 去重键 guild.id，禁止按名字去重（E3）。 */
export function dedupeGuilds(guilds) {
  const seen = new Set();
  const out = [];
  for (const g of guilds ?? []) {
    if (!g || seen.has(g.id)) continue;
    seen.add(g.id);
    out.push(g);
  }
  return out;
}

/** 邀请返回后 diff 出新增服（按 id），用于 E3 成功条。 */
export function diffNewGuilds(prev, next) {
  const had = new Set((prev ?? []).map((g) => g?.id));
  return (next ?? []).filter((g) => g && !had.has(g.id));
}

/** 超 5 截断 +N（复用 avatar-wall/avatar-more，不做分页）。 */
export function visibleGuilds(guilds, limit = 5) {
  const list = guilds ?? [];
  return { shown: list.slice(0, limit), hiddenCount: Math.max(0, list.length - limit) };
}
