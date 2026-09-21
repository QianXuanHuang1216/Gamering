/** 404 空态（§3 P2 错态）：事件不存在或已删除。 */
export default function NotFound() {
  return (
    <main className="stack">
      <div className="card">
        <div className="empty" data-testid="not-found-empty">
          <span className="empty-illo">
            <span className="msr">search_off</span>
          </span>
          <p className="t-title-medium">事件不存在或已删除</p>
          <div className="row-wrap" style={{ justifyContent: "center" }}>
            <a className="btn btn-filled" href="/events/new">
              创建事件
            </a>
            <a className="btn btn-text" href="/">
              回首页
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
