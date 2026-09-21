"use client";

import { useMemo, useState } from "react";
import { isPastDate } from "@/lib/edit-validate";

const pad = (n) => String(n).padStart(2, "0");
const DOW = ["一", "二", "三", "四", "五", "六", "日"];

/**
 * SPA-506 C：M3 Expressive 风格日期/时间选择器（只用现有 token，无外部日期库）。
 * value: { date: "YYYY-MM-DD", hour, minute } | null；onChange 同形。
 */
export default function DatetimePicker({ label, value, onChange, disablePast = true, error }) {
  const [dateOpen, setDateOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const init = value ?? { date: "", hour: 12, minute: 0 };
  const [view, setView] = useState(() => {
    const [y, m] = (init.date || "").split("-").map(Number);
    const now = new Date();
    return { y: y || now.getFullYear(), m: m || now.getMonth() + 1 };
  });
  const [selH, setSelH] = useState(init.hour);
  const [selM, setSelM] = useState(init.minute);

  const days = useMemo(() => {
    const first = new Date(view.y, view.m - 1, 1);
    const blanks = (first.getDay() + 6) % 7; // 周一起始
    const total = new Date(view.y, view.m, 0).getDate();
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    return { blanks, total, todayStr };
  }, [view]);

  const shown = value ? `${value.date} ${pad(value.hour)}:${pad(value.minute)}` : "请选择";

  function pickDay(d) {
    const date = `${view.y}-${pad(view.m)}-${pad(d)}`;
    onChange({ date, hour: value?.hour ?? 12, minute: value?.minute ?? 0 });
    setDateOpen(false);
  }

  function confirmTime() {
    onChange({ date: value?.date ?? "", hour: selH, minute: selM });
    setTimeOpen(false);
  }

  return (
    <div className="field">
      <span>{label}</span>
      <div className="row-wrap">
        <button
          type="button"
          className="datetime-field-btn"
          style={{ flex: 1, minWidth: 0 }}
          onClick={() => setDateOpen(true)}
          aria-haspopup="dialog"
          aria-invalid={!!error}
        >
          <span className="msr">calendar_month</span>
          <span>{value?.date || "选择日期"}</span>
          <span className="spacer" />
          <span className="msr">expand_more</span>
        </button>
        <button
          type="button"
          className="datetime-field-btn"
          style={{ flex: 1, minWidth: 0 }}
          onClick={() => { setSelH(value?.hour ?? 12); setSelM(value?.minute ?? 0); setTimeOpen(true); }}
          aria-haspopup="dialog"
          aria-invalid={!!error}
        >
          <span className="msr">schedule</span>
          <span>{value ? `${pad(value.hour)}:${pad(value.minute)}` : "选择时间"}</span>
          <span className="spacer" />
          <span className="msr">expand_more</span>
        </button>
      </div>
      <span className="hint">{shown}</span>
      {error && <span className="field-error">{error}</span>}

      {dateOpen && (
        <div className="scrim" onClick={() => setDateOpen(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label="选择日期" onClick={(e) => e.stopPropagation()}>
            <div className="grab" aria-hidden />
            <div className="datepicker-dialog" style={{ margin: "0 auto" }}>
              <div className="datepicker-title">
                <h3 className="t-title-large" style={{ flex: 1 }}>{view.y} 年 {view.m} 月</h3>
                <button type="button" className="btn btn-text" aria-label="上个月"
                  onClick={() => setView(view.m === 1 ? { y: view.y - 1, m: 12 } : { y: view.y, m: view.m - 1 })}>‹</button>
                <button type="button" className="btn btn-text" aria-label="下个月"
                  onClick={() => setView(view.m === 12 ? { y: view.y + 1, m: 1 } : { y: view.y, m: view.m + 1 })}>›</button>
              </div>
              <div className="datepicker-grid" role="grid" aria-label={`${view.m} 月日历`}>
                {DOW.map((d) => <div className="datepicker-dow" key={d}>{d}</div>)}
                {Array.from({ length: days.blanks }, (_, i) => <div key={`b${i}`} />)}
                {Array.from({ length: days.total }, (_, i) => {
                  const d = i + 1;
                  const str = `${view.y}-${pad(view.m)}-${pad(d)}`;
                  const disabled = disablePast && isPastDate(str);
                  return (
                    <button
                      key={d}
                      type="button"
                      className={`datepicker-day${str === value?.date ? " selected" : ""}${str === days.todayStr ? " today" : ""}`}
                      disabled={disabled}
                      onClick={() => pickDay(d)}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
              <div className="dialog-actions">
                <button type="button" className="btn btn-text" onClick={() => setDateOpen(false)}>取消</button>
                <button type="button" className="btn btn-filled" onClick={() => setDateOpen(false)}>确认</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {timeOpen && (
        <div className="scrim" onClick={() => setTimeOpen(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label="选择时间" onClick={(e) => e.stopPropagation()}>
            <div className="grab" aria-hidden />
            <h3 className="t-title-large">选择时间</h3>
            <div className="timepicker-cols">
              <div className="timepicker-col" aria-label="小时">
                {Array.from({ length: 24 }, (_, h) => (
                  <button key={h} type="button" className={h === selH ? "selected" : ""} onClick={() => setSelH(h)}>
                    {pad(h)}
                  </button>
                ))}
              </div>
              <div className="timepicker-col" aria-label="分钟">
                {Array.from({ length: 60 }, (_, m) => (
                  <button key={m} type="button" className={m === selM ? "selected" : ""} onClick={() => setSelM(m)}>
                    {pad(m)}
                  </button>
                ))}
              </div>
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn btn-text" onClick={() => setTimeOpen(false)}>取消</button>
              <button type="button" className="btn btn-filled" onClick={confirmTime}>确认</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
