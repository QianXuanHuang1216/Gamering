// 推送失败的用户可见文案 + 结果映射。前端组件与 API 路由共用这一份，
// 免得同一个故障在两处各写一套说法（分叉过一次：路由说「已加入重试」，前端说「网络错误」）。
//
// 只有产品里真实存在的情况才允许出现在文案里：没有同步状态视图，就别把人指过去。

/** 四种说法的唯一来源。改动前先确认产品里真有这个状态。 */
export const PUSH_ERROR = {
  /** 服务端连不上 Discord（5xx）。 */
  transport: "连不上 Discord，请再试一次",
  /** 响应不是 JSON / 请求本身失败：服务端的回复没拿到，不能替它猜。 */
  unreadable: "没有收到服务端的回复，请再试一次",
  /** Discord 429 限流。 */
  rateLimited: "发送太频繁，请过几秒再试",
  /** 兜底：拿到了 JSON 错误体但没有可展示的 error。 */
  fallback: "发送失败",
};

/**
 * 推送结果 → 用户可见文案。三态严格分开，别再把服务端崩溃说成客户端断网。
 * 服务端带回来的 error 一律照传（前后端同一份文案，说法不许分叉）；5xx 只是没带
 * error 时的兜底——它可能只是「换个频道」这种可操作提示，不该被覆盖成「连不上 Discord」。
 * @param {object} [r]
 * @param {boolean} [r.ok] 响应成功（此时返回空串，不产生错误文案）
 * @param {number}  [r.status] HTTP 状态码
 * @param {object|null} [r.data] 已解析的 JSON 响应体
 * @param {boolean} [r.unreadable] 响应无法解析（HTML 错误页/传输截断）或 fetch 本身失败
 * @returns {string} 空串 = 已确认成功
 */
export function pushErrorMessage({ ok = false, status = 0, data = null, unreadable = false } = {}) {
  // unreadable 排在 ok 前面：2xx 但响应体读不懂不构成「已确认成功」（服务端可能已经把卡
  // 发进 Discord，界面一片空白会让人再点一次，Discord 里就多一张卡）。
  if (unreadable) return PUSH_ERROR.unreadable;
  if (ok) return "";
  if (status === 429) return PUSH_ERROR.rateLimited;
  const reason = typeof data?.error === "string" ? data.error.trim() : "";
  if (!reason) return status >= 500 ? PUSH_ERROR.transport : `失败：${PUSH_ERROR.fallback}`;
  return status >= 500 ? reason : `失败：${reason}`;
}

/** Discord 没答上来时的统一应答：5xx + JSON。路由层用它，杜绝异常逃出去变 HTML 500。 */
export function discordUnreachable() {
  return Response.json({ error: PUSH_ERROR.transport }, { status: 502 });
}
