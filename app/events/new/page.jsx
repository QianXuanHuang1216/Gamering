"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiErrorMessage, callApi } from "@/lib/api-client";
import { GAME_PRESETS } from "@/lib/games";
import { defaultStartParts, partsToMs, validateTimes } from "@/lib/edit-validate";
import DatetimePicker from "@/app/datetime-picker";

const CUSTOM = "自定义…";

/** P1 建事件页（SPA-506 C：默认今天+当前分钟 + M3 日期/时间选择器）。结束 Switch 模式不变。 */
export default function NewEvent() {
  const router = useRouter();
  const [err, setErr] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const [preset, setPreset] = useState(GAME_PRESETS[0]);
  const [custom, setCustom] = useState("");
  const [customTouched, setCustomTouched] = useState(false);
  const [start, setStart] = useState(() => defaultStartParts(new Date()));
  const [end, setEnd] = useState(() => {
    const d = defaultStartParts(new Date());
    return { ...d, hour: (d.hour + 2) % 24 };
  });
  const [form, setForm] = useState({ cap: 5, held: 0, description: "" });
  const [endOn, setEndOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [createdId, setCreatedId] = useState(null);

  const startMs = start?.date ? partsToMs(start) : null;
  const endMs = endOn && end?.date ? partsToMs(end) : null;
  const startPast = useMemo(() => {
    if (startMs == null) return false;
    return startMs < Date.now() - 60_000; // 1 分钟容差：默认填充的当前分钟不算过去
  }, [startMs]);
  const endInvalid = validateTimes({ startAt: startMs, endAt: endMs }) != null;
  const customInvalid = preset === CUSTOM && custom.trim() === "";
  const canSubmit = !busy && startMs != null && !startPast && !endInvalid && !customInvalid;

  async function submit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setErr("");
    setBusy(true);
    const gameText = preset === CUSTOM ? custom.trim() : preset;
    try {
      const r = await callApi("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          game_text: gameText,
          cap: Number(form.cap),
          held: Number(form.held),
          start_at: new Date(startMs).toISOString(),
          end_at: endOn && endMs != null ? new Date(endMs).toISOString() : null,
        }),
      });
      if (!r.ok) {
        // r.data 为 null 说明响应体读不懂，不能拿它猜是不是没登录。
        if (r.data?.error === "login_required") setNeedsLogin(true);
        else setErr(apiErrorMessage(r, "创建"));
        return;
      }
      setCreatedId(r.data.event.id);
    } finally {
      setBusy(false);
    }
  }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isNaN(Number(v)) ? lo : Number(v)));

  if (needsLogin) {
    return (
      <main className="stack">
        <h1 className="t-headline-medium">建事件</h1>
        <div className="card">
          <div className="empty" data-testid="login-empty">
            <span className="empty-illo">
              <span className="msr">login</span>
            </span>
            <p className="t-title-medium">建事件需要先登录</p>
            <p className="t-body-medium">用 Discord 登录后即可创建事件并推送到群。</p>
            <a className="btn btn-filled" href="/api/auth/login">
              <span className="msr md-18">login</span>用 Discord 登录
            </a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="stack">
      <h1 className="t-headline-medium">建事件</h1>
      <form onSubmit={submit} className="card" style={{ display: "grid", gap: 16, padding: 16 }} data-testid="new-event-form">
        <div className="field">
          <span>游戏</span>
          <select className="select" value={preset} onChange={(e) => setPreset(e.target.value)} aria-label="游戏预设">
            {GAME_PRESETS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
            <option value={CUSTOM}>{CUSTOM}</option>
          </select>
        </div>
        {preset === CUSTOM && (
          <div className="field">
            <span>自定义游戏名（英文，≤80 字）</span>
            <input
              className="input"
              value={custom}
              onChange={(e) => {
                setCustom(e.target.value);
                setCustomTouched(true);
              }}
              maxLength={80}
              placeholder="Helldivers 2"
              aria-invalid={customTouched && customInvalid}
            />
            {customTouched && customInvalid && <span className="field-error">请填写自定义游戏名</span>}
          </div>
        )}
        <DatetimePicker
          label="开始时间（必填，默认今天 + 当前分钟）"
          value={start}
          onChange={setStart}
          error={startPast ? "开始时间不能早于现在" : ""}
        />
        <div className="field">
          <div className="switch-row">
            <input
              className="switch"
              type="checkbox"
              id="end-switch"
              checked={endOn}
              onChange={(e) => setEndOn(e.target.checked)}
            />
            <label htmlFor="end-switch" className="t-label-large">
              设置结束时间
            </label>
          </div>
          <span className="hint">为空显示“待定”，结束后房主可手动结束。</span>
          {endOn && (
            <DatetimePicker
              label="结束时间"
              value={end}
              onChange={setEnd}
              error={endInvalid ? "结束时间必须晚于开始时间" : ""}
            />
          )}
        </div>
        <div className="field">
          <span>人数上限（1–100）</span>
          <div className="stepper">
            <button type="button" aria-label="减少人数上限" disabled={Number(form.cap) <= 1} onClick={() => setForm({ ...form, cap: clamp(Number(form.cap) - 1, 1, 100) })}>
              −
            </button>
            <output>{form.cap}</output>
            <button type="button" aria-label="增加人数上限" disabled={Number(form.cap) >= 100} onClick={() => setForm({ ...form, cap: clamp(Number(form.cap) + 1, 1, 100) })}>
              ＋
            </button>
          </div>
        </div>
        <div className="field">
          <span>已有占位</span>
          <span className="hint">线下已组好、没有 Discord 的人数，会以默认头像占位显示。</span>
          <div className="stepper">
            <button type="button" aria-label="减少占位" disabled={Number(form.held) <= 0} onClick={() => setForm({ ...form, held: clamp(Number(form.held) - 1, 0, Number(form.cap)) })}>
              −
            </button>
            <output>{form.held}</output>
            <button type="button" aria-label="增加占位" disabled={Number(form.held) >= Number(form.cap)} onClick={() => setForm({ ...form, held: clamp(Number(form.held) + 1, 0, Number(form.cap)) })}>
              ＋
            </button>
          </div>
        </div>
        <div className="field">
          <span>描述</span>
          <textarea
            className="textarea"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            maxLength={2000}
            rows={4}
            placeholder="集合时间、语音频道、装备要求……"
          />
          <div className="counter">
            {form.description.length}/2000
          </div>
        </div>
        <div className="sticky-bar">
          <button type="button" className="btn btn-text" onClick={() => router.back()}>
            取消
          </button>
          <button type="submit" className="btn btn-filled" disabled={!canSubmit}>
            {busy && <span className="spin" aria-hidden />}
            创建事件
          </button>
        </div>
      </form>
      {err && (
        <div className="snackbar snackbar-error" role="alert" data-testid="error-snackbar">
          {err}
          <span className="spacer" />
          <button className="snack-action" onClick={submit}>
            重试
          </button>
        </div>
      )}
      {createdId && (
        <div className="snackbar" role="status" data-testid="success-snackbar">
          事件已创建，下一步推送到 Discord
          <span className="spacer" />
          <a href={`/e/${createdId}#push`}>去推送</a>
        </div>
      )}
    </main>
  );
}
