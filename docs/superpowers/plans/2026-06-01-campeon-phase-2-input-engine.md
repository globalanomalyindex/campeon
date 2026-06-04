# campeón Phase 2 - Input Fidelity + Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the input-validity layer (`input/`) and the Three.js arena (`engine/`) so you can pointer-lock and mouse-look at a set cm/360, with raw-vs-OS-adjusted input detected, deltas DPR-normalized, and the acceleration gate working.

**Architecture:** Irreducible browser I/O (WebGL renderer, `requestPointerLock`, event listeners) is isolated into thin shells. Every piece of real logic - the cm/360→degrees-per-count mapping, DPR normalization, the accel decision, look accumulation + pitch clamp, target bearing/angular-radius - is extracted into **pure functions unit-tested in Node**. Three.js math classes (`PerspectiveCamera`, `Vector3`) run headless in Node with no GL context, so the camera rotation and target geometry are unit-tested too; `Arena` takes an injected renderer + input source so its orchestration is testable without WebGL. Only the GL canvas, the Pointer Lock API, and DOM event wiring are verified live in Chromium (Task 9).

**Tech Stack:** TypeScript (strict) · Vite · Three.js `^0.184` · Vitest (`environment: 'node'`). New runtime dependency: `three`.

**Spec:** [../specs/2026-06-01-campeon-design.md](../specs/2026-06-01-campeon-design.md) (§5 engine, §6 input-validity) · **Index:** [./2026-06-01-campeon-master-plan.md](./2026-06-01-campeon-master-plan.md)

---

## Conventions for this phase

- **Commits:** conventional-commit subject (`feat(engine): …`, `feat(input): …`, `chore: …`), and every commit ends with the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
  (shown explicitly in each commit step via a second `-m`).
- **Imports:** `verbatimModuleSyntax` is on - use `import type { … }` for type-only imports and plain `import { … }` for values (including Three.js classes). No `any` in `src/engine` or `src/input` (the dev harness in `src/dev/` may use a single typed global).
- **Logical view frame (the contract for `onAim` and `TargetHandle.bearing()`):** `yaw 0 = forward (−Z)`, `+yaw = right (+X)`; `pitch 0 = level`, `+pitch = up (+Y)`. Mouse-right (`+dx`) → `+yaw`; mouse-down (`+dy`) → `−pitch`. Internally the camera uses Euler order `YXZ` with `rotation.y = −yawRad`, `rotation.x = +pitchRad`.
- **File-tree adherence:** this phase creates exactly the `input/` and `engine/` files named in the master plan, plus one **temporary dev harness** (`src/dev/arena-harness.ts`) and a small hash hook in `main.ts` so the arena is runnable now. The harness is a dev artifact; Phase 5's shell replaces this routing.
- **Test env stays `node`** - every new unit test is pure (no jsdom). Browser glue is covered by Task 9.

---

### Task 1: Add Three.js dependency

**Files:**
- Modify: `package.json` (+ `package-lock.json`)
- Test: `tests/engine/three-smoke.test.ts`

- [ ] **Step 1: Install Three.js (runtime dep) and its types (dev dep)**

```bash
npm install three@^0.184.0
npm install -D @types/three@^0.184.1
```

Expected `package.json` result (versions may resolve slightly higher - accept whatever npm pins):
```jsonc
{
  // …existing…
  "dependencies": {
    "three": "^0.184.0"
  },
  "devDependencies": {
    "@types/node": "^25.9.1",
    "@types/three": "^0.184.1",
    "typescript": "^5.5.4",
    "vite": "^5.4.0",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: Write the failing test** (proves Three.js math runs headless in Node - the foundation for unit-testing the engine)

`tests/engine/three-smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { Vector3, PerspectiveCamera } from 'three';

describe('three.js (headless, Node)', () => {
  it('constructs core math objects without a GL context', () => {
    const v = new Vector3(1, 2, 3);
    expect(v.length()).toBeCloseTo(Math.sqrt(14), 6);

    const cam = new PerspectiveCamera(90, 16 / 9, 0.1, 100);
    expect(cam.isPerspectiveCamera).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify it passes** (the dependency is the implementation)

Run: `npx vitest run tests/engine/three-smoke.test.ts`
Expected: PASS (1 file, 1 test). If it fails with "Cannot find module 'three'", the install in Step 1 did not complete.

- [ ] **Step 4: Confirm the type-check still passes**

Run: `npm run build`
Expected: `tsc --noEmit` clean + `vite build` succeeds.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tests/engine/three-smoke.test.ts
git commit -m "chore: add three.js (runtime) + @types/three" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: DPI + DPR helpers (`src/input/dpi.ts`)

> Pure. `parseDpi`/`isValidDpi` validate the user-entered DPI (no browser API exposes it - spec §6.1). `normalizeByDpr` makes Chrome's device-px `movementX` and Firefox's CSS-px `movementX` agree (spec §6.4). NB: `devicePixelRatio` ≠ mouse DPI; they are unrelated and this file owns both purely to keep the "count normalization" helpers together (per the master plan's `dpi.ts` responsibility).

**Files:**
- Create: `src/input/dpi.ts`
- Test: `tests/input/dpi.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/input/dpi.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseDpi, isValidDpi, normalizeByDpr, MIN_DPI, MAX_DPI } from '../../src/input/dpi';

describe('dpi parsing + validation', () => {
  it('parses numeric strings and passes through numbers', () => {
    expect(parseDpi('800')).toBe(800);
    expect(parseDpi(' 1600 ')).toBe(1600);
    expect(parseDpi(1.6e3)).toBe(1600);
    expect(Number.isNaN(parseDpi('abc'))).toBe(true);
  });
  it('accepts sane DPI and rejects the rest', () => {
    expect(isValidDpi(800)).toBe(true);
    expect(isValidDpi(MIN_DPI)).toBe(true);
    expect(isValidDpi(MAX_DPI)).toBe(true);
    expect(isValidDpi(MIN_DPI - 1)).toBe(false);
    expect(isValidDpi(MAX_DPI + 1)).toBe(false);
    expect(isValidDpi(0)).toBe(false);
    expect(isValidDpi(Number.NaN)).toBe(false);
  });
});

describe('DPR normalization', () => {
  it('divides movement by devicePixelRatio so browsers agree', () => {
    expect(normalizeByDpr(10, 2)).toBe(5);
    expect(normalizeByDpr(10, 1)).toBe(10);
    expect(normalizeByDpr(-8, 2)).toBe(-4);
  });
  it('guards a zero/negative ratio (treats as 1)', () => {
    expect(normalizeByDpr(10, 0)).toBe(10);
    expect(normalizeByDpr(10, -2)).toBe(10);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/input/dpi.test.ts`
Expected: FAIL - `Cannot find module '../../src/input/dpi'`.

- [ ] **Step 3: Implement `src/input/dpi.ts`**

```ts
import type { Dpi } from '../types';

/** Plausible mouse DPI bounds (CPI). Below ~100 or above ~32000 is almost certainly a typo. */
export const MIN_DPI = 100;
export const MAX_DPI = 32000;

/** Parse a user-entered DPI value. Returns NaN for unparseable input (caller validates). */
export function parseDpi(input: string | number): Dpi {
  return typeof input === 'number' ? input : Number.parseFloat(input.trim());
}

/** True when `dpi` is finite and within the supported range. */
export function isValidDpi(dpi: number): boolean {
  return Number.isFinite(dpi) && dpi >= MIN_DPI && dpi <= MAX_DPI;
}

/**
 * Normalize a raw pointer movement delta by `devicePixelRatio`.
 * Chrome reports `movementX` in device px (no DPR scaling); Firefox reports CSS px.
 * Dividing by DPR makes the two agree. Guards a non-positive ratio (treated as 1).
 * NB: `devicePixelRatio` is unrelated to mouse DPI.
 */
export function normalizeByDpr(movement: number, dpr: number): number {
  return movement / (dpr > 0 ? dpr : 1);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/input/dpi.test.ts`
Expected: PASS (all assertions).

- [ ] **Step 5: Commit**

```bash
git add src/input/dpi.ts tests/input/dpi.test.ts
git commit -m "feat(input): DPI validation + DPR delta normalization" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Acceleration gate (`src/input/accel-check.ts`)

> Pure logic for spec §6.3: the user swipes the **same physical distance** slow vs fast. With OS pointer acceleration **off**, the accumulated count magnitude is identical regardless of speed; with accel **on**, the faster swipe accumulates more counts. A relative difference beyond ~10% blocks measurement (cm/360 is undefined under acceleration). The capture UI is Phase 5; this file ships the math + a small accumulator.

**Files:**
- Create: `src/input/accel-check.ts`
- Test: `tests/input/accel-check.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/input/accel-check.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { accumulateMagnitude, accelVerdict, AccelMeter } from '../../src/input/accel-check';
import type { AimSample } from '../../src/types';

const s = (dx: number, dy: number): AimSample => ({ t: 0, dx, dy });

describe('accumulateMagnitude', () => {
  it('sums the per-sample path length (hypot)', () => {
    expect(accumulateMagnitude([s(3, 4), s(0, 0), s(6, 8)])).toBeCloseTo(15, 9);
  });
});

describe('accelVerdict', () => {
  it('passes when slow and fast totals match (accel off)', () => {
    expect(accelVerdict(1000, 1000).accelerated).toBe(false);
    expect(accelVerdict(1000, 1080).accelerated).toBe(false); // 8% < 10%
  });
  it('blocks when the fast swipe accumulates materially more (accel on)', () => {
    const v = accelVerdict(1000, 1300);
    expect(v.accelerated).toBe(true);
    expect(v.ratio).toBeCloseTo(0.3, 9);
  });
  it('honors a custom tolerance', () => {
    expect(accelVerdict(1000, 1080, 0.05).accelerated).toBe(true);
  });
  it('does not divide by zero on an empty slow swipe', () => {
    expect(accelVerdict(0, 0).ratio).toBe(0);
  });
});

describe('AccelMeter', () => {
  it('accumulates and resets', () => {
    const m = new AccelMeter();
    m.add(s(3, 4));
    m.add(s(6, 8));
    expect(m.total()).toBeCloseTo(15, 9);
    m.reset();
    expect(m.total()).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/input/accel-check.test.ts`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement `src/input/accel-check.ts`**

```ts
import type { AimSample } from '../types';

/** Total path-length magnitude (in normalized counts) across a swipe's samples. */
export function accumulateMagnitude(samples: readonly AimSample[]): number {
  let sum = 0;
  for (const sample of samples) sum += Math.hypot(sample.dx, sample.dy);
  return sum;
}

export interface AccelVerdict {
  /** True when OS pointer acceleration appears to be ON - measurement must be blocked. */
  accelerated: boolean;
  /** Relative difference |fast − slow| / slow. */
  ratio: number;
}

/**
 * Compare a slow vs fast same-distance swipe. Default tolerance 0.10 (10%).
 * accel OFF → totals match → ratio ≈ 0 → not accelerated.
 */
export function accelVerdict(slowTotal: number, fastTotal: number, tol = 0.1): AccelVerdict {
  const ratio = slowTotal > 0 ? Math.abs(fastTotal - slowTotal) / slowTotal : 0;
  return { accelerated: ratio > tol, ratio };
}

/** Accumulates the count magnitude for one swipe phase. */
export class AccelMeter {
  private sum = 0;
  add(sample: AimSample): void {
    this.sum += Math.hypot(sample.dx, sample.dy);
  }
  total(): number {
    return this.sum;
  }
  reset(): void {
    this.sum = 0;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/input/accel-check.test.ts`
Expected: PASS (all assertions).

- [ ] **Step 5: Commit**

```bash
git add src/input/accel-check.ts tests/input/accel-check.test.ts
git commit -m "feat(input): acceleration-gate decision + swipe accumulator" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Pointer-lock capture (`src/input/pointer-lock.ts`)

> The pure part - `flattenCoalesced` - turns a batch of coalesced pointer events into DPR-normalized `AimSample`s (spec §6.4–6.5: accumulate `getCoalescedEvents()` so no counts are lost at 1000 Hz). It is unit-tested. The `createPointerLock` shell does the real browser work - `requestPointerLock({ unadjustedMovement: true })` with a graceful fallback (spec §6.2), event wiring, and raw-vs-OS-adjusted detection. The shell has **no top-level DOM access** (so the module imports cleanly in Node) and is verified live in Task 9.

**Files:**
- Create: `src/input/pointer-lock.ts`
- Test: `tests/input/pointer-lock.test.ts`

- [ ] **Step 1: Write the failing test** (covers the pure flattening; the shell is runtime-verified in Task 9)

`tests/input/pointer-lock.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { flattenCoalesced } from '../../src/input/pointer-lock';

describe('flattenCoalesced', () => {
  it('DPR-normalizes each coalesced event and keeps per-event timestamps', () => {
    const events = [
      { movementX: 10, movementY: -4, timeStamp: 100 },
      { movementX: 6, movementY: 0, timeStamp: 101 },
    ];
    expect(flattenCoalesced(events, 2, 0)).toEqual([
      { t: 100, dx: 5, dy: -2 },
      { t: 101, dx: 3, dy: 0 },
    ]);
  });
  it('falls back to the supplied time when an event has no timeStamp', () => {
    const events = [{ movementX: 4, movementY: 4 }];
    expect(flattenCoalesced(events, 1, 250)).toEqual([{ t: 250, dx: 4, dy: 4 }]);
  });
  it('returns an empty array for no events', () => {
    expect(flattenCoalesced([], 1, 0)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/input/pointer-lock.test.ts`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement `src/input/pointer-lock.ts`**

```ts
import type { AimSample, PointerLockMode } from '../types';
import { normalizeByDpr } from './dpi';

interface MovementLike {
  movementX: number;
  movementY: number;
  timeStamp?: number;
}

/** Flatten coalesced pointer events into DPR-normalized AimSamples (pure). */
export function flattenCoalesced(
  events: readonly MovementLike[],
  dpr: number,
  fallbackTime: number,
): AimSample[] {
  return events.map((e) => ({
    t: e.timeStamp ?? fallbackTime,
    dx: normalizeByDpr(e.movementX, dpr),
    dy: normalizeByDpr(e.movementY, dpr),
  }));
}

export interface PointerLockController {
  /** Request lock, preferring raw (unadjusted) movement; resolves with the granted mode. */
  request(): Promise<PointerLockMode>;
  exit(): void;
  /** Subscribe to per-sample deltas while locked. Returns an unsubscribe fn. */
  onSample(cb: (sample: AimSample) => void): () => void;
  /** The granted mode, or null when not locked. */
  mode(): PointerLockMode | null;
  isLocked(): boolean;
  dispose(): void;
}

/**
 * Pointer-lock + high-frequency raw capture over `element`.
 * - Prefers `pointerrawupdate` (with `getCoalescedEvents`); falls back to `mousemove`
 *   for browsers without raw updates, deduping so counts are never doubled.
 * - Tries `unadjustedMovement: true` first (Chromium raw), falls back to plain lock.
 * Runtime-verified (Task 9); not unit-tested.
 */
export function createPointerLock(element: HTMLElement): PointerLockController {
  const cbs = new Set<(sample: AimSample) => void>();
  let currentMode: PointerLockMode | null = null;
  let locked = false;
  let rawSeen = false;

  const emit = (ev: Event): void => {
    if (!locked) return;
    const pe = ev as PointerEvent;
    const dpr = window.devicePixelRatio || 1;
    const coalesced =
      typeof pe.getCoalescedEvents === 'function' ? pe.getCoalescedEvents() : [];
    const batch = coalesced.length > 0 ? coalesced : [pe];
    const samples = flattenCoalesced(batch as unknown as MovementLike[], dpr, ev.timeStamp);
    for (const sample of samples) for (const cb of cbs) cb(sample);
  };

  const onRaw = (ev: Event): void => {
    rawSeen = true;
    emit(ev);
  };
  const onMouse = (ev: Event): void => {
    if (rawSeen) return; // pointerrawupdate is handling this device
    emit(ev);
  };
  const onLockChange = (): void => {
    locked = document.pointerLockElement === element;
    if (!locked) currentMode = null;
  };

  document.addEventListener('pointerrawupdate', onRaw as EventListener);
  document.addEventListener('mousemove', onMouse as EventListener);
  document.addEventListener('pointerlockchange', onLockChange);

  return {
    async request(): Promise<PointerLockMode> {
      try {
        const req = element.requestPointerLock({ unadjustedMovement: true }) as
          | Promise<void>
          | undefined;
        if (req && typeof req.then === 'function') {
          await req;
          currentMode = 'raw';
          return 'raw';
        }
        currentMode = 'os-adjusted';
        return 'os-adjusted';
      } catch {
        try {
          const fallback = element.requestPointerLock() as Promise<void> | undefined;
          if (fallback && typeof fallback.then === 'function') await fallback;
        } catch {
          /* surfaced via the pointerlockerror event */
        }
        currentMode = 'os-adjusted';
        return 'os-adjusted';
      }
    },
    exit(): void {
      if (document.pointerLockElement === element) document.exitPointerLock();
    },
    onSample(cb): () => void {
      cbs.add(cb);
      return () => {
        cbs.delete(cb);
      };
    },
    mode(): PointerLockMode | null {
      return currentMode;
    },
    isLocked(): boolean {
      return locked;
    },
    dispose(): void {
      document.removeEventListener('pointerrawupdate', onRaw as EventListener);
      document.removeEventListener('mousemove', onMouse as EventListener);
      document.removeEventListener('pointerlockchange', onLockChange);
      cbs.clear();
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes + type-checks**

Run: `npx vitest run tests/input/pointer-lock.test.ts`
Expected: PASS (3 assertions).
Run: `npm run build`
Expected: `tsc --noEmit` clean (confirms the shell type-checks against the DOM lib).

> If `requestPointerLock({ unadjustedMovement: true })` reports a type error on an older TS DOM lib, the `as Promise<void> | undefined` cast already present resolves it. Do not widen to `any`.

- [ ] **Step 5: Commit**

```bash
git add src/input/pointer-lock.ts tests/input/pointer-lock.test.ts
git commit -m "feat(input): pointer-lock raw capture + coalesced-event flattening" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Camera rig - cm/360 → view rotation (`src/engine/camera-rig.ts`)

> The heart of measurement validity. `degreesPerCount(cm360, dpi) = 914.4 / (cm360·dpi)` is the rotation the scene turns per one normalized mouse count, so a full 360° turn equals exactly `cm360` of physical travel - **independent of any internal yaw constant** (the spec's `Y_app`/`sens` split is internal bookkeeping; this is the observable). `applyLook` integrates samples with the logical frame + pitch clamp. `CameraRig` maps that onto a real `PerspectiveCamera` (unit-tested in Node - no GL needed).

**Files:**
- Create: `src/engine/camera-rig.ts`
- Test: `tests/engine/camera-rig.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/engine/camera-rig.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import {
  degreesPerCount,
  wrapYaw,
  applyLook,
  PITCH_LIMIT,
  CameraRig,
} from '../../src/engine/camera-rig';

describe('cm/360 → degrees per count', () => {
  it('makes one 360° turn equal the target cm/360 distance', () => {
    // 50.8 cm @ 1000 DPI = 20000 counts/360 → 0.018°/count
    expect(degreesPerCount(50.8, 1000)).toBeCloseTo(0.018, 6);
    // 34 cm @ 800 DPI → 914.4 / 27200
    expect(degreesPerCount(34, 800)).toBeCloseTo(0.033618, 6);
  });
});

describe('wrapYaw', () => {
  it('wraps into [-180, 180)', () => {
    expect(wrapYaw(190)).toBeCloseTo(-170, 9);
    expect(wrapYaw(-190)).toBeCloseTo(170, 9);
    expect(wrapYaw(360)).toBeCloseTo(0, 9);
    expect(wrapYaw(180)).toBeCloseTo(-180, 9);
  });
});

describe('applyLook', () => {
  const dpc = 0.018;
  it('moves +yaw on mouse-right and +pitch on mouse-up, then clamps pitch', () => {
    let st = { yaw: 0, pitch: 0 };
    st = applyLook(st, { t: 0, dx: 100, dy: 0 }, dpc); // right
    expect(st.yaw).toBeCloseTo(1.8, 6);
    st = applyLook(st, { t: 1, dx: 0, dy: -100 }, dpc); // up (dy negative)
    expect(st.pitch).toBeCloseTo(1.8, 6);
    st = applyLook(st, { t: 2, dx: 0, dy: -1_000_000 }, dpc); // slam up
    expect(st.pitch).toBe(PITCH_LIMIT);
  });
  it('a full 360° worth of counts returns to the starting yaw', () => {
    const d = degreesPerCount(34, 800);
    const counts = Math.round(360 / d);
    const st = applyLook({ yaw: 0, pitch: 0 }, { t: 0, dx: counts, dy: 0 }, d);
    expect(Math.abs(wrapYaw(st.yaw))).toBeLessThan(0.05);
  });
});

describe('CameraRig camera mapping', () => {
  const forward = (rig: CameraRig): Vector3 => rig.camera.getWorldDirection(new Vector3());
  it('looks down -Z at rest', () => {
    const d = forward(new CameraRig(34, 800));
    expect(d.x).toBeCloseTo(0, 5);
    expect(d.y).toBeCloseTo(0, 5);
    expect(d.z).toBeCloseTo(-1, 5);
  });
  it('+yaw turns the view to the right (+X)', () => {
    const rig = new CameraRig(34, 800);
    const dpc = degreesPerCount(34, 800);
    rig.apply({ t: 0, dx: 90 / dpc, dy: 0 }); // +90° yaw
    const d = forward(rig);
    expect(d.x).toBeCloseTo(1, 4);
    expect(d.z).toBeCloseTo(0, 4);
  });
  it('mouse-up pitches the view up (+Y)', () => {
    const rig = new CameraRig(34, 800);
    const dpc = degreesPerCount(34, 800);
    rig.apply({ t: 0, dx: 0, dy: -45 / dpc }); // +45° pitch
    expect(forward(rig).y).toBeCloseTo(Math.sin(Math.PI / 4), 4);
  });
  it('setSensitivity changes how far a fixed count stream rotates the view', () => {
    const rig = new CameraRig(34, 800);
    rig.apply({ t: 0, dx: 500, dy: 0 });
    const lo = rig.view()[0];
    rig.setSensitivity(68, 800); // double cm/360 → half deg/count
    rig.apply({ t: 1, dx: 500, dy: 0 });
    const inc = rig.view()[0] - lo;
    expect(inc).toBeCloseTo(lo / 2, 4);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/engine/camera-rig.test.ts`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement `src/engine/camera-rig.ts`**

```ts
import { MathUtils, PerspectiveCamera } from 'three';
import type { AimSample, Cm360, Degrees, Dpi } from '../types';
import { TURN_CM } from '../convert/cm360';

/** Max look-up/down angle (degrees) so the view cannot flip over the pole. */
export const PITCH_LIMIT: Degrees = 89;

/**
 * View rotation (degrees) per one normalized mouse count, so that a full 360°
 * turn equals `cm360` of physical mouse travel at `dpi`.
 *   deg/count = 914.4 / (cm360 · dpi)
 * Independent of any internal yaw constant - this is the measured observable.
 */
export function degreesPerCount(cm360: Cm360, dpi: Dpi): Degrees {
  return TURN_CM / (cm360 * dpi);
}

/** Wrap a yaw angle into [-180, 180). */
export function wrapYaw(deg: Degrees): Degrees {
  return (((deg + 180) % 360) + 360) % 360 - 180;
}

export interface LookState {
  yaw: Degrees;
  pitch: Degrees;
}

/**
 * Integrate one sample into the look state.
 * +dx (mouse-right) → +yaw (turn right); +dy (mouse-down) → −pitch (look down).
 * Pitch clamps to ±PITCH_LIMIT; yaw wraps to [-180, 180).
 */
export function applyLook(state: LookState, sample: AimSample, degPerCount: Degrees): LookState {
  const yaw = wrapYaw(state.yaw + sample.dx * degPerCount);
  const raw = state.pitch - sample.dy * degPerCount;
  const pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, raw));
  return { yaw, pitch };
}

/**
 * Owns a PerspectiveCamera and maps the logical look state onto it.
 * Logical frame: yaw 0 = forward (−Z), +yaw = right (+X); pitch 0 = level, +pitch = up (+Y).
 * Mapped via Euler order YXZ with rotation.y = −yawRad, rotation.x = +pitchRad.
 */
export class CameraRig {
  readonly camera: PerspectiveCamera;
  private state: LookState = { yaw: 0, pitch: 0 };
  private degPerCount: Degrees;

  constructor(cm360: Cm360, dpi: Dpi, aspect = 1) {
    this.camera = new PerspectiveCamera(90, aspect, 0.1, 1000);
    this.camera.rotation.order = 'YXZ';
    this.degPerCount = degreesPerCount(cm360, dpi);
    this.sync();
  }

  setSensitivity(cm360: Cm360, dpi: Dpi): void {
    this.degPerCount = degreesPerCount(cm360, dpi);
  }

  apply(sample: AimSample): void {
    this.state = applyLook(this.state, sample, this.degPerCount);
    this.sync();
  }

  view(): [Degrees, Degrees] {
    return [this.state.yaw, this.state.pitch];
  }

  private sync(): void {
    this.camera.rotation.y = -MathUtils.degToRad(this.state.yaw);
    this.camera.rotation.x = MathUtils.degToRad(this.state.pitch);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/engine/camera-rig.test.ts`
Expected: PASS (all groups).

- [ ] **Step 5: Commit**

```bash
git add src/engine/camera-rig.ts tests/engine/camera-rig.test.ts
git commit -m "feat(engine): camera rig - cm/360→deg/count, look integration, clamp" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Target geometry (`src/engine/targets.ts`)

> Pure geometry + a `Target` that satisfies `TargetHandle`. `bearingOf`/`positionAt` are exact inverses in the logical frame, so a target's reported bearing matches where the rig must look to center it (the foundation for hit-testing + tracking error in Phase 3). `angularRadius` is the half-angle the target subtends. Phase 2 implements a single **static** placement; `TargetSpec.kind` (`moving`/`grid`) is honored in Phase 3 when `TargetSpec` gains placement fields.

**Files:**
- Create: `src/engine/targets.ts`
- Test: `tests/engine/targets.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/engine/targets.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import {
  angularRadius,
  bearingOf,
  positionAt,
  placeStatic,
  Target,
} from '../../src/engine/targets';
import { mulberry32 } from '../../src/stats/bootstrap';

describe('angularRadius', () => {
  it('is atan(r/d) in degrees', () => {
    expect(angularRadius(1, 10)).toBeCloseTo(5.7106, 3);
    expect(angularRadius(1, 1)).toBeCloseTo(45, 6);
  });
});

describe('bearingOf', () => {
  it('straight ahead = [0,0]', () => {
    const [y, p] = bearingOf(new Vector3(0, 0, -10));
    expect(y).toBeCloseTo(0, 9);
    expect(p).toBeCloseTo(0, 9);
  });
  it('+X is +90° yaw (right); +Y is +pitch (up)', () => {
    expect(bearingOf(new Vector3(10, 0, 0))[0]).toBeCloseTo(90, 6);
    expect(bearingOf(new Vector3(0, 10, -10))[1]).toBeCloseTo(45, 6);
  });
});

describe('positionAt / bearingOf are inverses', () => {
  it('round-trips an arbitrary bearing', () => {
    const [y, p] = bearingOf(positionAt(33, -12, 25));
    expect(y).toBeCloseTo(33, 6);
    expect(p).toBeCloseTo(-12, 6);
  });
});

describe('Target', () => {
  it('reports its bearing and angular radius', () => {
    const t = new Target('t1', { yaw: 20, pitch: -5, distance: 20, worldRadius: 0.6 });
    const [y, p] = t.bearing();
    expect(y).toBeCloseTo(20, 4);
    expect(p).toBeCloseTo(-5, 4);
    expect(t.radiusDeg()).toBeCloseTo(angularRadius(0.6, 20), 9);
    expect(t.id).toBe('t1');
  });
});

describe('placeStatic', () => {
  it('places within the forward cone for a seeded RNG', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 50; i++) {
      const pl = placeStatic(rng);
      expect(Math.abs(pl.yaw)).toBeLessThanOrEqual(25);
      expect(Math.abs(pl.pitch)).toBeLessThanOrEqual(12);
      expect(pl.distance).toBeGreaterThan(0);
      expect(pl.worldRadius).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/engine/targets.test.ts`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement `src/engine/targets.ts`**

```ts
import { Color, Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from 'three';
import type { Degrees, TargetHandle } from '../types';

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

/** Angular half-angle (degrees) subtended by a sphere of world radius `r` at distance `d`. */
export function angularRadius(r: number, d: number): Degrees {
  return Math.atan2(r, d) * RAD2DEG;
}

/**
 * Logical bearing [yaw, pitch] (degrees) of a world position from the origin.
 * yaw = atan2(x, −z) (+yaw = right); pitch = atan2(y, hypot(x, z)) (+pitch = up).
 */
export function bearingOf(p: Vector3): [Degrees, Degrees] {
  return [Math.atan2(p.x, -p.z) * RAD2DEG, Math.atan2(p.y, Math.hypot(p.x, p.z)) * RAD2DEG];
}

/** World position at a bearing + distance (exact inverse of bearingOf). */
export function positionAt(yaw: Degrees, pitch: Degrees, distance: number): Vector3 {
  const y = yaw * DEG2RAD;
  const p = pitch * DEG2RAD;
  return new Vector3(
    Math.cos(p) * Math.sin(y),
    Math.sin(p),
    -Math.cos(p) * Math.cos(y),
  ).multiplyScalar(distance);
}

export interface Placement {
  yaw: Degrees;
  pitch: Degrees;
  distance: number;
  worldRadius: number;
}

export interface PlaceOptions {
  yawSpread?: Degrees;
  pitchSpread?: Degrees;
  distance?: number;
  worldRadius?: number;
}

/** A static target inside a forward cone (±yawSpread, ±pitchSpread). */
export function placeStatic(rng: () => number, opt: PlaceOptions = {}): Placement {
  const yawSpread = opt.yawSpread ?? 25;
  const pitchSpread = opt.pitchSpread ?? 12;
  return {
    yaw: (rng() * 2 - 1) * yawSpread,
    pitch: (rng() * 2 - 1) * pitchSpread,
    distance: opt.distance ?? 20,
    worldRadius: opt.worldRadius ?? 0.6,
  };
}

/** A spawned arena target. Owns its mesh; reports bearing/angular radius for scoring. */
export class Target implements TargetHandle {
  readonly id: string;
  readonly mesh: Mesh;
  private readonly placement: Placement;

  constructor(id: string, placement: Placement) {
    this.id = id;
    this.placement = placement;
    const geometry = new SphereGeometry(placement.worldRadius, 24, 16);
    const material = new MeshStandardMaterial({
      color: new Color('#FFC400'),
      emissive: new Color('#3a2a00'),
      roughness: 0.4,
      metalness: 0,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.position.copy(positionAt(placement.yaw, placement.pitch, placement.distance));
  }

  bearing(): [Degrees, Degrees] {
    return bearingOf(this.mesh.position);
  }

  radiusDeg(): Degrees {
    return angularRadius(this.placement.worldRadius, this.placement.distance);
  }

  /** Release GPU resources. Safe to call once the target is removed from the scene. */
  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshStandardMaterial).dispose();
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/engine/targets.test.ts`
Expected: PASS (all groups).

- [ ] **Step 5: Commit**

```bash
git add src/engine/targets.ts tests/engine/targets.test.ts
git commit -m "feat(engine): target geometry - bearing/angular-radius + static placement" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Arena (`src/engine/arena.ts`) - `ArenaScene` over an injected renderer + input

> Implements the `ArenaScene` contract. The renderer and input source are **injected interfaces** (`RendererLike`, `InputSource`) that `THREE.WebGLRenderer` and the pointer-lock controller satisfy structurally - so the arena's orchestration (per-sample → rig → `onAim`; spawn/clear; sensitivity; render delegation) is unit-tested in Node with a spy renderer and a fake input, while the real GL canvas is wired in Task 8. Input is applied **per sample** (not per frame) so no counts are lost at high refresh (spec §6.5); rendering is decoupled in the RAF loop.

**Files:**
- Create: `src/engine/arena.ts`
- Test: `tests/engine/arena.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/engine/arena.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { AimSample, Degrees } from '../../src/types';
import { Arena } from '../../src/engine/arena';
import type { RendererLike, InputSource } from '../../src/engine/arena';
import { degreesPerCount } from '../../src/engine/camera-rig';
import { mulberry32 } from '../../src/stats/bootstrap';

function harness() {
  let emit: (s: AimSample) => void = () => {};
  const input: InputSource = {
    onSample(cb) {
      emit = cb;
      return () => {
        emit = () => {};
      };
    },
  };
  let renders = 0;
  const renderer: RendererLike = {
    render() {
      renders += 1;
    },
    setSize() {},
    dispose() {},
  };
  const arena = new Arena({
    renderer,
    input,
    size: () => [800, 600],
    cm360: 34,
    dpi: 800,
    rng: mulberry32(1),
  });
  return { arena, send: (s: AimSample) => emit(s), renders: () => renders };
}

describe('Arena (headless)', () => {
  it('emits onAim with the integrated view for each sample', () => {
    const h = harness();
    const seen: Array<[AimSample, [Degrees, Degrees]]> = [];
    h.arena.onAim((s, v) => seen.push([s, v]));
    const dpc = degreesPerCount(34, 800);
    h.send({ t: 0, dx: 10 / dpc, dy: 0 });
    expect(seen).toHaveLength(1);
    expect(seen[0][1][0]).toBeCloseTo(10, 4); // yaw advanced 10°
  });

  it('unsubscribing stops delivery', () => {
    const h = harness();
    let count = 0;
    const off = h.arena.onAim(() => {
      count += 1;
    });
    h.send({ t: 0, dx: 5, dy: 0 });
    off();
    h.send({ t: 1, dx: 5, dy: 0 });
    expect(count).toBe(1);
  });

  it('spawnTarget returns a forward handle; clearTargets empties without throwing', () => {
    const h = harness();
    const t = h.arena.spawnTarget({ kind: 'static' });
    const [y, p] = t.bearing();
    expect(Math.abs(y)).toBeLessThanOrEqual(25);
    expect(Math.abs(p)).toBeLessThanOrEqual(12);
    expect(t.radiusDeg()).toBeGreaterThan(0);
    h.arena.clearTargets();
    expect(() => h.arena.spawnTarget({ kind: 'static' })).not.toThrow();
  });

  it('setSensitivity halves the rotation for a fixed count stream', () => {
    const h = harness();
    let yaw = 0;
    h.arena.onAim((_s, v) => {
      yaw = v[0];
    });
    h.send({ t: 0, dx: 500, dy: 0 });
    const lo = yaw;
    h.arena.setSensitivity(68, 800);
    h.send({ t: 1, dx: 500, dy: 0 });
    expect(yaw - lo).toBeCloseTo(lo / 2, 4);
  });

  it('render() delegates to the injected renderer', () => {
    const h = harness();
    h.arena.render();
    expect(h.renders()).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/engine/arena.test.ts`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement `src/engine/arena.ts`**

```ts
import {
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
} from 'three';
import type { AimSample, ArenaScene, Cm360, Degrees, Dpi, TargetHandle, TargetSpec } from '../types';
import { CameraRig } from './camera-rig';
import { Target, placeStatic } from './targets';

/** Minimal renderer surface the arena needs - satisfied by THREE.WebGLRenderer. */
export interface RendererLike {
  render(scene: Scene, camera: PerspectiveCamera): void;
  setSize(width: number, height: number): void;
  dispose(): void;
}

/** A source of pointer deltas - satisfied by the pointer-lock controller. */
export interface InputSource {
  onSample(cb: (sample: AimSample) => void): () => void;
}

export interface ArenaOptions {
  renderer: RendererLike;
  input: InputSource;
  size: () => [number, number];
  cm360: Cm360;
  dpi: Dpi;
  rng?: () => number;
}

type AimCallback = (sample: AimSample, view: [Degrees, Degrees]) => void;

/** A first-person arena: mouse-look at a set cm/360, spawn targets, emit aim samples. */
export class Arena implements ArenaScene {
  private readonly scene = new Scene();
  private readonly rig: CameraRig;
  private readonly renderer: RendererLike;
  private readonly sizeFn: () => [number, number];
  private readonly rng: () => number;
  private readonly targets = new Map<string, Target>();
  private readonly aimCbs = new Set<AimCallback>();
  private readonly unsubInput: () => void;
  private nextId = 0;
  private disposed = false;

  constructor(opts: ArenaOptions) {
    this.renderer = opts.renderer;
    this.sizeFn = opts.size;
    this.rng = opts.rng ?? Math.random;
    const [w, h] = this.sizeFn();
    this.rig = new CameraRig(opts.cm360, opts.dpi, w / h);
    this.buildEnvironment();
    this.renderer.setSize(w, h);
    this.unsubInput = opts.input.onSample((sample) => this.handleSample(sample));
  }

  private buildEnvironment(): void {
    this.scene.background = new Color('#0D0D0D');
    const hemi = new HemisphereLight(0xbfd4e0, 0x202020, 1.0);
    const dir = new DirectionalLight(0xffffff, 0.6);
    dir.position.set(3, 10, 4);
    const grid = new GridHelper(200, 80, 0x33424c, 0x1a2228);
    grid.position.y = -3;
    this.scene.add(hemi, dir, grid);
  }

  private handleSample(sample: AimSample): void {
    this.rig.apply(sample);
    const view = this.rig.view();
    for (const cb of this.aimCbs) cb(sample, view);
  }

  setSensitivity(cm360: Cm360, dpi: Dpi): void {
    this.rig.setSensitivity(cm360, dpi);
  }

  spawnTarget(_spec: TargetSpec): TargetHandle {
    // Phase 2 places a single static target. spec.kind (moving/grid) is honored in
    // Phase 3 once TargetSpec carries placement/motion fields.
    const id = `t${this.nextId++}`;
    const target = new Target(id, placeStatic(this.rng));
    this.targets.set(id, target);
    this.scene.add(target.mesh);
    return target;
  }

  clearTargets(): void {
    for (const target of this.targets.values()) {
      this.scene.remove(target.mesh);
      target.dispose();
    }
    this.targets.clear();
  }

  onAim(cb: AimCallback): () => void {
    this.aimCbs.add(cb);
    return () => {
      this.aimCbs.delete(cb);
    };
  }

  /** Re-read the size function and update camera aspect + renderer (call on window resize). */
  resize(): void {
    const [w, h] = this.sizeFn();
    this.rig.camera.aspect = w / h;
    this.rig.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  /** Render one frame (call from the host's RAF loop). */
  render(): void {
    this.renderer.render(this.scene, this.rig.camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubInput();
    this.clearTargets();
    this.renderer.dispose();
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/engine/arena.test.ts`
Expected: PASS (all 5).

- [ ] **Step 5: Run the full suite + commit**

Run: `npm test`
Expected: all suites green (Phase 1 suites + three-smoke, dpi, accel-check, pointer-lock, camera-rig, targets, arena).

```bash
git add src/engine/arena.ts tests/engine/arena.test.ts
git commit -m "feat(engine): arena ArenaScene over injected renderer + input source" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Runnable dev harness (`src/dev/arena-harness.ts` + `main.ts` hook)

> Wires the **real** `WebGLRenderer` + pointer-lock controller + RAF loop behind `#arena`, so the deliverable is mouse-lookable now. The harness merges pointer samples with a synthetic feed exposed on `window.__arenaDebug` (used by Task 9 to verify cm/360 fidelity in the real bundle without needing a user gesture). It includes a crosshair, a HUD (cm/360, deg/count, lock state, granted mode, live view), and a keyboard-driven accel check (keys 1–4). This is a **temporary dev artifact**; Phase 5's shell replaces this routing.

**Files:**
- Create: `src/dev/arena-harness.ts`
- Modify: `src/main.ts`
- Test: none new (covered by Task 9 runtime verification)

- [ ] **Step 1: Implement `src/dev/arena-harness.ts`**

```ts
import { WebGLRenderer } from 'three';
import { Arena } from '../engine/arena';
import type { InputSource } from '../engine/arena';
import { degreesPerCount } from '../engine/camera-rig';
import { createPointerLock } from '../input/pointer-lock';
import { AccelMeter, accelVerdict } from '../input/accel-check';
import { mulberry32 } from '../stats/bootstrap';
import type { AimSample, PointerLockMode } from '../types';

const CM360 = 34;
const DPI = 800;

interface ArenaDebug {
  feed(dx: number, dy: number): [number, number];
  degPerCount(): number;
  view(): [number, number];
  mode(): PointerLockMode | null;
  cleanup(): void;
}
declare global {
  interface Window {
    __arenaDebug?: ArenaDebug;
  }
}

/** Mount the dev arena harness into `root`. Returns nothing; cleanup via window.__arenaDebug. */
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

  // Composite input: pointer samples + a synthetic feed for runtime verification.
  const manual = new Set<(s: AimSample) => void>();
  const input: InputSource = {
    onSample(cb) {
      const off = pointer.onSample(cb);
      manual.add(cb);
      return () => {
        off();
        manual.delete(cb);
      };
    },
  };
  const pushSynthetic = (s: AimSample): void => {
    for (const cb of manual) cb(s);
  };

  const arena = new Arena({ renderer, input, size, cm360: CM360, dpi: DPI, rng: mulberry32(7) });
  arena.spawnTarget({ kind: 'static' });
  arena.spawnTarget({ kind: 'static' });
  arena.spawnTarget({ kind: 'static' });

  let view: [number, number] = [0, 0];
  arena.onAim((_s, v) => {
    view = v;
  });

  // Accel check: keys 1/2 capture the slow swipe total, 3/4 the fast swipe total.
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
      `lock ${pointer.isLocked() ? 'on' : 'off'}   mode ${pointer.mode() ?? '-'}\n` +
      `view  yaw ${view[0].toFixed(1)}°  pitch ${view[1].toFixed(1)}°\n` +
      `accel slow ${slow.toFixed(0)} / fast ${fast.toFixed(0)}` +
      (verdict ? `  → ${verdict.accelerated ? 'BLOCK (accel on)' : 'OK (accel off)'}` : '') +
      `\nclick to lock · [1]start [2]stop slow · [3]start [4]stop fast`;
  };

  canvas.addEventListener('click', () => {
    void pointer.request().then(refreshHud);
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
  const loop = (): void => {
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
    cleanup() {
      window.cancelAnimationFrame(raf);
      offMeter();
      pointer.dispose();
      arena.dispose();
      delete window.__arenaDebug;
    },
  };
}
```

- [ ] **Step 2: Update `src/main.ts`** to route `#arena` to the harness (dynamic import keeps Three.js out of the default bundle)

```ts
import './styles/tokens.css';
import './styles/base.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app element missing');

function renderPlaceholder(root: HTMLDivElement): void {
  root.innerHTML = `
    <main style="margin:auto;text-align:center">
      <p style="font-family:var(--font-display);font-style:italic;color:var(--slate-2)">aim sensitivity tool</p>
      <h1 style="font-family:var(--font-display);font-size:5rem;line-height:.9">campe<span style="color:var(--ink)">ó</span>n</h1>
      <p style="font-family:var(--font-mono);color:var(--slate-2);margin-top:1rem">
        dev: <a href="#arena" style="color:var(--gold)">#arena</a> - input + engine harness
      </p>
    </main>`;
}

async function route(root: HTMLDivElement): Promise<void> {
  if (window.location.hash === '#arena') {
    const { mountArenaHarness } = await import('./dev/arena-harness');
    mountArenaHarness(root);
  } else {
    root.style.cssText = '';
    renderPlaceholder(root);
  }
}

window.addEventListener('hashchange', () => {
  void route(app);
});
void route(app);
```

- [ ] **Step 3: Type-check + build**

Run: `npm run build`
Expected: `tsc --noEmit` clean (the harness + `declare global` type-check), `vite build` succeeds, and the build output shows the arena chunk **code-split** (a separate `arena-harness-*.js`), confirming Three.js is not in the entry chunk.

- [ ] **Step 4: Commit**

```bash
git add src/dev/arena-harness.ts src/main.ts
git commit -m "feat(engine): runnable #arena dev harness (pointer-lock + WebGL + accel check)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Runtime verification in Chromium

> The integration gate for the browser-only code (WebGL, Pointer Lock API, event wiring). Uses the Playwright MCP against the live dev server. This task may be executed by the controller rather than a subagent. It produces evidence the arena renders, has no console errors, and reproduces cm/360 fidelity end-to-end in the real bundle.

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server (background)**

Run: `npm run dev` (background; note the URL, default `http://localhost:5173`).

- [ ] **Step 2: Load the arena harness**

- `mcp__playwright__browser_navigate` → `http://localhost:5173/#arena`
- `mcp__playwright__browser_wait_for` → wait for the `<canvas>` to be present.

- [ ] **Step 3: Visual proof**

- `mcp__playwright__browser_take_screenshot`
- Expected: a dark (`#0D0D0D`) scene with a subtle slate grid floor, **three gold sphere targets** in the forward arc, a gold center crosshair, and the HUD top-left showing `cm/360 34   dpi 800   deg/count 0.0336`.

- [ ] **Step 4: No console errors**

- `mcp__playwright__browser_console_messages`
- Expected: no `error`-level messages (WebGL context created; no module/runtime errors).

- [ ] **Step 5: cm/360 fidelity in the real bundle**

- `mcp__playwright__browser_evaluate` with:
```js
() => {
  const d = window.__arenaDebug;
  const dpc = d.degPerCount();
  const before = d.view()[0];
  const after = d.feed(90 / dpc, 0)[0]; // synthetic +90° yaw worth of counts
  return { dpc, before, after, deltaYaw: after - before };
}
```
- Expected: `dpc ≈ 0.03362`, `deltaYaw ≈ 90` (within ±0.5°) - proving counts→degrees→view matches `914.4/(cm360·dpi)` through the live render path.
- Also evaluate `() => !!document.querySelector('canvas').getContext('webgl2') || !!document.querySelector('canvas').getContext('webgl')` → expect `true`.

- [ ] **Step 6: Clean up**

- `mcp__playwright__browser_evaluate` → `() => window.__arenaDebug.cleanup()`
- `mcp__playwright__browser_close`
- Stop the dev server.

- [ ] **Step 7: Record manual-verification notes** (for the human, in the PR/summary, not a code change)

Note for a real Chromium session (manual): click to lock → cursor hides, mouse-look turns the view (right = +yaw, up = +pitch), HUD `mode` reads `raw` in Chrome/Edge; in Firefox/Safari it reads `os-adjusted` and the app still runs (graceful degradation per spec §6.2). The accel check: swipe the same physical distance slow (keys 1→2) then fast (keys 3→4); with OS accel off the verdict reads **OK**, with accel on it reads **BLOCK**.

---

## Phase 2 self-review

- **Spec coverage (§6 input-validity):** user-entered DPI + validation (§6.1, Task 2); `unadjustedMovement` raw lock with graceful fallback + raw/os-adjusted detection (§6.2, Task 4 + Task 9); accel gate (§6.3, Task 3 + harness + Task 9); DPR normalization (§6.4, Task 2, used in Task 4); coalesced high-refresh capture (§6.5, Task 4); immediate cm/360 conversion via DPI + internal yaw (§6.6 / §3, Task 5 `degreesPerCount`). **Spec coverage (§5 engine / §8 architecture):** Three.js arena + camera + internal-yaw→cm/360 + target spawning + tick/render loop (Task 5–8); pure-vs-shell module boundary so validity is *proven* (Tasks 2–7 unit-tested, Task 9 integration). **Quality bar (§1.1):** clean dark high-contrast arena, 60fps RAF loop, per-sample capture (no lost counts), code-split Three.js, injected-renderer testability.
- **No placeholders:** every code step shows complete code; every run step shows the command + expected result; Task 9 lists exact MCP calls + expected values.
- **Type consistency:** `AimSample`, `PointerLockMode`, `ArenaScene`, `TargetSpec`, `TargetHandle`, `Cm360`, `Dpi`, `Degrees` all come from `src/types.ts`. `Arena implements ArenaScene` with matching signatures (`setSensitivity`, `spawnTarget`, `onAim`, `clearTargets`). `Target implements TargetHandle` (`id`, `bearing()`, `radiusDeg()`). `degreesPerCount` reuses `TURN_CM` from `convert/cm360.ts`; `placeStatic` + tests reuse `mulberry32` from `stats/bootstrap.ts`. `normalizeByDpr` is defined in Task 2 and imported by Task 4 under the same name.
- **Deliverable:** `npm test` green (Phase 1 + 7 new suites); `npm run dev` → `/#arena` is a pointer-lockable arena at 34 cm/360 with raw/os-adjusted detection, DPR-normalized deltas, and a working accel gate; Task 9 captures runtime evidence.
- **Deferred, on purpose:** `moving`/`grid` target dynamics (Phase 3, when `TargetSpec` extends); the PSX arena skin and falcon motion (later tracks); FOV-aware conversion (options). `noUncheckedIndexedAccess` remains deferred to pre-Phase-3/4 matrix code per the Phase 1 review note.
</content>
</invoke>
