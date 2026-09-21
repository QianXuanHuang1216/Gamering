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

/** fan-out：同一 payload 全量 PATCH 所有活卡；404/403 标 dead，429 读 retry_after。 */
export async function fanout(db, { markMessageDead }, eventId, messages, payload) {
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
      out.push({ messageId: m.message_id, ok: false, retryAfter, status: 429 });
    } else {
      out.push({ messageId: m.message_id, ok: false, status: r.status });
    }
  }
  return out;
}
