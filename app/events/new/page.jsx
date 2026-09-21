"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GAME_PRESETS } from "@/lib/games";

const CUSTOM = "自定义…";

export default function NewEvent() {
  const router = useRouter();
  const [err, setErr] = useState("");
  const [preset, setPreset] = useState(GAME_PRESETS[0]);
  const [custom, setCustom] = useState("");
  const [form, setForm] = useState({ start_at: "", end_at: "", cap: 5, held: 0, description: "" });

  async function submit(e) {
    e.preventDefault();
    setErr("");
    const gameText = preset === CUSTOM ? custom.trim() : preset;
    const res = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        game_text: gameText,
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
          游戏（预设英文名 + 自定义）
          <select value={preset} onChange={(e) => setPreset(e.target.value)} style={{ width: "100%" }}>
            {GAME_PRESETS.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
            <option value={CUSTOM}>{CUSTOM}</option>
          </select>
        </label>
        {preset === CUSTOM && (
          <label>
            自定义游戏名（英文，≤80 字）
            <input value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={80} placeholder="Helldivers 2" required style={{ width: "100%" }} />
          </label>
        )}
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
