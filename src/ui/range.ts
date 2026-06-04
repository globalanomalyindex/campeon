import type { AppContext, Screen } from './shell';
import type { InstrumentId, TargetHandle, TargetSpec } from '../types';
import { createArenaStage } from './arena-stage';
import { initRange, onKill, dueSpawns, bindSpawn, type RangeSlot, type RangeState } from './range-director';
import { nudgeCm360 } from './range-nudge';
import { adoptResult } from './range-adopt';
import { classifyHit } from './enemy/hit';

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
      const measured = ctx.lastResult?.result;
      const sessionId = ctx.lastResult?.sessionId;
      if (!measured || !sessionId) { ctx.navigate('hero'); return; }
      const dpi = ctx.draft.dpi;
      const bounds = ctx.draft.bounds;
      const measuredCm360 = measured.optimalCm360;
      let current = measuredCm360;

      const root = document.createElement('section');
      root.className = 'screen screen--arena range';
      root.innerHTML = `
        <canvas class="session__canvas"></canvas>
        <div class="session__crosshair" aria-hidden="true"></div>
        <header class="range__hud mono">
          <span class="display"><span data-range="cm360">${fmt(current)}</span><small> cm/360</small></span>
          <span class="range__delta" data-range="delta"></span>
        </header>
        <footer class="range__bar">
          <button class="action action--ghost" data-range="down" aria-label="decrease sensitivity by 0.5">−</button>
          <button class="action action--ghost" data-range="up" aria-label="increase sensitivity by 0.5">+</button>
          <button class="action action--primary" data-range="adopt">adopt this feel</button>
          <button class="action action--ghost" data-range="reset">reset to measured</button>
          <button class="action action--ghost" data-range="exit">back to result</button>
        </footer>
        <p class="range__hint mono" aria-hidden="true">click to lock · [ / ] nudge · shift = fine · esc releases</p>`;
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
        applyCm(measuredCm360);
        ctx.lastResult = { sessionId, result: measured };
        ctx.storage.saveResult(sessionId, measured);
      });
      root.querySelector('[data-range="adopt"]')!.addEventListener('click', () => {
        const tunedResult = adoptResult(measured, current, dpi); // carries tuned: true
        ctx.lastResult = { sessionId, result: tunedResult };
        ctx.storage.saveResult(sessionId, tunedResult);
        ctx.navigate('result');
      });

      const onKey = (e: KeyboardEvent): void => {
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
        // already-invisible sphere — the death animation plays out independently. Relies on that order.
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

      // Lock, then wait for the cosmetic layers so mercs (not bare spheres) appear, then start.
      canvas.addEventListener('click', () => {
        void stage.requestLock().catch(() => {}).then(() => stage.ready).then(startFreePlay);
      }, { once: true });

      cleanup = () => {
        alive = false;
        window.removeEventListener('keydown', onKey);
        offFire?.();
        offFrame?.();
        stage.dispose();
      };
    },
    unmount() { cleanup?.(); host.replaceChildren(); },
  };
}
