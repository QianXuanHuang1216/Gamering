import { STATUS_META } from "@/lib/present";

/** 状态徽章 Filter Chip（§5）：accent 只跟时间状态，容量永不动色（§6）。 */
export default function StatusBadge({ status }) {
  const meta = STATUS_META[status] ?? STATUS_META.scheduled;
  return (
    <span className={`badge ${meta.cls}`} data-testid={`badge-${status}`}>
      {status === "live" ? (
        <span className="dot-live" aria-hidden />
      ) : (
        <span className="msr md-18" aria-hidden>
          {meta.icon}
        </span>
      )}
      {meta.label}
    </span>
  );
}
