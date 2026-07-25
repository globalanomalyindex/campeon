import { rememberPrefs, type AppContext, type Screen } from './shell';
import type { FacetConcordance, GameId, Result } from '../types';
import { GAME_YAW } from '../convert/yaw-table';
import { buildExportBundle, toJson, triggerDownload } from '../state/export';
import { plotGeometry, plotLegendHtml, renderConvergencePlot } from './convergence-plot';
import { BOUNDED_COPY, BOUNDED_LEAD, CONCORD_COPY, THESIS_COPY, THESIS_INCONCLUSIVE } from './concord';
import { marksFromTrials } from './session-view';
import { ciConcord } from '../optimizer/result';

const fmt = (v: number, digits = 1): string => (Number.isFinite(v) ? v.toFixed(digits) : '-');

// The strike lean. track / flick / calibrate are pure skill readings; strike is the only facet that encodes
// the user's chosen speed↔accuracy taste (profile.speedAccuracy, NOT the hardcoded instrumentWeights.strike).
// Claim only what the weighting provably does - which side it leans - never a fabricated counterfactual ms.
const strikeLean = (sa: number): string => {
  const side = sa > 0.5 ? 'speed' : sa < 0.5 ? 'accuracy' : 'an even balance';
  return `leaning toward ${side}, which you chose`;
};
// Signed standardized contribution (z-score units, σ). Dash for NaN/missing - never a fabricated facet pick.
const fmtZ = (v: number | undefined): string =>
  v !== undefined && Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}σ` : '-';

// Session-drift copy (A4). The measured trend is per-session learning OR fatigue - the data cannot
// distinguish the two, so the copy names BOTH and never asserts one cause (honesty invariant). When
// the extended fit fell back the value is dashed and the copy must make NO removal claim.
const driftNote = (v: number | undefined): string =>
  v !== undefined && Number.isFinite(v)
    ? 'Session drift is removed from the number. It could be practice or it could be fatigue, and the data cannot separate the two.'
    : 'Session drift was not separable this run, so nothing was removed and the number is the plain fit.';

// A5 thesis block: each probe's own peak (or a dash - never faked), strike flagged as the
// taste-conditioned lane that is EXCLUDED from the verdict tier. Pure markup over measured values.
function thesisHtml(fc: FacetConcordance): string {
  const rows = fc.facets
    .map((f) => {
      const peak = f.peakCm360 !== undefined && Number.isFinite(f.peakCm360) ? f.peakCm360.toFixed(1) : '-';
      return `<span class="result__thesis-facet" data-thesis-facet="${f.instrument}"><span class="dot dot--${f.instrument}"></span> ${f.instrument} ${peak}${f.laneConditioned ? '<sup>*</sup>' : ''}</span>`;
    })
    .join(' · ');
  const starred = fc.facets.some((f) => f.laneConditioned && f.peakCm360 !== undefined);
  return `<div class="result__thesis" data-result="thesis" data-thesis-tier="${fc.tier ?? 'inconclusive'}">
    <p class="result__thesis-line">${fc.tier ? THESIS_COPY[fc.tier] : THESIS_INCONCLUSIVE}</p>
    <p class="result__thesis-facets mono">each probe's own peak (cm/360, marked ◆ on the plot): ${rows}</p>
    ${starred ? `<p class="result__thesis-note"><sup>*</sup>Strike encodes the speed and accuracy lean you chose. It is shown here and excluded from the verdict.</p>` : ''}
  </div>`;
}

// A single screen-reader summary sentence rendered ONCE near the number (not a live region - the
// result is static). The CI range is spelled " to " so no en-dash glyph is ever voiced; a tuned-by-feel
// value carries NO measured-CI claim (honesty), so it is announced as tuned without a band.
const srSummary = (r: Result, tuned: boolean, bounded?: 'low' | 'high'): string =>
  tuned
    ? `Your sensitivity, tuned by feel: ${fmt(r.optimalCm360)} centimetres per 360. It carries no measured interval.`
    : bounded
      ? `Your number reads as ${bounded === 'high' ? 'at least' : 'at most'} ${fmt(r.optimalCm360)} centimetres per 360. The fitted curve peaks past the ${bounded === 'high' ? 'slow' : 'fast'} edge of the searched window, so the edge is a bound and no measured interval is reported.`
      : `Your most-evolved sensitivity is ${fmt(r.optimalCm360)} centimetres per 360, with a 90% confidence interval from ${fmt(r.ci90[0])} to ${fmt(r.ci90[1])}.`;

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
      // The track/flick micro-plot needs the persisted axis (bounds) AND the affine contributions, both
      // of which a tuned-by-feel value drops and an OLD saved Result never had. Gate on all three so old
      // results render number-only and a hand-picked value makes no measured-facet claim (honesty).
      const hasFacets =
        !tuned && r.bounds !== undefined &&
        (bk.trackContribZ !== undefined || bk.flickContribZ !== undefined);
      // Bounds honesty: when the fitted vertex fell past an edge of the searched window, the number on
      // screen is that edge and must read as a bound. Gated on the persisted flag ONLY - an old saved
      // Result without the field renders exactly as before, and boundedness is never inferred from the
      // optimum happening to sit on an edge. A tuned value already dropped every measured claim.
      const bounded = !tuned ? r.peakAtBound : undefined;
      // CI concord: a measured-only readout (gated !tuned - a hand-picked value has no measured CI/concord).
      // undefined for a degenerate/old CI so nothing is fabricated. Also gated !bounded: a clamped band's
      // width describes where the clamp cut it, so a width bucket would dress the truncation as a reading.
      const concord = !tuned && !bounded ? ciConcord(r.optimalCm360, r.ci90) : undefined;
      // The strike lean comes from the user's real taste knob (carried as r.speedAccuracy); OLD results lack
      // it (number-only), and it is the only facet that encodes a chosen lean rather than pure skill.
      const lean = r.speedAccuracy;
      const root = document.createElement('section');
      root.className = 'screen screen--shell result fade-in';
      const rows = GAME_YAW.map((g) => {
        const sens = r.perGameSens[g.id as GameId];
        const current = g.id === ctx.draft.currentGame;
        return `<tr data-game="${g.id}"${current ? ' data-current="true"' : ''}>
          <td>${g.label}</td><td class="mono">${sens === undefined ? '-' : sens.toFixed(3)}</td></tr>`;
      }).join('');
      // The A5 facet-concordance readout: adoptResult drops it for tuned values and old Results never
      // had it, so its presence is the gate - nothing is fabricated for either.
      const fc = !tuned ? r.facetConcordance : undefined;
      // Staged reveal: each data-reveal block fades/rises in sequence (--reveal-i drives the CSS
      // delay; reduced-motion renders everything instantly). The NUMBER lands first, then the
      // evidence around it - the payoff reads as a reveal, not a data dump.
      root.innerHTML = `
        <div class="wrap stack result__inner">
          <p class="result__lead reveal" data-reveal style="--reveal-i:0">${bounded ? BOUNDED_LEAD : 'Your number'}</p>
          <h1 class="display result__number reveal" data-reveal style="--reveal-i:1"><span data-result="cm360">${fmt(r.optimalCm360)}</span><small> cm/360</small></h1>
          <p class="result__sr-summary sr-only">${srSummary(r, tuned, bounded)}</p>
          ${tuned
            ? `<p class="result__ci result__ci--tuned reveal" data-reveal style="--reveal-i:2">You picked this one by feel, so it carries no measured interval.</p>`
            : bounded
              ? `<p class="result__ci result__ci--bounded reveal" data-result="bounded" data-bounded="${bounded}" data-reveal style="--reveal-i:2">${BOUNDED_COPY[bounded](fmt(r.optimalCm360))}</p>`
              : `<p class="result__ci reveal" data-reveal style="--reveal-i:2">90% confidence interval <span data-result="ci">${fmt(r.ci90[0])} to ${fmt(r.ci90[1])}</span> cm/360</p>`}
          ${concord
            ? `<p class="result__concord reveal" data-result="concord" data-concord="${concord}" data-reveal style="--reveal-i:3">${CONCORD_COPY[concord]}</p>`
            : ''}
          ${!tuned && r.curve && r.bounds
            ? `<figure class="result__plot reveal" data-reveal style="--reveal-i:4"><svg data-plot aria-hidden="true"></svg>
                <figcaption>${bounded
                  ? 'The four probes still climbing at the edge of the searched window. The answer line and the band stop where the search stopped.'
                  : 'The four probes converging on your one number.'} ${plotLegendHtml()}</figcaption></figure>`
            : ''}
          <p class="result__credit reveal" data-reveal style="--reveal-i:5">Measured across four environments and six organisms: dragonfly, falcon, spider, raptor, archerfish, mantis shrimp.</p>
          <div class="result__tier reveal" data-tier="origin" data-reveal style="--reveal-i:6">
            <p class="result__tier-head t-label">Where the number comes from</p>
            <div class="result__breakdown">
              <div><span class="result__bk-label"><span class="dot dot--calibrate"></span> Bias zero <em>archerfish</em></span><span data-breakdown="biasZeroCm360">${fmt(r.breakdown.biasZeroCm360)} cm/360</span></div>
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
          <div class="result__tier reveal" data-tier="readings" data-reveal style="--reveal-i:7">
            <p class="result__tier-head t-label">Readings at that sensitivity</p>
            <div class="result__breakdown">
              <div><span class="result__bk-label">Precision floor</span><span data-breakdown="precisionFloorDeg">${fmt(r.breakdown.precisionFloorDeg, 2)}°</span></div>
              <div><span class="result__bk-label"><span class="dot dot--strike"></span> Time to kill <em>mantis shrimp</em>${lean !== undefined ? ` <span class="result__lean" data-result="strikeLean">${strikeLean(lean)}</span>` : ''}</span><span data-breakdown="ttkMs">${fmt(r.breakdown.ttkMs, 0)} ms</span></div>
              <div><span class="result__bk-label">Hit rate</span><span data-breakdown="hitRate">${Number.isFinite(r.breakdown.hitRate) ? Math.round(r.breakdown.hitRate * 100) + '%' : '-'}</span></div>
            </div>
            ${lean !== undefined
              ? `<p class="result__lean-note">Track, flick and calibrate are pure skill readings. The strike pair encodes the speed and accuracy lean you chose, so it reports the balance you set.</p>`
              : ''}
          </div>
          <div class="reveal" data-reveal style="--reveal-i:8">
            <label class="field result__game-pick"><span>Your game</span>
              <select data-action="your-game">${GAME_YAW.map((g) => `<option value="${g.id}"${g.id === ctx.draft.currentGame ? ' selected' : ''}>${g.label}</option>`).join('')}</select></label>
            <table class="result__games"><thead><tr><th>Game</th><th>Sensitivity</th></tr></thead><tbody>${rows}</tbody></table>
            <p class="result__saved">Saved locally. Nothing leaves your machine.</p>
          </div>
          <div class="result__actions reveal" data-reveal style="--reveal-i:9">
            ${bounded ? `<button class="action action--primary" data-action="widen-search">Widen the search window</button>` : ''}
            <button class="action ${bounded ? 'action--secondary' : 'action--primary'}" data-action="range">Step into the range</button>
            <button class="action action--secondary" data-action="case-study">Read how this works</button>
            <button class="action action--ghost" data-action="again">Run again</button>
            <button class="action action--ghost" data-action="export">Export JSON</button>
          </div>
        </div>`;
      root.querySelector('[data-action="again"]')!.addEventListener('click', () => ctx.navigate('hero'));
      root.querySelector('[data-action="range"]')!.addEventListener('click', () => ctx.navigate('range'));
      // The honest next step for a bounded result: the options screen owns the search-window control,
      // so the offer to search wider routes there instead of inventing a second mechanism.
      root.querySelector('[data-action="widen-search"]')?.addEventListener('click', () => ctx.navigate('options'));
      // The result is the one place a reader is most likely to want the reasoning, and it was the
      // one screen with no route to it.
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
        // The deferred game pick previously never left this screen - now it writes the draft and is
        // remembered, so the next visit highlights the right game without re-asking.
        ctx.draft.currentGame = sel.value as GameId;
        rememberPrefs(ctx);
      });
      host.appendChild(root);

      // Climax: redraw the convergence plot. Guard mirrors the markup guard - never plot a tuned value
      // (no measured curve) or an old number-only Result. Marks come from the persisted trials via the
      // existing pure marksFromTrials (no marks-schema duplication); curve/peak/CI are copied verbatim
      // from the Result (which copied them verbatim from the Report) - this layer never refits.
      if (!tuned && r.curve && r.bounds) {
        const svg = root.querySelector('[data-plot]') as unknown as SVGElement | null;
        if (svg) {
          const sessionId = ctx.lastResult?.sessionId;
          const trials = ctx.storage.loadSessions().find((s) => s.id === sessionId)?.trials ?? [];
          const g = plotGeometry({
            bounds: r.bounds, marks: marksFromTrials(trials),
            curve: r.curve, ci90: r.ci90, peak: r.optimalCm360, size: PLOT_SIZE,
            // A5's per-facet peaks ride the top rail of the SAME plot, so the thesis copy below has
            // its visible counterpart: four probes, their own bests, one gold answer line.
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

      // The two intercept probes (track + flick) shown as organism-colored marks on the SAME shared
      // ln(cm/360) axis, anchored to the one answer (peak line) - a small micro-plot, not extra grid
      // numbers. Reuses the pure plotGeometry/renderConvergencePlot seam (no fork); marks come from the
      // persisted trials via marksFromTrials, filtered to the two facets. Guard mirrors `hasFacets`.
      if (hasFacets && r.bounds) {
        const svg = root.querySelector('[data-facets]') as unknown as SVGElement | null;
        if (svg) {
          const sessionId = ctx.lastResult?.sessionId;
          const trials = ctx.storage.loadSessions().find((s) => s.id === sessionId)?.trials ?? [];
          const facetMarks = marksFromTrials(trials).filter(
            (m) => m.instrument === 'track' || m.instrument === 'flick',
          );
          const g = plotGeometry({
            bounds: r.bounds, marks: facetMarks, peak: r.optimalCm360, size: FACET_SIZE,
          });
          renderConvergencePlot(svg, g);
        }
      }
    },
    unmount() { host.replaceChildren(); },
  };
}
