import type { AppContext, Screen } from './shell';
import type { GameId, Result } from '../types';
import { GAME_YAW } from '../convert/yaw-table';
import { buildExportBundle, toJson, triggerDownload } from '../state/export';
import { plotGeometry, renderConvergencePlot } from './convergence-plot';
import { marksFromTrials } from './session-view';

const fmt = (v: number, digits = 1): string => (Number.isFinite(v) ? v.toFixed(digits) : '-');
// Signed standardized contribution (z-score units, σ). Dash for NaN/missing - never a fabricated facet pick.
const fmtZ = (v: number | undefined): string =>
  v !== undefined && Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}σ` : '-';

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
      const root = document.createElement('section');
      root.className = 'screen screen--shell result fade-in';
      const rows = GAME_YAW.map((g) => {
        const sens = r.perGameSens[g.id as GameId];
        const current = g.id === ctx.draft.currentGame;
        return `<tr data-game="${g.id}"${current ? ' data-current="true"' : ''}>
          <td>${g.label}</td><td class="mono">${sens === undefined ? '-' : sens.toFixed(3)}</td></tr>`;
      }).join('');
      root.innerHTML = `
        <div class="wrap stack result__inner">
          <p class="result__lead">your sweet spot</p>
          <h1 class="display result__number"><span data-result="cm360">${fmt(r.optimalCm360)}</span><small> cm/360</small></h1>
          ${tuned
            ? `<p class="result__ci result__ci--tuned mono">tuned by feel - not a measured optimum</p>`
            : `<p class="result__ci mono">90% CI <span data-result="ci">${fmt(r.ci90[0])}–${fmt(r.ci90[1])}</span> cm/360</p>`}
          ${!tuned && r.curve && r.bounds
            ? `<figure class="result__plot"><svg data-plot aria-hidden="true"></svg>
                <figcaption class="mono">the four probes converging on your one number</figcaption></figure>`
            : ''}
          <p class="result__credit">your most-evolved sensitivity - the target-acquisition “brain” six predators sharpened across four environments: dragonfly · falcon · spider · raptor · archerfish · mantis shrimp</p>
          <div class="result__tier" data-tier="origin">
            <p class="result__tier-head mono">where the number comes from</p>
            <div class="result__breakdown">
              <div><span class="result__bk-label">bias-zero <em>archerfish</em></span><span class="mono" data-breakdown="biasZeroCm360">${fmt(r.breakdown.biasZeroCm360)} cm/360</span></div>
            </div>
            ${hasFacets
              ? `<figure class="result__facets"><svg data-facets aria-hidden="true"></svg>
                  <figcaption class="mono">track + flick - the two intercept probes, marked where they pull on the blend
                    <span class="result__facet-z">+track <span data-breakdown="trackContribZ">${fmtZ(bk.trackContribZ)}</span> · +flick <span data-breakdown="flickContribZ">${fmtZ(bk.flickContribZ)}</span></span></figcaption></figure>`
              : ''}
          </div>
          <div class="result__tier" data-tier="readings">
            <p class="result__tier-head mono">readings at that sensitivity</p>
            <div class="result__breakdown">
              <div><span class="result__bk-label">precision floor</span><span class="mono" data-breakdown="precisionFloorDeg">${fmt(r.breakdown.precisionFloorDeg, 2)}°</span></div>
              <div><span class="result__bk-label">time-to-kill <em>mantis shrimp</em></span><span class="mono" data-breakdown="ttkMs">${fmt(r.breakdown.ttkMs, 0)} ms</span></div>
              <div><span class="result__bk-label">hit rate</span><span class="mono" data-breakdown="hitRate">${Number.isFinite(r.breakdown.hitRate) ? Math.round(r.breakdown.hitRate * 100) + '%' : '-'}</span></div>
            </div>
          </div>
          <label class="field result__game-pick">your game
            <select data-action="your-game">${GAME_YAW.map((g) => `<option value="${g.id}"${g.id === ctx.draft.currentGame ? ' selected' : ''}>${g.label}</option>`).join('')}</select></label>
          <table class="result__games"><thead><tr><th>game</th><th>sensitivity</th></tr></thead><tbody>${rows}</tbody></table>
          <p class="result__saved mono">saved locally</p>
          <div class="result__actions">
            <button class="action action--ghost" data-action="export">export json</button>
            <button class="action action--ghost" data-action="range">step into the range</button>
            <button class="action action--primary" data-action="again">run again</button>
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
          });
          renderConvergencePlot(svg, g, 'blended score');
        }
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
