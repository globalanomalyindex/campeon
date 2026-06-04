import type { AppContext, Screen } from './shell';
import type { GameId } from '../types';
import { GAME_YAW, yawFor } from '../convert/yaw-table';
import { cmPer360 } from '../convert/cm360';

export function setup(host: HTMLElement, ctx: AppContext): Screen {
  const d = ctx.draft;
  return {
    mount() {
      const root = document.createElement('section');
      root.className = 'screen screen--shell setup fade-in';
      root.innerHTML = `
        <div class="wrap stack setup__inner">
          <h2 class="display setup__title">+ setup</h2>
          <p class="setup__lead">Tell us your hardware and where you sit today. From the next screen on, everything is <span class="mono">cm/360</span>.</p>
          <label class="field">mouse DPI
            <input class="mono" type="number" min="100" max="32000" step="50" data-field="dpi" value="${d.dpi}">
          </label>
          <label class="field">current game
            <select data-field="game">
              ${GAME_YAW.map((g) => `<option value="${g.id}"${g.id === d.currentGame ? ' selected' : ''}>${g.label}</option>`).join('')}
            </select>
          </label>
          <label class="field">current in-game sensitivity
            <input class="mono" type="number" min="0.01" step="0.01" data-field="sens" value="${d.currentSens}">
          </label>
          <p class="setup__readout">you sit at <span class="mono" data-readout="cm360">-</span> cm/360 today</p>
          <label class="field">goal - precision ↔ speed
            <input type="range" min="0" max="1" step="0.01" data-field="goal" value="${d.profile.speedAccuracy}">
            <span class="setup__goalhint mono" data-readout="goal"></span>
          </label>
          <button class="action action--primary" data-action="begin">begin</button>
        </div>`;

      const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
      const dpiEl = $<HTMLInputElement>('[data-field="dpi"]');
      const gameEl = $<HTMLSelectElement>('[data-field="game"]');
      const sensEl = $<HTMLInputElement>('[data-field="sens"]');
      const goalEl = $<HTMLInputElement>('[data-field="goal"]');
      const cmOut = $<HTMLElement>('[data-readout="cm360"]');
      const goalOut = $<HTMLElement>('[data-readout="goal"]');

      const refresh = (): void => {
        const dpi = Number(dpiEl.value), sens = Number(sensEl.value);
        const yaw = yawFor(gameEl.value as GameId);
        cmOut.textContent = dpi > 0 && sens > 0 ? cmPer360(dpi, sens, yaw).toFixed(1) : '-';
        const g = Number(goalEl.value);
        goalOut.textContent = g >= 0.66 ? 'speed-first' : g <= 0.34 ? 'precision-first' : 'balanced';
      };
      for (const e of [dpiEl, gameEl, sensEl, goalEl]) e.addEventListener('input', refresh);
      refresh();

      $<HTMLButtonElement>('[data-action="begin"]').addEventListener('click', () => {
        d.dpi = Number(dpiEl.value);
        d.currentGame = gameEl.value as GameId;
        d.currentSens = Number(sensEl.value);
        d.profile = { ...d.profile, speedAccuracy: Number(goalEl.value) };
        ctx.navigate('gate');
      });

      host.appendChild(root);
    },
    unmount() { host.replaceChildren(); },
  };
}
