import { describe, it, expect } from 'vitest';
import { counts360, countsBounds } from '../../src/types';
import { plotGeometry } from '../../src/ui/convergence-plot';

const size = { width: 600, height: 300 };
const bounds = countsBounds(15, 60);

describe('plotGeometry', () => {
  it('maps the cm/360 bounds (log axis) to the padded x-extent', () => {
    const g = plotGeometry({ bounds, marks: [], size });
    const left = g.xToPx(counts360(15));
    const right = g.xToPx(counts360(60));
    expect(left).toBeCloseTo(g.pad, 6);
    expect(right).toBeCloseTo(size.width - g.pad, 6);
    expect(g.xToPx(counts360(Math.sqrt(15 * 60)))).toBeCloseTo((left + right) / 2, 6); // log axis midpoint
  });

  it('places marks inside the plot and tags them with their instrument', () => {
    const g = plotGeometry({ bounds, marks: [{ counts: counts360(30), score: 0.2, instrument: 'flick' }], size });
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
    const g = plotGeometry({ bounds, marks: [], curve, ci90: countsBounds(27, 36), peak: counts360(31), size });
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
    expect(g.facetPeaks).toEqual([]);
  });

  it('maps A5 facet peaks to the axis with spread whiskers in ln space', () => {
    const g = plotGeometry({
      bounds, marks: [], size,
      facetPeaks: [
        { instrument: 'track', peakCounts: counts360(30), spreadLn: 0.1, laneConditioned: false },
        { instrument: 'strike', peakCounts: counts360(40), spreadLn: 0.2, laneConditioned: true },
      ],
    });
    expect(g.facetPeaks).toHaveLength(2);
    const track = g.facetPeaks[0];
    expect(track.px).toBeCloseTo(g.xToPx(counts360(30)), 6);
    // whisker ends are exp(ln(peak) +/- spreadLn) mapped through the SAME log axis
    expect(track.whisker!.x0).toBeCloseTo(g.xToPx(counts360(Math.exp(Math.log(30) - 0.1))), 6);
    expect(track.whisker!.x1).toBeCloseTo(g.xToPx(counts360(Math.exp(Math.log(30) + 0.1))), 6);
    expect(g.facetPeaks[1].laneConditioned).toBe(true);
  });

  it('skips unfittable facet peaks (undefined) and whiskers (no spread) - never fakes geometry', () => {
    const g = plotGeometry({
      bounds, marks: [], size,
      facetPeaks: [
        { instrument: 'calibrate', laneConditioned: false }, // no peak - dashed in copy, absent here
        { instrument: 'flick', peakCounts: counts360(28), laneConditioned: false }, // peak but no spread
      ],
    });
    expect(g.facetPeaks).toHaveLength(1);
    expect(g.facetPeaks[0].instrument).toBe('flick');
    expect(g.facetPeaks[0].whisker).toBeNull();
  });

  it('clamps a facet whisker that would overflow the plot extent', () => {
    const g = plotGeometry({
      bounds, marks: [], size,
      facetPeaks: [{ instrument: 'track', peakCounts: counts360(58), spreadLn: 0.5, laneConditioned: false }],
    });
    expect(g.facetPeaks[0].whisker!.x1).toBeLessThanOrEqual(size.width - g.pad);
  });
});
