import { useEffect, useState } from "react";

// Animated circular progress gauge (SVG stroke-dashoffset). No libraries.
interface Props {
  value: number;      // 0-100
  label?: string;
  size?: number;
}

export default function Gauge({ value, label, size = 96 }: Props) {
  const [shown, setShown] = useState(0);
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(pct));
    return () => cancelAnimationFrame(id);
  }, [pct]);

  const color = pct >= 75 ? "var(--success)" : pct >= 45 ? "var(--warning)" : "var(--danger)";

  return (
    <div className="gauge" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth="6" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={circ - (shown / 100) * circ}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dashoffset 900ms cubic-bezier(.22,.61,.36,1)" }}
        />
      </svg>
      <div className="gauge-center">
        <span className="gauge-val">{Math.round(shown)}<em>%</em></span>
        {label && <span className="gauge-label">{label}</span>}
      </div>
    </div>
  );
}
