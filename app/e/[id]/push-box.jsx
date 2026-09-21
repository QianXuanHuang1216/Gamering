"use client";

import { useEffect, useState } from "react";

const STEPS = ["选群", "选频道", "确认发送"];

/** 推送三步（§4）：Modal（medium+）/ 底部表 draggable（compact）+ Stepper。请求逻辑不动。 */
export default function PushBox({ id }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [guilds, setGuilds] = useState(null);
  const [invite, setInvite] = useState(null);
  const [guildId, setGuildId] = useState("");
  const [guildName, setGuildName] = useState("");
  const [channels, setChannels] = useState([]);
  const [sendable, setSendable] = useState(null);
  const [channelId, setChannelId] = useState("");
  const [channelName, setChannelName] = useState("");
  const [preview, setPreview] = useState(null);
  const [msg, setMsg] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentOnce, setSentOnce] = useState(false);

  useEffect(() => {
    if (!open || guilds !== null) return;
    fetch("/api/guilds")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setMsg(`失败：${d.error}`);
        else {
          setGuilds(d.guilds);
          setInvite(d.invite_url);
        }
      })
      .catch(() => setMsg("失败：网络错误"));
    fetch(`/api/events/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.event) setPreview(d.event);
      })
      .catch(() => {});
  }, [open, guilds, id]);

  async function pickGuild(g) {
    setGuildId(g.id);
    setGuildName(g.name);
    setMsg("");
    setOkMsg("");
    const r = await fetch(`/api/guilds/${g.id}/channels`).then((x) => x.json());
    if (r.error) {
      setMsg(`失败：${r.error}`);
      return;
    }
    setChannels(r.channels);
    setSendable(r.sendable);
    setStep(2);
  }

  async function send() {
    setBusy(true);
    setMsg("");
    setOkMsg("");
    try {
      const res = await fetch(`/api/events/${id}/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel_id: channelId }),
      });
      const data = await res.json();
      if (res.ok) {
        setSentOnce(true);
        setOkMsg(`已发送到 #${channelName}`);
      } else {
        setMsg(`失败：${data.error ?? "发送失败"}`);
      }
    } catch {
      setMsg("失败：网络错误，稍后可在详情查看同步状态");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    if (busy) return;
    setOpen(false);
    setStep(1);
    setMsg("");
    setOkMsg("");
  }

  function guildIcon(g) {
    if (g.icon) return `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64`;
    return null;
  }

  return (
    <section aria-label="推送到 Discord" data-testid="push-box">
      <button type="button" className="btn btn-tonal" onClick={() => setOpen(true)}>
        <span className="msr md-18">send</span>推送到 Discord
      </button>
      {open && (
        <div className="scrim" onClick={close}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label="推送到 Discord" onClick={(e) => e.stopPropagation()}>
            <div className="grab" aria-hidden />
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2 className="t-title-large">推送到 Discord</h2>
              <button type="button" className="btn btn-text" onClick={close} disabled={busy} aria-label="关闭">
                <span className="msr">close</span>
              </button>
            </div>
            <ol className="row" style={{ listStyle: "none", margin: "12px 0 0", padding: 0 }} aria-label="步骤">
              {STEPS.map((s, i) => (
                <li key={s} className="t-label-medium" style={{ color: step === i + 1 ? "var(--md-sys-color-primary)" : "var(--md-sys-color-on-surface-variant)" }}>
                  {i + 1}. {s}{i < STEPS.length - 1 ? " › " : ""}
                </li>
              ))}
            </ol>

            {guilds === null && (
              <div className="stack" style={{ marginTop: 16 }}>
                <div className="skel" style={{ height: 56 }} />
                <div className="skel" style={{ height: 56 }} />
                <p className="t-body-medium">加载中…</p>
              </div>
            )}

            {guilds !== null && guilds.length === 0 && (
              <div className="empty" data-testid="push-empty-guilds">
                <span className="empty-illo">
                  <span className="msr">group_add</span>
                </span>
                <p className="t-title-medium">Bot 还没进你的群</p>
                <p className="t-body-medium">需要该群 Manage Server 权限。</p>
                {invite && (
                  <a className="btn btn-filled" href={invite} target="_blank" rel="noreferrer">
                    一键邀请 Bot
                  </a>
                )}
              </div>
            )}

            {guilds !== null && guilds.length > 0 && step === 1 && (
              <ul className="pick-list">
                {/* 成员数：群列表 API 未返回 with_counts，按稿取舍仅显示头像+群名 */}
                {guilds.map((g) => (
                  <li key={g.id}>
                    <button type="button" className="pick-row" onClick={() => pickGuild(g)}>
                      {guildIcon(g) ? (
                        <img className="avatar" src={guildIcon(g)} alt="" width={40} height={40} loading="lazy" />
                      ) : (
                        <span className="avatar" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }} aria-hidden>
                          <span className="msr">group</span>
                        </span>
                      )}
                      <span className="who">
                        <div className="n">{g.name}</div>
                      </span>
                      <span className="msr" aria-hidden>
                        chevron_right
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {step === 2 && (
              <div style={{ marginTop: 8 }}>
                <p className="t-body-medium">仅显示 Bot 可见的文字频道。</p>
                {sendable === false && (
                  <p className="t-body-medium" style={{ color: "var(--md-sys-color-error)" }}>
                    Bot 在该群缺少发送/嵌入权限，换群或补权限。
                  </p>
                )}
                <ul className="pick-list">
                  {channels.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="pick-row"
                        disabled={sendable === false}
                        onClick={() => {
                          setChannelId(c.id);
                          setChannelName(c.name);
                          setStep(3);
                        }}
                      >
                        <span className="msr" aria-hidden>
                          tag
                        </span>
                        <span className="who">
                          <div className="n"># {c.name}</div>
                          {c.topic && <div className="s">{c.topic.slice(0, 60)}</div>}
                        </span>
                        {sendable === false ? (
                          <span className="chip-error-outline">无发送权限</span>
                        ) : (
                          <span className="msr" aria-hidden>
                            chevron_right
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="dialog-actions">
                  <button type="button" className="btn btn-text" onClick={() => setStep(1)}>
                    返回选群
                  </button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="stack-8" style={{ marginTop: 8 }}>
                {sentOnce && (
                  <p className="t-body-medium" style={{ color: "var(--md-sys-color-primary)" }}>
                    已推送过，再次发送会新增一张卡（全部实时同步）。
                  </p>
                )}
                {preview && (
                  <div className="mini-preview" aria-label="卡片预览">
                    <p className="t-title-medium" style={{ margin: 0 }}>
                      {preview.gameText}
                    </p>
                    <p className="t-body-medium" style={{ margin: 0 }}>
                      {preview.confirmed + preview.held}/{preview.cap} · 还差{" "}
                      {Math.max(0, preview.cap - preview.confirmed - preview.held)} · 排队 {preview.waitlisted}
                    </p>
                    <p className="t-body-medium" style={{ margin: 0 }}>
                      #{channelName} @ {guildName}
                    </p>
                  </div>
                )}
                {!preview && (
                  <p className="t-body-medium">
                    目标 #{channelName} @ {guildName}，确认发送？再次发送会新增一张卡（全部实时同步）。
                  </p>
                )}
                <div className="dialog-actions">
                  <button type="button" className="btn btn-text" onClick={() => setStep(2)} disabled={busy}>
                    返回选频道
                  </button>
                  <button type="button" className="btn btn-filled" onClick={send} disabled={busy}>
                    {busy && <span className="spin" aria-hidden />}
                    确认发送
                  </button>
                </div>
              </div>
            )}

            {msg && (
              <p className="t-body-medium" role="alert" style={{ color: "var(--md-sys-color-error)" }}>
                {msg}
              </p>
            )}
            {okMsg && (
              <div className="snackbar" role="status">
                {okMsg}
                <span className="spacer" />
                <button className="snack-action" onClick={close}>
                  知道了
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
