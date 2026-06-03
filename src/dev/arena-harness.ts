import { WebGLRenderer } from 'three';
import { Arena } from '../engine/arena';
import type { InputSource } from '../engine/arena';
import { degreesPerCount } from '../engine/camera-rig';
import { createPointerLock } from '../input/pointer-lock';
import { AccelMeter, accelVerdict } from '../input/accel-check';
import { mulberry32 } from '../stats/bootstrap';
import type { AimSample, PointerLockMode, InstrumentId, TrialResult, Report } from '../types';

const CM360 = 34;
const DPI = 800;

interface ArenaDebug {
  feed(dx: number, dy: number): [number, number];
  degPerCount(): number;
  view(): [number, number];
  mode(): PointerLockMode | null;
  fire(): void;
  runInstrument(id: InstrumentId): Promise<TrialResult>;
  runSession(): Promise<Report>;
  cleanup(): void;
}
declare global {
  interface Window {
    __arenaDebug?: ArenaDebug;
  }
}

/** Mount the dev arena harness into `root`. Temporary dev artifact; Phase 5's shell replaces this. */
export function mountArenaHarness(root: HTMLElement): void {
  root.innerHTML = '';
  root.style.cssText = 'position:fixed;inset:0;';

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;cursor:none;';
  root.appendChild(canvas);

  const cross = document.createElement('div');
  cross.style.cssText =
    'position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;' +
    'border-radius:50%;background:#FFC400;box-shadow:0 0 0 1px #0D0D0D;pointer-events:none;';
  root.appendChild(cross);

  const hud = document.createElement('pre');
  hud.style.cssText =
    'position:absolute;left:12px;top:12px;margin:0;font:12px/1.5 ui-monospace,monospace;' +
    'color:#EAE7DC;background:rgba(13,13,13,.8);padding:8px 10px;border:1px solid #4A5A66;';
  root.appendChild(hud);

  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const size = (): [number, number] => [window.innerWidth, window.innerHeight];
  const pointer = createPointerLock(canvas);

  // Composite input: real pointer samples + a synthetic feed for runtime verification (Task 9).
  const manual = new Set<(s: AimSample) => void>();
  const manualFire = new Set<() => void>();
  const input: InputSource = {
    onSample(cb) {
      const off = pointer.onSample(cb);
      manual.add(cb);
      return () => {
        off();
        manual.delete(cb);
      };
    },
    onFire(cb) {
      const off = pointer.onFire(cb);
      manualFire.add(cb);
      return () => {
        off();
        manualFire.delete(cb);
      };
    },
  };
  const pushSynthetic = (s: AimSample): void => {
    for (const cb of manual) cb(s);
  };
  const pushFire = (): void => {
    for (const cb of manualFire) cb();
  };

  const arena = new Arena({ renderer, input, size, cm360: CM360, dpi: DPI, rng: mulberry32(7) });
  arena.spawnTarget({ kind: 'static' });
  arena.spawnTarget({ kind: 'static' });
  arena.spawnTarget({ kind: 'static' });

  let view: [number, number] = [0, 0];
  arena.onAim((_s, v) => {
    view = v;
  });

  // Accel check: keys 1/2 capture the slow-swipe total, 3/4 the fast-swipe total.
  let meter: AccelMeter | null = null;
  let slow = 0;
  let fast = 0;
  const offMeter = pointer.onSample((s) => meter?.add(s));

  const refreshHud = (): void => {
    const dpc = degreesPerCount(CM360, DPI);
    const verdict = slow && fast ? accelVerdict(slow, fast) : null;
    hud.textContent =
      `campeón · input + engine harness\n` +
      `cm/360 ${CM360}   dpi ${DPI}   deg/count ${dpc.toFixed(4)}\n` +
      `lock ${pointer.isLocked() ? 'on' : 'off'}   mode ${pointer.mode() ?? '—'}\n` +
      `view  yaw ${view[0].toFixed(1)}°  pitch ${view[1].toFixed(1)}°\n` +
      `accel slow ${slow.toFixed(0)} / fast ${fast.toFixed(0)}` +
      (verdict ? `  → ${verdict.accelerated ? 'BLOCK (accel on)' : 'OK (accel off)'}` : '') +
      `\nclick to lock · [1]start [2]stop slow · [3]start [4]stop fast`;
  };

  canvas.addEventListener('click', () => {
    void pointer
      .request()
      .then(refreshHud)
      .catch(() => refreshHud());
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === '1') meter = new AccelMeter();
    else if (e.key === '2') {
      slow = meter?.total() ?? 0;
      meter = null;
    } else if (e.key === '3') meter = new AccelMeter();
    else if (e.key === '4') {
      fast = meter?.total() ?? 0;
      meter = null;
    }
    refreshHud();
  });
  window.addEventListener('resize', () => arena.resize());

  let raf = 0;
  let last = 0;
  const loop = (ts: number): void => {
    const dt = last === 0 ? 16 : ts - last;
    last = ts;
    arena.tick(dt);
    arena.render();
    refreshHud();
    raf = window.requestAnimationFrame(loop);
  };
  raf = window.requestAnimationFrame(loop);

  window.__arenaDebug = {
    feed(dx, dy) {
      pushSynthetic({ t: 0, dx, dy });
      return view;
    },
    degPerCount: () => degreesPerCount(CM360, DPI),
    view: () => view,
    mode: () => pointer.mode(),
    fire() {
      pushFire();
    },
    async runInstrument(id: InstrumentId): Promise<TrialResult> {
      const { getInstrument } = await import('../instruments/registry');
      arena.clearTargets();
      return getInstrument(id).run(
        {
          cm360: CM360,
          dpi: DPI,
          rng: mulberry32(42),
          profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } },
        },
        arena,
      );
    },
    async runSession(): Promise<Report> {
      const { runSession } = await import('../optimizer/session-controller');
      const { makeEvolution } = await import('../optimizer/evolution');
      const { INSTRUMENTS } = await import('../instruments/registry');
      arena.clearTargets();
      const engine = makeEvolution({
        gp: { signalVar: 1, lengthScale: 0.6, noiseVar: 0.1 },
        sigma0: 0.3,
      });
      // Auto-fire pulse so the fire-gated instruments progress without a human (dev proof only).
      const autofire = window.setInterval(() => pushFire(), 220);
      try {
        const { report } = await runSession({
          dpi: DPI,
          profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } },
          bounds: [18, 50],
          engine,
          instruments: INSTRUMENTS,
          scene: arena,
          schedule: ['flick', 'strike', 'calibrate', 'track'],
          coldStart: 8, // Generation 0 gene pool…
          maxTrials: 12, // …then 4 evolutionary generations (exercises makeEvolution.suggest)
          rng: mulberry32(2026),
          bootstrapIters: 300,
        });
        console.log('[campeón] session report', report);
        return report;
      } finally {
        window.clearInterval(autofire);
      }
    },
    cleanup() {
      window.cancelAnimationFrame(raf);
      offMeter();
      pointer.dispose();
      arena.dispose();
      delete window.__arenaDebug;
    },
  };
}
