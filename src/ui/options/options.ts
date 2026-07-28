// Options.
//
// This screen used to carry three panels and only one of them did anything, and even
// that one wrote to an in-memory draft that was thrown away on the next reload. The
// conversion-school select changed no conversion anywhere in the app, and the per-game
// yaw inputs fed a map that only the table above them ever read. A control that moves
// and changes nothing is worse than no control, so:
//
//   - the search window is a real setting now. It is applied on an explicit press,
//     written to the live draft (which is what the optimizer searches), and saved
//     through the same prefs seam calibration uses, so it survives a reload.
//   - the game table is read only. Making a yaw override actually bite would mean
//     threading it through convert/yaw-table, convert/schools and optimizer/result,
//     none of which this screen owns, so it states the constants instead of pretending
//     to edit them.
//   - the FOV panel is a converter, not a setting. It takes a number and gives you a
//     number. That is its whole job and it does it on screen.
import { rememberPrefs, type AppContext, type Screen } from '../shell';
import { GAME_YAW } from '../../convert/yaw-table';
import { monitorDistanceMatchCounts } from '../../convert/schools';
import { normalizeBounds, COUNT_LO, COUNT_HI } from './settings';
import { counts360 } from '../../types';

/** Geometric middle of the search window: the scale is logarithmic, so the mean is too. */
const windowMid = (lo: number, hi: number): number => Math.round(Math.sqrt(lo * hi));

export function options(host: HTMLElement, ctx: AppContext): Screen {
  return {
    mount() {
      const root = document.createElement('section');
      root.className = 'screen screen--shell options';
      const [lo, hi] = ctx.draft.bounds;
      let mid = windowMid(lo, hi);

      // Prefs exist only after a calibration, and setup reads their presence as "this
      // visitor has calibrated before". Writing them from here for a first-time visitor
      // would invent a calibration they never ran, so the save is gated on one existing.
      const calibrated = (ctx.storage.loadPrefs?.() ?? null) !== null;
      const measured = ctx.lastResult?.result.optimalCounts;

      root.innerHTML = `
        <div class="options__bar">
          <div class="wrap options__bar-inner">
            <button class="action action--secondary options__back" data-action="back">
              <span class="options__arrow" aria-hidden="true">←</span>Back to the start
            </button>
          </div>
        </div>

        <div class="wrap options__inner">
          <h1 class="t-display-sm">Options</h1>
          <p class="t-body-lg options__lead">Two things live here. The window I search for your number, and a converter for carrying a number between fields of view.</p>

          <section class="panel options__panel" data-panel="bounds">
            <h3 class="t-heading-md options__h">The search window <span class="t-label options__sub">counts per 360</span></h3>
            <p class="t-body-sm options__note">This is the range I search while you play the drills. A wider window covers more of the scale and takes longer to settle. Running a new calibration replaces it with a window around whatever I measure.</p>
            <div class="options__row">
              <label class="field"><span>Lowest</span><input type="number" data-bound="lo" value="${lo}" min="${COUNT_LO}" max="${COUNT_HI}"></label>
              <label class="field"><span>Highest</span><input type="number" data-bound="hi" value="${hi}" min="${COUNT_LO}" max="${COUNT_HI}"></label>
            </div>
            <p class="options__readout">Searching <span class="t-figure options__figure" data-bounds-out>${lo} to ${hi}</span> counts per 360, centred on <span data-mid-sub>${mid}</span>.</p>
            <div class="options__commit">
              <button class="action action--primary" data-action="apply-bounds">Apply this window</button>
              <p class="t-body-sm options__status" data-bounds-status role="status" aria-live="polite"></p>
            </div>
          </section>

          <section class="panel options__panel" data-panel="games">
            <h3 class="t-heading-md options__h">Game yaw <span class="t-label options__sub">degrees per count at sens 1</span></h3>
            <p class="t-body-sm options__note">These are the community-derived yaw constants I use to turn counts per 360 into a native in-game number. I show them read only, since they are reference rather than a setting. There is no sensitivity column: a native number also needs the factor between the browser's movement deltas and your mouse's own counts, and nothing on this screen measures that.</p>
            <div class="options__scroll">
              <table class="options__table">
                <thead><tr><th>Game</th><th>Yaw, degrees per count</th><th>Note</th></tr></thead>
                <tbody data-games-body></tbody>
              </table>
            </div>
          </section>

          <section class="panel options__panel" data-panel="fov">
            <h3 class="t-heading-md options__h">Field of view converter</h3>
            <p class="t-body-sm options__note">campeón measures counts per 360, which does not depend on your field of view. If you want the same on-screen travel after changing FOV, this is the number that holds it. Screen fraction is how far across the half screen you are flicking, where 0 is a small correction near the centre.</p>
            <div class="options__row">
              <label class="field"><span>From counts per 360</span><input type="number" data-fov="from" value="${measured !== undefined ? Math.round(measured) : mid}" min="1000" max="60000" step="10"></label>
              <label class="field"><span>Source FOV</span><input type="number" data-fov="source" value="103" min="60" max="140"></label>
              <label class="field"><span>Target FOV</span><input type="number" data-fov="target" value="90" min="60" max="140"></label>
              <label class="field"><span>Screen fraction</span><input type="number" data-fov="fraction" value="0" min="0" max="1" step="0.1"></label>
            </div>
            <p class="options__readout">Same feel at <span class="t-figure options__figure" data-fov-out>-</span> counts per 360</p>
            ${measured !== undefined ? `<p class="t-body-sm options__caption">Starting from your last result.</p>` : ''}
          </section>
        </div>`;

      const $ = <T extends Element>(sel: string): T => root.querySelector<T>(sel)!;

      // ── The game reference table ─────────────────────────────────────────
      const renderGames = (): void => {
        $('[data-games-body]').innerHTML = GAME_YAW.map((e) => `
          <tr data-yaw-row data-game="${e.id}">
            <td>${e.label}</td>
            <td class="t-figure-text">${e.yaw}</td>
            <td class="options__cell-note">${e.note ?? ''}</td>
          </tr>`).join('');
      };
      renderGames();

      // ── The search window ────────────────────────────────────────────────
      const loInput = $<HTMLInputElement>('[data-bound="lo"]');
      const hiInput = $<HTMLInputElement>('[data-bound="hi"]');
      const status = $('[data-bounds-status]');

      // Typing previews the normalized window but commits nothing: the old screen wrote
      // the draft on every keystroke, which is how an edit could look applied and not be.
      $('[data-panel="bounds"]').addEventListener('input', () => {
        const [nlo, nhi] = normalizeBounds(parseFloat(loInput.value), parseFloat(hiInput.value));
        $('[data-bounds-out]').textContent = `${nlo} to ${nhi}`;
        status.textContent = 'Press apply to use this window.';
      });

      $('[data-action="apply-bounds"]').addEventListener('click', () => {
        const [nlo, nhi] = normalizeBounds(parseFloat(loInput.value), parseFloat(hiInput.value));
        loInput.value = String(nlo);
        hiInput.value = String(nhi);
        ctx.draft.bounds = [nlo, nhi];
        $('[data-bounds-out]').textContent = `${nlo} to ${nhi}`;

        mid = windowMid(nlo, nhi);
        $('[data-mid-sub]').textContent = String(mid);
        renderGames();

        if (calibrated) {
          rememberPrefs(ctx);
          status.textContent = `Saved. I search ${nlo} to ${nhi} counts per 360.`;
        } else {
          // "Applied for this visit" was not true for a visitor who has never calibrated. Their only
          // way into a run is the sweep and the spin (or typed numbers), and both of those set the
          // window from what they measure, so this one is replaced before it is ever searched. Only
          // "start from your saved calibration" carries a stored window forward, and that path needs
          // a calibration to exist. So the message names the calibration as what happens next.
          status.textContent = `Set to ${nlo} to ${nhi} counts per 360. Calibration comes before your first run and it sets the window from what it measures, so it will replace this one. After you have calibrated, a window you set here is saved.`;
        }
      });

      // ── The FOV converter ────────────────────────────────────────────────
      const recalcFov = (): void => {
        const num = (k: string): number => parseFloat($<HTMLInputElement>(`[data-fov="${k}"]`).value);
        const frac = num('fraction');
        const out = monitorDistanceMatchCounts(counts360(num('from')), num('source'), num('target'), Number.isFinite(frac) ? frac : 0);
        $('[data-fov-out]').textContent = Number.isFinite(out) ? String(Math.round(out)) : '-';
      };
      $('[data-panel="fov"]').addEventListener('input', recalcFov);
      recalcFov();

      $('[data-action="back"]').addEventListener('click', () => ctx.navigate('hero'));
      host.appendChild(root);
    },
    unmount() { host.replaceChildren(); },
  };
}
