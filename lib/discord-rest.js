// Discord Bot REST 封装（fetch 直调，零依赖）。
// 发卡 / 全量 PATCH / 权限预检 / ephemeral followup。
// SPA-545：所有请求走 discordFetch 这一个出口——永不抛、必有超时。传输层失败
// 变成返回值（status 0），否则异常逃出路由会变成 Next 的 HTML 500 错误页，
// 前端拿到非 JSON 只能报成「网络错误」，一次服务端崩溃被误诊成客户端断网。

import { PUSH_ERROR } from "./push.js";

const API = "https://discord.com/api/v10";

/** Discord 正常 p99 在 1s 内；冷启动/限流会到几秒。8s 是用户主动点「确认发送」的合理上限。 */
export const DISCORD_TIMEOUT_MS = 8000;

function headers(json = true) {
  const h = { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

/**
 * 传输层唯一出口。永不 reject：fetch 拒绝（DNS/断网/连接重置）或超时都转成
 * `{ ok:false, status:0, transport:"network"|"timeout" }`；真收到 HTTP 响应则
 * transport:"ok"，status/ok/data 与裸 fetch 时代逐字一致（现有调用方零改动）。
 * @param {object} fallback 响应体解析失败时的 data 兜底（discordApi 用 {}，userGuilds 用 []）
 */
async function discordFetch(path, init, fallback = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCORD_TIMEOUT_MS);
  try {
    const res = await fetch(`${API}${path}`, { ...init, signal: controller.signal });
    return {
      status: res.status,
      ok: res.ok,
      headers: res.headers,
      data: await res.json().catch(() => fallback),
      transport: "ok",
    };
  } catch (e) {
    return {
      status: 0,
      ok: false,
      headers: new Headers(),
      data: fallback,
      transport: controller.signal.aborted || e?.name === "AbortError" ? "timeout" : "network",
      error: String(e?.message ?? e),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function discordApi(path, { method = "GET", body } = {}) {
  return discordFetch(
    path,
    { method, headers: headers(body !== undefined), body: body !== undefined ? JSON.stringify(body) : undefined },
  );
}

/** 发送前权限预检：频道可见 + 文字频道。返回 {ok, reason?, channel?, transport?}。 */
export async function precheckChannel(channelId) {
  const { ok, status, data, transport } = await discordApi(`/channels/${channelId}`);
  if (!ok) {
    // Discord 没答上来：status 是 0 不是 HTTP 码，读者看到「预检失败（0）」只会困惑。
    if (transport !== "ok") return { ok: false, transport, reason: PUSH_ERROR.transport };
    if (status === 404) return { ok: false, transport, reason: "频道不存在（404），换个频道试试" };
    if (status === 403) return { ok: false, transport, reason: "Bot 在该频道没有访问权限（403），换个频道试试" };
    return { ok: false, transport, reason: "频道预检失败，稍后重试" };
  }
  if (data.type !== 0) return { ok: false, transport, reason: "仅支持文字频道" };
  return { ok: true, channel: data };
}

export async function sendCard(channelId, payload) {
  return discordApi(`/channels/${channelId}/messages`, { method: "POST", body: payload });
}

export async function patchCard(channelId, messageId, payload) {
  return discordApi(`/channels/${channelId}/messages/${messageId}`, { method: "PATCH", body: payload });
}

/** interaction followup ephemeral（排队序号 / 无变化提示用）。 */
export async function ephemeralFollowup(appId, token, content) {
  return discordApi(`/webhooks/${appId}/${token}`, {
    method: "POST",
    body: { content, flags: 64 },
  });
}

/** 一键邀请 Bot 链接（空状态用；最小权限：看频道+发消息+嵌链接 = 19456）。 */
export function botInviteLink() {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    scope: "bot applications.commands",
    permissions: "19456",
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

/** Bot 已在的群。 */
export async function botGuilds() {
  return discordApi("/users/@me/guilds");
}

/** 用户的群（需用户 OAuth token；identify+guilds scope）。 */
export function userGuilds(userToken) {
  return discordFetch("/users/@me/guilds", { headers: { Authorization: `Bearer ${userToken}` } }, []);
}

/** 有管理权限（0x20）的群 id 集合。 */
export function manageableIds(guilds) {
  return new Set((guilds ?? []).filter((g) => (BigInt(g.permissions ?? "0") & 32n) !== 0n).map((g) => g.id));
}

/** Bot 可见的文字频道（Bot token 只能看到有权限的）。 */
export async function guildTextChannels(guildId) {
  const r = await discordApi(`/guilds/${guildId}/channels`);
  if (!r.ok) return r;
  return { ...r, data: (r.data ?? []).filter((c) => c.type === 0) };
}

/** Bot 在某群的发送/嵌入权限（群级角色并集 best-effort；频道覆盖异常靠发送时 403 映射）。 */
export async function guildSendable(guildId, botId) {
  const [member, roles] = await Promise.all([
    discordApi(`/guilds/${guildId}/members/${botId}`),
    discordApi(`/guilds/${guildId}/roles`),
  ]);
  // transport 要透传：否则「Discord 没答」和「答了但没权限」在调用方眼里都是 ok:false。
  const transport = member.transport !== "ok" ? member.transport : roles.transport;
  if (!member.ok || !roles.ok) return { ok: false, transport };
  const rolePerms = new Map((roles.data ?? []).map((r) => [r.id, BigInt(r.permissions ?? "0")]));
  let perms = rolePerms.get(guildId) ?? 0n; // @everyone
  for (const rid of member.data?.roles ?? []) perms |= rolePerms.get(rid) ?? 0n;
  const can = (bit) => (perms & BigInt(bit)) !== 0n;
  return { ok: true, send: can(0x800), embed: can(0x4000), transport: "ok" };
}
export async function fanout(db, { markMessageDead, enqueueRetry }, eventId, messages, payload) {
  const out = [];
  for (const m of messages) {
    const r = await patchCard(m.channel_id, m.message_id, payload);
    if (r.ok) {
      out.push({ messageId: m.message_id, ok: true, transport: r.transport });
      continue;
    }
    if (r.status === 404 || r.status === 403) {
      markMessageDead(db, m.id);
      out.push({ messageId: m.message_id, ok: false, dead: true, status: r.status, transport: r.transport });
    } else if (r.status === 429) {
      const retryAfter = Number(r.data?.retry_after ?? 1);
      enqueueRetry?.(db, { eventId, channelId: m.channel_id, messageId: m.message_id, status: 429, retryAfterSec: retryAfter });
      out.push({ messageId: m.message_id, ok: false, retryAfter, status: 429, transport: r.transport });
    } else {
      if (r.status >= 500) enqueueRetry?.(db, { eventId, channelId: m.channel_id, messageId: m.message_id, status: r.status });
      // SPA-545：传输层失败 status=0，当前不入重试队列（是否该入队是策略决定，本工单不决定），
      // 但绝不静默——显式上报 + 结果里带 transport，调用方能区分「Discord 答了报错」和「Discord 根本没答」。
      if (r.transport !== "ok") {
        console.error("discord transport failure", { eventId, channelId: m.channel_id, messageId: m.message_id, transport: r.transport, error: r.error });
      }
      out.push({ messageId: m.message_id, ok: false, status: r.status, transport: r.transport });
    }
  }
  return out;
}
