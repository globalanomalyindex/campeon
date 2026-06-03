import type { AppContext, Screen } from './shell';
import type { GameId, Result } from '../types';
import { GAME_YAW } from '../convert/yaw-table';
import { buildExportBundle, toJson, triggerDownload } from '../state/export';

const fmt = (v: number, digits = 1): string => (Number.isFinite(v) ? v.toFixed(digits) : '—');

export function result(host: HTMLElement, ctx: AppContext): Screen {
  const r: Result | undefined = ctx.lastResult?.result;
  return {
    mount() {
      if (!r) { ctx.navigate('hero'); return; }
      const root = document.createElement('section');
      root.className = 'screen screen--shell result fade-in';
      const rows = GAME_YAW.map((g) => {
        const sens = r.perGameSens[g.id as GameId];
        const current = g.id === ctx.draft.currentGame;
        return `<tr data-game="${g.id}"${current ? ' data-current="true"' : ''}>
          <td>${g.label}</td><td class="mono">${sens === undefined ? '—' : sens.toFixed(3)}</td></tr>`;
      }).join('');
      root.innerHTML = `
        <div class="wrap stack result__inner">
          <p class="result__lead">your sweet spot</p>
          <h1 class="display result__number"><span data-result="cm360">${fmt(r.optimalCm360)}</span><small> cm/360</small></h1>
          <p class="result__ci mono">90% CI <span data-result="ci">${fmt(r.ci90[0])}–${fmt(r.ci90[1])}</span> cm/360</p>
          <p class="result__credit">where you held up best — the search converged here across four predator faculties: dragonfly · falcon · spider · raptor · archerfish · mantis shrimp</p>
          <div class="result__breakdown">
            <div><span class="result__bk-label">bias-zero <em>archerfish</em></span><span class="mono" data-breakdown="biasZeroCm360">${fmt(r.breakdown.biasZeroCm360)} cm/360</span></div>
            <div><span class="result__bk-label">precision floor</span><span class="mono" data-breakdown="precisionFloorDeg">${fmt(r.breakdown.precisionFloorDeg, 2)}°</span></div>
            <div><span class="result__bk-label">time-to-kill <em>mantis shrimp</em></span><span class="mono" data-breakdown="ttkMs">${fmt(r.breakdown.ttkMs, 0)} ms</span></div>
            <div><span class="result__bk-label">hit rate</span><span class="mono" data-breakdown="hitRate">${Number.isFinite(r.breakdown.hitRate) ? Math.round(r.breakdown.hitRate * 100) + '%' : '—'}</span></div>
          </div>
          <table class="result__games"><thead><tr><th>game</th><th>sensitivity</th></tr></thead><tbody>${rows}</tbody></table>
          <p class="result__saved mono">saved locally</p>
          <div class="result__actions">
            <button class="action action--ghost" data-action="export">export json</button>
            <button class="action action--primary" data-action="again">run again</button>
          </div>
        </div>`;
      root.querySelector('[data-action="again"]')!.addEventListener('click', () => ctx.navigate('hero'));
      root.querySelector('[data-action="export"]')!.addEventListener('click', () => {
        const sessions = ctx.storage.loadSessions();
        const results = ctx.lastResult ? { [ctx.lastResult.sessionId]: ctx.lastResult.result } : {};
        triggerDownload('campeon-result.json', toJson(buildExportBundle(sessions, results, 0)));
      });
      host.appendChild(root);
    },
    unmount() { host.replaceChildren(); },
  };
}
