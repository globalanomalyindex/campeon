import { describe, it, expect } from 'vitest';
import { plotGeometry } from '../../src/ui/convergence-plot';

const size = { width: 600, height: 300 };
const bounds: [number, number] = [15, 60];

describe('plotGeometry', () => {
  it('maps the cm/360 bounds (log axis) to the padded x-extent', () => {
    const g = plotGeometry({ bounds, marks: [], size });
    const left = g.xToPx(15);
    const right = g.xToPx(60);
    expect(left).toBeCloseTo(g.pad, 6);
    expect(right).toBeCloseTo(size.width - g.pad, 6);
    expect(g.xToPx(Math.sqrt(15 * 60))).toBeCloseTo((left + right) / 2, 6); // log axis midpoint
  });

  it('places marks inside the plot and tags them with their instrument', () => {
    const g = plotGeometry({ bounds, marks: [{ cm360: 30, score: 0.2, instrument: 'flick' }], size });
    expect(g.marks).toHaveLength(1);
    expect(g.marks[0].instrument).toBe('flick');
    expect(g.marks[0].px).toBeGreaterThan(g.pad);
    expect(g.marks[0].px).toBeLessThan(size.width - g.pad);
    expect(g.marks[0].py).toBeGreaterThanOrEqual(g.pad);
    expect(g.marks[0].py).toBeLessThanOrEqual(size.height - g.pad);
  });

  it('builds an SVG path for the fitted curve and a CI rect + peak line', () => {
    const curve = [
      { x: Math.log(20), mean: 0 },
      { x: Math.log(30), mean: 0.5 },
      { x: Math.log(45), mean: 0.1 },
    ];
    const g = plotGeometry({ bounds, marks: [], curve, ci90: [27, 36], peak: 31, size });
    expect(g.curvePath).toMatch(/^M /);
    expect(g.ciRectPx).not.toBeNull();
    expect(g.ciRectPx!.width).toBeGreaterThan(0);
    expect(g.peakPx).toBeGreaterThan(g.pad);
  });

  it('handles empty data without throwing (no curve, no band)', () => {
    const g = plotGeometry({ bounds, marks: [], size });
    expect(g.curvePath).toBeNull();
    expect(g.ciRectPx).toBeNull();
    expect(g.peakPx).toBeNull();
  });
});
