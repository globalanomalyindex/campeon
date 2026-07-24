// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { plotGeometry, plotLegendHtml, renderConvergencePlot } from '../../src/ui/convergence-plot';

describe('renderConvergencePlot', () => {
  it('renders a mark per observation and the curve path', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const g = plotGeometry({
      bounds: [15, 60],
      marks: [
        { cm360: 25, score: 0.1, instrument: 'track' },
        { cm360: 35, score: 0.3, instrument: 'strike' },
      ],
      curve: [{ x: Math.log(20), mean: 0 }, { x: Math.log(40), mean: 0.4 }],
      size: { width: 600, height: 300 },
    });
    renderConvergencePlot(svg, g);
    expect(svg.querySelectorAll('[data-mark]').length).toBe(2);
    expect(svg.querySelector('[data-curve]')).not.toBeNull();
  });

  it('renders A5 facet-peak diamonds on the top rail, hollow + dashed for the taste-conditioned lane', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const g = plotGeometry({
      bounds: [15, 60],
      marks: [],
      size: { width: 600, height: 300 },
      facetPeaks: [
        { instrument: 'track', peakCm360: 30, spreadLn: 0.1, laneConditioned: false },
        { instrument: 'strike', peakCm360: 40, spreadLn: 0.2, laneConditioned: true },
      ],
    });
    renderConvergencePlot(svg, g);
    const track = svg.querySelector('[data-facet-peak="track"]')!;
    const strike = svg.querySelector('[data-facet-peak="strike"]')!;
    expect(track).not.toBeNull();
    expect(strike).not.toBeNull();
    expect(track.getAttribute('fill')).toContain('--instrument-track'); // filled: a real estimate of the latent
    expect(strike.getAttribute('fill')).toBe('none'); // taste-conditioned: hollow...
    expect(strike.getAttribute('stroke-dasharray')).toBe('2 2'); // ...and dashed - excluded from the tier
    expect(svg.querySelectorAll('[data-facet-whisker]').length).toBe(2);
  });

  it('plotLegendHtml emits one organism-colored chip per probe, aria-hidden', () => {
    const holder = document.createElement('div');
    holder.innerHTML = plotLegendHtml();
    const legend = holder.querySelector('.plot-legend')!;
    expect(legend.getAttribute('aria-hidden')).toBe('true');
    for (const id of ['track', 'flick', 'calibrate', 'strike']) {
      const item = legend.querySelector(`[data-legend="${id}"]`)!;
      expect(item, `${id} chip`).not.toBeNull();
      expect(item.textContent).toContain(id);
      expect((item.querySelector('.plot-legend__swatch') as HTMLElement).style.background).toContain(`--instrument-${id}`);
    }
  });

  it('renders an optional rotated y-axis label when provided', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const g = plotGeometry({
      bounds: [15, 60],
      marks: [{ cm360: 25, score: 0.1, instrument: 'track' }],
      size: { width: 600, height: 300 },
    });
    renderConvergencePlot(svg, g, 'blended score');
    const label = svg.querySelector('[data-ylabel]');
    expect(label?.textContent).toBe('blended score');
    expect(label?.getAttribute('transform')).toContain('rotate(-90');
    // without the arg, no label
    const svg2 = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    renderConvergencePlot(svg2, g);
    expect(svg2.querySelector('[data-ylabel]')).toBeNull();
  });
});
