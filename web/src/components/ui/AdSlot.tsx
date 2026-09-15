// AdSense slot that only appears after the user has stayed on the workspace for 5
// minutes (engaged-session monetization). Before that it renders nothing, so the
// editor stays clean for new/short visits. Loads the AdSense script once, lazily.
import { useEffect, useRef, useState } from "react";

const ADSENSE_CLIENT = "ca-pub-4554043228187575";
const REVEAL_AFTER_MS = 5 * 60 * 1000; // 5 minutes
// TODO: replace with a real ad unit slot id from the AdSense dashboard when available.
const AD_SLOT = "0000000000";

function ensureAdSenseScript(): void {
  if (typeof document === "undefined") return;
  if (document.querySelector('script[data-aptora-adsense]')) return;
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`;
  s.crossOrigin = "anonymous";
  s.setAttribute("data-aptora-adsense", "1");
  document.head.appendChild(s);
}

export default function AdSlot() {
  const [show, setShow] = useState(false);
  const insRef = useRef<HTMLModElement>(null);

  // Reveal only after 5 minutes of continuous session.
  useEffect(() => {
    const t = setTimeout(() => setShow(true), REVEAL_AFTER_MS);
    return () => clearTimeout(t);
  }, []);

  // Once revealed, load the script and register the unit.
  useEffect(() => {
    if (!show) return;
    ensureAdSenseScript();
    try {
      // @ts-expect-error adsbygoogle is injected by the AdSense script
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch { /* ad blockers / no-fill are non-fatal */ }
  }, [show]);

  if (!show) return null;

  return (
    <div className="ad-slot" aria-label="Advertisement">
      <ins
        ref={insRef}
        className="adsbygoogle"
        style={{ display: "block" }}
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={AD_SLOT}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  );
}
