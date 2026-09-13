import { useState } from "react";
import { ZoomIn, ZoomOut, Maximize2, RotateCw } from "lucide-motion";
import IconButton from "../ui/IconButton";
import type { SaveState } from "./MenuBar";

// Right pane: the ACTUAL generated document as rasterized page images (not HTML, not PDF.js).
// Own toolbar (recompile · page nav · zoom) and own scroll. Export lives in the menu bar.
interface Props {
  documentId: string | null;
  pageCount: number;
  saveState: SaveState;
  onRecompile: () => void;
}

const ZOOMS = [0.5, 0.6, 0.75, 0.9, 1, 1.15, 1.35, 1.6];
const FIT = 4;

export default function PreviewPane({ documentId, pageCount, saveState, onRecompile }: Props) {
  const [zoomIdx, setZoomIdx] = useState(FIT);
  const zoom = ZOOMS[zoomIdx];
  const base = 560;

  return (
    <div className="preview-pane" aria-busy={saveState === "updating"}>
      <div className="pv-toolbar">
        <div className="pv-tb-left">
          <button type="button" className="pv-recompile" onClick={onRecompile} disabled={saveState === "updating"}>
            <RotateCw size={14} className={saveState === "updating" ? "spin-animate" : ""} /> <span>{saveState === "updating" ? "Compiling…" : "Recompile"}</span>
          </button>
        </div>
        <div className="pv-tb-right">
          <span className="pv-pages">{pageCount > 0 ? `${pageCount} page${pageCount > 1 ? "s" : ""}` : ""}</span>
          <div className="pv-zoom">
            <IconButton label="Zoom out" disabled={zoomIdx === 0} onClick={() => setZoomIdx((i) => Math.max(0, i - 1))}><ZoomOut size={15} /></IconButton>
            <span className="pv-zoom-val">{Math.round(zoom * 100)}%</span>
            <IconButton label="Zoom in" disabled={zoomIdx === ZOOMS.length - 1} onClick={() => setZoomIdx((i) => Math.min(ZOOMS.length - 1, i + 1))}><ZoomIn size={15} /></IconButton>
            <IconButton label="Fit" onClick={() => setZoomIdx(FIT)}><Maximize2 size={14} /></IconButton>
          </div>
        </div>
      </div>

      {saveState === "updating" && (
        <div className="pv-compiling-bar" aria-live="polite">
          <div className="pv-compiling-fill" />
        </div>
      )}

      <div className="pv-scroll">
        {!documentId && saveState !== "error" && <div className="sheet skeleton" style={{ width: `${base * zoom}px` }} aria-hidden="true" />}
        {documentId && Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
          <figure key={`${documentId}-${n}`} className="sheet-wrap">
            <img className="sheet" style={{ width: `${base * zoom}px` }} src={`/api/preview/${documentId}/pages/${n}`} alt={`Resume page ${n}`} loading={n === 1 ? "eager" : "lazy"} />
            {pageCount > 1 && <figcaption className="sheet-num">{n}</figcaption>}
          </figure>
        ))}
        {saveState === "error" && !documentId && (
          <div className="pv-error">
            <p>We couldn't update the preview.</p>
            <p className="muted">Your latest changes couldn't be compiled. Fix the source and try again.</p>
          </div>
        )}
      </div>
    </div>
  );
}
