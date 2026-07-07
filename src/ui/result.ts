import type { AppContext, Screen } from './shell';
import type { FacetConcordance, GameId, Result } from '../types';
import { GAME_YAW } from '../convert/yaw-table';
import { buildExportBundle, toJson, triggerDownload } from '../state/export';
import { plotGeometry, plotLegendHtml, renderConvergencePlot } from './convergence-plot';
import { CONCORD_COPY, THESIS_COPY, THESIS_INCONCLUSIVE } from './concord';
import { marksFromTrials } from './session-view';
import { ciConcord } from '../optimizer/result';

const fmt = (v: number, digits = 1): string => (Number.isFinite(v) ? v.toFixed(digits) : '-');

// The strike lean. track / flick / calibrate are pure skill readings; strike is the only facet that encodes
// the user's chosen speed↔accuracy taste (profile.speedAccuracy, NOT the hardcoded instrumentWeights.strike).
// Claim only what the weighting provably does - which side it leans - never a fabricated counterfactual ms.
const strikeLean = (sa: number): string => {
  const side = sa > 0.5 ? 'speed' : sa < 0.5 ? 'accuracy' : 'a balanced speed/accuracy point';
  return `leaning toward ${side} (your call)`;
};
// Signed standardized contribution (z-score units, σ). Dash for NaN/missing - never a fabricated facet pick.
const fmtZ = (v: number | undefined): string =>
  v !== undefined && Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}σ` : '-';

// Session-drift copy (A4). The measured trend is per-session learning OR fatigue - the data cannot
// distinguish the two, so the copy names BOTH and never asserts one cause (honesty invariant). When
// the extended fit fell back the value is dashed and the copy must make NO removal claim.
const driftNote = (v: number | undefined): string =>
  v !== undefined && Number.isFinite(v)
    ? 'session drift - practice or fatigue, the data cannot say which - removed from the number.'
    : 'session drift was not separable this run - nothing removed; the number is the plain fit.';

// A5 thesis block: each probe's own peak (or a dash - never faked), strike flagged as the
// taste-conditioned lane that is EXCLUDED from the verdict tier. Pure markup over measured values.
function thesisHtml(fc: FacetConcordance): string {
  const rows = fc.facets
    .map((f) => {
      const peak = f.peakCm360 !== undefined && Number.isFinite(f.peakCm360) ? f.peakCm360.toFixed(1) : '-';
      return `<span class="result__thesis-facet" data-thesis-facet="${f.instrument}">${f.instrument} ${peak}${f.laneConditioned ? '<sup>*</sup>' : ''}</span>`;
    })
    .join(' · ');
  const starred = fc.facets.some((f) => f.laneConditioned && f.peakCm360 !== undefined);
  return `<div class="result__thesis" data-result="thesis" data-thesis-tier="${fc.tier ?? 'inconclusive'}">
    <p class="result__thesis-line">${fc.tier ? THESIS_COPY[fc.tier] : THESIS_INCONCLUSIVE}</p>
    <p class="result__thesis-facets mono">each probe's own peak (cm/360, marked ◆ on the plot): ${rows}</p>
    ${starred ? `<p class="result__thesis-note mono"><sup>*</sup>strike encodes your speed/accuracy taste - shown, but excluded from the verdict</p>` : ''}
  </div>`;
}

// A single screen-reader summary sentence rendered ONCE near the number (not a live region - the
// result is static). The CI range is spelled " to " so no en-dash glyph is ever voiced; a tuned-by-feel
// value carries NO measured-CI claim (honesty), so it is announced as tuned without a band.
const srSummary = (r: Result, tuned: boolean): string =>
  tuned
    ? `Your sensitivity, tuned by feel: ${fmt(r.optimalCm360)} centimetres per 360. This is a hand-picked value, not a measured optimum.`
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
      // CI concord: a measured-only readout (gated !tuned - a hand-picked value has no measured CI/concord).
      // undefined for a degenerate/old CI so nothing is fabricated.
      const concord = !tuned ? ciConcord(r.optimalCm360, r.ci90) : undefined;
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
          <p class="result__lead" data-reveal style="--reveal-i:0">your sweet spot</p>
          <h1 class="display result__number" data-reveal style="--reveal-i:1"><span data-result="cm360">${fmt(r.optimalCm360)}</span><small> cm/360</small></h1>
          <p class="result__sr-summary sr-only">${srSummary(r, tuned)}</p>
          ${tuned
            ? `<p class="result__ci result__ci--tuned mono" data-reveal style="--reveal-i:2">tuned by feel - not a measured optimum</p>`
            : `<p class="result__ci mono" data-reveal style="--reveal-i:2">90% CI <span data-result="ci">${fmt(r.ci90[0])}–${fmt(r.ci90[1])}</span> cm/360</p>`}
          ${concord
            ? `<p class="result__concord" data-result="concord" data-concord="${concord}" data-reveal style="--reveal-i:3">${CONCORD_COPY[concord]}</p>`
            : ''}
          ${!tuned && r.curve && r.bounds
            ? `<figure class="result__plot" data-reveal style="--reveal-i:4"><svg data-plot aria-hidden="true"></svg>
                <figcaption class="mono">the four probes converging on your one number ${plotLegendHtml()}</figcaption></figure>`
            : ''}
          <p class="result__credit" data-reveal style="--reveal-i:5">your most-evolved sensitivity - the target-acquisition “brain” six predators sharpened across four environments: dragonfly · falcon · spider · raptor · archerfish · mantis shrimp</p>
          <div class="result__tier" data-tier="origin" data-reveal style="--reveal-i:6">
            <p class="result__tier-head mono">where the number comes from</p>
            <div class="result__breakdown">
              <div><span class="result__bk-label">bias-zero <em>archerfish</em></span><span class="mono" data-breakdown="biasZeroCm360">${fmt(r.breakdown.biasZeroCm360)} cm/360</span></div>
              ${!tuned
                ? `<div><span class="result__bk-label">session drift <em>practice or fatigue</em></span><span class="mono" data-result="driftZ">${fmtZ(r.driftZ)}</span></div>`
                : ''}
            </div>
            ${!tuned ? `<p class="result__drift-note mono">${driftNote(r.driftZ)}</p>` : ''}
            ${fc ? thesisHtml(fc) : ''}
            ${hasFacets
              ? `<figure class="result__facets"><svg data-facets aria-hidden="true"></svg>
                  <figcaption class="mono">track + flick - the two intercept probes, marked where they pull on the blend
                    <span class="result__facet-z">+track <span data-breakdown="trackContribZ">${fmtZ(bk.trackContribZ)}</span> · +flick <span data-breakdown="flickContribZ">${fmtZ(bk.flickContribZ)}</span></span></figcaption></figure>`
              : ''}
          </div>
          <div class="result__tier" data-tier="readings" data-reveal style="--reveal-i:7">
            <p class="result__tier-head mono">readings at that sensitivity</p>
            <div class="result__breakdown">
              <div><span class="result__bk-label">precision floor</span><span class="mono" data-breakdown="precisionFloorDeg">${fmt(r.breakdown.precisionFloorDeg, 2)}°</span></div>
              <div><span class="result__bk-label">time-to-kill <em>mantis shrimp</em>${lean !== undefined ? ` <span class="result__lean" data-result="strikeLean">${strikeLean(lean)}</span>` : ''}</span><span class="mono" data-breakdown="ttkMs">${fmt(r.breakdown.ttkMs, 0)} ms</span></div>
              <div><span class="result__bk-label">hit rate</span><span class="mono" data-breakdown="hitRate">${Number.isFinite(r.breakdown.hitRate) ? Math.round(r.breakdown.hitRate * 100) + '%' : '-'}</span></div>
            </div>
            ${lean !== undefined
              ? `<p class="result__lean-note mono">track, flick and calibrate are pure skill readings; the strike pair encodes your chosen speed/accuracy lean, not a measured optimum.</p>`
              : ''}
          </div>
          <div data-reveal style="--reveal-i:8">
            <label class="field result__game-pick">your game
              <select data-action="your-game">${GAME_YAW.map((g) => `<option value="${g.id}"${g.id === ctx.draft.currentGame ? ' selected' : ''}>${g.label}</option>`).join('')}</select></label>
            <table class="result__games"><thead><tr><th>game</th><th>sensitivity</th></tr></thead><tbody>${rows}</tbody></table>
            <p class="result__saved mono">saved locally</p>
          </div>
          <div class="result__actions" data-reveal style="--reveal-i:9">
            <button class="action action--primary" data-action="range">step into the range - feel it</button>
            <button class="action action--ghost" data-action="again">run again</button>
            <button class="action action--ghost" data-action="export">export json</button>
          </div>
        </div>`;
      root.querySelector('[data-action="again"]')!.addEventListener('click', () => ctx.navigate('hero'));
      root.querySelector('[data-action="range"]')!.addEventListener('click', () => ctx.navigate('range'));
      root.querySelector('[data-action="export"]')!.addEventListener('click', () => {
        const sessions = ctx.storage.loadSessions();
        const results = ctx.lastResult ? { [ctx.lastResult.sessionId]: ctx.lastResult.result } : {};
        triggerDownload('campeon-result.json', toJson(buildExportBundle(sessions, results, 0)));
      });
      const sel = root.querySelector('[data-action="your-game"]') as HTMLSelectElement | null;
      sel?.addEventListener('change', () => {
        root.querySelectorAll('tr[data-current="true"]').forEach((tr) => tr.removeAttribute('data-current'));
        root.querySelector(`tr[data-game="${sel.value}"]`)?.setAttribute('data-current', 'true');
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
