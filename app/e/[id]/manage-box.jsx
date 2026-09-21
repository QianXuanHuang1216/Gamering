"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import EditBox from "./edit-box";

/** 房主管理（§3 P3 结束/取消区分 + SPA-506 编辑事件入口）：tonal 编辑/结束 vs error 取消。 */
export default function ManageBox({ id, status, ev, participants }) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [dialog, setDialog] = useState(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const terminal = status === "ended" || status === "cancelled";

  async function op(name) {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(`/api/events/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: name }),
      });
      const data = await res.json();
      if (res.ok) {
        setDialog(null);
        setMsg(name === "end" ? "已结束" : "已取消");
        router.refresh();
      } else {
        setMsg(`失败：${data.error ?? "操作失败"}`);
      }
    } catch {
      setMsg("失败：网络错误");
    } finally {
      setBusy(false);
    }
  }

  if (terminal) return <p className="t-body-medium">事件已终态（{status === "ended" ? "已结束" : "已取消"}）。</p>;

  if (editing && ev) {
    return (
      <EditBox
        id={id}
        ev={ev}
        participants={participants ?? []}
        onDone={(m, keepOpen) => {
          if (m && m !== "removed") setMsg(m);
          if (!keepOpen) setEditing(false);
          router.refresh();
        }}
      />
    );
  }

  return (
    <section className="card card-outlined" aria-label="房主管理" data-testid="manage-box">
      <h2 className="t-title-medium">房主管理</h2>
      <div className="row-wrap" style={{ marginTop: 12 }}>
        <button type="button" className="btn btn-tonal" onClick={() => setEditing(true)}>
          <span className="msr md-18">edit</span>编辑事件
        </button>
        <button type="button" className="btn btn-tonal" onClick={() => { setDialog("end"); setAck(false); }}>
          <span className="msr md-18">stop</span>结束
        </button>
        <button type="button" className="btn btn-error" onClick={() => { setDialog("cancel"); setAck(false); }}>
          <span className="msr md-18">cancel</span>取消
        </button>
      </div>

      {dialog === "end" && (
        <div className="scrim" onClick={() => !busy && setDialog(null)}>
          <div className="sheet" role="alertdialog" aria-modal="true" aria-label="结束事件确认" onClick={(e) => e.stopPropagation()}>
            <div className="grab" aria-hidden />
            <h3 className="t-title-large">结束事件？</h3>
            <p className="t-body-large">结束后 Discord 卡变灰、按钮停用，不可恢复。</p>
            <div className="dialog-actions">
              <button type="button" className="btn btn-text" onClick={() => setDialog(null)} disabled={busy}>
                取消
              </button>
              <button type="button" className="btn btn-tonal" onClick={() => op("end")} disabled={busy}>
                {busy && <span className="spin" aria-hidden />}
                结束
              </button>
            </div>
          </div>
        </div>
      )}

      {dialog === "cancel" && (
        <div className="scrim" onClick={() => !busy && setDialog(null)}>
          <div className="sheet" role="alertdialog" aria-modal="true" aria-label="取消事件确认" onClick={(e) => e.stopPropagation()}>
            <div className="grab" aria-hidden />
            <h3 className="t-title-large">取消事件？</h3>
            <div className="dialog-danger-strip">取消后所有报名清空（仅留记录）、Discord 卡变灰，不可恢复。</div>
            <label className="confirm-check" style={{ marginTop: 12 }}>
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              我确认取消
            </label>
            <div className="dialog-actions">
              <button type="button" className="btn btn-text" onClick={() => setDialog(null)} disabled={busy}>
                取消
              </button>
              <button type="button" className="btn btn-error" onClick={() => op("cancel")} disabled={busy || !ack}>
                {busy && <span className="spin" aria-hidden />}
                确认取消
              </button>
            </div>
          </div>
        </div>
      )}

      {msg && (
        <div className="snackbar" role="status">
          {msg}
        </div>
      )}
    </section>
  );
}
