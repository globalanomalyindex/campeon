import type { Cm360, InstrumentId } from '../types';

export interface PlotSize { width: number; height: number; }
export interface PlotMark { cm360: Cm360; score: number; instrument: InstrumentId; }
export interface PlotInput {
  bounds: [Cm360, Cm360];
  marks: readonly PlotMark[];
  curve?: readonly { x: number; mean: number }[]; // x = ln(cm/360)
  ci90?: [Cm360, Cm360];
  peak?: Cm360;
  size: PlotSize;
  pad?: number;
}
export interface PlotMarkPx extends PlotMark { px: number; py: number; }
export interface PlotGeometry {
  size: PlotSize;
  pad: number;
  xToPx(cm360: Cm360): number;
  xTicks: { cm360: Cm360; px: number }[];
  marks: PlotMarkPx[];
  curvePath: string | null;
  ciRectPx: { x: number; width: number } | null;
  peakPx: number | null;
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

  return { size, pad, xToPx, xTicks, marks: marksPx, curvePath, ciRectPx, peakPx, yRange: [yMin, yMax] };
}

const NS = 'http://www.w3.org/2000/svg';
const el = (name: string, attrs: Record<string, string>): SVGElement => {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};
const ORGANISM_VAR: Record<InstrumentId, string> = {
  track: 'var(--c-track)', flick: 'var(--c-flick)', calibrate: 'var(--c-calibrate)', strike: 'var(--c-strike)',
};

/** Thin renderer: clears `svg` and draws the geometry (CI band → curve → marks → peak → ticks). */
export function renderConvergencePlot(svg: SVGElement, g: PlotGeometry, yLabel?: string): void {
  svg.setAttribute('viewBox', `0 0 ${g.size.width} ${g.size.height}`);
  svg.replaceChildren();

  if (g.ciRectPx) {
    svg.appendChild(el('rect', {
      x: g.ciRectPx.x.toFixed(2), y: String(g.pad), width: g.ciRectPx.width.toFixed(2),
      height: String(g.size.height - 2 * g.pad), fill: 'var(--gold)', 'fill-opacity': '0.12', 'data-ci': '',
    }));
  }
  if (g.curvePath) {
    svg.appendChild(el('path', {
      d: g.curvePath, fill: 'none', stroke: 'var(--bone)', 'stroke-width': '2',
      'stroke-opacity': '0.7', 'data-curve': '',
    }));
  }
  if (g.peakPx !== null) {
    svg.appendChild(el('line', {
      x1: g.peakPx.toFixed(2), y1: String(g.pad), x2: g.peakPx.toFixed(2),
      y2: String(g.size.height - g.pad), stroke: 'var(--gold)', 'stroke-width': '1.5', 'data-peak': '',
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
  for (const t of g.xTicks) {
    const label = el('text', {
      x: t.px.toFixed(2), y: String(g.size.height - 8), 'text-anchor': 'middle',
      fill: 'var(--slate-2)', 'font-size': '10', 'font-family': 'var(--font-mono)',
    });
    label.textContent = String(t.cm360);
    svg.appendChild(label);
  }

  if (yLabel) {
    const yc = g.size.height / 2;
    const lab = el('text', {
      x: '10', y: yc.toFixed(1), 'text-anchor': 'middle',
      transform: `rotate(-90 10 ${yc.toFixed(1)})`,
      fill: 'var(--slate-2)', 'font-size': '10', 'font-family': 'var(--font-mono)', 'data-ylabel': '',
    });
    lab.textContent = yLabel;
    svg.appendChild(lab);
  }
}
