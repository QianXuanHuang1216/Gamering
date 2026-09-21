"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ManageBox({ id, status }) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const terminal = status === "ended" || status === "cancelled";

  async function op(name) {
    if (name === "cancel" && !confirm("取消后不可恢复，确认取消？")) return;
    const res = await fetch(`/api/events/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: name }),
    });
    const data = await res.json();
    setMsg(res.ok ? (name === "end" ? "已结束" : "已取消") : `失败：${data.error}`);
    router.refresh();
  }

  if (terminal) return <p>事件已终态（{status}）。</p>;
  return (
    <section>
      <h2>房主管理</h2>
      <button onClick={() => op("end")}>结束</button>{" "}
      <button onClick={() => op("cancel")} style={{ color: "red" }}>
        取消
      </button>
      {msg && <p>{msg}</p>}
    </section>
  );
}
