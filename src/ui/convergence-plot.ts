import type { Counts360, FacetPeak, InstrumentId } from '../types';

export interface PlotSize { width: number; height: number; }
export interface PlotMark { counts: Counts360; score: number; instrument: InstrumentId; }
export interface PlotInput {
  bounds: [Counts360, Counts360];
  marks: readonly PlotMark[];
  /** Fitted curve; each x is the natural log OF the counts-per-360 value (ln(counts), the same
   *  scale the optimizer fits on - "counts/360" names the unit, never a division). */
  curve?: readonly { x: number; mean: number }[];
  ci90?: [Counts360, Counts360];
  peak?: Counts360;
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
  xToPx(counts: number): number;
  xTicks: { counts: number; px: number }[];
  marks: PlotMarkPx[];
  curvePath: string | null;
  ciRectPx: { x: number; width: number } | null;
  peakPx: number | null;
  facetPeaks: FacetPeakPx[];
  yRange: [number, number];
}

/**
 * Log-decade tick ladder for a counts axis. The old hand-enumerated cm ticks (10..80) covered one
 * decade of a physical unit; counts bounds move with hardware and with k, spanning anywhere from a
 * few hundred to tens of thousands, so the ladder is generated per decade instead of enumerated.
 * The 1/1.5/2/3/5/7 mantissas keep near-even spacing in ln space (steps of 1.33x to 1.5x). When
 * bounds span enough decades that the full ladder would shingle 10px labels into each other, the
 * ladder thins to 1/2/5 and then to decades: thinning keeps ln spacing even, where dropping every
 * other tick would alternate 1.5x and 2x gaps.
 */
const TICK_MANTISSAS = [1, 1.5, 2, 3, 5, 7] as const;
export function countTicks(lo: number, hi: number): number[] {
  const build = (mants: readonly number[]): number[] => {
    const out: number[] = [];
    for (let dec = Math.floor(Math.log10(lo)); dec <= Math.ceil(Math.log10(hi)); dec++) {
      for (const m of mants) {
        const v = m * 10 ** dec;
        if (v >= lo && v <= hi) out.push(v);
      }
    }
    return out;
  };
  for (const mants of [TICK_MANTISSAS, [1, 2, 5], [1]] as const) {
    const t = build(mants);
    if (t.length <= 9) return t;
  }
  return build([1]);
}

/** Tick label: 8000 reads "8k", 1500 reads "1.5k". Tabular mono at 10px cannot afford five
 *  digits per tick without the labels colliding at the 360px result-plot width. */
export function tickLabel(v: number): string {
  return v >= 1000 ? `${v / 1000}k` : String(v);
}

export function plotGeometry(input: PlotInput): PlotGeometry {
  const { bounds, marks, curve, ci90, peak, size } = input;
  const pad = input.pad ?? 28;
  const [lo, hi] = bounds;
  const lLo = Math.log(lo), lHi = Math.log(hi);
  const x0 = pad, x1 = size.width - pad;
  const y0 = size.height - pad, y1 = pad;

  const xToPx = (counts: number): number =>
    x0 + ((Math.log(counts) - lLo) / (lHi - lLo)) * (x1 - x0);

  const ys = [...marks.map((m) => m.score), ...(curve?.map((c) => c.mean) ?? [])];
  let yMin = ys.length ? Math.min(...ys) : 0;
  let yMax = ys.length ? Math.max(...ys) : 1;
  if (yMax - yMin < 1e-9) { yMin -= 0.5; yMax += 0.5; }
  const span = yMax - yMin;
  yMin -= span * 0.08; yMax += span * 0.08;
  const yToPx = (score: number): number =>
    y0 + ((score - yMin) / (yMax - yMin)) * (y1 - y0);

  const xTicks = countTicks(lo, hi).map((t) => ({ counts: t, px: xToPx(t) }));
  const marksPx: PlotMarkPx[] = marks.map((m) => ({ ...m, px: xToPx(m.counts), py: yToPx(m.score) }));

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
    .filter((f): f is FacetPeak & { peakCounts: Counts360 } => f.peakCounts !== undefined && Number.isFinite(f.peakCounts))
    .map((f) => ({
      instrument: f.instrument,
      px: clampX(xToPx(f.peakCounts)),
      whisker:
        f.spreadLn !== undefined && Number.isFinite(f.spreadLn) && f.spreadLn > 0
          ? {
              x0: clampX(xToPx(Math.exp(Math.log(f.peakCounts) - f.spreadLn))),
              x1: clampX(xToPx(Math.exp(Math.log(f.peakCounts) + f.spreadLn))),
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

/** Thin renderer: clears `svg` and draws the geometry (CI band, curve, marks, peak, ticks).
 *  Same curve as before the unit change, honest label: the axis is the log of counts per 360 now,
 *  and the ticks say so in counts. */
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
  // whisker - the eye compares them against the answer line (the thesis, tested visibly).
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
    label.textContent = tickLabel(t.counts);
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
