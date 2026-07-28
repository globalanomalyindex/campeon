import { rememberPrefs, type AppContext, type Screen } from './shell';
import type { FacetConcordance, GameId, Result } from '../types';
import { GAME_YAW } from '../convert/yaw-table';
import { buildExportBundle, toJson, triggerDownload } from '../state/export';
import { plotGeometry, plotLegendHtml, renderConvergencePlot } from './convergence-plot';
import { BOUNDED_COPY, BOUNDED_LEAD, CONCORD_COPY, THESIS_COPY, THESIS_INCONCLUSIVE } from './concord';
import { marksFromTrials } from './session-view';
import {
  ciConcord, ratioFraming, CONFIRMED_MAX_ABS_LN, type Prescription, type RatioFraming,
} from '../optimizer/result';

const fmt = (v: number, digits = 1): string => (Number.isFinite(v) ? v.toFixed(digits) : '-');
// Counts are whole units at four-plus digits: rounded and grouped, because 8240 misreads as a
// year and the group separator is part of the number's legibility budget. Tabular figures come
// from the CSS (canon: every measured number gets them).
const fmtCounts = (v: number): string => (Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '-');
// Two decimals is the factor's honest resolution: the anchor floor is about 4%, so a third
// decimal would print noise (CONFIRMED_MAX_ABS_LN in optimizer/result.ts is the same judgement).
const fmtRatio = (v: number): string => (Number.isFinite(v) ? v.toFixed(2) : '-');

// Percent form of the confirmed band, derived from the classifier's own constant so the copy can
// never drift from the maths (the band is defined in ln space, hence expm1).
const CONFINED_PCT = Math.round(Math.expm1(CONFIRMED_MAX_ABS_LN) * 100);
// Two-sided 90% z, the same constant the anchor CI uses, so tier two's band and tier one's band
// mean the same coverage.
const Z90 = 1.6448536269514722;

// ── Tier-one copy. The screen is ordered by how much each claim assumes and the ordering IS the
// argument: the factor leads BECAUSE it assumes nothing (a ratio of two counts in the same units).
// Each variant below is one branch of the spec's error-path list; none may claim what its data
// cannot distinguish (canon invariant 2). Deliberately the least sophisticated sentences on the
// page: tier one earns the lead by assumptions, never by rhetoric.
const RATIO_WIDTH_NOTE =
  'This interval is wider than the band in the plot below, because the factor carries two measurements: where you aim best, and where you started. A narrower number would answer an easier question.';
// F33: only what the interval supports. No "the session had every chance to move you" (a claim
// about the design, not a measurement) and no "measured no move worth making" (the instrument
// cannot resolve below its own floor, so it cannot certify a move worthless).
const ratioConfirmedNote = (pct: number): string =>
  `Every factor this interval allows is within ${pct}% of no change, and ${pct}% is the tightest this instrument resolves: there is no change here it can distinguish. The honest instruction is to change nothing.`;
const RATIO_INDISTINCT_NOTE =
  'The factor against where you started came back with an interval that includes 1.00, so I will not prescribe a change I cannot tell apart from no change.';
const RATIO_UNAVAILABLE_NOTE =
  'The headline factor needs a clean read of where your hands started, and this session did not produce one. I report the location and leave the factor blank.';

// ── Tier-two copy. The one assumption, named, in words a player can act on. Two routes pin k and
// no third exists (the discrete DPI prior is the false-precision shortcut the spec bans). The
// typed route may NOT claim an exact pin: it inherits the anchor's spread whole (kLogSd, A5), so
// its note names the spread and the table carries it as a band.
const K_NOTE: Record<'lattice' | 'typed-sens', string> = {
  lattice:
    'One measured factor stands between my counts and your mouse. This session it showed up in the movement stream itself, so the table below is in your games’ own units.',
  'typed-sens':
    'One measured factor stands between my counts and your mouse. The in-game sensitivity you typed pinned it, to within the spread of the turn it was compared against, and each row below folds that spread into its 90% band.',
};
const TIER_TWO_WITHHELD =
  'No per-game numbers this session. They need one measured factor, the scale between what your browser reports and what your mouse actually counts, and nothing this session pinned it down. Telling me your game and current in-game sensitivity at setup pins it.';
const TIER_TWO_BOUNDED =
  'No per-game numbers for a bounded result. The number above is an edge of the window I searched, and converting an edge would hand you my search setting as if it were your best.';

// ── Tier-three copy. The tool's own unit, plus arithmetic the player can opt into. The conversion
// renders WITH its arithmetic visible so it can never read as a measurement; the canon test pins
// that no cm/360 string appears anywhere on this screen. Two variants (A6): with k pinned the
// number is HARDWARE counts (C*/k, the division done once in buildPrescription) and the DPI
// conversion carries one caveat; without k the number is BROWSER counts and every centimetre
// claim must name the second unmeasured factor, because this is the tier whose whole job is
// refusing to overclaim.
const TIER_THREE_EXPLAINER =
  'If you know your mouse’s DPI, that is counts divided by DPI, times 2.54, in centimetres.';
const BROWSER_COUNTS_NOTE =
  'These are counts as the browser reports them; the scale between them and your mouse’s own counts went unmeasured this session.';

/** Tier three's optional conversion: centimetres from the player's OWN typed DPI. Pure arithmetic
 *  on their input. It lives here in the shell, off every measured path, so nothing upstream can
 *  mistake it for a measurement. Returns null (never 0, never a guess) for a DPI that is not a
 *  positive finite number. Exported for the unit test. */
export const typedCm = (counts: number, dpi: number): number | null =>
  Number.isFinite(dpi) && dpi > 0 && Number.isFinite(counts) ? (counts / dpi) * 2.54 : null;

const convertedLine = (counts: number, dpiTyped: string, cm: number, hardware: boolean): string =>
  `${fmtCounts(counts)} ÷ ${dpiTyped} × 2.54 = ${cm.toFixed(1)} cm per 360, arithmetic on the DPI you typed. If that DPI is off, this length is off by the same factor.${
    hardware
      ? ''
      : ' It also carries a second unmeasured factor: the scale between browser deltas and your mouse’s own counts, which nothing this session pinned.'
  }`;

// The strike lean. track / flick / calibrate are pure skill readings; strike is the only facet
// that encodes the user's chosen speed and accuracy taste (profile.speedAccuracy, NOT the
// hardcoded instrumentWeights.strike). Claim only what the weighting provably does, never a
// fabricated counterfactual ms.
const strikeLean = (sa: number): string => {
  const side = sa > 0.5 ? 'speed' : sa < 0.5 ? 'accuracy' : 'an even balance';
  return `leaning toward ${side}, which you chose`;
};
// Signed standardized contribution (z-score units). Dash for NaN/missing, never a fabricated pick.
const fmtZ = (v: number | undefined): string =>
  v !== undefined && Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}σ` : '-';

// Session-drift copy (A4). The measured trend is per-session learning OR fatigue; the data cannot
// distinguish the two, so the copy names BOTH and never asserts one cause (honesty invariant).
// When the extended fit fell back the value is dashed and the copy makes NO removal claim.
const driftNote = (v: number | undefined): string =>
  v !== undefined && Number.isFinite(v)
    ? 'Session drift is removed from the number. It could be practice or it could be fatigue, and the data cannot separate the two.'
    : 'Session drift was not separable this run, so nothing was removed and the number is the plain fit.';

// A5 thesis block: each probe's own peak (or a dash, never faked), strike flagged as the
// taste-conditioned lane that is EXCLUDED from the verdict tier. Pure markup over measured values.
function thesisHtml(fc: FacetConcordance): string {
  const rows = fc.facets
    .map((f) => {
      const peak = f.peakCounts !== undefined && Number.isFinite(f.peakCounts) ? fmtCounts(f.peakCounts) : '-';
      return `<span class="result__thesis-facet" data-thesis-facet="${f.instrument}"><span class="dot dot--${f.instrument}"></span> ${f.instrument} ${peak}${f.laneConditioned ? '<sup>*</sup>' : ''}</span>`;
    })
    .join(' · ');
  const starred = fc.facets.some((f) => f.laneConditioned && f.peakCounts !== undefined);
  return `<div class="result__thesis" data-result="thesis" data-thesis-tier="${fc.tier ?? 'inconclusive'}">
    <p class="result__thesis-line">${fc.tier ? THESIS_COPY[fc.tier] : THESIS_INCONCLUSIVE}</p>
    <p class="result__thesis-facets mono">each probe's own peak (counts per 360, marked ◆ on the plot): ${rows}</p>
    ${starred ? `<p class="result__thesis-note"><sup>*</sup>Strike encodes the speed and accuracy lean you chose. It is shown here and excluded from the verdict.</p>` : ''}
  </div>`;
}

// The ratio pair as the screen consumes it: both fields or neither (they are built together in
// buildPrescription). Narrowed once here so every render branch below can trust it.
interface RatioReading { ratio: number; ci: [number, number]; }

// A single screen-reader summary sentence rendered ONCE near the number (not a live region: the
// result is static). Ranges are spelled " to " so no en-dash glyph is ever voiced; a tuned value
// carries NO measured-interval claim, and the ratio variants mirror the visible hero exactly.
function srSummary(
  r: Result,
  ratioP: RatioReading | undefined,
  framing: RatioFraming | undefined,
  tuned: boolean,
  bounded: 'low' | 'high' | undefined,
): string {
  if (tuned) return `Your sensitivity, tuned by feel: ${fmtCounts(r.optimalCounts)} counts per 360. It carries no measured interval.`;
  if (bounded) return `Your number reads as ${bounded === 'high' ? 'at least' : 'at most'} ${fmtCounts(r.optimalCounts)} counts per 360. The fitted curve peaks past the ${bounded === 'high' ? 'slow' : 'fast'} edge of the searched window, so the edge is a bound and no measured interval is reported.`;
  if (ratioP && framing === 'directional') return `Multiply your in-game sensitivity by ${fmtRatio(ratioP.ratio)}, 90% interval ${fmtRatio(ratioP.ci[0])} to ${fmtRatio(ratioP.ci[1])}. You aim best at ${fmtCounts(r.optimalCounts)} counts per 360.`;
  if (ratioP && framing === 'confirmed') return `The factor came back as ${fmtRatio(ratioP.ratio)}: every value its interval allows is within ${CONFINED_PCT}% of no change, the tightest this instrument resolves.`;
  const tail = ratioP
    ? 'The factor against your starting point includes no change, so I do not prescribe one.'
    : 'No starting-point factor was measurable this session.';
  // D1: ci90 is optional on the Result. This branch is measured-only in practice, so the interval
  // is always there; a missing one is simply left unspoken rather than fabricated.
  const interval = r.ci90 ? `, 90% interval ${fmtCounts(r.ci90[0])} to ${fmtCounts(r.ci90[1])}` : '';
  return `You aim best at ${fmtCounts(r.optimalCounts)} counts per 360${interval}. ${tail}`;
}

// Fixed viewBox: clientWidth is 0 before layout, so the geometry must use a constant design size.
const PLOT_SIZE = { width: 360, height: 200 };
const FACET_SIZE = { width: 360, height: 96 };

export function result(host: HTMLElement, ctx: AppContext): Screen {
  const r: Result | undefined = ctx.lastResult?.result;
  return {
    mount() {
      if (!r) { ctx.navigate('hero'); return; }
      const tuned = r.tuned ?? false;
      const bk = r.breakdown;
      const hasFacets =
        !tuned && r.bounds !== undefined &&
        (bk.trackContribZ !== undefined || bk.flickContribZ !== undefined);
      // Bounds honesty: gated on the persisted flag ONLY, never inferred from the optimum sitting
      // on an edge. A tuned value already dropped every measured claim.
      const bounded = !tuned ? r.peakAtBound : undefined;
      // The tier-one gate: a tuned value has no measured ratio even if a stale prescription rides
      // the Result (range-adopt drops it, but the screen must not depend on that), and a bounded
      // number is an edge no factor may be taken against (buildPrescription also refuses; this
      // gate covers old persisted Results that predate the refusal).
      const p: Prescription | undefined = !tuned && !bounded ? r.prescription : undefined;
      // A5: the ratio fields are optional now (a pinned k with a refused anchor still ships tier
      // two). Narrow them once; a prescription without them renders the counts hero + the
      // factor-blank sentence, NOT the indistinct sentence, because nothing was measured.
      const ratioP: RatioReading | undefined =
        p && p.ratio !== undefined && p.ratioCi90 !== undefined
          ? { ratio: p.ratio, ci: p.ratioCi90 }
          : undefined;
      const framing = ratioP ? ratioFraming(ratioP.ci) : undefined;
      const heroMode: 'tuned' | 'bounded' | 'ratio' | 'confirmed' | 'counts' =
        tuned ? 'tuned'
        : bounded ? 'bounded'
        : framing === 'directional' ? 'ratio'
        : framing === 'confirmed' ? 'confirmed'
        : 'counts';
      const showRatioHero = heroMode === 'ratio' || heroMode === 'confirmed';
      // D1: Result.ci90 is optional now (absent means tuned by feel; phase 1a task 4). A measured
      // Result always carries it; the truthiness guard keeps tsc honest under strict and renders
      // nothing from a malformed one rather than fabricating an interval.
      const concord = !tuned && !bounded && r.ci90 ? ciConcord(r.optimalCounts, r.ci90) : undefined;
      const lean = r.speedAccuracy;
      const fc = !tuned ? r.facetConcordance : undefined;

      const lead =
        heroMode === 'tuned' ? 'Your number'
        : heroMode === 'bounded' ? BOUNDED_LEAD
        : heroMode === 'ratio' ? 'Multiply your in-game sensitivity by'
        : heroMode === 'confirmed' ? 'The factor came back as'
        : 'Where you aim best';
      const heroNumber = showRatioHero && ratioP
        ? `<span data-result="ratio">${fmtRatio(ratioP.ratio)}</span><small>×</small>`
        : `<span data-result="counts360">${fmtCounts(r.optimalCounts)}</span><small> counts per 360</small>`;
      const ciLine = tuned
        ? `<p class="result__ci result__ci--tuned reveal" data-reveal style="--reveal-i:2">You picked this one by feel, so it carries no measured interval.</p>`
        : bounded
          ? `<p class="result__ci result__ci--bounded reveal" data-result="bounded" data-bounded="${bounded}" data-reveal style="--reveal-i:2">${BOUNDED_COPY[bounded](fmtCounts(r.optimalCounts))}</p>`
          : showRatioHero && ratioP
            ? `<p class="result__ci reveal" data-reveal style="--reveal-i:2">90% interval <span data-result="ratio-ci">${fmtRatio(ratioP.ci[0])} to ${fmtRatio(ratioP.ci[1])}</span>. ${
                heroMode === 'ratio'
                  ? 'A ratio of two counts measured the same way, so your game, mouse DPI and driver settings all cancel out of it.'
                  : `Everything this interval allows sits within ${CONFINED_PCT}% of no change.`
              }</p>`
            : r.ci90
              ? `<p class="result__ci reveal" data-reveal style="--reveal-i:2">90% interval <span data-result="ci">${fmtCounts(r.ci90[0])} to ${fmtCounts(r.ci90[1])}</span> counts per 360</p>`
              : '';
      const heroNote = tuned || bounded
        ? ''
        : heroMode === 'ratio'
          ? `<p class="result__ratio-note reveal" data-result="ratio-note" data-reveal style="--reveal-i:3">${RATIO_WIDTH_NOTE}</p>`
          : heroMode === 'confirmed'
            ? `<p class="result__ratio-note reveal" data-result="ratio-confirmed" data-reveal style="--reveal-i:3">${ratioConfirmedNote(CONFINED_PCT)}</p>`
            : ratioP
              ? `<p class="result__ratio-note reveal" data-result="ratio-withheld" data-reveal style="--reveal-i:3">${RATIO_INDISTINCT_NOTE}</p>`
              : `<p class="result__ratio-note reveal" data-result="ratio-unavailable" data-reveal style="--reveal-i:3">${RATIO_UNAVAILABLE_NOTE}</p>`;

      // Tier two: the table exists only under a pinned k. A tuned value renders no tier two at
      // all (its k evidence was dropped with the measurement, and explaining k against a hand
      // pick would be noise). Every row carries a 90% band built from two independent sources
      // combined in quadrature: the search's own precision (the drill bootstrap, read straight
      // off countsCi90) and k's spread (kLogSd, A5). Math.hypot is never smaller than either
      // input, so the band can only widen, never narrow (D3, and the same rule the interval has
      // already been fixed against four times). It renders even when kLogSd is 0 (an exactly
      // pure lattice): the bootstrap is still there, and a bare three-decimal sensitivity would
      // present a number the player types into their game as if it were exact. A degenerate
      // countsCi90 renders no band at all rather than a fabricated one. The withheld sentence
      // must be one a player can act on.
      const kSpread = p?.kLogSd !== undefined && Number.isFinite(p.kLogSd) && p.kLogSd > 0 ? p.kLogSd : 0;
      const searchHalfLn =
        p !== undefined && p.countsCi90[0] > 0 && p.countsCi90[1] > p.countsCi90[0]
          ? Math.log(p.countsCi90[1] / p.countsCi90[0]) / 2
          : null;
      const halfLn = searchHalfLn === null ? null : Math.hypot(searchHalfLn, Z90 * kSpread);
      const rows = p?.perGameSens
        ? GAME_YAW.map((g) => {
            const sens = p.perGameSens![g.id];
            const current = g.id === ctx.draft.currentGame;
            const bandCell =
              halfLn !== null
                ? `<td class="mono">${
                    sens === undefined
                      ? '-'
                      : `<span data-sens-band>${(sens * Math.exp(-halfLn)).toFixed(3)} to ${(sens * Math.exp(halfLn)).toFixed(3)}</span>`
                  }</td>`
                : '';
            return `<tr data-game="${g.id}"${current ? ' data-current="true"' : ''}>
              <td>${g.label}</td><td class="mono">${sens === undefined ? '-' : sens.toFixed(3)}</td>${bandCell}</tr>`;
          }).join('')
        : '';
      const tierTwo = tuned
        ? ''
        : `<div class="result__tier reveal" data-tier="two" data-reveal style="--reveal-i:9">
            <p class="result__tier-head t-label">No. 2 · one measured factor</p>
            ${p?.perGameSens && p.kSource
              ? `<p class="result__k-note">${K_NOTE[p.kSource]}</p>
                <label class="field result__game-pick"><span>Your game</span>
                  <select data-action="your-game">${GAME_YAW.map((g) => `<option value="${g.id}"${g.id === ctx.draft.currentGame ? ' selected' : ''}>${g.label}</option>`).join('')}</select></label>
                <table class="result__games"><thead><tr><th>Game</th><th>Sensitivity</th>${halfLn !== null ? '<th>90% band</th>' : ''}</tr></thead><tbody>${rows}</tbody></table>`
              : `<p class="result__tier-note" data-result="tier-two-withheld">${bounded ? TIER_TWO_BOUNDED : TIER_TWO_WITHHELD}</p>`}
          </div>`;

      // Tier three (A6): hardware counts when k is pinned (buildPrescription did the one
      // division and carried it as hardwareCounts), browser counts plus the second-factor
      // disclosure when it is not. The DPI conversion always divides the number SHOWN, so the
      // arithmetic on screen and the arithmetic performed can never disagree.
      const hw = !tuned && !bounded ? p?.hardwareCounts : undefined;
      const convertBase = hw !== undefined ? hw : r.optimalCounts;
      const boundedPrefix = bounded === 'high' ? 'At least ' : bounded === 'low' ? 'At most ' : '';
      const tierThreeLine = hw !== undefined
        ? `<span class="mono" data-result="tier-three-counts" data-counts-kind="hardware">${fmtCounts(hw)}</span> hardware counts of mouse travel make one full turn at this sensitivity. The measured browser factor is already divided out of this number. ${TIER_THREE_EXPLAINER}`
        : `${boundedPrefix}<span class="mono" data-result="tier-three-counts" data-counts-kind="browser">${fmtCounts(r.optimalCounts)}</span> browser counts of mouse travel make one full turn at this sensitivity. ${TIER_THREE_EXPLAINER} ${BROWSER_COUNTS_NOTE}`;
      const tierThree = `<div class="result__tier reveal" data-tier="three" data-reveal style="--reveal-i:10">
          <p class="result__tier-head t-label">No. 3 · arithmetic on your input</p>
          <p class="result__counts-line">${tierThreeLine}</p>
          <label class="field result__dpi-field"><span>Mouse DPI, if you know it</span>
            <input type="number" min="1" step="1" inputmode="numeric" data-action="dpi-convert"></label>
          <p class="result__converted mono" data-result="dpi-converted" hidden></p>
        </div>`;

      const root = document.createElement('section');
      root.className = 'screen screen--shell result fade-in';
      // Staged reveal: each data-reveal block fades/rises in sequence (--reveal-i drives the CSS
      // delay; reduced motion renders everything instantly). The NUMBER lands first, then the
      // evidence around it, then the tiers in assumption order, then the actions.
      root.innerHTML = `
        <div class="wrap stack result__inner">
          <div class="result__tier result__tier--one" data-tier="one" data-hero="${heroMode}">
            <p class="result__tier-head t-label reveal" data-reveal style="--reveal-i:0">No. 1 · assumes nothing</p>
            <p class="result__lead reveal" data-reveal style="--reveal-i:0">${lead}</p>
            <h1 class="display result__number reveal" data-reveal style="--reveal-i:1">${heroNumber}</h1>
            <p class="result__sr-summary sr-only">${srSummary(r, ratioP, framing, tuned, bounded)}</p>
            ${ciLine}
            ${heroNote}
          </div>
          ${concord
            ? `<p class="result__concord reveal" data-result="concord" data-concord="${concord}" data-reveal style="--reveal-i:4">${CONCORD_COPY[concord]}</p>`
            : ''}
          ${!tuned && r.curve && r.bounds
            ? `<figure class="result__plot reveal" data-reveal style="--reveal-i:5"><svg data-plot aria-hidden="true"></svg>
                <figcaption>${bounded
                  ? 'The four probes still climbing at the edge of the searched window. The answer line and the band stop where the search stopped.'
                  : 'The four probes converging on your one number.'} ${plotLegendHtml()}</figcaption></figure>`
            : ''}
          <p class="result__credit reveal" data-reveal style="--reveal-i:6">Measured across four environments and six organisms: dragonfly, falcon, spider, raptor, archerfish, mantis shrimp.</p>
          <div class="result__tier reveal" data-tier="origin" data-reveal style="--reveal-i:7">
            <p class="result__tier-head t-label">Where the number comes from</p>
            <div class="result__breakdown">
              <div><span class="result__bk-label"><span class="dot dot--calibrate"></span> Bias zero <em>archerfish</em></span><span data-breakdown="biasZeroCounts">${fmtCounts(bk.biasZeroCounts)} counts per 360</span></div>
              ${!tuned
                ? `<div><span class="result__bk-label">Session drift <em>practice or fatigue</em></span><span data-result="driftZ">${fmtZ(r.driftZ)}</span></div>`
                : ''}
            </div>
            ${!tuned ? `<p class="result__drift-note">${driftNote(r.driftZ)}</p>` : ''}
            ${fc ? thesisHtml(fc) : ''}
            ${hasFacets
              ? `<figure class="result__facets"><svg data-facets aria-hidden="true"></svg>
                  <figcaption>Track and flick, the two intercept probes, marked where they pull on the blend.
                    <span class="result__facet-z"><span class="dot dot--track"></span> track <span data-breakdown="trackContribZ">${fmtZ(bk.trackContribZ)}</span> · <span class="dot dot--flick"></span> flick <span data-breakdown="flickContribZ">${fmtZ(bk.flickContribZ)}</span></span></figcaption></figure>`
              : ''}
          </div>
          <div class="result__tier reveal" data-tier="readings" data-reveal style="--reveal-i:8">
            <p class="result__tier-head t-label">Readings at that sensitivity</p>
            <div class="result__breakdown">
              <div><span class="result__bk-label">Precision floor</span><span data-breakdown="precisionFloorDeg">${fmt(bk.precisionFloorDeg, 2)}°</span></div>
              <div><span class="result__bk-label"><span class="dot dot--strike"></span> Time to kill <em>mantis shrimp</em>${lean !== undefined ? ` <span class="result__lean" data-result="strikeLean">${strikeLean(lean)}</span>` : ''}</span><span data-breakdown="ttkMs">${fmt(bk.ttkMs, 0)} ms</span></div>
              <div><span class="result__bk-label">Hit rate</span><span data-breakdown="hitRate">${Number.isFinite(bk.hitRate) ? Math.round(bk.hitRate * 100) + '%' : '-'}</span></div>
            </div>
            ${lean !== undefined
              ? `<p class="result__lean-note">Track, flick and calibrate are pure skill readings. The strike pair encodes the speed and accuracy lean you chose, so it reports the balance you set.</p>`
              : ''}
          </div>
          ${tierTwo}
          ${tierThree}
          <p class="result__saved reveal" data-reveal style="--reveal-i:11">Saved locally. Nothing leaves your machine.</p>
          <div class="result__actions reveal" data-reveal style="--reveal-i:11">
            ${bounded ? `<button class="action action--primary" data-action="widen-search">Widen the search window</button>` : ''}
            <button class="action ${bounded ? 'action--secondary' : 'action--primary'}" data-action="range">Step into the range</button>
            <button class="action action--secondary" data-action="case-study">Read how this works</button>
            <button class="action action--ghost" data-action="again">Run again</button>
            <button class="action action--ghost" data-action="export">Export JSON</button>
          </div>
        </div>`;
      root.querySelector('[data-action="again"]')!.addEventListener('click', () => ctx.navigate('hero'));
      root.querySelector('[data-action="range"]')!.addEventListener('click', () => ctx.navigate('range'));
      // The honest next step for a bounded result: the options screen owns the search-window
      // control, so the offer to search wider routes there instead of inventing a second mechanism.
      root.querySelector('[data-action="widen-search"]')?.addEventListener('click', () => ctx.navigate('options'));
      root.querySelector('[data-action="case-study"]')!.addEventListener('click', () => ctx.navigate('case-study'));
      root.querySelector('[data-action="export"]')!.addEventListener('click', () => {
        const sessions = ctx.storage.loadSessions();
        const results = ctx.lastResult ? { [ctx.lastResult.sessionId]: ctx.lastResult.result } : {};
        triggerDownload('campeon-result.json', toJson(buildExportBundle(sessions, results, 0)));
      });
      const sel = root.querySelector('[data-action="your-game"]') as HTMLSelectElement | null;
      sel?.addEventListener('change', () => {
        root.querySelectorAll('tr[data-current="true"]').forEach((tr) => tr.removeAttribute('data-current'));
        root.querySelector(`tr[data-game="${sel.value}"]`)?.setAttribute('data-current', 'true');
        // The pick writes the draft and is remembered, so the next visit highlights the right
        // game without re-asking.
        ctx.draft.currentGame = sel.value as GameId;
        rememberPrefs(ctx);
      });
      // Tier three's converter: pure arithmetic on the typed value, rendered with the arithmetic
      // VISIBLE (counts, DPI, 2.54) so it can never read as a measurement. It divides convertBase,
      // the SAME number the tier displays (hardware when pinned, browser otherwise), and the
      // browser variant restates the second unmeasured factor. A non-positive or empty DPI clears
      // the line entirely: no guess, no zero, no held stale value.
      const dpiInput = root.querySelector('[data-action="dpi-convert"]') as HTMLInputElement | null;
      const dpiOut = root.querySelector('[data-result="dpi-converted"]') as HTMLElement | null;
      dpiInput?.addEventListener('input', () => {
        if (!dpiOut) return;
        const cm = typedCm(convertBase, Number(dpiInput.value));
        if (cm === null) { dpiOut.hidden = true; dpiOut.textContent = ''; return; }
        dpiOut.hidden = false;
        dpiOut.textContent = convertedLine(convertBase, dpiInput.value.trim(), cm, hw !== undefined);
      });
      host.appendChild(root);

      // Climax: redraw the convergence plot. Guard mirrors the markup guard: never plot a tuned
      // value (no measured curve) or an old number-only Result. Marks come from the persisted
      // trials via the pure marksFromTrials; curve/peak/CI are copied verbatim from the Result
      // (which copied them verbatim from the Report). This layer never refits.
      if (!tuned && r.curve && r.bounds) {
        const svg = root.querySelector('[data-plot]') as unknown as SVGElement | null;
        if (svg) {
          const sessionId = ctx.lastResult?.sessionId;
          const trials = ctx.storage.loadSessions().find((s) => s.id === sessionId)?.trials ?? [];
          const g = plotGeometry({
            bounds: r.bounds, marks: marksFromTrials(trials),
            curve: r.curve, peak: r.optimalCounts, size: PLOT_SIZE,
            // D1: ci90 is optional, and exactOptionalPropertyTypes forbids assigning undefined to
            // PlotInput's optional member, so it spreads in only when present.
            ...(r.ci90 ? { ci90: r.ci90 } : {}),
            // A5's per-facet peaks ride the top rail of the SAME plot, so the thesis copy below
            // has its visible counterpart: four probes, their own bests, one answer line.
            ...(fc ? { facetPeaks: fc.facets } : {}),
          });
          renderConvergencePlot(svg, g, 'blended score');
        }
      }

      // Stage the reveal on the next frame (CSS transitions from the data-reveal initial state);
      // under reduced motion the CSS renders everything instantly and this class is inert.
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => root.classList.add('is-revealed'));
      } else {
        root.classList.add('is-revealed');
      }

      // The two intercept probes (track + flick) as organism-colored marks on the SAME shared
      // counts log axis, anchored to the one answer (peak line). Reuses the pure
      // plotGeometry/renderConvergencePlot seam (no fork); guard mirrors `hasFacets`.
      if (hasFacets && r.bounds) {
        const svg = root.querySelector('[data-facets]') as unknown as SVGElement | null;
        if (svg) {
          const sessionId = ctx.lastResult?.sessionId;
          const trials = ctx.storage.loadSessions().find((s) => s.id === sessionId)?.trials ?? [];
          const facetMarks = marksFromTrials(trials).filter(
            (m) => m.instrument === 'track' || m.instrument === 'flick',
          );
          const g = plotGeometry({
            bounds: r.bounds, marks: facetMarks, peak: r.optimalCounts, size: FACET_SIZE,
          });
          renderConvergencePlot(svg, g);
        }
      }
    },
    unmount() { host.replaceChildren(); },
  };
}
