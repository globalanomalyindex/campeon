// The one renderer for the speed trace, shared by both calibration instruments. The geometry it
// draws is pure and lives in turn-trace.ts; this file is the canvas shell around it and is
// runtime-verified, not unit-tested.
//
// Shared rather than copied because the trace is a claim, not a decoration: x is the clock and y is
// instantaneous speed, so the drawing can prove the instrument is reading without leaking how far
// the hand has travelled. Two hand-copied painters would be two places for an "improvement" to
// creep in that scales the ink by the pass total, which is the retired dial growing back
// (tests/ui/turn-trace.test.ts "identical clocks and speeds draw identical traces" pins the
// geometry, and it can only pin what one painter draws).
import type { TraceGeometry } from './turn-trace';
import { hex, rgba } from '../../palette';

export interface TracePainter {
  /** True when a 2D context exists. jsdom has none, and mounting a view must not depend on one. */
  ready(): boolean;
  /** Size the backing store to the stage, then draw one frame. A no-op without a context. */
  paint(g: TraceGeometry): void;
}

/** Cap the backing store at 2x. Beyond that the trace is fatter to rasterize and no clearer. */
const maxDpr = (): number => Math.min(window.devicePixelRatio || 1, 2);

export function createTracePainter(canvas: HTMLCanvasElement, stage: HTMLElement): TracePainter {
  // Asked for lazily, and once: getContext on a jsdom canvas returns null every time, and calling
  // it per frame would be a null check dressed as work.
  let ctx2d: CanvasRenderingContext2D | null | undefined;
  const ctx = (): CanvasRenderingContext2D | null => {
    if (ctx2d === undefined) ctx2d = canvas.getContext('2d');
    return ctx2d;
  };

  function size(c: CanvasRenderingContext2D): void {
    // Read the ratio per frame rather than capturing it: dragging the window to a different-density
    // monitor changes devicePixelRatio, and a captured one would rasterize at the old density.
    const dpr = maxDpr();
    const w = Math.max(1, Math.round(stage.clientWidth * dpr));
    const h = Math.max(1, Math.round(stage.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  return {
    ready: () => ctx() !== null,
    paint(g: TraceGeometry): void {
      const c = ctx();
      if (!c) return;
      size(c);
      const dpr = maxDpr();
      const w = canvas.width / dpr, h = canvas.height / dpr;
      c.clearRect(0, 0, w, h);
      // No axis, no labels: the resting pen draws its own zero line, and any rule under it would
      // start reading as a scale.
      const baseline = h * 0.7, top = h * 0.14;
      c.strokeStyle = hex.calibrate;
      c.lineWidth = 1.5;
      c.lineJoin = 'miter';
      for (const line of g.lines) {
        c.beginPath();
        for (let i = 0; i < line.length; i++) {
          const px = line[i]!.x * w;
          const py = baseline - line[i]!.amp * (baseline - top);
          if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
        }
        c.stroke();
      }
      // The pen: a short tick at the writing edge. In sweep mode this is the one thing that moves,
      // and it is what proves the instrument is alive while the hand is still.
      c.strokeStyle = rgba('paper', 0.55);
      c.lineWidth = 1;
      c.beginPath();
      const penPx = Math.min(g.penX * w, w - 1);
      c.moveTo(penPx, baseline - 7);
      c.lineTo(penPx, baseline + 7);
      c.stroke();
    },
  };
}
