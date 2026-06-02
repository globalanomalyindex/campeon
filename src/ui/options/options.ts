import type { AppContext, Screen } from '../shell';
import type { GameId } from '../../types';
import { CONVERSION_SCHOOLS, monitorDistanceMatchCm360 } from '../../convert/schools';
import { effectiveYawTable, normalizeBounds, type YawOverrides } from './settings';
import { sensFor } from '../../convert/cm360';

export function options(host: HTMLElement, ctx: AppContext): Screen {
  const overrides: YawOverrides = {};
  return {
    mount() {
      const root = document.createElement('section');
      root.className = 'screen screen--shell options fade-in';
      const [lo, hi] = ctx.draft.bounds;
      const mid = Math.round(Math.sqrt(lo * hi));

      root.innerHTML = `
        <div class="wrap options__inner stack">
          <button class="action action--ghost" data-action="back">back</button>
          <h2 class="options__title display">+ options</h2>

          <section class="options__panel" data-panel="school">
            <h3 class="options__h">conversion school</h3>
            <label class="field">method
              <select data-school>${CONVERSION_SCHOOLS.map((s) => `<option value="${s.id}">${s.label}</option>`).join('')}</select>
            </label>
            <p class="options__note mono" data-school-note>${CONVERSION_SCHOOLS[0]!.note}</p>
            <div data-fov-block hidden>
              <label class="field">source fov (°) <input type="number" data-fov="source" value="103" min="60" max="140"></label>
              <label class="field">target fov (°) <input type="number" data-fov="target" value="90" min="60" max="140"></label>
              <label class="field">screen fraction <input type="number" data-fov="fraction" value="0" min="0" max="1" step="0.1"></label>
              <p class="options__readout">at <span class="mono">${mid}</span> cm/360 → <span class="mono" data-fov-out>—</span> cm/360</p>
            </div>
          </section>

          <section class="options__panel" data-panel="games">
            <h3 class="options__h">per-game yaw + sensitivity <span class="options__sub mono">dpi ${ctx.draft.dpi} · ${mid} cm/360</span></h3>
            <table class="options__table"><thead><tr><th>game</th><th>yaw (°/count)</th><th>sensitivity</th></tr></thead>
            <tbody data-games-body></tbody></table>
            <button class="action action--ghost" data-action="reset-yaw">reset yaw to defaults</button>
          </section>

          <section class="options__panel" data-panel="bounds">
            <h3 class="options__h">cm/360 search bounds</h3>
            <p class="options__note">the range the optimizer searches. wider = more thorough, slower.</p>
            <div class="options__bounds">
              <label class="field">min <input type="number" data-bound="lo" value="${lo}" min="5" max="150"></label>
              <label class="field">max <input type="number" data-bound="hi" value="${hi}" min="5" max="150"></label>
            </div>
            <p class="options__readout">searching <span class="mono" data-bounds-out>${lo}–${hi}</span> cm/360</p>
          </section>
        </div>`;

      const $ = <T extends Element>(sel: string): T => root.querySelector<T>(sel)!;

      const renderGames = (): void => {
        $('[data-games-body]').innerHTML = effectiveYawTable(overrides).map((e) => `
          <tr data-yaw-row data-game="${e.id}">
            <td>${e.label}</td>
            <td><input class="options__yaw" type="number" step="0.0001" data-yaw="${e.id}" value="${e.yaw}"></td>
            <td class="mono" data-sens="${e.id}">${sensFor(mid, ctx.draft.dpi, e.yaw).toFixed(3)}</td>
          </tr>`).join('');
      };
      renderGames();
      $('[data-games-body]').addEventListener('input', (ev) => {
        const t = ev.target as HTMLInputElement;
        const id = t.getAttribute('data-yaw') as GameId | null;
        if (!id) return;
        const v = parseFloat(t.value);
        if (Number.isFinite(v) && v > 0) {
          overrides[id] = v;
          $(`[data-sens="${id}"]`).textContent = sensFor(mid, ctx.draft.dpi, v).toFixed(3);
        }
      });
      $('[data-action="reset-yaw"]').addEventListener('click', () => {
        for (const k of Object.keys(overrides)) delete overrides[k as GameId];
        renderGames();
      });

      const fovBlock = $('[data-fov-block]') as HTMLElement;
      const recalcFov = (): void => {
        const sFov = parseFloat($<HTMLInputElement>('[data-fov="source"]').value);
        const tFov = parseFloat($<HTMLInputElement>('[data-fov="target"]').value);
        const frac = parseFloat($<HTMLInputElement>('[data-fov="fraction"]').value);
        const out = monitorDistanceMatchCm360(mid, sFov, tFov, Number.isFinite(frac) ? frac : 0);
        $('[data-fov-out]').textContent = Number.isFinite(out) ? out.toFixed(1) : '—';
      };
      $('[data-school]').addEventListener('change', (ev) => {
        const id = (ev.target as HTMLSelectElement).value;
        const school = CONVERSION_SCHOOLS.find((s) => s.id === id)!;
        $('[data-school-note]').textContent = school.note;
        fovBlock.hidden = !school.fovAware;
        if (school.fovAware) recalcFov();
      });
      fovBlock.addEventListener('input', recalcFov);

      const syncBounds = (): void => {
        const a = parseFloat($<HTMLInputElement>('[data-bound="lo"]').value);
        const b = parseFloat($<HTMLInputElement>('[data-bound="hi"]').value);
        const [nlo, nhi] = normalizeBounds(a, b);
        ctx.draft.bounds = [nlo, nhi];
        $('[data-bounds-out]').textContent = `${nlo}–${nhi}`;
      };
      $('[data-panel="bounds"]').addEventListener('input', syncBounds);

      $('[data-action="back"]').addEventListener('click', () => ctx.navigate('hero'));
      host.appendChild(root);
    },
    unmount() { host.replaceChildren(); },
  };
}
