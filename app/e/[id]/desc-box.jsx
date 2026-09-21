"use client";

import { useState } from "react";

/** 描述卡折叠：>400 字折叠 + “展开” Text button（§3 P2）。 */
export default function DescBox({ text }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 400;
  return (
    <section className="card" aria-label="事件描述" data-testid="desc-card">
      <h2 className="t-title-medium">描述</h2>
      <p className="t-body-large" style={{ whiteSpace: "pre-wrap", margin: "8px 0 0" }}>
        {long && !open ? text.slice(0, 400) + "…" : text}
      </p>
      {long && !open && (
        <button type="button" className="btn btn-text" onClick={() => setOpen(true)}>
          展开
        </button>
      )}
    </section>
  );
}
