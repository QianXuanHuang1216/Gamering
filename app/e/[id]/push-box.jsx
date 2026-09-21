"use client";

import { useState } from "react";

export default function PushBox({ id }) {
  const [channel, setChannel] = useState("1192341288591315036");
  const [msg, setMsg] = useState("");

  async function send() {
    setMsg("发送中…");
    const res = await fetch(`/api/events/${id}/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel_id: channel }),
    });
    const data = await res.json();
    setMsg(res.ok ? `已发送到频道（message ${data.message_id}）` : `失败：${data.error}`);
  }

  return (
    <section>
      <h2>推送到 Discord</h2>
      <label>
        频道 ID
        <input value={channel} onChange={(e) => setChannel(e.target.value)} style={{ width: "100%" }} />
      </label>
      <button onClick={send}>确认发送</button>
      {msg && <p>{msg}</p>}
    </section>
  );
}
