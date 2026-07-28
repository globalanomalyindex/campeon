import type { AppContext, Screen } from './shell';
import type { Counts360, InstrumentId, TargetHandle, TargetSpec } from '../types';
import { createArenaStage } from './arena-stage';
import { initRange, onKill, dueSpawns, bindSpawn, type RangeSlot, type RangeState } from './range-director';
import { bindRangeLock } from './range-lock';
import { nudgeCounts } from './range-nudge';
import { adoptResult } from './range-adopt';
import { openModal, type ModalHandle } from './modal';
import { classifyHit } from './enemy/hit';

/**
 * Adopting writes to its OWN record, so the measured Result is never overwritten. The measured
 * number is the measurement; a hand-picked one is a preference, and a preference must not be able
 * to destroy a measurement in one click. `${measuredId}${TUNED_ID_SUFFIX}` also lets this screen
 * find its way back to the measured record on a second visit.
 */
export const TUNED_ID_SUFFIX = '-tuned';

/** The measured record's id, whether we arrived carrying the measured result or the tuned one. */
export function measuredIdOf(sessionId: string): string {
  return sessionId.endsWith(TUNED_ID_SUFFIX) ? sessionId.slice(0, -TUNED_ID_SUFFIX.length) : sessionId;
}

const SLOTS: RangeSlot[] = [
  { kind: 'fixed', placement: { yaw: -12, pitch: 0, distance: 8, worldRadius: 0.6 } }, // near
  { kind: 'fixed', placement: { yaw: 0, pitch: 2, distance: 18, worldRadius: 0.6 } }, // mid
  { kind: 'fixed', placement: { yaw: 14, pitch: -1, distance: 32, worldRadius: 0.6 } }, // far
  { kind: 'roam' }, { kind: 'roam' }, { kind: 'roam' },
];
const ENVS: InstrumentId[] = ['track', 'flick', 'calibrate', 'strike'];
const fmtCounts = (v: number): string => Math.round(v).toLocaleString('en-US');

/** The step both the buttons and an unshifted bracket key take, in counts per 360. 150 counts is
 *  about 1.8% of a typical window's centre, which is the same relative step the retired 0.5 cm was. */
export const STEP_COUNTS = 150;
/** The step a shifted bracket key takes. */
export const FINE_STEP_COUNTS = 30;

/**
 * What the nudge controls actually do, spoken. The buttons carry a "+" and a "−" glyph, but what
 * they move is counts per 360, and a HIGHER count total is a LOWER sensitivity. Saying "increase
 * sensitivity" on the "+" would tell a screen-reader user the inverse of what happens, so the name
 * states the unit that changes and then the direction the feel moves.
 */
export const stepLabel = (dir: 1 | -1): string =>
  dir > 0
    ? `Increase counts per 360 by ${STEP_COUNTS}, a lower sensitivity`
    : `Decrease counts per 360 by ${STEP_COUNTS}, a higher sensitivity`;

/**
 * The spoken form of the live readout. The visible HUD is a mono glyph composition ("8,240 counts
 * per 360", "+150 from your number"); this is the same fact as a sentence, with the comparison to
 * the measured number stated in the same unit, which is the thing that moved.
 */
export function announceCounts(current: number, measured: number): string {
  const d = Math.round(current) - Math.round(measured);
  if (d === 0) return `${fmtCounts(current)} counts per 360. This is your measured value.`;
  const dir = d > 0 ? 'above' : 'below';
  return `${fmtCounts(current)} counts per 360, ${fmtCounts(Math.abs(d))} ${dir} your measured ${fmtCounts(measured)}.`;
}

/** Thin-shell injection seam, as in session-view: production builds the real WebGL stage, a jsdom
 *  test swaps in a fake so the shell's wiring and its accessible names are testable. */
export interface RangeDeps {
  createStage: typeof createArenaStage;
}

const DEFAULT_DEPS: RangeDeps = { createStage: createArenaStage };

export function range(host: HTMLElement, ctx: AppContext, deps: RangeDeps = DEFAULT_DEPS): Screen {
  let alive = true;
  let cleanup: (() => void) | null = null;

  return {
    mount() {
      const carried = ctx.lastResult?.result;
      const sessionId = ctx.lastResult?.sessionId;
      if (!carried || !sessionId) { ctx.navigate('hero'); return; }
      // Re-read the MEASURED record rather than trusting whatever we arrived carrying: on a second
      // visit ctx.lastResult holds the tuned value, and reading that would label a hand-picked
      // number "Your measured sweet spot" and make "Reset to measured" reset to it.
      const measuredId = measuredIdOf(sessionId);
      const measured = ctx.storage.loadResults?.()[measuredId] ?? carried;
      const tunedId = `${measuredId}${TUNED_ID_SUFFIX}`;
      const bounds = ctx.draft.bounds;
      const measuredCounts: Counts360 = measured.optimalCounts;
      let current: Counts360 = carried.optimalCounts; // re-entering with a tuned value keeps that feel

      const root = document.createElement('section');
      root.className = 'screen screen--arena range';
      root.dataset.surface = 'chamber';
      root.innerHTML = `
        <h1 class="sr-only">The range</h1>
        <canvas class="session__canvas"></canvas>
        <div class="session__crosshair" aria-hidden="true"></div>
        <header class="range__hud mono" aria-live="polite" aria-atomic="true">
          <span class="display" aria-hidden="true"><span data-range="counts">${fmtCounts(current)}</span><small> counts per 360</small></span>
          <span class="range__delta" data-range="delta" aria-hidden="true"></span>
          <span class="sr-only" data-range="announce"></span>
        </header>
        <footer class="range__bar" role="group" aria-label="Sensitivity controls" aria-describedby="range-keys">
          <button class="action action--ghost range__step" data-range="down" aria-label="${stepLabel(-1)}" aria-keyshortcuts="[ Shift+[">−</button>
          <button class="action action--ghost range__step" data-range="up" aria-label="${stepLabel(1)}" aria-keyshortcuts="] Shift+]">+</button>
          <button class="action action--primary" data-range="adopt">Adopt this feel</button>
          <button class="action action--ghost" data-range="reset">Reset to measured</button>
          <button class="action action--ghost" data-range="exit">Back to result</button>
        </footer>
        <p class="range__hint" id="range-keys">Click the arena to lock the cursor. The bracket keys nudge counts per 360, hold
          Shift for a fine step, and Esc releases the cursor.</p>
        <div class="range__confirm" data-confirm role="dialog" aria-labelledby="range-confirm-title" hidden>
          <p class="mono range__confirm-label" id="range-confirm-title">Adopt this feel</p>
          <p class="range__confirm-lead">This saves <span data-confirm="num"></span> counts per 360 as a number you picked by
            hand. It carries no measured CI, so I drop the convergence plot and the four facets from the result screen.
            Your measured <span data-confirm="measured"></span> counts per 360 stays saved, and reset brings it back.</p>
          <div class="range__confirm-actions">
            <button class="action action--primary" data-confirm="adopt">Adopt it</button>
            <button class="action action--ghost" data-confirm="cancel">Keep tuning</button>
          </div>
        </div>`;
      host.appendChild(root);

      const canvas = root.querySelector('canvas') as HTMLCanvasElement;
      const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      const stage = deps.createStage(root, { canvas, counts: current, reducedMotion: reduced });

      const cmEl = root.querySelector('[data-range="counts"]')!;
      const deltaEl = root.querySelector('[data-range="delta"]')!;
      const announceEl = root.querySelector('[data-range="announce"]')!;
      // The visible readout is aria-hidden and this sr-only span carries it as a sentence, so the
      // polite region voices the change once instead of reading the glyphs twice. Rewritten only
      // when the shown value actually moves: a nudge that clamps at a bound changes nothing, and
      // re-announcing the same number would be noise.
      let announced: string | null = null;
      const refresh = (): void => {
        const shown = fmtCounts(current);
        cmEl.textContent = shown;
        const d = current - measuredCounts;
        deltaEl.textContent = Math.abs(d) < 0.05 ? 'Your measured sweet spot' : `${d > 0 ? '+' : ''}${d.toFixed(1)} from your number`;
        if (shown !== announced) {
          announced = shown;
          announceEl.textContent = announceCounts(current, measuredCounts);
        }
      };
      refresh();

      const applyCounts = (next: Counts360): void => { current = next; stage.setCounts(current); refresh(); };
      const nudge = (dir: number, fine: boolean): void =>
        applyCounts(nudgeCounts(current, dir * (fine ? FINE_STEP_COUNTS : STEP_COUNTS), bounds));

      root.querySelector('[data-range="down"]')!.addEventListener('click', () => nudge(-1, false));
      root.querySelector('[data-range="up"]')!.addEventListener('click', () => nudge(1, false));
      root.querySelector('[data-range="exit"]')!.addEventListener('click', () => ctx.navigate('result'));
      root.querySelector('[data-range="reset"]')!.addEventListener('click', () => {
        // Nothing to write back: the measured record was never overwritten, so reset just points
        // the app at it again.
        applyCounts(measuredCounts);
        ctx.lastResult = { sessionId: measuredId, result: measured };
      });

      // Adopting is the one action here that changes what the result screen shows, so it asks
      // first and says what it costs.
      const confirmEl = root.querySelector('[data-confirm]') as HTMLElement;
      const $c = (s: string) => root.querySelector(`[data-confirm="${s}"]`) as HTMLElement;
      // The HUD, the control bar and the key-bindings hint are the only background content behind
      // the confirm. All three leave the tab order and the accessibility tree while it is open, so
      // the dialog is the whole room and the live HUD does not narrate over it.
      const behind = [
        root.querySelector('.range__hud') as HTMLElement,
        root.querySelector('.range__bar') as HTMLElement,
        root.querySelector('.range__hint') as HTMLElement,
      ];
      let confirmModal: ModalHandle | null = null;
      const closeConfirm = (): void => {
        confirmEl.hidden = true;
        confirmModal?.release();
        confirmModal = null;
      };
      root.querySelector('[data-range="adopt"]')!.addEventListener('click', () => {
        $c('num').textContent = fmtCounts(current);
        $c('measured').textContent = fmtCounts(measuredCounts);
        confirmEl.hidden = false;
        confirmModal = openModal(confirmEl, { initialFocus: $c('adopt'), onEscape: closeConfirm, inert: behind });
      });
      $c('cancel').addEventListener('click', closeConfirm);
      $c('adopt').addEventListener('click', () => {
        const tunedResult = adoptResult(measured, current); // carries tuned: true
        // Its OWN record. The measured Result at `measuredId` is left exactly as the run wrote it.
        ctx.storage.saveResult(tunedId, tunedResult);
        ctx.lastResult = { sessionId: tunedId, result: tunedResult };
        closeConfirm();
        ctx.navigate('result');
      });

      const onKey = (e: KeyboardEvent): void => {
        if (!confirmEl.hidden) return; // the dialog owns the keyboard while it is open
        if (e.key === '[') nudge(-1, e.shiftKey);
        else if (e.key === ']') nudge(1, e.shiftKey);
      };
      window.addEventListener('keydown', onKey);

      const targets = new Map<string, { slotIndex: number; handle: TargetHandle }>();
      let state: RangeState | null = null;
      let offFire: (() => void) | null = null;
      let offFrame: (() => void) | null = null;
      let envI = 0;

      const spawnForSlot = (req: { slotIndex: number; kind: 'fixed' | 'roam'; placement?: { yaw: number; pitch: number; distance: number; worldRadius: number } }): void => {
        let spec: TargetSpec;
        if (req.kind === 'roam') {
          const [vYaw, vPitch] = stage.arena.view();
          const yaw = vYaw + (Math.random() * 2 - 1) * 26; // within ~±26° of where you're looking → on-screen
          const pitch = Math.max(-40, Math.min(40, vPitch + (Math.random() * 2 - 1) * 14));
          stage.setEnemyEnvironment(ENVS[envI++ % ENVS.length]!); // vary the merc sheet per roam spawn
          spec = { kind: 'static', yaw, pitch, distance: 14 + Math.random() * 18, worldRadius: 0.6 };
        } else {
          spec = { kind: 'static', ...req.placement! };
        }
        const handle = stage.arena.spawnTarget(spec);
        targets.set(handle.id, { slotIndex: req.slotIndex, handle });
        bindSpawn(state!, req.slotIndex, handle.id);
      };

      const startFreePlay = (): void => {
        if (!alive) return;
        state = initRange(SLOTS);
        // arena.handleFire runs the cosmetic enemy.fire() (which migrates a killed merc into its
        // persistent fade-out set) BEFORE these onFire callbacks, so removeTarget() here only drops the
        // already-invisible sphere - the death animation plays out independently. Relies on that order.
        offFire = stage.arena.onFire((now) => {
          if (!state) return;
          const view = stage.arena.view();
          let killId: string | null = null;
          for (const [id, { handle }] of targets) {
            if (classifyHit(view, handle.bearing(), handle.radiusDeg()) === 'kill') { killId = id; break; }
          }
          if (killId) {
            onKill(state, killId, now);
            targets.delete(killId);
            stage.arena.removeTarget(killId); // retire the sphere; the merc death persists in the fade-out set
          }
        });
        offFrame = stage.arena.onFrame((_dt, now) => {
          if (!state) return;
          for (const req of dueSpawns(state, now)) spawnForSlot(req);
        });
      };

      // Lock on click, wait for the cosmetic layers so mercs (not bare spheres) appear, then start
      // free play ONCE. Every later unlocked click (after an Esc release) relocks - the orchestration
      // lives in bindRangeLock, where the Esc -> click cycle is unit-tested.
      const unbindLock = bindRangeLock(canvas, {
        isLocked: () => stage.isLocked(),
        requestLock: () => stage.requestLock(),
        ready: stage.ready,
        start: startFreePlay,
      });

      cleanup = () => {
        alive = false;
        closeConfirm();
        unbindLock();
        window.removeEventListener('keydown', onKey);
        offFire?.();
        offFrame?.();
        stage.dispose();
      };
    },
    unmount() { cleanup?.(); host.replaceChildren(); },
  };
}
