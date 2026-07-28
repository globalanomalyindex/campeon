// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { plotGeometry, plotLegendHtml, renderConvergencePlot } from '../../src/ui/convergence-plot';
import { counts360, type Counts360 } from '../../src/types';

const c = counts360;
const bounds: [Counts360, Counts360] = [c(1500), c(24000)];

describe('renderConvergencePlot', () => {
  it('renders a mark per observation and the curve path', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const g = plotGeometry({
      bounds,
      marks: [
        { counts: c(5000), score: 0.1, instrument: 'track' },
        { counts: c(9000), score: 0.3, instrument: 'strike' },
      ],
      curve: [{ x: Math.log(4000), mean: 0 }, { x: Math.log(12000), mean: 0.4 }],
      size: { width: 600, height: 300 },
    });
    renderConvergencePlot(svg, g);
    expect(svg.querySelectorAll('[data-mark]').length).toBe(2);
    expect(svg.querySelector('[data-curve]')).not.toBeNull();
  });

  it('labels the counts axis with compact ladder ticks', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const g = plotGeometry({ bounds, marks: [], size: { width: 600, height: 300 } });
    renderConvergencePlot(svg, g);
    const texts = [...svg.querySelectorAll('text')].map((t) => t.textContent);
    expect(texts).toEqual(['1.5k', '2k', '3k', '5k', '7k', '10k', '15k', '20k']);
  });

  it('renders A5 facet-peak diamonds on the top rail, hollow + dashed for the taste-conditioned lane', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const g = plotGeometry({
      bounds,
      marks: [],
      size: { width: 600, height: 300 },
      facetPeaks: [
        { instrument: 'track', peakCounts: c(8000), spreadLn: 0.1, laneConditioned: false },
        { instrument: 'strike', peakCounts: c(10000), spreadLn: 0.2, laneConditioned: true },
      ],
    });
    renderConvergencePlot(svg, g);
    const track = svg.querySelector('[data-facet-peak="track"]')!;
    const strike = svg.querySelector('[data-facet-peak="strike"]')!;
    expect(track).not.toBeNull();
    expect(strike).not.toBeNull();
    expect(track.getAttribute('fill')).toContain('--instrument-track'); // filled: a real estimate of the latent
    expect(strike.getAttribute('fill')).toBe('none'); // taste-conditioned: hollow
    expect(strike.getAttribute('stroke-dasharray')).toBe('2 2'); // and dashed: excluded from the tier
    expect(svg.querySelectorAll('[data-facet-whisker]').length).toBe(2);
  });

  it('plotLegendHtml emits one organism-colored chip per probe, aria-hidden', () => {
    const holder = document.createElement('div');
    holder.innerHTML = plotLegendHtml();
    const legend = holder.querySelector('.plot-legend')!;
    expect(legend.getAttribute('aria-hidden')).toBe('true');
    for (const id of ['track', 'flick', 'calibrate', 'strike']) {
      const item = legend.querySelector(`[data-legend="${id}"]`)!;
      expect(item).not.toBeNull();
      expect(item.querySelector('.plot-legend__swatch')).not.toBeNull();
    }
  });
});
