"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { dedupeGuilds, diffNewGuilds, guildIconUrl, loginHref, visibleGuilds } from "@/lib/invite";

/**
 * 主页邀请卡 S1/S2/E0-E3（SPA-499，设计 SPA-498）。
 * 样式零新增：只复用 .card/.empty/.empty-illo/.p-list/.avatar/.btn-filled/.btn-tonal/.skel/.snackbar。
 */
export default function InviteCard() {
  const [guilds, setGuilds] = useState(null);
  const [invite, setInvite] = useState(null);
  const [err, setErr] = useState("");
  const [expired, setExpired] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [fresh, setFresh] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const prevRef = useRef(null);

  const load = useCallback(async () => {
    setSpinning(true);
    setErr("");
    try {
      const r = await fetch("/api/guilds");
      const d = await r.json();
      if (r.status === 401 || d.error === "login_required") {
        setExpired(true);
        return;
      }
      if (!r.ok || d.error) {
        setErr("群列表拉取失败，稍后重试");
        return;
      }
      const list = dedupeGuilds(d.guilds ?? []);
      const added = prevRef.current ? diffNewGuilds(prevRef.current, list) : [];
      prevRef.current = list;
      setGuilds(list);
      setInvite(d.invite_url ?? null);
      setExpired(false);
      // E3：邀请返回后重拉出现新服 → 成功条（按 id 去重，文案含群名）
      if (added.length > 0 && prevRef.current && list.length > 0) setFresh(added.slice(0, 1));
    } catch {
      setErr("群列表拉取失败，稍后重试");
    } finally {
      setSpinning(false);
    }
  }, []);

  useEffect(() => {
    load();
    // E1：Discord 侧取消授权回来（?invite=cancelled）→ 中性条，阅后清除 query
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.get("invite") === "cancelled") {
        setCancelled(true);
        q.delete("invite");
        const rest = q.toString();
        window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
      }
      // ?invite=1 回跳原位：聚焦邀请卡
      if (q.get("invite") === "1") {
        document.getElementById("invite")?.focus?.({ preventScroll: false });
        document.getElementById("invite")?.scrollIntoView?.({ block: "nearest" });
      }
    } catch {
      /* ignore */
    }
    // 授权回来后刷新即现新服：窗口重获焦点时重拉一次（不做 websocket）
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const { shown, hiddenCount } = visibleGuilds(guilds ?? [], 5);
  const rows = expanded ? (guilds ?? []) : shown;

  return (
    <section aria-label="邀请 Bot" data-testid="home-invite-card">
      {guilds === null && !err && !expired && (
        <div className="stack" aria-label="加载中">
          <div className="skel" style={{ height: 56 }} />
          <div className="skel" style={{ height: 56 }} />
          <p className="t-body-medium">加载中…</p>
        </div>
      )}

      {expired && (
        <div className="empty" data-testid="home-invite-expired">
          <p className="t-body-medium">登录已过期，请重新登录</p>
          <a className="btn btn-filled" href={loginHref("/?invite=1")}>
            <span className="msr md-18">login</span>重新登录
          </a>
        </div>
      )}

      {err && !expired && (
        <div className="empty" data-testid="home-invite-error">
          <p className="t-body-medium" role="alert" style={{ color: "var(--md-sys-color-error)" }}>
            群列表拉取失败，稍后重试
          </p>
          <button type="button" className="btn btn-text" onClick={load} disabled={spinning}>
            重试
          </button>
        </div>
      )}

      {guilds !== null && !err && !expired && guilds.length === 0 && (
        <div className="empty" data-testid="home-invite-empty">
          <span className="empty-illo">
            <span className="msr">group_add</span>
          </span>
          <p className="t-title-medium">把 Gamering Bot 拉进你的服务器</p>
          <p className="t-body-medium">只需要看频道 + 发消息 + 嵌链接（权限 19456），不读私信、不碰管理。</p>
          {invite && (
            <a className="btn btn-filled" href={invite} target="_blank" rel="noreferrer">
              <span className="msr md-18">group_add</span>一键邀请 Bot
            </a>
          )}
          <p className="t-label-medium" style={{ color: "var(--md-sys-color-on-surface-variant)" }}>
            需要该群 Manage Server 权限才能拉 Bot，换个你是管理的群试试
          </p>
        </div>
      )}

      {guilds !== null && !err && !expired && guilds.length > 0 && (
        <div data-testid="home-invite-list">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <p className="t-title-medium" style={{ margin: 0 }}>
              已在 {guilds.length} 个服务器
            </p>
            {invite && (
              <a className="btn btn-tonal" href={invite} target="_blank" rel="noreferrer">
                <span className="msr md-18">add</span>再加一个服务器
              </a>
            )}
          </div>
          {!expanded && guilds.length > 5 && (
            <div className="avatar-wall" style={{ marginTop: 8 }} aria-hidden>
              {shown.map((g) =>
                guildIconUrl(g) ? (
                  <img key={g.id} src={guildIconUrl(g)} alt="" width={40} height={40} loading="lazy" />
                ) : (
                  <span key={g.id} className="avatar" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                    <span className="msr">group</span>
                  </span>
                ),
              )}
              <span className="avatar-more">+{hiddenCount}</span>
            </div>
          )}
          <ul className="p-list">
            {rows.map((g) => (
              <li key={g.id}>
                {guildIconUrl(g) ? (
                  <img className="avatar" src={guildIconUrl(g)} alt="" width={40} height={40} loading="lazy" />
                ) : (
                  <span className="avatar" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }} aria-hidden>
                    <span className="msr">group</span>
                  </span>
                )}
                <span className="who">
                  <div className="n">{g.name}</div>
                </span>
                <span className="check-green" aria-label="Bot 已在">
                  <span className="msr" aria-hidden>
                    check_circle
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {guilds.length > 5 && (
            <button type="button" className="btn btn-text" onClick={() => setExpanded((v) => !v)}>
              {expanded ? "收起" : "查看全部"}
            </button>
          )}
        </div>
      )}

      {cancelled && (
        <div className="snackbar" role="status">
          已取消邀请，可随时重试
          <span className="spacer" />
          <button
            type="button"
            className="snack-action"
            onClick={() => {
              setCancelled(false);
              load();
            }}
          >
            重试
          </button>
        </div>
      )}

      {fresh.length > 0 && (
        <div className="snackbar" role="status">
          Bot 已在「{fresh[0].name}」，直接去推送吧
          <span className="spacer" />
          <a className="snack-action" href="/me">
            去推送
          </a>
        </div>
      )}
    </section>
  );
}
