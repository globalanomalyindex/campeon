import type { AppContext, Screen } from './shell';
import type { InstrumentId, TargetHandle, TargetSpec } from '../types';
import { createArenaStage } from './arena-stage';
import { initRange, onKill, dueSpawns, bindSpawn, type RangeSlot, type RangeState } from './range-director';
import { bindRangeLock } from './range-lock';
import { nudgeCm360 } from './range-nudge';
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
const fmt = (v: number): string => v.toFixed(1);

export function range(host: HTMLElement, ctx: AppContext): Screen {
  let alive = true;
  let cleanup: (() => void) | null = null;

  return {
    mount() {
      const carried = ctx.lastResult?.result;
      const sessionId = ctx.lastResult?.sessionId;
      if (!carried || !sessionId) { ctx.navigate('hero'); return; }
      // Re-read the MEASURED record rather than trusting whatever we arrived carrying: on a second
      // visit ctx.lastResult holds the tuned value, and reading that would label a hand-picked
      // number "your measured sweet spot" and make "reset to measured" reset to it.
      const measuredId = measuredIdOf(sessionId);
      const measured = ctx.storage.loadResults?.()[measuredId] ?? carried;
      const tunedId = `${measuredId}${TUNED_ID_SUFFIX}`;
      const dpi = ctx.draft.dpi;
      const bounds = ctx.draft.bounds;
      const measuredCm360 = measured.optimalCm360;
      let current = carried.optimalCm360; // re-entering with a tuned value keeps that feel

      const root = document.createElement('section');
      root.className = 'screen screen--arena range';
      root.dataset.surface = 'chamber';
      root.innerHTML = `
        <h1 class="sr-only">the range</h1>
        <canvas class="session__canvas"></canvas>
        <div class="session__crosshair" aria-hidden="true"></div>
        <header class="range__hud mono" aria-live="polite" aria-atomic="true">
          <span class="display"><span data-range="cm360">${fmt(current)}</span><small> cm/360</small></span>
          <span class="range__delta" data-range="delta"></span>
        </header>
        <footer class="range__bar">
          <button class="action action--ghost range__step" data-range="down" aria-label="decrease sensitivity by 0.5">−</button>
          <button class="action action--ghost range__step" data-range="up" aria-label="increase sensitivity by 0.5">+</button>
          <button class="action action--primary" data-range="adopt">adopt this feel</button>
          <button class="action action--ghost" data-range="reset">reset to measured</button>
          <button class="action action--ghost" data-range="exit">back to result</button>
        </footer>
        <p class="range__hint">click the arena to lock the cursor. bracket keys nudge the sensitivity, hold shift for a
          fine step, and Esc releases the cursor.</p>
        <div class="range__confirm" data-confirm role="dialog" aria-labelledby="range-confirm-title" hidden>
          <p class="mono range__confirm-label" id="range-confirm-title">adopt this feel</p>
          <p class="range__confirm-lead">this saves <span data-confirm="num"></span> cm/360 as a number you picked by
            hand. it carries no measured CI, so the result screen drops the convergence plot and the four facets.
            your measured <span data-confirm="measured"></span> cm/360 stays saved, and reset brings it back.</p>
          <div class="range__confirm-actions">
            <button class="action action--primary" data-confirm="adopt">adopt it</button>
            <button class="action action--ghost" data-confirm="cancel">keep tuning</button>
          </div>
        </div>`;
      host.appendChild(root);

      const canvas = root.querySelector('canvas') as HTMLCanvasElement;
      const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      const stage = createArenaStage(root, { canvas, cm360: current, dpi, reducedMotion: reduced });

      const cmEl = root.querySelector('[data-range="cm360"]')!;
      const deltaEl = root.querySelector('[data-range="delta"]')!;
      const refresh = (): void => {
        cmEl.textContent = fmt(current);
        const d = current - measuredCm360;
        deltaEl.textContent = Math.abs(d) < 0.05 ? 'your measured sweet spot' : `${d > 0 ? '+' : ''}${d.toFixed(1)} from your number`;
      };
      refresh();

      const applyCm = (next: number): void => { current = next; stage.setCm360(current); refresh(); };
      const nudge = (dir: number, fine: boolean): void => applyCm(nudgeCm360(current, dir * (fine ? 0.1 : 0.5), bounds));

      root.querySelector('[data-range="down"]')!.addEventListener('click', () => nudge(-1, false));
      root.querySelector('[data-range="up"]')!.addEventListener('click', () => nudge(1, false));
      root.querySelector('[data-range="exit"]')!.addEventListener('click', () => ctx.navigate('result'));
      root.querySelector('[data-range="reset"]')!.addEventListener('click', () => {
        // Nothing to write back: the measured record was never overwritten, so reset just points
        // the app at it again.
        applyCm(measuredCm360);
        ctx.lastResult = { sessionId: measuredId, result: measured };
      });

      // Adopting is the one action here that changes what the result screen shows, so it asks
      // first and says what it costs.
      const confirmEl = root.querySelector('[data-confirm]') as HTMLElement;
      const $c = (s: string) => root.querySelector(`[data-confirm="${s}"]`) as HTMLElement;
      let confirmModal: ModalHandle | null = null;
      const closeConfirm = (): void => {
        confirmEl.hidden = true;
        confirmModal?.release();
        confirmModal = null;
      };
      root.querySelector('[data-range="adopt"]')!.addEventListener('click', () => {
        $c('num').textContent = fmt(current);
        $c('measured').textContent = fmt(measuredCm360);
        confirmEl.hidden = false;
        confirmModal = openModal(confirmEl, { initialFocus: $c('adopt'), onEscape: closeConfirm });
      });
      $c('cancel').addEventListener('click', closeConfirm);
      $c('adopt').addEventListener('click', () => {
        const tunedResult = adoptResult(measured, current, dpi); // carries tuned: true
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
