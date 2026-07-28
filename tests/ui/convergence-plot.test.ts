import { describe, it, expect } from 'vitest';
import { countTicks, plotGeometry, tickLabel } from '../../src/ui/convergence-plot';
import { counts360, type Counts360 } from '../../src/types';

const c = counts360;
const size = { width: 600, height: 300 };
const bounds: [Counts360, Counts360] = [c(1500), c(24000)];

describe('countTicks', () => {
  it('walks the 1/1.5/2/3/5/7 ladder per decade inside the bounds', () => {
    expect(countTicks(1500, 24000)).toEqual([1500, 2000, 3000, 5000, 7000, 10000, 15000, 20000]);
  });
  it('thins to 1/2/5 when the full ladder would shingle the labels', () => {
    expect(countTicks(200, 90000)).toEqual([200, 500, 1000, 2000, 5000, 10000, 20000, 50000]);
  });
  it('labels compactly: a 10px mono tick cannot afford five digits', () => {
    expect(tickLabel(800)).toBe('800');
    expect(tickLabel(1500)).toBe('1.5k');
    expect(tickLabel(8000)).toBe('8k');
    expect(tickLabel(20000)).toBe('20k');
  });
});

describe('plotGeometry', () => {
  it('maps the counts bounds (log axis) to the padded x-extent', () => {
    const g = plotGeometry({ bounds, marks: [], size });
    const left = g.xToPx(1500);
    const right = g.xToPx(24000);
    expect(left).toBeCloseTo(g.pad, 6);
    expect(right).toBeCloseTo(size.width - g.pad, 6);
    expect(g.xToPx(6000)).toBeCloseTo((left + right) / 2, 6); // log midpoint: sqrt(1500 * 24000) = 6000
  });

  it('places marks inside the plot and tags them with their instrument', () => {
    const g = plotGeometry({ bounds, marks: [{ counts: c(8000), score: 0.2, instrument: 'flick' }], size });
    expect(g.marks).toHaveLength(1);
    expect(g.marks[0].instrument).toBe('flick');
    expect(g.marks[0].px).toBeGreaterThan(g.pad);
    expect(g.marks[0].px).toBeLessThan(size.width - g.pad);
    expect(g.marks[0].py).toBeGreaterThanOrEqual(g.pad);
    expect(g.marks[0].py).toBeLessThanOrEqual(size.height - g.pad);
  });

  it('builds an SVG path for the fitted curve and a CI rect + peak line', () => {
    const curve = [
      { x: Math.log(3000), mean: 0 },
      { x: Math.log(8000), mean: 0.5 },
      { x: Math.log(15000), mean: 0.1 },
    ];
    const g = plotGeometry({ bounds, marks: [], curve, ci90: [c(7000), c(9500)], peak: c(8000), size });
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
        { instrument: 'track', peakCounts: c(8000), spreadLn: 0.1, laneConditioned: false },
        { instrument: 'strike', peakCounts: c(10000), spreadLn: 0.2, laneConditioned: true },
      ],
    });
    expect(g.facetPeaks).toHaveLength(2);
    const track = g.facetPeaks[0];
    expect(track.px).toBeCloseTo(g.xToPx(8000), 6);
    // whisker ends are exp(ln(peak) +/- spreadLn) mapped through the SAME log axis
    expect(track.whisker!.x0).toBeCloseTo(g.xToPx(Math.exp(Math.log(8000) - 0.1)), 6);
    expect(track.whisker!.x1).toBeCloseTo(g.xToPx(Math.exp(Math.log(8000) + 0.1)), 6);
    expect(g.facetPeaks[1].laneConditioned).toBe(true);
  });

  it('skips unfittable facet peaks (undefined) and whiskers (no spread), never fakes geometry', () => {
    const g = plotGeometry({
      bounds, marks: [], size,
      facetPeaks: [
        { instrument: 'calibrate', laneConditioned: false }, // no peak: dashed in copy, absent here
        { instrument: 'flick', peakCounts: c(7000), laneConditioned: false }, // peak but no spread
      ],
    });
    expect(g.facetPeaks).toHaveLength(1);
    expect(g.facetPeaks[0].instrument).toBe('flick');
    expect(g.facetPeaks[0].whisker).toBeNull();
  });

  it('clamps a facet whisker that would overflow the plot extent', () => {
    const g = plotGeometry({
      bounds, marks: [], size,
      facetPeaks: [{ instrument: 'track', peakCounts: c(23000), spreadLn: 0.5, laneConditioned: false }],
    });
    expect(g.facetPeaks[0].whisker!.x1).toBeLessThanOrEqual(size.width - g.pad);
  });
});
