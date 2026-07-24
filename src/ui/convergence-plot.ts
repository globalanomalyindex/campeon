import type { Cm360, FacetPeak, InstrumentId } from '../types';

export interface PlotSize { width: number; height: number; }
export interface PlotMark { cm360: Cm360; score: number; instrument: InstrumentId; }
export interface PlotInput {
  bounds: [Cm360, Cm360];
  marks: readonly PlotMark[];
  curve?: readonly { x: number; mean: number }[]; // x = ln(cm/360)
  ci90?: [Cm360, Cm360];
  peak?: Cm360;
  /**
   * A5's per-facet peaks, drawn as markers along the top of the plot: each probe's OWN best
   * sensitivity, so the eye can SEE the one-number thesis being tested against the blended peak
   * line. Entries without a fittable peak are skipped (dashed in copy, never faked in geometry).
   */
  facetPeaks?: readonly FacetPeak[];
  size: PlotSize;
  pad?: number;
}
export interface PlotMarkPx extends PlotMark { px: number; py: number; }
export interface FacetPeakPx {
  instrument: InstrumentId;
  px: number;
  /** The facet's bootstrap SPREAD (not a CI - see FacetPeak.spreadLn) as a horizontal whisker,
   *  clamped to the plot extent; null when the spread is missing. */
  whisker: { x0: number; x1: number } | null;
  /** strike: taste-conditioned, excluded from the tier - rendered hollow/dashed. */
  laneConditioned: boolean;
}
export interface PlotGeometry {
  size: PlotSize;
  pad: number;
  xToPx(cm360: Cm360): number;
  xTicks: { cm360: Cm360; px: number }[];
  marks: PlotMarkPx[];
  curvePath: string | null;
  ciRectPx: { x: number; width: number } | null;
  peakPx: number | null;
  facetPeaks: FacetPeakPx[];
  yRange: [number, number];
}

const NICE_TICKS = [10, 15, 20, 25, 30, 35, 40, 50, 60, 80];

export function plotGeometry(input: PlotInput): PlotGeometry {
  const { bounds, marks, curve, ci90, peak, size } = input;
  const pad = input.pad ?? 28;
  const [lo, hi] = bounds;
  const lLo = Math.log(lo), lHi = Math.log(hi);
  const x0 = pad, x1 = size.width - pad;
  const y0 = size.height - pad, y1 = pad;

  const xToPx = (cm360: number): number =>
    x0 + ((Math.log(cm360) - lLo) / (lHi - lLo)) * (x1 - x0);

  const ys = [...marks.map((m) => m.score), ...(curve?.map((c) => c.mean) ?? [])];
  let yMin = ys.length ? Math.min(...ys) : 0;
  let yMax = ys.length ? Math.max(...ys) : 1;
  if (yMax - yMin < 1e-9) { yMin -= 0.5; yMax += 0.5; }
  const span = yMax - yMin;
  yMin -= span * 0.08; yMax += span * 0.08;
  const yToPx = (score: number): number =>
    y0 + ((score - yMin) / (yMax - yMin)) * (y1 - y0);

  const xTicks = NICE_TICKS.filter((t) => t >= lo && t <= hi).map((t) => ({ cm360: t, px: xToPx(t) }));
  const marksPx: PlotMarkPx[] = marks.map((m) => ({ ...m, px: xToPx(m.cm360), py: yToPx(m.score) }));

  let curvePath: string | null = null;
  if (curve && curve.length >= 2) {
    curvePath = curve
      .map((c, i) => `${i === 0 ? 'M' : 'L'} ${xToPx(Math.exp(c.x)).toFixed(2)},${yToPx(c.mean).toFixed(2)}`)
      .join(' ');
  }

  const ciRectPx =
    ci90 && ci90[1] > ci90[0]
      ? { x: xToPx(ci90[0]), width: xToPx(ci90[1]) - xToPx(ci90[0]) }
      : null;

  const peakPx = peak !== undefined ? xToPx(peak) : null;

  const clampX = (px: number): number => Math.max(x0, Math.min(x1, px));
  const facetPeaks: FacetPeakPx[] = (input.facetPeaks ?? [])
    .filter((f): f is FacetPeak & { peakCm360: number } => f.peakCm360 !== undefined && Number.isFinite(f.peakCm360))
    .map((f) => ({
      instrument: f.instrument,
      px: clampX(xToPx(f.peakCm360)),
      whisker:
        f.spreadLn !== undefined && Number.isFinite(f.spreadLn) && f.spreadLn > 0
          ? {
              x0: clampX(xToPx(Math.exp(Math.log(f.peakCm360) - f.spreadLn))),
              x1: clampX(xToPx(Math.exp(Math.log(f.peakCm360) + f.spreadLn))),
            }
          : null,
      laneConditioned: f.laneConditioned,
    }));

  return { size, pad, xToPx, xTicks, marks: marksPx, curvePath, ciRectPx, peakPx, facetPeaks, yRange: [yMin, yMax] };
}

const NS = 'http://www.w3.org/2000/svg';
const el = (name: string, attrs: Record<string, string>): SVGElement => {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};
const ORGANISM_VAR: Record<InstrumentId, string> = {
  track: 'var(--instrument-track)', flick: 'var(--instrument-flick)', calibrate: 'var(--instrument-calibrate)', strike: 'var(--instrument-strike)',
};

/**
 * The color key the plots never had: one swatch chip per probe, in the same organism color the
 * marks use. Pure markup string (unit-testable); aria-hidden because it decodes an aria-hidden
 * plot - the accessible story is the figcaption + live-region copy, not the colors.
 */
export function plotLegendHtml(ids: readonly InstrumentId[] = ['track', 'flick', 'calibrate', 'strike']): string {
  const items = ids
    .map(
      (id) =>
        `<span class="plot-legend__item" data-legend="${id}"><span class="plot-legend__swatch" style="background:${ORGANISM_VAR[id]}"></span>${id}</span>`,
    )
    .join('');
  return `<span class="plot-legend mono" aria-hidden="true">${items}</span>`;
}

/** Thin renderer: clears `svg` and draws the geometry (CI band → curve → marks → peak → ticks). */
export function renderConvergencePlot(svg: SVGElement, g: PlotGeometry, yLabel?: string): void {
  svg.setAttribute('viewBox', `0 0 ${g.size.width} ${g.size.height}`);
  svg.replaceChildren();

  if (g.ciRectPx) {
    svg.appendChild(el('rect', {
      x: g.ciRectPx.x.toFixed(2), y: String(g.pad), width: g.ciRectPx.width.toFixed(2),
      height: String(g.size.height - 2 * g.pad), fill: 'var(--color-primary)', 'fill-opacity': '0.12', 'data-ci': '',
    }));
  }
  if (g.curvePath) {
    svg.appendChild(el('path', {
      d: g.curvePath, fill: 'none', stroke: 'var(--text-strong)', 'stroke-width': '2',
      'stroke-opacity': '0.7', 'data-curve': '',
    }));
  }
  if (g.peakPx !== null) {
    svg.appendChild(el('line', {
      x1: g.peakPx.toFixed(2), y1: String(g.pad), x2: g.peakPx.toFixed(2),
      y2: String(g.size.height - g.pad), stroke: 'var(--color-primary)', 'stroke-width': '1.5', 'data-peak': '',
    }));
  }
  for (const m of g.marks) {
    const filled = m.instrument === 'track' || m.instrument === 'flick';
    svg.appendChild(el('circle', {
      cx: m.px.toFixed(2), cy: m.py.toFixed(2), r: '4',
      fill: filled ? ORGANISM_VAR[m.instrument] : 'none',
      stroke: ORGANISM_VAR[m.instrument], 'stroke-width': '1.5',
      'data-mark': m.instrument,
    }));
  }
  // A5 facet-peak markers: each probe's OWN best, as a diamond on a top rail with its spread
  // whisker - the eye compares them against the gold peak line (the thesis, tested visibly).
  // strike (taste-conditioned, excluded from the tier) renders hollow + dashed.
  const railY = g.pad + 7;
  for (const f of g.facetPeaks) {
    if (f.whisker) {
      svg.appendChild(el('line', {
        x1: f.whisker.x0.toFixed(2), y1: String(railY), x2: f.whisker.x1.toFixed(2), y2: String(railY),
        stroke: ORGANISM_VAR[f.instrument], 'stroke-width': '1', 'stroke-opacity': '0.5',
        'data-facet-whisker': f.instrument,
      }));
    }
    svg.appendChild(el('rect', {
      x: (f.px - 4).toFixed(2), y: String(railY - 4), width: '8', height: '8',
      transform: `rotate(45 ${f.px.toFixed(2)} ${railY})`,
      fill: f.laneConditioned ? 'none' : ORGANISM_VAR[f.instrument],
      stroke: ORGANISM_VAR[f.instrument], 'stroke-width': '1.5',
      ...(f.laneConditioned ? { 'stroke-dasharray': '2 2' } : {}),
      'data-facet-peak': f.instrument,
    }));
  }
  for (const t of g.xTicks) {
    const label = el('text', {
      x: t.px.toFixed(2), y: String(g.size.height - 8), 'text-anchor': 'middle',
      fill: 'var(--text-muted)', 'font-size': '10', 'font-family': 'var(--font-mono)',
    });
    label.textContent = String(t.cm360);
    svg.appendChild(label);
  }

  if (yLabel) {
    const yc = g.size.height / 2;
    const lab = el('text', {
      x: '10', y: yc.toFixed(1), 'text-anchor': 'middle',
      transform: `rotate(-90 10 ${yc.toFixed(1)})`,
      fill: 'var(--text-muted)', 'font-size': '10', 'font-family': 'var(--font-mono)', 'data-ylabel': '',
    });
    lab.textContent = yLabel;
    svg.appendChild(lab);
  }
}
