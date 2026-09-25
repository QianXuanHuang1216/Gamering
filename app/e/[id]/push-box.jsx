"use client";

import { useEffect, useState } from "react";
import { callApi, fieldErrorMessage } from "@/lib/api-client";
import { pushErrorMessage, pushOutcome, newPushNonce } from "@/lib/push";

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
  const [outcome, setOutcome] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sentOnce, setSentOnce] = useState(false);
  const [nonce, setNonce] = useState(null);

  useEffect(() => {
    if (!open || guilds !== null) return;
    callApi("/api/guilds").then((r) => {
      if (!r.ok) {
        setMsg(pushErrorMessage(r));
        return;
      }
      // guilds 的取值域只有两个：null（加载中）和数组。渲染期有 guilds.length / guilds.map，
      // 2xx 但缺这个字段时照存 → guilds 变 undefined → 整页白掉，而且下一行的
      // guilds !== null 还会把它当成「已经加载过了」，连重拉都不再发生。
      // 按失败说话，state 留在 null：宁可停在加载态，也不拿空数组骗人
      // （空数组的意思是「Bot 一个群都没进」，那是另一回事）。关掉重开会重试。
      const missing = fieldErrorMessage(r, "guilds", "拉取群列表");
      if (missing) {
        setMsg(missing);
        return;
      }
      setGuilds(r.data.guilds);
      setInvite(r.data?.invite_url ?? null);
    });
    callApi(`/api/events/${id}`).then((r) => {
      // preview 是可选的：没有它就用默认那段确认文案（渲染期 {preview && …} 短路）。
      // 这里 ?. 是为了让「取不到也不抛」这件事由调用点自己保证，而不是靠 JSX 恰好短路。
      if (r.ok) setPreview(r.data?.event);
    });
  }, [open, guilds, id]);

  async function pickGuild(g) {
    setGuildId(g.id);
    setGuildName(g.name);
    setMsg("");
    setOkMsg("");
    const r = await callApi(`/api/guilds/${g.id}/channels`);
    if (!r.ok) {
      setMsg(pushErrorMessage(r));
      return;
    }
    // 同上：channels 在 step 2 被 .map。缺了就停在这儿，别 setStep(2)——
    // 进了 step 2 再发现没有列表，渲染期就抛了。
    const missing = fieldErrorMessage(r, "channels", "读取频道");
    if (missing) {
      setMsg(missing);
      return;
    }
    setChannels(r.data.channels);
    // sendable 是可选的：查不到只说明「不知道能不能发」，不等于不能发（不能发是 false）。
    setSendable(r.data?.sendable ?? null);
    setStep(2);
  }

  /**
   * SPA-546：「刚才那一下到底成没成」不再靠猜。
   * unreadable 落在「卡可能已经进了 Discord」的窗口里，此时「请再试一次」就是在教人
   * 制造重复卡——改成先查 event_messages（只读接口），按查到的三种结果分别说话。
   * 一次手势一个 nonce：POST 带它、事后查询也带它（否则查回来的可能是上一次留下的卡，
   * 把没发出去说成发出去了）。确认成功才换新 nonce，失败重发复用同一个。
   */
  async function send() {
    setBusy(true);
    setMsg("");
    setOutcome(null);
    setOkMsg("");
    const gestureNonce = nonce ?? newPushNonce();
    if (nonce === null) setNonce(gestureNonce); // 兜底值要留在 state 里，否则下次重发会换一个 nonce
    try {
      const r = await callApi(`/api/events/${id}/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel_id: channelId, nonce: gestureNonce }),
      });
      if (r.ok) {
        setSentOnce(true);
        setOkMsg(`已发送到 #${channelName}`);
        // 只有确认成功才换新 nonce：用户主动再发一张是产品承诺的行为，不能被去重吞掉。
        setNonce(newPushNonce());
      } else if (r.unreadable) {
        const q = new URLSearchParams({ channel_id: channelId, nonce: gestureNonce });
        const v = await callApi(`/api/events/${id}/push?${q}`);
        setOutcome(pushOutcome(v));
      } else {
        setMsg(pushErrorMessage(r));
      }
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
    setOutcome(null);
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
                          setNonce(newPushNonce());
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
            {outcome && (
              <p className="t-body-medium" role="status" data-testid="push-outcome" style={{ color: "var(--md-sys-color-on-surface-variant)" }}>
                {outcome.text}
                {outcome.url && (
                  <>
                    {" · "}
                    <a href={outcome.url} target="_blank" rel="noreferrer">
                      在 Discord 里打开
                    </a>
                  </>
                )}
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
