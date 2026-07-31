import { counts360 } from '../../types';
import type { Counts360, InstrumentId } from '../../types';
import type { PlotInput } from '../convergence-plot';

export interface CaseSection {
  id: 'premise' | 'track' | 'flick' | 'calibrate' | 'strike' | 'engine' | 'honesty' | 'colophon';
  idx: string;
  eyebrow: string[];
  spine?: string;
  accent: 'track' | 'flick' | 'calibrate' | 'strike' | 'neutral' | 'primary';
  title: string;
  lede?: string;
  /** The niche/selective pressure that forged this predator's accuracy, the thing campeón actually
   *  recreates (sensitivity is evolved IN it). Rendered as a first-class "the environment" line. */
  environment?: string;
  body: string[];
  spec?: { k: string; v: string; mono?: boolean }[];
}

const ACCENT_VAR: Record<CaseSection['accent'], string> = {
  track: 'var(--instrument-track)', flick: 'var(--instrument-flick)', calibrate: 'var(--instrument-calibrate)',
  strike: 'var(--instrument-strike)', neutral: 'var(--text-muted)', primary: 'var(--color-primary)',
};
export const accentVar = (a: CaseSection['accent']): string => ACCENT_VAR[a];

export const SECTIONS: CaseSection[] = [
  {
    id: 'premise', idx: 'i', accent: 'neutral',
    eyebrow: ['the problem', 'a case study', 'counts per 360'],
    spine: 'one latent constant',
    title: 'One setting decides your aim. I built an instrument to measure yours.',
    lede: 'This is for a PC player who already knows their sensitivity matters and has no way to find the right one. I wanted a number measured against my own hands, with its uncertainty attached.',
    body: [
      'One number decides how far your hand travels to turn all the way around: <strong>counts per 360</strong>, the mouse counts of travel that make one full turn. It is the unit the instrument itself measures in, independent of any game by construction, and every in-game slider you have ever touched is this number wearing different clothes. When a session opens with the card sweep, the result screen also reports the distance in centimetres, measured against the card and approximate to the few percent the method carries. And if you know your mouse\'s DPI, it will turn your typed number into centimetres too, labelled as arithmetic on your input rather than as a measurement.',
      'Nobody can tell you <em>yours</em>. A converter only translates a number you already picked. A pro\'s config is a stranger\'s hands, a stranger\'s grip and a stranger\'s desk. So I ran a hypothesis. A predator\'s accuracy is what its <strong>environment</strong> forced evolution to build, and a human already carries the one knob that plays the role all that neural wiring does: <span class="cs-mark">sensitivity</span>, the gain that turns an instinctive flick into where the shot actually lands.',
      'So I rebuilt the four <strong>environments</strong> that forged that accuracy and drop you into them, your sensitivity standing in for the trait under selection. Generation after generation the search mutates that one number and keeps what scores higher, until it settles on the sensitivity you score highest at. Four environments, one evolving number, a single master counts per 360 with a confidence interval.',
      '<strong>What a session costs you.</strong> Calibration first, and it is short. Slide your mouse across a bank card twice, then turn all the way around three times, blind, alternating direction. The turns read where your hands already play and seed the search there; the card is a ruler whose width is fixed by international standard, so the turn can be checked against a real distance instead of only against itself. Nothing to look up and no DPI to find. After that you play the four drills in short trials, at sensitivities the search picks. The first <span class="cs-mark">8 trials</span> seed the gene pool, and a whole session is capped at <span class="cs-mark">30 trials</span>. I have not timed sessions across a range of players, so I am not going to quote you a duration I never measured.',
    ],
    spec: [
      { k: 'who it is for', v: 'a PC player who wants their own number, with its uncertainty' },
      { k: 'the variable', v: 'counts per 360 · mouse counts of travel per full 360° turn' },
      { k: 'the ask', v: 'two card sweeps · three blind turns · 4 drills · 8 seeding trials · 30 trial cap', mono: true },
      { k: 'method', v: 'evolutionary search over a speed↔accuracy manifold' },
      { k: 'output', v: 'one counts per 360 + a 90% confidence interval', mono: true },
    ],
  },
  {
    id: 'track', idx: 'ii', accent: 'track',
    eyebrow: ['environment 01', 'track', 'dragonfly + falcon'],
    spine: 'predictive tracking',
    title: 'The lead. Holding a moving target still.',
    lede: 'A dragonfly intercepts prey about 95% of the time using a feed-forward internal model. It aims where the prey is going to be.',
    environment: 'The open-air intercept: a target that weaves and reverses, with one pass to stay glued to it. Miss where it is going and you starve. That pressure forged the dragonfly\'s predictive lead, so I rebuilt it as a weaving mover you have to hold.',
    body: [
      'Dragonfly target-selective descending neurons decode prey direction as a population vector at a sensorimotor latency of <strong>29.94 ± 5.75 ms</strong><sup class="cs-cite">2</sup>, and an efference-copy forward model predicts self-induced image motion so the strike <em>leads</em><sup class="cs-cite">1</sup>. The peregrine falcon runs the mirror task: <strong>vor + okr</strong> gaze stabilization holds the target image still on the fovea, nulling its angular velocity, with terminal guidance that fits proportional navigation<sup class="cs-cite">3</sup>.',
      'I rebuilt this with a <strong>constant-velocity kalman filter</strong> that smooths the target\'s motion, then measured <em>your</em> tracking latency directly: L is the lag of the peak aim↔target cross-correlation, refined to sub-frame precision. That L is the dragonfly\'s forward-model horizon, <span class="cs-mark">fitted to you</span>. (the filter\'s <em>innovation</em> ν = z − Hx̂⁻ predicts the <em>target</em> rather than your aim, so I deliberately kept it out of the score.)',
      'The score\'s spine is the <span class="cs-mark">lag-compensated residual</span>: your aim against the target where you were truly tracking it, L ago. Subtracting pure latency leaves only what sensitivity governs. That is tremor jitter (multiplied when you are too sensitive) and gain over/undershoot (when you are too slow), plus the relative angular velocity the falcon\'s vor + okr would null. I fold those measured parts into one number with three small weights, and I disclose all three: it is a designed composite and I say so rather than dressing it up as a single reading. The optimum jointly minimizes slip and jitter.',
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
    eyebrow: ['environment 02', 'flick', 'spider + raptor'],
    spine: 'staged acquisition',
    title: 'The snap. A flick is a three-stage pipeline.',
    lede: 'A jumping spider detects with wide-field secondary eyes, fires a ballistic body saccade open-loop, then confirms with high-acuity principal eyes. That is exactly a human flick.',
    environment: 'The ambush: prey breaks cover at an unpredictable angle and range, and the first explosive orient has to land before it is gone. That pressure built the spider\'s open-loop snap and the raptor\'s two-fovea trade. I rebuilt it as targets that pop across the field to acquire and lock.',
    body: [
      'The spider\'s orient is pre-programmed at <strong>810 to 1300 °/s</strong><sup class="cs-cite">5</sup>, amplitude preset from retinal eccentricity, with no mid-flight correction, and the coarse error is cleaned up by the confirm stage<sup class="cs-cite">6</sup>. The raptor adds a two-fovea trade: a deep fovea (~140 cyc/deg, the scope) and a shallow fovea (wide, fast)<sup class="cs-cite">4</sup>. Speed against precision, two modes.',
      'I segment your mouse-velocity trace into the spider\'s stages (detection latency, the ballistic orient, the corrective sub-movements of the confirm) and score each (amplitude, width) condition by <strong>fitts effective throughput</strong> per ISO 9241-9<sup class="cs-cite">11</sup>: effective width <span class="cs-mark">We = 4.133·σ</span>, IDe = log2(Ae/We + 1), TP = IDe / MT. The orient\'s overshoot and the confirm\'s corrections need no separate penalty, because they already inflate MT and σ, so a sloppy stage lowers its own throughput.',
      'The raptor\'s two-fovea trade <em>is</em> the scorer. I measure <span class="cs-mark">ballistic throughput</span> (big reorientations, cheap at lower counts per 360) and <span class="cs-mark">precision-lock throughput</span> (fine placement, sharper at higher counts per 360) separately, and flick reports their <em>harmonic mean</em>, a number maximized exactly at the crossover where you serve both at once. This faculty is pure skill. Only the strike pole bends to taste, and section v says why.',
    ],
    spec: [
      { k: 'spider orient', v: '810 to 1300 °/s, open-loop', mono: true },
      { k: 'raptor deep fovea', v: '~140 cyc/deg' },
      { k: 'scorer', v: 'two-mode crossover · harmonic mean of ballistic × precision tp' },
      { k: 'effective width', v: 'We = 4.133·σ', mono: true },
    ],
  },
  {
    id: 'calibrate', idx: 'iv', accent: 'calibrate',
    eyebrow: ['environment 03', 'calibrate', 'archerfish'],
    spine: 'bias vs variance',
    title: 'The correction. Separating aim from noise.',
    lede: 'An archerfish shoots prey through the air to water boundary and has to cancel a systematic refraction offset of up to 10 to 15°. It learns the correction trial by trial.',
    environment: 'Aiming through a lie: the water\'s surface bends every shot, so where the prey looks and where it is diverge by a fixed offset. Survival meant learning that offset cold. It is the same fight a shooter calls recoil, the gap between crosshair and point of impact.',
    body: [
      'The tell that it is a real internal model is a <strong>negative aftereffect</strong> when the offset is removed, which is the signature of a recalibrated forward model<sup class="cs-cite">9</sup>. The abstraction I borrowed is the cleanest one in aim: <span class="cs-mark">error = systematic bias + random variance</span>. It is the same gap a shooter fights as <strong>recoil</strong>, the offset between where your crosshair points and where the rounds actually land. Bias is learnable and removable. Variance is your precision floor.',
      'I estimate gain bias g = E[r_impact]/E[r_required] (g > 1 is oversensitive, g < 1 is undersensitive) and decompose <strong>MSE = |bias|² + σ_R²</strong>. Counts per 360 drives bias steeply and monotonically, so the <em>bias-zero sensitivity</em>, where g crosses 1, is the headline estimator. Variance is the hardware and skill floor, and I report it rather than recommending against it.',
    ],
    spec: [
      { k: 'refraction offset', v: 'up to 10 to 15°', mono: true },
      { k: 'fps analog', v: 'recoil · crosshair vs. point of impact' },
      { k: 'decomposition', v: 'MSE = |bias|² + σ_R²', mono: true },
      { k: 'headline', v: 'bias-zero counts per 360 (gain g = 1)' },
    ],
  },
  {
    id: 'strike', idx: 'v', accent: 'strike',
    eyebrow: ['environment 04', 'strike', 'mantis shrimp'],
    spine: 'the speed pole',
    title: 'The limit. Pure, uncorrectable speed.',
    lede: 'The mantis shrimp strike is a latch-mediated spring: about 10,400 g, full discharge in about 1.1 ms, no mid-flight correction. It is the canonical speed pole of the speed↔accuracy trade-off.',
    environment: 'The strike window: a target drifts into range for a heartbeat, with no time for a second thought and no taking the shot back. That knife edge built the mantis shrimp\'s latch. I rebuilt it as fire-the-instant-you-see-it, misses allowed.',
    body: [
      'The charge phase is about 300× longer than the strike itself<sup class="cs-cite">8</sup>: commit, and then there is no taking it back<sup class="cs-cite">7</sup>. My strike drill works the same way. Fire as fast as possible, misses allowed, no settling. I record reaction t_R, ballistic strike t_S, peak velocity, endpoint scatter σ_θ, and hit rate H.',
      'The pair <strong>(TTK = t_R + t_S, H)</strong> is your speed↔accuracy operating point at each sensitivity. Too sensitive and you are fast, but σ_θ explodes and H collapses. Too slow and you are tight, but late.',
      '<strong>This is the one place taste enters, and here is the fence I put around it.</strong> Setup ships a continuous <span class="cs-mark">goal slider</span> from precision to speed rather than three presets, because the trade really is continuous and a preset would invent a step where the physics has none. It defaults to 0.5, so an untouched slider asks for the balanced point rather than for nothing. That preference tunes the <em>strike</em> pole only. I considered weighting all four facets by it and rejected that: track, flick and calibrate measure skill, and letting taste move them would let you dial your own skill measurement up. The cost of the slider is real and it is yours to pay. Set it wrong and you get a correct number for a goal you did not want.',
    ],
    spec: [
      { k: 'peak acceleration', v: '~10,400 g', mono: true },
      { k: 'strike duration', v: '~1.1 ms', mono: true },
      { k: 'operating point', v: '(TTK = t_R + t_S, hit rate)', mono: true },
      { k: 'taste knob', v: 'goal slider · continuous · default 0.5 · strike pole only', mono: true },
    ],
  },
  {
    id: 'engine', idx: 'vi', accent: 'primary',
    eyebrow: ['the engine', 'one system', 'speed↔accuracy'],
    spine: 'triangulation',
    title: 'Four environments, one number.',
    lede: 'Each environment scores you in its own units: bits per second, a (0,1] rate, strikes per second, degrees. The trick is fusing them without lying.',
    body: [
      'I sweep each environment across counts per 360 and <strong>z-score it across its own sweep</strong>. That was a choice with rejected alternatives. Min-max normalizing would let one outlier trial set the whole scale. Rank-fusing would throw away <em>how much</em> better one sensitivity was than the next. Z-scoring is an affine map, and a quadratic\'s peak is invariant under affine transforms, so it is the one option that makes heterogeneous metrics commensurable <span class="cs-mark">without moving any instrument\'s own optimum</span>. That is the whole reason the fusion is honest rather than arbitrary.',
      'The four environments blend on equal footing, with your speed↔accuracy preference tuning the strike pole before it enters the blend. That blended score is <strong>fitness</strong>, and <span class="cs-mark">your sensitivity is the only gene</span> under selection. The search is the evolution the predators themselves underwent: each <span class="cs-mark">generation</span> mutates the fittest sensitivity so far by a gaussian step, plays the most promising offspring, and keeps it only if it scores higher. Elitist selection, with the step size self-adapting by the 1/5 success rule (offspring keep winning, so widen the search; they stop, so narrow in and refine).',
      '<strong>The trial budget is what forces the rest of the design.</strong> I capped a session at <span class="cs-mark">30 trials</span>, because past that a player stops caring and the drift I am fighting in section vii gets worse than the signal I am buying. <span class="cs-mark">8</span> of those go to seeding the pool before the search starts, which leaves 22 to actually search with. A grid sweep spends all 30 confirming the obvious. A plain evolution strategy spends them on offspring that were never going to win. So a <strong>gaussian process</strong> (matérn-5/2) carries the lineage\'s memory of the fitness landscape: it screens a candidate without spending a trial on it, and it denoises selection so a lucky trial cannot win. The same budget is why a segment stops once its own 90% ci is tighter than <span class="cs-mark">1,900 counts per 360</span>, and why "keep refining" buys 6 more generations rather than an open-ended run. A segment that has already answered should not be taking trials from one that has not.',
      'As the lineage converges, a <strong>parabola</strong> fit in log-sensitivity locates the peak (cross-checked against the gp\'s argmax) and a <strong>bootstrap</strong> draws the 90% confidence interval.',
      'The payoff is conceptual: there is <em>one</em> latent constant on <em>one</em> manifold, and the four faculties are four views of it. The engine <strong>tests</strong> that claim, fitting each faculty\'s own peak and showing whether they triangulate one answer or scatter. I also detrend the reported vertex for the practice or fatigue you pick up across the session, so the number lands where you aim best and not where you happened to finish. The interval\'s width is the estimate\'s total uncertainty: sampling noise, the fit, and how much the faculties disagree all widen it. A tight interval means the views concur on a sharp answer. <span class="cs-mark">a wide one is the system admitting the data do not yet pin the number down.</span>',
    ],
    spec: [
      { k: 'normalize', v: 'per-instrument z-score (affine, peak-preserving)' },
      { k: 'search', v: '(1+λ) evolution strategy · mutate · select · 1/5-rule step', mono: true },
      { k: 'trial budget', v: '30 trials max · 8 seeding the pool · 22 to search with', mono: true },
      { k: 'segment stop', v: '90% ci tighter than 1,900 counts per 360 · refine buys 6 generations', mono: true },
      { k: 'fitness memory', v: 'gaussian process · matérn-5/2 (denoise + screen)' },
      { k: 'thesis test', v: 'per-facet peaks + concordance, shown' },
      { k: 'drift', v: 'within-session practice/fatigue detrended at finalize' },
      { k: 'uncertainty', v: 'bootstrap 90% ci · widens with noise + facet disagreement' },
    ],
  },
  {
    id: 'honesty', idx: 'vii', accent: 'neutral',
    eyebrow: ['the honest part', 'what this does not solve'],
    spine: 'measurement honesty',
    title: 'The number, cross-examined.',
    lede: 'The fastest way to trust a measurement is to watch someone attack it. So I ran an adversarial review of my own measurement, on its own terms. Two of the attacks landed, and both became code changes.',
    body: [
      '<strong>I found two small lies in my own measurement and I fixed them.</strong> The strike drill had been dividing by a hand-picked one-degree constant and calling the result "measured uncertainty". The flick drill signed its endpoint error by whichever way my hand happened to move rather than by the axis the shot was along, so on a near-vertical reach the sign tracked horizontal wobble, inflating We and cancelling real bias out of Ae. Both quietly bent the number. The tuned constant became the hit rate\'s own binomial standard error carried through the delta method. The sign-hack became the <span class="cs-mark">ISO 9241-9</span> along-axis projection I had already claimed to use. Here is the diff.',
      '<strong>I remove the drift you accrue mid-session, and I refuse to say why.</strong> You get faster (practice) or slower (fatigue) as a session runs, and an evolutionary search that samples late trials near your best sensitivity would bake that trend straight into the answer. So at the close I fit the trend out with an <span class="cs-mark">ANCOVA over trial order</span> and disclose what I removed. The data cannot tell practice from fatigue, so the readout names both and claims neither. When your trial order is too tangled with the sensitivities tested to separate the trend from the curve, it says so and leaves the number alone.',
      '<strong>I test the core hypothesis.</strong> The whole design rests on one claim: that the four environments are four views of a single latent constant. So the result fits each faculty\'s <em>own</em> peak and <span class="cs-mark">draws them on the one axis</span>, four marks either triangulating the answer or visibly scattering. When they converge, that is the thesis holding up in front of you. When they scatter, I show the disagreement and leave it visible. A fused average that hid four faculties quietly disagreeing would look better and mean less.',
      '<strong>The interval can be wide.</strong> A short session, or genuinely conflicting faculties, produces an honestly wide ci rather than a falsely precise point. I ship the doubt along with the number, and the doubt is load-bearing.',
      '<strong>Variance is a floor.</strong> Precision (σ_R) is set by your hardware and your hands. I report it and leave it alone, because no sensitivity can fix it. A degenerate trial drops out of the blend rather than being padded with synthetic spread, because padding would inflate the metric and lie. Realistic spread belongs in the test fixtures and nowhere near production.',
      '<strong>I gate raw input, and then I let you walk past the gate.</strong> A measured session wants pointer-lock raw capture, and the blind turn runs an acceleration check because os mouse acceleration would make one true turn distance impossible to pin down. When that check fails, or when the browser refuses the lock outright, I still let you type your game and current in-game sensitivity by hand. Those typed numbers seed the search and pin the one browser-to-mouse factor the per-game table needs; they are never treated as a measured anchor, and the button says so both times it appears. Showing you the gate and the door beside it beats pretending the door is not there.',
    ],
    spec: [
      { k: 'self-audit', v: 'a tuned constant + a sign-hack, found in the "measured" SE and removed' },
      { k: 'session drift', v: 'practice/fatigue fit out at finalize, the cause left unnamed' },
      { k: 'the thesis', v: 'four faculty peaks tested for agreement, never assumed' },
      { k: 'when unsure', v: 'the interval widens; degenerate trials drop, never padded' },
      { k: 'the input gate', v: 'raw capture preferred · typed game + sens seeds and pins k, never an anchor' },
    ],
  },
  {
    id: 'colophon', idx: 'viii', accent: 'primary',
    eyebrow: ['colophon', 'how it is built'],
    spine: 'design engineering',
    title: 'How it is built.',
    lede: 'A pure, unit-tested measurement core wrapped by an engine and a hand-rolled ui, so validity can be proven and the craft is held to the same standard as the math.',
    body: [
      'The core (<strong>convert · scoring · optimizer · stats</strong>) is plain typescript, tested against published formulas: iso 9241-9 throughput, a constant-velocity kalman filter, a hand-rolled cholesky solve for the gaussian process. I hand-rolled the cholesky and the gp rather than pulling a library for one reason: a portfolio measurement a reviewer cannot read line by line is a measurement a reviewer cannot trust. No framework, no backend, and a vitest suite of <span class="cs-mark">650+ tests</span> you can run with <code>npm test</code>.',
      'The seams are deliberate. Every instrument is a pure <code>analyze()</code> plus a thin <code>run()</code> shell, so the math is tested against synthetic players and only the raw pointer/raf glue is runtime-only. The data-viz throughout is the same idea: a pure <code>plotGeometry()</code> (domain to pixel, fully unit-tested) and a thin renderer that only writes svg attributes. Every figure on this page is built from those same two pieces.',
      '<strong>I hold the graphics to the measurement\'s honesty.</strong> The 3d is sculpted <em>procedurally in-repo</em>, with no external tool and no baked asset a reviewer would have to take on faith. Every quarry is primitives and palette math, every shader hand-written. The cosmetic layers <span class="cs-mark">read the scored scene and write nothing back</span>, proven by a test that the scored stream is <em>byte-identical</em> with the skin on or off, so the graphics can never move the number. The same discipline governs how it looks: a foreground silhouette may never borrow the background\'s own color; the environment map\'s low sun and the analytic rim light derive from <em>one</em> direction, so a metal\'s specular ping and its silhouette halo agree with each other; the long shadow a target throws is both the diegetic dusk and the fix for a flat disc that vanishes at a first-person angle. One light, one set of consequences.',
      '<strong>I built the arc the same way.</strong> A returning player\'s calibration is measured once and remembered, so nobody redoes a calibration they already earned. The search narrates itself as the evolution it actually is, a gene pool seeded and then generation after generation. The payoff <span class="cs-mark">stages the reveal</span>, then shows the thesis being tested (each faculty\'s own peak marked on the one axis, triangulating or honestly scattering) and hands you a live range to feel the number in your own hand. A silent failure got caught in here too: a pointer-lock relock that died on the second escape, found and fixed like any measurement bug.',
      'Here is what a reviewer can check instead of taking my word for it. <code>tests/engine/arena-enemies.test.ts</code> asserts the scored recording stream is byte-identical with the cosmetic layers on or off. <code>tests/ui/range-lock.test.ts</code> covers the relock bug above. <code>prefers-reduced-motion</code> is honoured on every screen, including the reveal on this page. I have not benchmarked frame time on a named machine, so there is no fps number here. The whole thing is a single argument: that careful measurement and considered craft are the same discipline.',
    ],
    spec: [
      { k: 'stack', v: 'typescript · vite · three.js · client-only' },
      { k: 'tests', v: '650+ · pure core tdd · npm test', mono: true },
      { k: 'integrity gate', v: 'tests/engine/arena-enemies.test.ts', mono: true },
      { k: 'seams', v: 'pure analyze + thin shell · geometry + renderer' },
      { k: 'graphics', v: 'procedural in-repo · read-never-write · byte-identical scored stream' },
      { k: 'the arc', v: 'calibration remembered · reveal staged · thesis shown · range to feel it' },
    ],
  },
];

export interface Citation {
  /** Marker number used by the <sup class="cs-cite"> references in the prose. */
  n: number;
  work: string;
  /** The claim this source actually backs. A citation that cannot name one does not belong here. */
  backs: string;
}

/** Every entry carries the claim it supports, and every marker in the prose resolves to one of
 *  these. The UCB1 bandit citation that used to sit here was dropped: `src/optimizer/bandit.ts`
 *  is a fallback engine the session never wires up, so no claim on this page rests on it. */
export const CITATIONS: Citation[] = [
  { n: 1, work: 'Mischiati et al. Internal models direct dragonfly interception steering. Nature 517 (2015).', backs: 'the efference-copy forward model in ii' },
  { n: 2, work: 'Gonzalez-Bellido et al. Eight pairs of descending visual neurons … population vector of prey direction. PNAS 110(2) (2013).', backs: 'the 29.94 ± 5.75 ms latency in ii' },
  { n: 3, work: 'Brighton, Thomas & Taylor. Terminal attack trajectories of peregrine falcons … proportional navigation. PNAS 114(51) (2017).', backs: 'the falcon\'s terminal guidance in ii' },
  { n: 4, work: 'Tucker. The deep fovea, sideways vision and spiral flight paths in raptors. J. Exp. Biol. 203 (2000).', backs: 'the two-fovea trade in iii' },
  { n: 5, work: 'Land. Movements of the retinae of jumping spiders. J. Exp. Biol. 51 (1969).', backs: 'the open-loop orient speed in iii' },
  { n: 6, work: 'Zurek & Nelson. J. Comp. Physiol. A 198 (2012).', backs: 'the secondary-eye detect and principal-eye confirm stages in iii' },
  { n: 7, work: 'Patek et al. Deadly strike mechanism of a mantis shrimp. Nature 428 (2004).', backs: 'the ~10,400 g strike in v' },
  { n: 8, work: 'deVries & Patek. Integrative and Comparative Biology 59(6) (2019).', backs: 'the latch-mediated spring and its charge phase in v' },
  { n: 9, work: 'Reinel & Schuster. The archerfish predictive C-start. J. Comp. Physiol. A (2023).', backs: 'the learned correction and its aftereffect in iv' },
  { n: 10, work: 'Volotsky et al. eLife 13 (2024).', backs: 'the archerfish refraction offset in iv' },
  { n: 11, work: 'MacKenzie. Fitts\' law. In The Wiley Handbook of Human-Computer Interaction (2018).', backs: 'effective throughput as the flick scorer in iii' },
  { n: 12, work: 'ISO 9241-9:2000. Ergonomic requirements for office work with visual display terminals, part 9: requirements for non-keyboard input devices.', backs: 'We = 4.133·σ and the along-axis projection in iii and vii' },
];

const REPO = 'https://github.com/globalanomalyindex/campeon';
const SRC = `${REPO}/blob/main`;

export interface CreditLink { label: string; href: string; note: string; }

export const CREDIT = {
  by: 'designed and built by christopher robin fiore',
  theme: 'portfolio theme: looking to nature for answers',
  /** Section viii argues the measurement is reviewable line by line, so the piece has to hand a
   *  reviewer the lines. Each link points at the file the claim above it rests on. */
  links: [
    { label: 'the repository', href: REPO, note: 'all of it, client only, no backend' },
    { label: 'the search', href: `${SRC}/src/optimizer/evolution.ts`, note: 'src/optimizer/evolution.ts' },
    { label: 'the peak fit and the interval', href: `${SRC}/src/stats/peak-fit.ts`, note: 'src/stats/peak-fit.ts' },
    { label: 'The strike SE I repaired', href: `${SRC}/src/instruments/strike.ts`, note: 'src/instruments/strike.ts' },
    { label: 'The flick projection I repaired', href: `${SRC}/src/instruments/flick.ts`, note: 'src/instruments/flick.ts' },
    { label: 'the integrity gate', href: `${SRC}/tests/engine/arena-enemies.test.ts`, note: 'tests/engine/arena-enemies.test.ts' },
  ] as CreditLink[],
};

/**
 * A WORKED EXAMPLE with invented numbers, drawn so the shape of a converged sweep is legible on a
 * page a reader may reach before ever playing. Nothing here is measured, and every surface that
 * renders it labels it as an illustration (see `buildFigure` in case-study.ts). Four mark-sets
 * scattered across the sweep, a concave fit peaked near 9250 counts per 360, and four per-facet
 * peaks that sit near one another without fully agreeing, which is the ordinary case.
 */
export function demoConvergence(): PlotInput {
  const bounds: [Counts360, Counts360] = [counts360(4700), counts360(19000)];
  const peak = 9250;
  const at = (v: number) => -Math.pow(Math.log(v) - Math.log(peak), 2);
  const insts: InstrumentId[] = ['track', 'flick', 'calibrate', 'strike'];
  const xs = [5700, 7250, 9250, 11700, 14800];
  const jitter: Record<InstrumentId, number> = { track: 0.04, flick: -0.05, calibrate: 0.02, strike: -0.03 };
  const marks = insts.flatMap((instrument) =>
    xs.map((v) => ({ counts: counts360(v), instrument, score: at(v) + jitter[instrument] })),
  );
  const curve = [5000, 6300, 7900, 9250, 10800, 13200, 17300].map((v) => ({ x: Math.log(v), mean: at(v) }));
  const facetPeaks = [
    { instrument: 'track' as InstrumentId, peakCounts: counts360(8900), spreadLn: 0.07, laneConditioned: false },
    { instrument: 'flick' as InstrumentId, peakCounts: counts360(9600), spreadLn: 0.08, laneConditioned: false },
    { instrument: 'calibrate' as InstrumentId, peakCounts: counts360(9250), spreadLn: 0.06, laneConditioned: false },
    { instrument: 'strike' as InstrumentId, peakCounts: counts360(10450), spreadLn: 0.11, laneConditioned: true },
  ];
  return {
    bounds, marks, curve,
    ci90: [counts360(8630), counts360(9800)],
    peak: counts360(9250),
    facetPeaks,
    size: { width: 640, height: 280 },
  };
}
