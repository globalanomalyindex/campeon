import { describe, it, expect } from 'vitest';
import {
  createSpeedTrace, TRACE_BIN_MS, TRACE_WINDOW_MS, type SpeedTrace, type TraceMode,
} from '../../src/ui/calibrate/turn-trace';

/**
 * The property that separates this trace from the dial it replaced. The dial drew from
 * accumulated path length, so it filled toward a constant and its edge became a finish line;
 * this trace draws from the clock and instantaneous speed, so its geometry must carry zero
 * information about how far around the player is. The two tests that pin it: identical clocks
 * and speeds must draw identically whatever the totals, and the same total on a different
 * clock must draw differently. A dial fails both, in opposite directions.
 */

const W = TRACE_WINDOW_MS;
const BINS_PER_WINDOW = W / TRACE_BIN_MS;

/** Feed one add per bin, at the bin centre, offset by `t0`. `perBin[i]` is that bin's counts. */
function feed(trace: SpeedTrace, t0: number, perBin: readonly number[]): void {
  for (let i = 0; i < perBin.length; i++) trace.add(t0 + (i + 0.5) * TRACE_BIN_MS, perBin[i]);
}

const total = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

/** A deterministic, non-repeating window of speeds: the shape both streams must share. */
const pattern = Array.from({ length: BINS_PER_WINDOW }, (_, i) => (i % 7) * 3 + (i % 3));

for (const mode of ['scroll', 'sweep'] as TraceMode[]) {
  describe(`turn trace stays blind to the path (${mode})`, () => {
    it('identical clocks and speeds draw identical traces, whatever the totals', () => {
      // Stream A is one bare window of the pattern. Stream B spends nine windows travelling
      // hard before drawing that same window, so its accumulated path is over ten times A's.
      // Any geometry that reads the accumulation, however laundered, must differ between the
      // two; the dial this replaced would have been full for B before its window even began.
      const prefix = Array.from({ length: 9 * BINS_PER_WINDOW }, (_, i) => 40 + (i % 11));
      const a = createSpeedTrace();
      a.reset(0);
      feed(a, 0, pattern);
      const b = createSpeedTrace();
      b.reset(0);
      feed(b, 0, prefix);
      feed(b, 9 * W, pattern);
      expect(total(prefix) + total(pattern)).toBeGreaterThan(10 * total(pattern));
      expect(b.geometry(10 * W, mode)).toEqual(a.geometry(W, mode));
    });

    it('the same total on a different clock draws a different trace', () => {
      // The converse, so the first test cannot be satisfied by drawing nothing: equal path
      // totals, but one stream spends them evenly and the other packs them into the first
      // half. Speed against the clock distinguishes them; a path-length dial cannot.
      const even = Array.from({ length: BINS_PER_WINDOW }, () => 64);
      const packed = Array.from({ length: BINS_PER_WINDOW }, (_, i) => (i < BINS_PER_WINDOW / 2 ? 128 : 0));
      expect(total(packed)).toBe(total(even));
      const c = createSpeedTrace();
      c.reset(0);
      feed(c, 0, even);
      const d = createSpeedTrace();
      d.reset(0);
      feed(d, 0, packed);
      expect(d.geometry(W, mode)).not.toEqual(c.geometry(W, mode));
    });
  });
}

describe('turn trace: the drawing itself', () => {
  it('a still hand draws a flat line at zero, never a blank stage', () => {
    // The defect this prevents is the owner's report: a pure black box with no sign the
    // instrument is reading. Silence must still draw.
    const t = createSpeedTrace();
    t.reset(0);
    const g = t.geometry(1000, 'scroll');
    expect(g.lines.length).toBe(1);
    expect(g.lines[0].length).toBeGreaterThan(30);
    expect(g.lines[0].every((p) => p.amp === 0)).toBe(true);
  });

  it('speed saturates below full height, so no flick clips against a ceiling', () => {
    const t = createSpeedTrace();
    t.reset(0);
    t.add(TRACE_BIN_MS / 2, 1e9);
    const amps = t.geometry(100, 'scroll').lines[0].map((p) => p.amp);
    expect(Math.max(...amps)).toBeGreaterThan(0.99);
    expect(Math.max(...amps)).toBeLessThan(1);
  });

  it('draws nothing from before the pass began: no invented history', () => {
    const t = createSpeedTrace();
    t.reset(10_000);
    const g = t.geometry(11_000, 'scroll');
    // One second of pass inside a four second window: only the newest quarter holds ink.
    expect(Math.min(...g.lines[0].map((p) => p.x))).toBeGreaterThan(0.7);
    expect(g.penX).toBe(1);
  });

  it('the sweep pen wraps between segments, never stroking across the stage', () => {
    const t = createSpeedTrace();
    t.reset(0);
    const g = t.geometry(1.5 * W, 'sweep');
    expect(g.lines.length).toBe(2);
    for (const line of g.lines) {
      for (let i = 1; i < line.length; i++) expect(line[i].x).toBeGreaterThan(line[i - 1].x);
    }
    expect(g.penX).toBeCloseTo(0.5, 6);
  });

  it('reset clears the drum: the previous pass cannot bleed into the next one', () => {
    const t = createSpeedTrace();
    t.reset(0);
    feed(t, 0, Array.from({ length: BINS_PER_WINDOW }, () => 80));
    t.reset(W);
    const g = t.geometry(W + 500, 'scroll');
    expect(g.lines.flat().every((p) => p.amp === 0)).toBe(true);
  });
});
