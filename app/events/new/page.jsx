"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewEvent() {
  const router = useRouter();
  const [err, setErr] = useState("");
  const [form, setForm] = useState({ game_text: "", start_at: "", end_at: "", cap: 5, held: 0, description: "" });

  async function submit(e) {
    e.preventDefault();
    setErr("");
    const res = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        cap: Number(form.cap),
        held: Number(form.held),
        start_at: new Date(form.start_at).toISOString(),
        end_at: form.end_at ? new Date(form.end_at).toISOString() : null,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setErr(data.error ?? "创建失败");
      return;
    }
    router.push(`/e/${data.event.id}`);
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <main>
      <h1>建事件</h1>
      {err && <p style={{ color: "red" }}>{err}</p>}
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <label>
          游戏名（≤80 字）
          <input value={form.game_text} onChange={set("game_text")} maxLength={80} required style={{ width: "100%" }} />
        </label>
        <label>
          开始时间（必填）
          <input type="datetime-local" value={form.start_at} onChange={set("start_at")} required />
        </label>
        <label>
          结束时间（可选）
          <input type="datetime-local" value={form.end_at} onChange={set("end_at")} />
        </label>
        <label>
          人数上限（1–100）
          <input type="number" value={form.cap} min={1} max={100} onChange={set("cap")} />
        </label>
        <label>
          已有占位（无 Discord 身份的人数）
          <input type="number" value={form.held} min={0} max={form.cap} onChange={set("held")} />
        </label>
        <label>
          描述（≤2000 字，{form.description.length}/2000）
          <textarea value={form.description} onChange={set("description")} maxLength={2000} rows={4} style={{ width: "100%" }} />
        </label>
        <button type="submit">创建事件</button>
      </form>
    </main>
  );
}
