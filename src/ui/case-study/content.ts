import type { InstrumentId } from '../../types';
import type { PlotInput } from '../convergence-plot';

export interface CaseSection {
  id: 'premise' | 'track' | 'flick' | 'calibrate' | 'strike' | 'engine' | 'honesty' | 'colophon';
  idx: string;
  eyebrow: string[];
  spine?: string;
  accent: 'track' | 'flick' | 'calibrate' | 'strike' | 'slate' | 'gold';
  title: string;
  lede?: string;
  body: string[];
  spec?: { k: string; v: string; mono?: boolean }[];
}

const ACCENT_VAR: Record<CaseSection['accent'], string> = {
  track: 'var(--c-track)', flick: 'var(--c-flick)', calibrate: 'var(--c-calibrate)',
  strike: 'var(--c-strike)', slate: 'var(--slate)', gold: 'var(--gold)',
};
export const accentVar = (a: CaseSection['accent']): string => ACCENT_VAR[a];

export const SECTIONS: CaseSection[] = [
  {
    id: 'premise', idx: 'i', accent: 'slate',
    eyebrow: ['the science', 'a case study', 'cm/360'],
    spine: 'one latent constant',
    title: 'every trainer hands you a score. none hands you your number.',
    lede: 'aim trainers measure how well you did today. campeón measures the one setting your hands were built for — and tells you how sure it is.',
    body: [
      'there is exactly one number that decides how far your hand travels to turn all the way around: <strong>cm/360</strong> — centimeters of mouse movement per 360°. it is hardware-independent, game-independent, the true unit of aim. everything downstream (your in-game sliders) is just this number wearing different clothes.',
      'the problem: nobody can tell you <em>yours</em>. so campeón treats it as a hidden quantity to be <span class="cs-mark">measured</span>, not guessed — and borrows its instruments from the only engineers who have already solved targeting: <strong>evolution</strong>.',
      'six predators, four faculties, <span class="cs-mark">one number</span> with a confidence interval. this page is the real mechanism behind each one — and how four heterogeneous probes collapse into a single answer.',
    ],
    spec: [
      { k: 'the variable', v: 'cm/360 — physical cm per 360° turn' },
      { k: 'method', v: 'bayesian search over a speed↔accuracy manifold' },
      { k: 'output', v: 'one cm/360 + a 90% confidence interval', mono: true },
    ],
  },
  {
    id: 'track', idx: 'ii', accent: 'track',
    eyebrow: ['instrument 01', 'track', 'dragonfly + falcon'],
    spine: 'predictive tracking',
    title: 'the lead. holding a moving target still.',
    lede: 'a dragonfly intercepts prey ~95% of the time using a feed-forward internal model — it aims where prey will be, not where it is.',
    body: [
      'dragonfly target-selective descending neurons decode prey direction as a population vector at a sensorimotor latency of <strong>29.94 ± 5.75 ms</strong>; an efference-copy forward model predicts self-induced image motion so the strike <em>leads</em>. the peregrine falcon does the mirror task — <strong>vor + okr</strong> gaze-stabilization holds the target image still on the fovea, nulling its angular velocity, terminal guidance fitting proportional navigation.',
      'campeón rebuilds this with a <strong>constant-velocity kalman filter</strong> that smooths the target\'s motion, then measures <em>your</em> tracking latency directly: L is the lag of the peak aim↔target cross-correlation, refined to sub-frame precision. that L is the dragonfly\'s forward-model horizon — <span class="cs-mark">fitted to you, not assumed</span>. (the filter\'s <em>innovation</em> ν = z − Hx̂⁻ predicts the <em>target</em>, not your aim, so it is deliberately not the score.)',
      'the score is the <span class="cs-mark">lag-compensated residual</span> — your aim against the target where you were truly tracking it, L ago. subtracting pure latency leaves only what sensitivity governs: tremor jitter (multiplied when you\'re too sensitive) and gain over/undershoot (when you\'re too slow), plus the relative angular velocity the falcon\'s vor + okr would null. the optimum jointly minimizes slip + jitter.',
    ],
    spec: [
      { k: 'tsdn latency', v: '29.94 ± 5.75 ms', mono: true },
      { k: 'dragonfly intercept', v: '~95% success' },
      { k: 'scorer', v: 'lag-compensated residual @ measured latency L', mono: true },
      { k: 'metrics', v: 'measured latency · predictive index · jitter · slip · time-on-target' },
    ],
  },
  {
    id: 'flick', idx: 'iii', accent: 'flick',
    eyebrow: ['instrument 02', 'flick', 'spider + raptor'],
    spine: 'staged acquisition',
    title: 'the snap. a flick is a three-stage pipeline.',
    lede: 'a jumping spider detects with wide-field secondary eyes, fires a ballistic body saccade open-loop, then confirms with high-acuity principal eyes. that is exactly a human flick.',
    body: [
      'the spider\'s orient is pre-programmed — <strong>810–1300 °/s</strong>, amplitude preset from retinal eccentricity, no mid-flight correction — and the coarse error is cleaned up by the confirm stage. the raptor adds a two-fovea trade: a deep fovea (~140 cyc/deg, the scope) and a shallow fovea (wide, fast). speed vs precision, two modes.',
      'campeón segments your mouse-velocity trace into the spider\'s stages — detection latency, the ballistic orient, the corrective sub-movements of the confirm — and scores each (amplitude, width) condition by <strong>fitts effective throughput</strong> (iso 9241-9): effective width <span class="cs-mark">We = 4.133·σ</span>, IDe = log2(Ae/We + 1), TP = IDe / MT. the orient\'s overshoot and the confirm\'s corrections need no separate penalty — they already inflate MT and σ, so a sloppy stage lowers its own throughput.',
      'the raptor\'s two-fovea trade <em>is</em> the scorer. <span class="cs-mark">ballistic throughput</span> (big reorientations, cheap at lower cm/360) and <span class="cs-mark">precision-lock throughput</span> (fine placement, sharper at higher cm/360) are measured separately, and flick reports their <em>harmonic mean</em> — a number maximized exactly at the crossover where you serve both at once. this faculty is pure skill; only the strike pole bends to taste.',
    ],
    spec: [
      { k: 'spider orient', v: '810–1300 °/s, open-loop', mono: true },
      { k: 'raptor deep fovea', v: '~140 cyc/deg' },
      { k: 'scorer', v: 'two-mode crossover — harmonic mean of ballistic × precision tp' },
      { k: 'effective width', v: 'We = 4.133·σ', mono: true },
    ],
  },
  {
    id: 'calibrate', idx: 'iv', accent: 'calibrate',
    eyebrow: ['instrument 03', 'calibrate', 'archerfish'],
    spine: 'bias vs variance',
    title: 'the correction. separating aim from noise.',
    lede: 'an archerfish shoots prey through the air–water boundary and must cancel a systematic refraction offset of up to 10–15°. it learns the correction trial by trial.',
    body: [
      'the tell that it is a real internal model: a <strong>negative aftereffect</strong> when the offset is removed — the signature of a recalibrated forward model. the abstraction campeón borrows is the cleanest in aim: <span class="cs-mark">error = systematic bias + random variance</span>. bias is learnable and removable; variance is your precision floor.',
      'we estimate gain bias g = E[r_impact]/E[r_required] (g > 1 = oversensitive, g < 1 = undersensitive) and decompose <strong>MSE = |bias|² + σ_R²</strong>. cm/360 drives bias steeply and monotonically, so the <em>bias-zero sensitivity</em> — where g crosses 1 — is the headline estimator. variance is the hardware/skill floor, not the recommendation.',
    ],
    spec: [
      { k: 'refraction offset', v: 'up to 10–15°', mono: true },
      { k: 'decomposition', v: 'MSE = |bias|² + σ_R²', mono: true },
      { k: 'headline', v: 'bias-zero cm/360 (gain g = 1)' },
    ],
  },
  {
    id: 'strike', idx: 'v', accent: 'strike',
    eyebrow: ['instrument 04', 'strike', 'mantis shrimp'],
    spine: 'the speed pole',
    title: 'the limit. pure, uncorrectable speed.',
    lede: 'the mantis shrimp strike is a latch-mediated spring: ~10,400 g, full discharge in ~1.1 ms, no mid-flight correction. it is the canonical speed pole of the speed–accuracy trade-off.',
    body: [
      'the charge phase is ~300× longer than the strike itself — commit, then there is no taking it back. campeón\'s strike drill is the same: fire as fast as possible, misses allowed, no settling. we record reaction t_R, ballistic strike t_S, peak velocity, endpoint scatter σ_θ, and hit rate H.',
      'the pair <strong>(TTK = t_R + t_S, H)</strong> is your speed–accuracy operating point at each cm/360. this is what lets the optimizer respect <em>your</em> preference — the goal slider in setup — instead of assuming everyone wants the same trade. too sensitive: fast but σ_θ explodes and H collapses. too slow: tight but late.',
    ],
    spec: [
      { k: 'peak acceleration', v: '~10,400 g', mono: true },
      { k: 'strike duration', v: '~1.1 ms', mono: true },
      { k: 'operating point', v: '(TTK = t_R + t_S, hit rate)', mono: true },
    ],
  },
  {
    id: 'engine', idx: 'vi', accent: 'gold',
    eyebrow: ['the engine', 'one system', 'speed↔accuracy'],
    spine: 'triangulation',
    title: 'four probes, one number.',
    lede: 'the four instruments measure different physical quantities — bits per second, a (0,1] rate, strikes per second, degrees. the trick is fusing them without lying.',
    body: [
      'each instrument is swept across cm/360 and <strong>z-scored across its own sweep</strong>. z-scoring is an affine map, and a quadratic\'s peak is invariant under affine transforms — so normalizing makes heterogeneous metrics commensurable <span class="cs-mark">without moving any instrument\'s own optimum</span>. that is the whole reason the fusion is honest rather than arbitrary.',
      'the four instruments blend on equal footing — your speed↔accuracy preference tunes the <em>strike</em> pole (the one facet that is taste, not skill), which then enters the blend. that blend feeds a <strong>gaussian-process bayesian optimizer</strong> — a matérn-5/2 surrogate, expected-improvement acquisition on a dense ln(cm/360) grid — which proposes the next trial where it expects to learn most. a <strong>parabola</strong> is then fit in log-sensitivity to locate the peak — cross-checked against the gp\'s own argmax — and a <strong>bootstrap</strong> draws the 90% confidence interval.',
      'the payoff is conceptual: there is <em>one</em> latent constant on <em>one</em> manifold, and the four faculties are four views of it. the interval\'s width is the estimate\'s total uncertainty — sampling noise, the fit, and how much the faculties disagree all widen it. a tight interval means the views concur on a sharp answer; <span class="cs-mark">a wide one is the system admitting the data don\'t yet pin the number down.</span>',
    ],
    spec: [
      { k: 'normalize', v: 'per-instrument z-score (affine, peak-preserving)' },
      { k: 'surrogate', v: 'gaussian process · matérn-5/2' },
      { k: 'acquisition', v: 'expected improvement on ln(cm/360)', mono: true },
      { k: 'uncertainty', v: 'bootstrap 90% ci — widens with noise + facet disagreement' },
    ],
  },
  {
    id: 'honesty', idx: 'vii', accent: 'slate',
    eyebrow: ['the honest part', 'what this does not solve'],
    spine: 'measurement honesty',
    title: 'what this does not solve.',
    body: [
      '<strong>the interval can be wide.</strong> a short session, or genuinely conflicting faculties, produces an honestly-wide ci rather than a falsely-precise point. that is a feature: the number comes with its own doubt.',
      '<strong>variance is a floor, not a knob.</strong> precision (σ_R) is set by your hardware and your hands. campeón reports it; it does not pretend a sensitivity can fix it.',
      '<strong>no fabricated noise.</strong> the scorers record what actually happened. a degenerate trial drops out of the blend rather than being padded with synthetic spread — padding would inflate the metric and lie. realistic spread belongs in the test fixtures, never in production.',
      '<strong>raw input is gated.</strong> measurement only proceeds after pointer-lock raw capture and an acceleration check pass; os mouse acceleration would corrupt every reading, so it is detected and blocked up front.',
    ],
  },
  {
    id: 'colophon', idx: 'viii', accent: 'gold',
    eyebrow: ['colophon', 'how it is built'],
    spine: 'design engineering',
    title: 'how it is built.',
    lede: 'a pure, unit-tested measurement core wrapped by an engine and a hand-rolled ui — so validity can be proven, not hoped.',
    body: [
      'the core (<strong>convert · scoring · optimizer · stats</strong>) is plain typescript, tested against published formulas: iso 9241-9 throughput, a constant-velocity kalman filter, a hand-rolled cholesky solve for the gaussian process. no framework, no backend, ~210 passing tests.',
      'the seams are deliberate. every instrument is a pure <code>analyze()</code> plus a thin <code>run()</code> shell, so the math is tested against synthetic players and only the raw pointer/raf glue is runtime-only. the data-viz above is the same idea: a pure <code>plotGeometry()</code> (domain→pixel, fully unit-tested) and a thin renderer that only writes svg attributes.',
      'it runs at 60fps in a real webgl arena, respects <code>prefers-reduced-motion</code> everywhere, and reads cleanly enough to review. the whole thing is a single argument: that careful measurement and considered craft are the same discipline.',
    ],
    spec: [
      { k: 'stack', v: 'typescript · vite · three.js · client-only' },
      { k: 'tests', v: '~210, pure core tdd', mono: true },
      { k: 'seams', v: 'pure analyze + thin shell · geometry + renderer' },
    ],
  },
];

export const CITATIONS: string[] = [
  'Mischiati et al. Internal models direct dragonfly interception steering. Nature 517 (2015).',
  'Gonzalez-Bellido et al. Eight pairs of descending visual neurons … population vector of prey direction. PNAS 110(2) (2013).',
  'Brighton, Thomas & Taylor. Terminal attack trajectories of peregrine falcons … proportional navigation. PNAS 114(51) (2017).',
  'Tucker. The deep fovea, sideways vision and spiral flight paths in raptors. J. Exp. Biol. 203 (2000).',
  'Land. Movements of the retinae of jumping spiders. J. Exp. Biol. 51 (1969); Zurek & Nelson, J. Comp. Physiol. A 198 (2012).',
  'Patek et al. Deadly strike mechanism of a mantis shrimp. Nature 428 (2004); deVries & Patek, ICB 59(6) (2019).',
  'Reinel & Schuster. The archerfish predictive C-start. J. Comp. Physiol. A (2023); Volotsky et al., eLife 13 (2024).',
  'MacKenzie. Fitts\' law (ISO 9241-9 effective throughput), HHCI (2018).',
  'Auer, Cesa-Bianchi & Fischer. Finite-time Analysis of the Multiarmed Bandit Problem (2002).',
];

export const CREDIT = {
  by: 'designed and built by christopher robin fiore',
  theme: 'portfolio theme: looking to nature for answers',
};

/** Illustrative (not live) convergence dataset for Act iii: four organism mark-sets
 *  scattered across the sweep, converging on a concave fit peaked near 29 cm/360. */
export function demoConvergence(): PlotInput {
  const bounds: [number, number] = [15, 60];
  const peak = 29;
  const at = (cm: number) => -Math.pow(Math.log(cm) - Math.log(peak), 2);
  const insts: InstrumentId[] = ['track', 'flick', 'calibrate', 'strike'];
  const xs = [18, 23, 29, 37, 47];
  const jitter: Record<InstrumentId, number> = { track: 0.04, flick: -0.05, calibrate: 0.02, strike: -0.03 };
  const marks = insts.flatMap((instrument) =>
    xs.map((cm360) => ({ cm360, instrument, score: at(cm360) + jitter[instrument] })),
  );
  const curve = [16, 20, 25, 29, 34, 42, 55].map((cm) => ({ x: Math.log(cm), mean: at(cm) }));
  return { bounds, marks, curve, ci90: [27.4, 31.1], peak, size: { width: 640, height: 280 } };
}
