// Discord Bot REST 封装（fetch 直调，零依赖）。
// 发卡 / 全量 PATCH / 权限预检 / ephemeral followup。

const API = "https://discord.com/api/v10";

function headers(json = true) {
  const h = { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

export async function discordApi(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: headers(body !== undefined),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, headers: res.headers, data };
}

/** 发送前权限预检：频道可见 + 文字频道。返回 {ok, reason?, channel?}。 */
export async function precheckChannel(channelId) {
  const { ok, status, data } = await discordApi(`/channels/${channelId}`);
  if (!ok) {
    if (status === 404) return { ok: false, reason: "频道不存在（404），换个频道试试" };
    if (status === 403) return { ok: false, reason: "Bot 在该频道没有访问权限（403），换个频道试试" };
    return { ok: false, reason: `频道预检失败（${status}），稍后重试` };
  }
  if (data.type !== 0) return { ok: false, reason: "仅支持文字频道" };
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
export async function userGuilds(userToken) {
  const res = await fetch(`${API}/users/@me/guilds`, { headers: { Authorization: `Bearer ${userToken}` } });
  return { status: res.status, ok: res.ok, data: await res.json().catch(() => ([])) };
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
  if (!member.ok || !roles.ok) return { ok: false };
  const rolePerms = new Map((roles.data ?? []).map((r) => [r.id, BigInt(r.permissions ?? "0")]));
  let perms = rolePerms.get(guildId) ?? 0n; // @everyone
  for (const rid of member.data?.roles ?? []) perms |= rolePerms.get(rid) ?? 0n;
  const can = (bit) => (perms & BigInt(bit)) !== 0n;
  return { ok: true, send: can(0x800), embed: can(0x4000) };
}
export async function fanout(db, { markMessageDead, enqueueRetry }, eventId, messages, payload) {
  const out = [];
  for (const m of messages) {
    const r = await patchCard(m.channel_id, m.message_id, payload);
    if (r.ok) {
      out.push({ messageId: m.message_id, ok: true });
      continue;
    }
    if (r.status === 404 || r.status === 403) {
      markMessageDead(db, m.id);
      out.push({ messageId: m.message_id, ok: false, dead: true, status: r.status });
    } else if (r.status === 429) {
      const retryAfter = Number(r.data?.retry_after ?? 1);
      enqueueRetry?.(db, { eventId, channelId: m.channel_id, messageId: m.message_id, status: 429 });
      out.push({ messageId: m.message_id, ok: false, retryAfter, status: 429 });
    } else {
      if (r.status >= 500) enqueueRetry?.(db, { eventId, channelId: m.channel_id, messageId: m.message_id, status: r.status });
      out.push({ messageId: m.message_id, ok: false, status: r.status });
    }
  }
  return out;
}
