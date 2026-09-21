// 头像 URL + custom_id 命名空间（design-spec §6/§7，本票 §1/§4）。

/** 真人头像：Discord CDN；无头像走默认头像公式（本票 §1）。 */
export function avatarUrl(discordId, avatarHash) {
  if (avatarHash) return `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.png?size=64`;
  return defaultAvatarUrl(discordId);
}

/** 默认/占位头像：`https://cdn.discordapp.com/embed/avatars/{(discord_id>>22)%6}.png`（§6 明文）。 */
export function defaultAvatarUrl(discordId) {
  const idx = Number((BigInt(discordId) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}

/** 按钮 custom_id 带版本命名空间：`join:v1:{eventId}` / `leave:v1:{eventId}`（§7）。 */
export function joinCustomId(eventId) {
  return `join:v1:${eventId}`;
}
export function leaveCustomId(eventId) {
  return `leave:v1:${eventId}`;
}

/** 解析 custom_id；非法返回 null（直接丢弃 + ephemeral 提示由调用方处理）。 */
export function parseCustomId(customId) {
  const m = /^(join|leave):v1:(.+)$/.exec(customId ?? "");
  if (!m) return null;
  return { action: m[1], eventId: m[2] };
}
