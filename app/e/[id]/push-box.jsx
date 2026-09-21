"use client";

import { useEffect, useState } from "react";

export default function PushBox({ id }) {
  const [step, setStep] = useState(1);
  const [guilds, setGuilds] = useState(null);
  const [invite, setInvite] = useState(null);
  const [guildId, setGuildId] = useState("");
  const [channels, setChannels] = useState([]);
  const [sendable, setSendable] = useState(null);
  const [channelId, setChannelId] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/guilds")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setMsg(`失败：${d.error}`);
        else {
          setGuilds(d.guilds);
          setInvite(d.invite_url);
        }
      });
  }, []);

  async function pickGuild(gid) {
    setGuildId(gid);
    setMsg("");
    const r = await fetch(`/api/guilds/${gid}/channels`).then((x) => x.json());
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
    setMsg("发送中…");
    const res = await fetch(`/api/events/${id}/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel_id: channelId }),
    });
    const data = await res.json();
    setBusy(false);
    setMsg(res.ok ? `已发送到频道（message ${data.message_id}）` : `失败：${data.error}`);
  }

  if (guilds === null) return <section><h2>推送到 Discord</h2><p>加载中…{msg}</p></section>;

  return (
    <section>
      <h2>推送到 Discord（{step}/3）</h2>
      {guilds.length === 0 && (
        <div>
          <p>Bot 还没进你的群。需要该群 Manage Server 权限。</p>
          <p><a href={invite} target="_blank" rel="noreferrer">一键邀请 Bot</a></p>
        </div>
      )}
      {step === 1 && guilds.length > 0 && (
        <ul>
          {guilds.map((g) => (
            <li key={g.id}><button onClick={() => pickGuild(g.id)}>{g.name}</button></li>
          ))}
        </ul>
      )}
      {step === 2 && (
        <div>
          <p>仅显示 Bot 可见的文字频道。{sendable === false && <strong>Bot 在该群缺少发送/嵌入权限，换群或补权限。</strong>}</p>
          <ul>
            {channels.map((c) => (
              <li key={c.id}>
                <button onClick={() => { setChannelId(c.id); setStep(3); }} disabled={sendable === false}>
                  #{c.name}{c.topic ? ` — ${c.topic.slice(0, 40)}` : ""}
                </button>
              </li>
            ))}
          </ul>
          <p><button onClick={() => setStep(1)}>返回选群</button></p>
        </div>
      )}
      {step === 3 && (
        <div>
          <p>目标频道 ID：{channelId}，确认发送？再次发送会新增一张卡（全部实时同步）。</p>
          <button onClick={send} disabled={busy}>确认发送</button>{" "}
          <button onClick={() => setStep(2)}>返回选频道</button>
        </div>
      )}
      {msg && <p>{msg}</p>}
    </section>
  );
}
