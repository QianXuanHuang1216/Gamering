"use client";

import { useMemo, useState } from "react";
import { GAME_PRESETS } from "@/lib/games";
import { capFloor, msToParts, partsToMs, validateTimes } from "@/lib/edit-validate";
import { avatarUrl } from "@/lib/discord";
import AvatarImg from "@/app/avatar-img";
import DatetimePicker from "@/app/datetime-picker";

const CUSTOM = "自定义…";
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isNaN(Number(v)) ? lo : Number(v)));

/** SPA-506 B：事件编辑模式（mock edit.html 为准）。 */
export default function EditBox({ id, ev, participants, onDone }) {
  const startParts = useMemo(() => msToParts(ev.startAt), [ev.startAt]);
  const endParts0 = useMemo(() => (ev.endAt ? msToParts(ev.endAt) : null), [ev.endAt]);
  const [title, setTitle] = useState(ev.gameText);
  const [preset, setPreset] = useState(GAME_PRESETS.includes(ev.gameText) ? ev.gameText : CUSTOM);
  const [custom, setCustom] = useState(GAME_PRESETS.includes(ev.gameText) ? "" : ev.gameText);
  const [start, setStart] = useState(startParts);
  const [endOn, setEndOn] = useState(ev.endAt != null);
  const [end, setEnd] = useState(endParts0 ?? startParts);
  const [cap, setCap] = useState(ev.cap);
  const [held, setHeld] = useState(ev.held);
  const [desc, setDesc] = useState(ev.description ?? "");
  const [removed, setRemoved] = useState([]); // discordIds 已移除
  const [pendingRemove, setPendingRemove] = useState(null);
  const [dirtyLeave, setDirtyLeave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [snack, setSnack] = useState("");

  const liveParts = useMemo(() => participants.filter((p) => !removed.includes(p.discordId)), [participants, removed]);
  const confirmed = useMemo(() => {
    // confirmed 计数：DB 快照 ev.confirmed 减去已移除的 confirmed 成员
    const removedConfirmed = participants.filter((p) => removed.includes(p.discordId) && p.seat === "confirmed").length;
    return ev.confirmed - removedConfirmed;
  }, [ev.confirmed, participants, removed]);

  const startMs = useMemo(() => (start?.date ? partsToMs(start) : null), [start]);
  const endMs = useMemo(() => (endOn && end?.date ? partsToMs(end) : null), [endOn, end]);
  const timeErr = validateTimes({ startAt: startMs, endAt: endMs });
  const customInvalid = preset === CUSTOM && custom.trim() === "";
  const need = capFloor({ confirmed, held });
  const capErr = cap < need
    ? `总位置数（${cap}）小于当前参加人数（${need}）。请先移除至少 ${need - cap} 人，或调大 cap，才能保存。`
    : "";
  const gameName = preset === CUSTOM ? custom.trim() : preset;

  const dirty = useMemo(() => (
    title !== ev.gameText || gameName !== ev.gameText || startMs !== ev.startAt ||
    (endMs ?? null) !== (ev.endAt ?? null) || endOn !== (ev.endAt != null) ||
    cap !== ev.cap || held !== ev.held || desc !== (ev.description ?? "") || removed.length > 0
  ), [title, gameName, startMs, endMs, endOn, cap, held, desc, removed, ev]);

  const canSave = dirty && !capErr && !timeErr && !customInvalid && title.trim() && title.trim().length <= 80 &&
    desc.length <= 2000 && startMs != null && !busy;

  async function save() {
    if (!canSave) return;
    setBusy(true);
    try {
      const body = { op: "edit" };
      // 标题与游戏名为同一字段（gameText）：预设/自定义有改动则优先，否则用标题输入
      const nameChanged = gameName !== ev.gameText;
      if (nameChanged) body.game_text = gameName;
      else if (title.trim() !== ev.gameText) body.game_text = title.trim();
      if (startMs !== ev.startAt) body.start_at = startMs;
      if ((endMs ?? null) !== (ev.endAt ?? null)) body.end_at = endMs;
      if (cap !== ev.cap) body.cap = cap;
      if (held !== ev.held) body.held = held;
      if (desc !== (ev.description ?? "")) body.description = desc;
      if (Object.keys(body).length === 1) {
        onDone?.("无改动");
        return;
      }
      const res = await fetch(`/api/events/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setSnack(`保存失败：${data.error ?? "操作失败"}`);
        return;
      }
      onDone?.("已保存");
    } catch {
      setSnack("保存失败：网络错误");
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemove() {
    if (!pendingRemove || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/events/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "remove", discord_id: pendingRemove }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "移除失败");
      setRemoved([...removed, pendingRemove]);
      setSnack(data.promotedId ? `已移除（排队首位已递补）` : "已移除");
      setPendingRemove(null);
      onDone?.("removed", true); // 刷新父级数据但不关闭编辑
    } catch (e) {
      setSnack(`移除失败：${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    if (dirty) setDirtyLeave(true);
    else onDone?.(null);
  }

  return (
    <section className="card card-main" aria-label="编辑事件" data-testid="edit-box">
      <div className="stack-8">
        <div className="row">
          <h1 className="t-title-large" style={{ flex: 1 }}>编辑事件</h1>
          <span className="chip-label">脏检查：{dirty ? "有改动未保存" : "无改动"}</span>
        </div>

        <div className="field">
          <span>标题（即 gameText）</span>
          <input className="input" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} aria-label="标题" />
        </div>

        <div className="field">
          <span>游戏名称（预设 + 自定义）</span>
          <select className="select" value={preset} onChange={(e) => setPreset(e.target.value)} aria-label="游戏预设">
            {GAME_PRESETS.map((g) => <option key={g} value={g}>{g}</option>)}
            <option value={CUSTOM}>{CUSTOM}</option>
          </select>
          {preset === CUSTOM && (
            <input className="input" value={custom} maxLength={80} placeholder="自定义游戏名"
              onChange={(e) => setCustom(e.target.value)} aria-label="自定义游戏名" aria-invalid={customInvalid} />
          )}
          {customInvalid && <span className="field-error">请填写自定义游戏名</span>}
        </div>

        <DatetimePicker label="开始时间" value={start} onChange={setStart} />
        <div className="field">
          <div className="switch-row">
            <input className="switch" type="checkbox" id="edit-end-switch" checked={endOn} onChange={(e) => setEndOn(e.target.checked)} />
            <label htmlFor="edit-end-switch" className="t-label-large">设置结束时间</label>
          </div>
          {endOn && <DatetimePicker label="结束时间" value={end} onChange={setEnd} error={timeErr} />}
          {!endOn && <span className="hint">为空显示“待定”。</span>}
        </div>

        <div className="field">
          <span>总位置数 cap（当前参加 {confirmed} 人：confirmed {confirmed} + held {held}）</span>
          <div className="stepper">
            <button type="button" aria-label="减少人数上限" disabled={cap <= 1} onClick={() => setCap(clamp(cap - 1, 1, 100))}>−</button>
            <output>{cap}</output>
            <button type="button" aria-label="增加人数上限" disabled={cap >= 100} onClick={() => setCap(clamp(cap + 1, 1, 100))}>＋</button>
          </div>
          {capErr && <div className="edit-cap-error" role="alert"><span className="msr">error</span><span>{capErr}</span></div>}
        </div>

        <div className="field">
          <span>占位 held</span>
          <div className="stepper">
            <button type="button" aria-label="减少占位" disabled={held <= 0} onClick={() => setHeld(clamp(held - 1, 0, cap))}>−</button>
            <output>{held}</output>
            <button type="button" aria-label="增加占位" disabled={held >= cap} onClick={() => setHeld(clamp(held + 1, 0, cap))}>＋</button>
          </div>
        </div>

        <div className="field">
          <span>参加者管理（移除需二次确认；直接移除，有排队自动递补首位）</span>
          <div>
            {liveParts.map((p) => {
              const isOwner = p.discordId === ev.creatorDiscordId;
              return (
                <div className="edit-member-row" key={p.discordId}>
                  <AvatarImg className="avatar" src={avatarUrl(p.discordId, p.avatarHash)} seed={p.discordId} alt="" size={40} />
                  <span className="who"><div>{p.username}{isOwner ? "（房主）" : ""}</div></span>
                  <button
                    type="button"
                    className="btn btn-text-danger"
                    disabled={isOwner || busy}
                    title={isOwner ? "房主不可移除" : "移除"}
                    onClick={() => setPendingRemove(p.discordId)}
                  >
                    移除
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="field">
          <span>描述</span>
          <textarea className="textarea" value={desc} maxLength={2000} rows={3} onChange={(e) => setDesc(e.target.value)} />
          <div className="counter">{desc.length}/2000</div>
        </div>

        <div className="sticky-bar" style={{ marginBottom: -16 }}>
          <button type="button" className="btn btn-text" onClick={cancel}>取消</button>
          <button type="button" className="btn btn-filled" onClick={save} disabled={!canSave}>
            {busy && <span className="spin" aria-hidden />}
            保存
          </button>
        </div>
        <p className="t-body-medium" style={{ margin: 0 }}>保存禁用规则：无改动禁用；cap &lt; confirmed+held 禁用 + 错误文案。</p>
      </div>

      {pendingRemove && (
        <div className="scrim" onClick={() => !busy && setPendingRemove(null)}>
          <div className="sheet" role="alertdialog" aria-modal="true" aria-label="移除参加者确认" onClick={(e) => e.stopPropagation()}>
            <div className="grab" aria-hidden />
            <h3 className="t-title-large">移除参加者？</h3>
            <div className="dialog-danger-strip">移除后该位置释放；若有排队将自动递补首位。不可恢复。</div>
            <div className="dialog-actions">
              <button type="button" className="btn btn-text" onClick={() => setPendingRemove(null)} disabled={busy}>取消</button>
              <button type="button" className="btn btn-error" onClick={confirmRemove} disabled={busy}>
                {busy && <span className="spin" aria-hidden />}
                确认移除
              </button>
            </div>
          </div>
        </div>
      )}

      {dirtyLeave && (
        <div className="scrim" onClick={() => setDirtyLeave(false)}>
          <div className="sheet" role="alertdialog" aria-modal="true" aria-label="未保存更改" onClick={(e) => e.stopPropagation()}>
            <div className="grab" aria-hidden />
            <h3 className="t-title-large">放弃未保存的更改？</h3>
            <p className="t-body-large">已有改动尚未保存，现在退出将丢失。</p>
            <div className="dialog-actions">
              <button type="button" className="btn btn-text" onClick={() => setDirtyLeave(false)}>继续编辑</button>
              <button type="button" className="btn btn-error" onClick={() => onDone?.(null)}>放弃更改</button>
            </div>
          </div>
        </div>
      )}

      {snack && (
        <div className="snackbar" role="status">{snack}<span className="spacer" />
          <button className="snack-action" onClick={() => setSnack("")}>关闭</button>
        </div>
      )}
    </section>
  );
}
