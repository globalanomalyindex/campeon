// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { plotGeometry, renderConvergencePlot } from '../../src/ui/convergence-plot';

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
