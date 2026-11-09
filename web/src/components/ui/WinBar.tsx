// macOS-style window title bar for popups: three traffic-light dots on the left
// (red closes; amber/green are inert window decor, standard affordance) plus an
// optional centered title. Reused across every popup so the chrome is consistent.
// `light` switches to the white-popup palette (Budget / Pricing / Calendly).

export default function WinBar({ onClose, title, light = false }: { onClose: () => void; title?: string; light?: boolean }) {
  return (
    <div className={`winbar${light ? " light" : ""}`}>
      <div className="winbar-dots">
        <button type="button" className="winbar-dot close" aria-label="Close" onClick={onClose} />
        <span className="winbar-dot min" aria-hidden="true" />
        <span className="winbar-dot max" aria-hidden="true" />
      </div>
      {title && <span className="winbar-title">{title}</span>}
    </div>
  );
}
