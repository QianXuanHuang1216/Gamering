"use client";

import { useState } from "react";
import StatusBadge from "@/app/status-badge";
import { relText } from "@/lib/present";

const TABS = [
  { key: "scheduled", label: "未开始", empty: "还没有未开始的事件" },
  { key: "live", label: "正在进行", empty: "还没有正在进行的事件" },
  { key: "ended", label: "已结束", empty: "还没有已结束的事件" },
  { key: "cancelled", label: "已取消", empty: "还没有已取消的事件" },
];

/** P3 Tab 列表（§3 P3）：Primary Tabs + badge + Outlined card。展示层。 */
export default function TabsBox({ groups }) {
  const [tab, setTab] = useState("scheduled");
  const now = Date.now();
  const meta = TABS.find((t) => t.key === tab);
  const list = groups[tab] ?? [];
  return (
    <div className="stack" data-testid="me-tabs">
      <div className="tabs" role="tablist" aria-label="我的事件状态">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            className="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            <span className="tab-badge">{groups[t.key]?.length ?? 0}</span>
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <div className="card">
          <div className="empty" data-testid={`empty-${tab}`}>
            <span className="empty-illo">
              <span className="msr">event_busy</span>
            </span>
            <p className="t-title-medium">{meta.empty}</p>
            {tab === "scheduled" && (
              <a className="btn btn-filled" href="/events/new">
                <span className="msr md-18">add</span>创建事件
              </a>
            )}
          </div>
        </div>
      ) : (
        <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {list.map((e) => {
            const terminal = tab === "ended" || tab === "cancelled";
            return (
              <li key={e.id} className={`card card-outlined${terminal ? " card-terminal" : ""}`}>
                <div className="event-row">
                  <div className="grow stack-8">
                    <div className="row-wrap">
                      <p className="t-title-medium" style={{ margin: 0 }}>
                        {tab === "cancelled" ? "【已取消】" : ""}
                        {e.gameText}
                      </p>
                      <StatusBadge status={tab} />
                    </div>
                    <div className="t-body-medium">
                      {tab === "scheduled" && `${relText(e.startAt, now)}开始`}
                      {tab === "live" && "进行中"}
                      {tab === "ended" && "已结束"}
                      {tab === "cancelled" && "已取消"}
                    </div>
                    <div className="t-body-medium">
                      {e.confirmed + e.held}/{e.cap} · 还差 {Math.max(0, e.cap - e.confirmed - e.held)} · 排队 {e.waitlisted}
                    </div>
                  </div>
                  {terminal ? (
                    <a className="btn btn-text" href={`/e/${e.id}`}>
                      查看
                    </a>
                  ) : (
                    <a className="btn btn-text" href={`/e/${e.id}#push`}>
                      管理
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
