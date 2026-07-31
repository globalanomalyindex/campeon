// The live trace for the blind turn: a seismograph, scrolled by the clock, drawn from
// instantaneous speed. The one thing this module must never do is what the retired dial did:
// derive geometry from accumulated path length. Any drawing that grows with the path hands the
// player a scale, and the edge of that scale becomes a finish line, so the instrument would be
// measuring its own meter again. Here the x axis is the clock and the y axis is speed over one
// fixed bin, which together carry provably zero information about how far around the player is.
// Pinned by tests/ui/turn-trace.test.ts "identical clocks and speeds draw identical traces".
import type { Ms } from '../../types';

/** How much clock the stage shows at once. */
export const TRACE_WINDOW_MS = 4000;

/** One pen sample. Fixed, so speed is counts over a constant slice of clock and never counts
 *  over the whole pass, which would be the path length wearing a hat. */
export const TRACE_BIN_MS = 16;

/** Speed, in counts per ms, at which the pen sits at half height. The y map is saturating
 *  (s / (s + half)) so no speed clips and no per-pass rescale is needed; a rescale would derive
 *  the y axis from the pass's own extremes, which is history leaking back into the drawing. */
export const TRACE_HALF_SPEED = 4;

/** 'scroll' slides the ink left as the clock runs. 'sweep' is the reduced-motion form: the ink
 *  holds still and only the pen advances, wrapping like a drum, so liveness survives without a
 *  whole field in motion. Both axes stay clock and speed in either mode. */
export type TraceMode = 'scroll' | 'sweep';

export interface TracePoint {
  /** Unit position along the window: 0 at the oldest edge, 1 at the newest. */
  x: number;
  /** Unit amplitude: 0 still, saturating toward 1 and never reaching it. */
  amp: number;
}

export interface TraceGeometry {
  /** Polylines in unit space. Plural because the sweep pen wraps: a segment never spans the
   *  wrap, which would draw a false stroke across the whole stage. */
  lines: TracePoint[][];
  /** The pen position in unit x. The right edge in scroll mode, by construction. */
  penX: number;
}

export interface SpeedTrace {
  /** A fresh pass draws on a blank drum. Skipping this would replay the previous pass's
   *  motion inside the new pass's window. */
  reset(t: Ms): void;
  /** Feed one sample's |dx|. The caller feeds exactly what the meter counts, so the trace
   *  shows counted motion and nothing the instrument ignored. */
  add(t: Ms, absDx: number): void;
  geometry(now: Ms, mode: TraceMode): TraceGeometry;
}

const binOf = (t: Ms): number => Math.floor(t / TRACE_BIN_MS);

export function createSpeedTrace(): SpeedTrace {
  let origin: Ms = 0;
  let counts = new Map<number, number>();

  return {
    reset(t: Ms): void {
      origin = t;
      counts = new Map();
    },

    add(t: Ms, absDx: number): void {
      if (t < origin || !Number.isFinite(absDx)) return;
      const i = binOf(t);
      counts.set(i, (counts.get(i) ?? 0) + Math.abs(absDx));
    },

    geometry(now: Ms, mode: TraceMode): TraceGeometry {
      // Prune bins that fell off the window, so a long pass cannot grow memory without bound.
      const cutoff = binOf(now - TRACE_WINDOW_MS) - 1;
      for (const k of counts.keys()) if (k < cutoff) counts.delete(k);

      const first = Math.max(binOf(origin), binOf(now - TRACE_WINDOW_MS) + 1);
      // The live bin is still accumulating; drawing it would under-read the newest speed.
      const last = binOf(now) - 1;

      const lines: TracePoint[][] = [];
      let line: TracePoint[] = [];
      let prevX = -Infinity;
      for (let i = first; i <= last; i++) {
        const tc = (i + 0.5) * TRACE_BIN_MS;
        if (tc < now - TRACE_WINDOW_MS) continue;
        const speed = (counts.get(i) ?? 0) / TRACE_BIN_MS;
        const amp = speed / (speed + TRACE_HALF_SPEED);
        // Scroll x reads off the distance from now; sweep x reads off the clock since the pass
        // began, wrapped. Neither has any way to see how many counts came before this bin.
        const x = mode === 'scroll'
          ? 1 - (now - tc) / TRACE_WINDOW_MS
          : ((tc - origin) % TRACE_WINDOW_MS) / TRACE_WINDOW_MS;
        if (x < prevX && line.length > 0) { lines.push(line); line = []; } // the sweep pen wrapped
        line.push({ x, amp });
        prevX = x;
      }
      if (line.length > 0) lines.push(line);

      const penX = mode === 'scroll'
        ? 1
        : ((now - origin) % TRACE_WINDOW_MS) / TRACE_WINDOW_MS;
      return { lines, penX };
    },
  };
}
