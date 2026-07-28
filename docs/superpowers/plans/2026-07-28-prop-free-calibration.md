# Prop-free calibration: implementation plan

Spec: `docs/superpowers/specs/2026-07-25-prop-free-calibration-design.md`.

This removes the wallet card from calibration and, with it, the entire physical unit chain. campeon
stops measuring mouse DPI, because DPI cancels out of every number it reports. The unit becomes counts
per 360, the headline output becomes a ratio that assumes nothing, and the result screen is ordered by
how much each claim costs in assumptions.

## How to execute this

Every task is self-contained. Work one task at a time, in the sequence below, and do not start the next
until the current one ends green. Each task is test-first: the step-one test must FAIL for the stated
reason before you write the implementation. If it passes, stop and find out why, because a test that
does not fail first is not testing what you think.

One task deserves warning: its red step is a `tsc` error rather than a failing test. Vitest passes
happily, which is exactly how the defect it fixes survived a full review pass unnoticed.

`npm test` is 826 passing at HEAD. `npm run build` runs `tsc --noEmit` first, so type errors fail the
build.

## Sequence

Task numbers are grouped by area, not by execution order. The order is:

1. **Phase 1a, tasks 1 to 5.** The branded unit, the engine, the raw pointer channel, the deletions.
   Nothing else can start until `Counts360` exists and `Cm360` and `Dpi` are gone.
2. **Phase 3, tasks 23 to 27.** The lattice estimator and the count convention, since phase 2 places
   the typed-sensitivity offer that phase 3 authors.
3. **Phase 2, tasks 15 to 20.** The turn, the calibration flow, and the deletions of the sweep and spin.
4. **Phase 1b, tasks 9 to 13.** The payoff screen, the plot, the case study.
5. **Phase 4, tasks 29 to 35 and 37.** The segmenter, the observational channel, the flick anchor, the
   reconciliation, the clock-offset invariance test.
6. **Integration, tasks 36 and 38 to 41.** The seam, and the end-to-end test that renders tier one.
7. **Phase 1a, task 6.** The invariance test, last, because it has to run through the shipped path
   rather than a local re-implementation of the ratio, and that path does not exist until task 40.

Task numbering has gaps at 7, 8, 14, 21, 22 and 28. Each author was given a numbering budget and
several used fewer tasks than allocated. The gaps are deliberate and nothing is missing.

Task 41 is the one that proves the change. Nothing here is done until it passes.

## How this plan was written and checked

Five authors in parallel against a locked contract of canonical signatures and a file-ownership
partition, then two adversarial reviewers, then a repair round, then two more reviewers, then a final
repair. The reviewers found 41 defects in the first pass, 12 of them blocking, and 18 in the second.
The worst was structural: across 22 tasks written by four authors, nothing wired the anchor into the
result, so tier one never rendered. Four owners had each documented the seam as a hand-off to the
others. Whatever else this plan is, that gap is closed by authored tasks and proved by a test.

---


### Task 1: The branded unit

**Files:**
- Modify: `src/types.ts:1-14`
- Test: `tests/types.test.ts`

Counts per 360 becomes the tool's own unit. This task only ADDS the brand and its constructors, so
the repo stays green: nothing consumes `Counts360` until task 4, which flips the meaning of every
field in one commit. Splitting it any other way would leave a commit whose type says counts while the
value is centimetres, which is the exact silent unit swap the brand exists to prevent.

- [ ] **Step 1: Write the failing test**

Replace the whole of `tests/types.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { counts360, countsBounds } from '../src/types';
import type { Cm360, Counts360, GameId, TrialResult, YawEntry } from '../src/types';

describe('types', () => {
  it('contract objects are constructible', () => {
    const cm: Cm360 = 34;
    const game: GameId = 'valorant';
    const yaw: YawEntry = { id: game, label: 'Valorant', yaw: 0.07 };
    const trial: TrialResult = { instrument: 'track', cm360: cm, score: 0.8, raw: { eLead: 1.2 }, at: 0 };
    expect(yaw.yaw).toBe(0.07);
    expect(trial.instrument).toBe('track');
  });
});

describe('Counts360, the branded unit', () => {
  it('brands without touching the number', () => {
    expect(counts360(8240)).toBe(8240);
    expect(countsBounds(4800, 19200)).toEqual([4800, 19200]);
  });

  it('refuses a bare number where a count total is required', () => {
    // The defect the brand exists to catch. While the unit was `type Cm360 = number` the compiler
    // had no way to tell 34 (centimetres) from 8240 (counts), so a migration that changed the
    // MEANING of the parameter would have compiled everywhere and reported wrong numbers silently.
    // This directive is the assertion: if the brand is ever weakened back to a bare alias, tsc
    // reports TS2578 for an unused @ts-expect-error and `npm run build` fails.
    // @ts-expect-error a bare number is not a count total
    const bare: Counts360 = 8240;
    expect(bare).toBe(8240);
  });

  it('widens back to number under arithmetic, so a derived total must be re-branded on purpose', () => {
    const lo = counts360(4800);
    const doubled: number = lo * 2; // arithmetic on a branded number yields a plain number
    expect(doubled).toBe(9600);
    expect(counts360(doubled)).toBe(9600);
  });
});
```

The first block is the pre-existing contract test, kept verbatim so this task adds coverage without
losing any. Task 4 step 13 rewrites it onto `counts`, because that is the commit where `Cm360` and
`TrialResult.cm360` stop existing.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/types.test.ts`
Expected: FAIL, `Tests  2 failed | 2 passed (4)`, with `TypeError: counts360 is not a function`.

Verified in this repo on vitest 2.1.9: a missing NAMED export from a module that does exist is not a
`SyntaxError`. Vite resolves the module, the binding is `undefined`, and the failure surfaces at the
first call. The two type-only cases pass at runtime, which is why the type gate below is the real one.

Then run: `npx tsc --noEmit`
Expected: FAIL with exactly

```
tests/types.test.ts(2,10): error TS2305: Module '"../src/types"' has no exported member 'counts360'.
tests/types.test.ts(2,21): error TS2305: Module '"../src/types"' has no exported member 'countsBounds'.
tests/types.test.ts(3,15): error TS2305: Module '"../src/types"' has no exported member 'Counts360'.
```

- [ ] **Step 3: Write the minimal implementation**

In `src/types.ts`, replace the units block at lines 1 to 14 with:

```ts
// ── units & identifiers ────────────────────────────────────────────────
/** Mouse counts of travel for one full 360 turn. The optimisation variable and the tool's own unit.
 *  Branded deliberately: a bare number alias gives the compiler no way to catch a unit swap, and
 *  this migration is exactly a unit swap, so the brand is what makes tsc enumerate every call site.
 *  Pinned by tests/types.test.ts "refuses a bare number where a count total is required". */
export type Counts360 = number & { readonly __unit: 'counts360' };
export const counts360 = (n: number): Counts360 => n as Counts360;
/** A search window in counts. Exists because arithmetic on a branded number widens back to `number`,
 *  so every clamp, exp and geometric midpoint has to re-brand, and a pair of them is the shape that
 *  recurs (bounds, CIs, adopted ranges). */
export const countsBounds = (lo: number, hi: number): [Counts360, Counts360] =>
  [counts360(lo), counts360(hi)];
export type Cm360 = number;          // physical cm of mouse travel per 360° turn (the optimization variable)
export type Dpi = number;            // mouse counts per inch (user-supplied; not browser-readable)
export type Degrees = number;
export type Ms = number;
export type GameId =
  | 'valorant' | 'cs2' | 'apex' | 'ow2' | 'cod' | 'fortnite' | 'r6' | 'pubg';

// ── conversion (convert/) ──────────────────────────────────────────────
export interface YawEntry { id: GameId; label: string; yaw: number; note?: string; }

// ── raw input (input/) ─────────────────────────────────────────────────
export interface AimSample { t: Ms; dx: number; dy: number; }   // normalized-count deltas (÷ devicePixelRatio)
export type PointerLockMode = 'raw' | 'os-adjusted';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/types.test.ts && npx tsc --noEmit`
Expected: PASS, 4 tests, and tsc silent.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts tests/types.test.ts
git commit -m "feat(types): brand Counts360 before the unit swap

A bare \`type Cm360 = number\` would let the counts migration change the meaning of every
parameter while still compiling. The brand forces tsc to enumerate the call sites instead."
```

---

### Task 2: `src/convert/counts.ts`, the whole conversion layer

**Files:**
- Create: `src/convert/counts.ts`
- Test: `tests/convert/counts.test.ts`

Additive: nothing imports it yet, so the repo stays green. `sensRatio` is an addition to the
canonical four (see the hand-offs section): tier one is a quotient of two count measurements and the
exactness of that cancellation is the thesis of the whole design, so it gets one implementation and
one test rather than being open-coded in `optimizer/result.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/convert/counts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { degreesPerCount, sensFor, countsForSens, crossGame, sensRatio } from '../../src/convert/counts';
import { counts360 } from '../../src/types';

// The physical settings these expectations came from, kept only as a cross-check against the
// retired cm form: 34 cm/360 at 800 DPI is 34 * 800 / 2.54 = 10708.66 counts per 360, and CS2 at
// sens 1 is 51.95 cm/360 at 800 DPI, which is 16362 counts. Every assertion below is stated in
// counts; the centimetre numbers appear in comments only, because the tool no longer has a ruler.
const CM34_AT_800 = counts360((34 * 800) / 2.54);

describe('degreesPerCount', () => {
  it('puts one full 360 at exactly the given count total', () => {
    expect(degreesPerCount(counts360(9450)) * 9450).toBeCloseTo(360, 9);
    expect(degreesPerCount(counts360(8240))).toBeCloseTo(360 / 8240, 12);
  });

  it('agrees with the retired cm form at the same physical setting, which is the proof DPI cancels', () => {
    // Retired: TURN_CM / (cm360 * dpi) = 914.4 / (34 * 800) = 0.0336176.
    expect(degreesPerCount(CM34_AT_800)).toBeCloseTo(914.4 / (34 * 800), 12);
  });

  it('refuses a non-positive or non-finite count total instead of emitting Infinity', () => {
    expect(() => degreesPerCount(counts360(0))).toThrow(RangeError);
    expect(() => degreesPerCount(counts360(-1))).toThrow(/finite and positive/);
    expect(() => degreesPerCount(counts360(Number.NaN))).toThrow(/finite and positive/);
    expect(() => degreesPerCount(counts360(Number.POSITIVE_INFINITY))).toThrow(/finite and positive/);
  });
});

describe('sensFor and countsForSens', () => {
  it('emits the same native sensitivities the cm form did, with no DPI in the call', () => {
    expect(sensFor(CM34_AT_800, 0.07)).toBeCloseTo(0.480, 3);     // Valorant, exactly 0.4802521
    expect(sensFor(CM34_AT_800, 0.022)).toBeCloseTo(1.528, 3);    // CS2 and Apex, exactly 1.5280749
    expect(sensFor(CM34_AT_800, 0.0066)).toBeCloseTo(5.0936, 3);  // OW2 and CoD, exactly 5.0935829
  });

  it('countsForSens is exact, not estimated: it is the game definition inverted', () => {
    expect(countsForSens(1, 0.022)).toBeCloseTo(360 / 0.022, 9);
    expect(countsForSens(1, 0.022)).toBeCloseTo(16363.6, 1); // = 51.95 cm at 800 DPI
  });

  it('round-trips against sensFor at every yaw in the table range', () => {
    for (const yaw of [0.002222, 0.005555, 0.0066, 0.022, 0.07]) {
      const counts = countsForSens(1.7, yaw);
      expect(sensFor(counts, yaw)).toBeCloseTo(1.7, 9);
    }
  });

  it('refuses rather than dividing by zero', () => {
    expect(() => sensFor(counts360(0), 0.022)).toThrow(/finite and positive/);
    expect(() => sensFor(counts360(8240), 0)).toThrow(/finite and positive/);
    expect(() => countsForSens(0, 0.022)).toThrow(/finite and positive/);
    expect(() => countsForSens(1, Number.NaN)).toThrow(/finite and positive/);
  });
});

describe('crossGame', () => {
  it('is a ratio of yaw constants, so the count convention cancels out of it', () => {
    expect(crossGame(1, 0.022, 0.07)).toBeCloseTo(0.022 / 0.07, 12);
    expect(crossGame(1, 0.022, 0.07)).toBeCloseTo(0.314, 3);
    expect(crossGame(2.5, 0.0066, 0.0066)).toBeCloseTo(2.5, 12);
  });

  it('refuses a non-positive yaw on either side', () => {
    expect(() => crossGame(1, 0, 0.07)).toThrow(/finite and positive/);
    expect(() => crossGame(1, 0.022, 0)).toThrow(/finite and positive/);
  });
});

describe('sensRatio, the tier-one number', () => {
  it('is the anchor over the optimum, because sensitivity runs inverse to counts per 360', () => {
    // A player whose hands believe 9000 counts, measured best at 8240, needs a HIGHER in-game
    // sensitivity, so the multiplier is above 1.
    expect(sensRatio(counts360(9000), counts360(8240))).toBeCloseTo(9000 / 8240, 12);
    expect(sensRatio(counts360(8240), counts360(9000))).toBeLessThan(1);
    expect(sensRatio(counts360(8240), counts360(8240))).toBe(1);
  });

  it('refuses rather than returning a plausible multiplier when either side is not a count total', () => {
    expect(() => sensRatio(counts360(0), counts360(8240))).toThrow(/finite and positive/);
    expect(() => sensRatio(counts360(8240), counts360(Number.NaN))).toThrow(/finite and positive/);
  });
});
```

The 0.0066 expectation is 5.0936, not 5.091. `360 / (0.0066 * 10708.661417322835)` is 5.093582887700535,
and `toBeCloseTo(_, 3)` allows 0.0005, so 5.091 fails by 0.0026. Arithmetic checked for all three
yaw values before writing them down.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/convert/counts.test.ts`
Expected: FAIL, `tests/convert/counts.test.ts (0 test)`, with

```
Error: Failed to load url ../../src/convert/counts (resolved id: ../../src/convert/counts) in /Users/chrisfiore/Documents/Claude/Projects/campeon/tests/convert/counts.test.ts. Does the file exist?
```

and the summary line `Test Files  1 failed (1)`. The resolved id echoes the RELATIVE specifier, not
an absolute path; only the trailing file path is absolute.

- [ ] **Step 3: Write the minimal implementation**

Create `src/convert/counts.ts`:

```ts
// Counts per 360 is the tool's own unit, so nothing here takes a DPI, a centimetre, or the 2.54 that
// used to sit in convert/cm360.ts. DPI cancels out of every number the tool reports: sens is
// 914.4 / (dpi * yaw * cm360) and cm360 is counts * 2.54 / dpi, so sens is 360 / (yaw * counts) and
// the DPI is gone. It survived only in a printed label, which is why the card was deleted rather
// than replaced. Verified numerically as well as algebraically, in tests/convert/counts.test.ts
// "agrees with the retired cm form at the same physical setting".
import { counts360 } from '../types';
import type { Counts360, Degrees } from '../types';

/** Every entry point guards the same way: an invalid gain must fail loudly at the validity core
 *  rather than propagate Infinity or NaN into the view rotation, a search bound, or an emitted
 *  sensitivity. Callers never see a plausible wrong number from this module. */
function positive(name: string, ...values: readonly number[]): void {
  for (const v of values) {
    if (!Number.isFinite(v) || !(v > 0)) {
      throw new RangeError(`${name}: arguments must be finite and positive (got ${values.join(', ')})`);
    }
  }
}

/** Degrees of view rotation per mouse count, so one full 360 spans exactly `counts` counts. */
export function degreesPerCount(counts: Counts360): Degrees {
  positive('degreesPerCount', counts);
  return 360 / counts;
}

/** In-game sensitivity that puts one 360 at `counts`, for a game whose yaw is `yaw` degrees per
 *  count at sens 1. The DPI-free form of the retired `914.4 / (dpi * yaw * cm360)`.
 *
 *  A warning for callers, which is the whole reason tier two is gated: `counts` here must be TRUE
 *  hardware counts. Handing it the browser's own movement deltas emits a sensitivity that is wrong
 *  by the unmeasured convention factor k, and wrong silently, because the number looks ordinary. */
export function sensFor(counts: Counts360, yaw: number): number {
  positive('sensFor', counts, yaw);
  return 360 / (yaw * counts);
}

/** True counts per 360 for a player who names their game and their current in-game sensitivity.
 *  Exact rather than estimated: it is the game's own definition inverted, which is why the typed
 *  route is a first-class offer and not a fallback. */
export function countsForSens(sens: number, yaw: number): Counts360 {
  positive('countsForSens', sens, yaw);
  return counts360(360 / (yaw * sens));
}

/** Same 360 distance, different game. A ratio of yaw constants, so the count total, the count
 *  convention and any unit cancel exactly. */
export function crossGame(sens: number, yawFrom: number, yawTo: number): number {
  positive('crossGame', sens, yawFrom, yawTo);
  return (sens * yawFrom) / yawTo;
}

/** The tier-one number: what to multiply the player's current in-game sensitivity by.
 *
 *  Sensitivity runs inverse to counts per 360, so the multiplier is anchor / optimum. Both sides are
 *  counts measured by the same arena, so the browser's count convention k, the game yaw and the unit
 *  itself cancel exactly, which is the one claim on the result screen that assumes nothing. Named
 *  here so the quotient has one home and one guard: `positive` refuses a zero or a NaN on either
 *  side rather than handing a screen an Infinity as a multiply factor. The cancellation itself is
 *  pinned through the shipped composition rather than through this function, by
 *  tests/convert/counts-invariance.test.ts, because a test that does its own division would pin the
 *  formula and not the pipeline. */
export function sensRatio(anchor: Counts360, optimum: Counts360): number {
  positive('sensRatio', anchor, optimum);
  return anchor / optimum;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/convert/counts.test.ts && npx tsc --noEmit`
Expected: PASS, 11 tests (3 + 4 + 2 + 2), tsc silent.

- [ ] **Step 5: Commit**

```bash
git add src/convert/counts.ts tests/convert/counts.test.ts
git commit -m "feat(convert): counts per 360 conversion, with no DPI in any signature"
```

---

### Task 3: Raw deltas out of pointer lock, and the devicePixelRatio division deleted

**Files:**
- Modify: `src/input/pointer-lock.ts:1-21,53-138`
- Modify: `src/types.ts:13` (the `AimSample` comment, which currently documents the division)
- Test: `tests/input/pointer-lock.test.ts`

**The defect this task fixes.** `src/input/dpi.ts` says, in `normalizeByDpr`: "Chrome reports
`movementX` in device px (no DPR scaling); Firefox reports CSS px. Dividing by DPR makes the two
agree." It cannot. If two streams differ by a factor of DPR, dividing BOTH of them by DPR leaves them
still differing by DPR. What it actually did was make the device-pixel browser correct and leave the
CSS-pixel browser wrong by DPR. The division also destroys the integer lattice the count-convention
probe reads: on a DPR 2 display every delta arrived halved, so a genuine spacing of one count read as
0.5 and a one-sided estimator would report a scaled stream where there was none. Nothing downstream
needs a pixel unit, because the arena is self-consistent in whatever counts the browser hands it and
the reported ratio is a quotient of two count measurements.

- [ ] **Step 1: Write the failing test**

Replace the whole of `tests/input/pointer-lock.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { flattenCoalesced, rawDeltasFrom } from '../../src/input/pointer-lock';

describe('flattenCoalesced', () => {
  it('carries movementX and movementY through unchanged and keeps per-event timestamps', () => {
    // The defect pinned here: this used to divide by devicePixelRatio on the stated reasoning that
    // Chrome reports device pixels and Firefox CSS pixels, so dividing by DPR "makes the two agree".
    // Dividing two streams that differ by a factor by that same factor cannot reconcile them; it
    // made one correct and left the other wrong by DPR. The samples are now exactly what the browser
    // reported, which is also what keeps the integer lattice readable for the convention probe.
    const events = [
      { movementX: 10, movementY: -4, timeStamp: 100 },
      { movementX: 6, movementY: 0, timeStamp: 101 },
    ];
    expect(flattenCoalesced(events, 0)).toEqual([
      { t: 100, dx: 10, dy: -4 },
      { t: 101, dx: 6, dy: 0 },
    ]);
  });

  it('falls back to the supplied time when an event has no timeStamp', () => {
    expect(flattenCoalesced([{ movementX: 4, movementY: 4 }], 250)).toEqual([{ t: 250, dx: 4, dy: 4 }]);
  });

  it('returns an empty array for no events', () => {
    expect(flattenCoalesced([], 0)).toEqual([]);
  });

  it('has no devicePixelRatio parameter left to pass', () => {
    // @ts-expect-error the dpr parameter is gone; a caller that still passes one is a live bug
    flattenCoalesced([], 1, 0);
  });
});

describe('rawDeltasFrom', () => {
  it('exposes the untouched horizontal deltas, in event order', () => {
    const events = [
      { movementX: 3, movementY: 1, timeStamp: 1 },
      { movementX: -4, movementY: 0, timeStamp: 2 },
      { movementX: 0, movementY: 9, timeStamp: 3 },
    ];
    expect(rawDeltasFrom(events)).toEqual([3, -4, 0]);
  });

  it('keeps a non-integer delta rather than rounding it, because the non-integer IS the finding', () => {
    // A stream whose spacing is not 1 is how the convention probe detects a scaled delta stream.
    // Rounding here would erase the only evidence that exists, and would do it silently.
    expect(rawDeltasFrom([{ movementX: 1.5, movementY: 0 }])).toEqual([1.5]);
  });

  it('returns an empty array for no events', () => {
    expect(rawDeltasFrom([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/input/pointer-lock.test.ts`
Expected: FAIL, `Tests  5 failed | 2 passed (7)`, with `TypeError: rawDeltasFrom is not a function`
on the three `rawDeltasFrom` cases and, on the first two `flattenCoalesced` cases, an
`AssertionError` whose received samples carry the DPR-divided values (`flattenCoalesced(events, 0)`
reads 0 as the dpr under the old three-parameter signature, and `normalizeByDpr` treats a
non-positive ratio as 1, so `t` comes out `undefined` for the second case). A missing named export
from an existing module is `undefined` here, not a `SyntaxError`: verified on vitest 2.1.9.

Then run: `npx tsc --noEmit`
Expected: FAIL with `tests/input/pointer-lock.test.ts(33,5): error TS2578: Unused '@ts-expect-error'
directive.` (the three-argument call still type-checks against the old signature) plus TS2305 for
`rawDeltasFrom`.

- [ ] **Step 3: Write the minimal implementation**

In `src/input/pointer-lock.ts`, replace lines 1 to 21 with:

```ts
import type { AimSample, Ms, PointerLockMode } from '../types';

interface MovementLike {
  movementX: number;
  movementY: number;
  timeStamp?: number;
}

/**
 * Flatten coalesced pointer events into AimSamples, carrying `movementX`/`movementY` through
 * UNCHANGED (pure).
 *
 * It used to divide both axes by `devicePixelRatio`, on the reasoning recorded in the deleted
 * input/dpi.ts: Chrome reports device pixels, Firefox reports CSS pixels, and dividing by DPR makes
 * them agree. Dividing two streams that differ by a factor by that same factor cannot reconcile
 * them, so what it actually did was make one browser correct and leave the other wrong by DPR. It
 * also halved every delta on a DPR 2 display, which destroys the integer lattice the count
 * convention probe reads. Pinned by tests/input/pointer-lock.test.ts "carries movementX and
 * movementY through unchanged".
 */
export function flattenCoalesced(
  events: readonly MovementLike[],
  fallbackTime: Ms,
): AimSample[] {
  return events.map((e) => ({
    t: e.timeStamp ?? fallbackTime,
    dx: e.movementX,
    dy: e.movementY,
  }));
}

/**
 * The horizontal deltas exactly as the browser reported them, in event order.
 *
 * Separate from `flattenCoalesced` because the consumer is different in kind: the count convention
 * probe needs a flat number stream to read a lattice spacing off, not timestamped samples, and it
 * must see any non-integer value the browser produced. Nothing here rounds, clamps or filters: a
 * spacing other than 1 is the only evidence that the deltas were scaled, so smoothing it away would
 * make the probe confidently wrong instead of honestly indeterminate.
 */
export function rawDeltasFrom(events: readonly MovementLike[]): number[] {
  return events.map((e) => e.movementX);
}
```

The `import { normalizeByDpr } from './dpi';` at line 2 goes with them. That import is the last
source-side consumer of `src/input/dpi.ts`, which is why task 5 can delete the file.

- [ ] **Step 4: Add the raw channel to the controller**

In `src/input/pointer-lock.ts`, add to the `PointerLockController` interface, directly after the
`onSample` member:

```ts
  /** Subscribe to the browser's UNTOUCHED per-event deltas while locked, for the count convention
   *  probe. Parallel to `onSample` rather than derived from it, so a future change to sampling
   *  (filtering, resampling) cannot silently reshape the lattice the probe reads. */
  onRawDelta(cb: (dx: number, dy: number) => void): () => void;
```

In `createPointerLock`, add the callback set next to `fireCbs`:

```ts
  const rawCbs = new Set<(dx: number, dy: number) => void>();
```

Replace the body of `onMove` with:

```ts
  const onMove = (ev: Event): void => {
    if (!locked) return;
    const pe = ev as PointerEvent;
    const coalesced =
      typeof pe.getCoalescedEvents === 'function' ? pe.getCoalescedEvents() : [];
    const batch = coalesced.length > 0 ? coalesced : [pe];
    // The raw channel is fed from the SAME batch, before any sample transform, so the two streams
    // can never disagree about how many events arrived (a doubled or dropped event would make the
    // lattice spacing meaningless).
    if (rawCbs.size > 0) {
      for (const e of batch) for (const cb of rawCbs) cb(e.movementX, e.movementY);
    }
    const samples = flattenCoalesced(batch, ev.timeStamp);
    for (const sample of samples) for (const cb of cbs) cb(sample);
  };
```

Add the subscription method to the returned object, directly after `onFire`:

```ts
    onRawDelta(cb): () => void {
      rawCbs.add(cb);
      return () => {
        rawCbs.delete(cb);
      };
    },
```

And add `rawCbs.clear();` to `dispose()`, next to `fireCbs.clear();`.

- [ ] **Step 5: Correct the AimSample comment**

In `src/types.ts`, replace line 13 with:

```ts
export interface AimSample { t: Ms; dx: number; dy: number; }   // browser movement deltas, untouched
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/input/pointer-lock.test.ts && npx tsc --noEmit && npm test`
Expected: PASS, 7 tests in the file, tsc silent, and the full suite at 844 passing: 826 at HEAD,
plus 3 in `tests/types.test.ts` (1 case became 4), plus 11 in the new `tests/convert/counts.test.ts`,
plus 4 here (3 cases became 7). `dpi.ts` still exports `normalizeByDpr` and its own 4-case test still
passes; task 5 deletes both.

- [ ] **Step 7: Commit**

```bash
git add src/input/pointer-lock.ts src/types.ts tests/input/pointer-lock.test.ts
git commit -m "fix(input): stop dividing deltas by devicePixelRatio, and expose the raw stream

dpi.ts claimed the division reconciled Chrome device pixels with Firefox CSS pixels. Dividing
two streams that differ by a factor by that same factor cannot reconcile them: it made one
correct and left the other wrong by DPR. It also halved every delta at DPR 2, which destroys
the integer lattice the count convention probe reads, so the probe gets its own untouched
channel off the same event batch."
```

---

### Task 4: The unit swap, counts per 360 through the engine, the optimizer and the plumbing

**Files:**
- Modify: `src/types.ts` (units, `ArenaScene`, `TrialContext`, `TrialResult`, `SearchEngine`, `Report`, `FacetPeak`, `Session`, `Result`, `PersistedPrefs`)
- Modify: `src/engine/camera-rig.ts:1-52,81-96`, `src/engine/arena.ts:14,77-84,153,232-234`
- Modify: `src/optimizer/session-controller.ts`, `src/optimizer/evolution.ts`, `src/optimizer/bandit.ts`, `src/optimizer/bayesopt.ts`, `src/optimizer/objective.ts:80`, `src/optimizer/breakdown.ts`, `src/optimizer/result.ts`
- Modify: `src/stats/peak-fit.ts:108,137,240`, `src/stats/bootstrap.ts:7,107,138`
- Modify: `src/instruments/track.ts:298,309`, `src/instruments/flick.ts:103,124`, `src/instruments/strike.ts:57,68`, `src/instruments/calibrate.ts:40,60`, `src/instruments/acclimation.ts:33-37,74-85`
- Modify: `src/ui/options/settings.ts`, `src/ui/options/options.ts`, `src/ui/shell.ts:1,12-16,59,72,89`, `src/state/storage.ts:28,40`, `src/ui/arena-stage.ts:20-21,40-48,67,106`, `src/ui/range.ts`, `src/ui/range-nudge.ts`, `src/ui/range-adopt.ts`, `src/convert/schools.ts`, `src/dev/arena-harness.ts:16,103,148,152,205,233-254`
- Modify (rename fallout only, other phases own the content; see step 10 and the hand-offs): `src/ui/session-view.ts`, `src/ui/result.ts`, `src/optimizer/result.ts`, `src/ui/case-study/content.ts`, `src/ui/case-study/case-study.ts`, `src/ui/case-study/chrome.ts`
- Modify (quarantine only, deleted in task 5 or by phase 2): `src/convert/cm360.ts`, `src/convert/turn-rate.ts`, `src/input/dpi.ts`, `src/input/dpi-sweep.ts:1`, `src/ui/calibrate/sweep-view.ts`, `src/ui/calibrate/spin-view.ts:9-12,26-28,59,149`, `src/ui/setup.ts:7-10,53-98,117-232`
- Test: every test file listed in step 13

One commit. A partial unit swap cannot compile, and worse, a commit in which a field named `cm360`
holds counts is the exact defect the brand was introduced to prevent. The steps below are small; the
commit is at the end.

**Sequencing, load bearing.** This task lands strictly BEFORE phase 1b task 9. It is the single
commit in which `Cm360`, `Dpi`, `Session.dpi`, `SessionDraft.dpi` and `Result.perGameSens` all cease
to exist and `Result.prescription?` appears, so phase 1b writes its fixtures against that state, not
against HEAD.

**What this task is allowed to change in a file it does not own.** Amendment A1 licenses the
repo-wide rename anywhere and forbids authoring semantic change outside phase 1a's own files. Three
classes of edit here are rename fallout rather than authorship, and every reach into another phase's
file is limited to them:

1. identifier and type renames the sed performs;
2. deletions forced by the type deletions (a `dpi` argument or field, a `perGameSens` producer or
   consumer) without which the commit does not compile;
3. numeric constants that were denominated in centimetres, because a rename that changes a number's
   unit and not its magnitude is a wrong rename, not an incomplete one; plus the single-string unit
   labels sitting next to those numbers, so no screen is lying at this commit.

Everything else in another phase's file is a hand-off: copy rewrites, formatting helpers, new
parameter shapes, and the whole three-tier result layout.

- [ ] **Step 1: Swap the unit in `src/types.ts`**

Delete `Cm360` and `Dpi` (no compatibility alias: a silent alias defeats the whole reason for
branding), and apply these edits.

Lines 2 to 3, delete both lines. Then:

```ts
// ── arena (engine/) ────────────────────────────────────────────────────
export interface ArenaScene {
  setSensitivity(counts: Counts360): void;
```

```ts
export interface TrialContext {
  counts: Counts360;
  rng: () => number;
  profile: Profile;
  /** The counts per 360 the player arrived at this trial adapted to - normally the previous trial's
   *  value, or the setting they walked in with on the first trial. Consumed ONLY by the unscored
   *  acclimation lead-in (src/instruments/acclimation.ts) to size how much practice the player
   *  gets before scoring starts: adaptation cost grows with |ln(new) - ln(prev)|, so a near
   *  neighbour needs less than a jump across the range. Absent = arrival gain unknown, and the
   *  lead-in then spends its FULL budget (treat an unknown as a far jump, never as a near one).
   *  It never touches scoring, geometry, or the shared rng stream. */
  prevCounts?: Counts360;
}
export interface TrialResult {
  instrument: InstrumentId;
  counts: Counts360;
```

The `dpi: Dpi;` member of `TrialContext` is deleted in the same edit: no instrument reads a DPI any
more, and the arena is self-consistent in whatever counts the browser hands it.

`SearchEngine`: replace every `Cm360` with `Counts360` in `suggest`, `posteriorPeak` and
`posteriorPeakWith` (four signatures, mechanical).

`Report`: `optimalCounts: Counts360;` and `ci90: [Counts360, Counts360];`.

`FacetPeak`: `peakCounts?: Counts360;`, and in its doc comment "The facet's OWN concave-fit peak
(counts per 360)".

`Session`: delete the `dpi: Dpi;` member, leaving `id: string; profile: Profile;`.

`Result`:

- `optimalCounts: Counts360;`, `breakdown.biasZeroCounts: Counts360;`,
  `bounds?: [Counts360, Counts360];`, and in the `curve` doc comment "x = ln(counts/360)".
- **`ci90` becomes OPTIONAL**, with this doc comment:

```ts
  /** The measured 90 percent interval. ABSENT means the value was tuned by feel rather than located,
   *  and a hand-picked value carries no measured interval. Never fabricated, never widened to fill. */
  ci90?: [Counts360, Counts360];
```

  It lands here, in the commit that already rewrites `Result`, because `adoptResult` cannot drop the
  interval while the field is required, and `tuned-value-has-no-measured-ci` is an existing canon
  rule in this repo that the current code violates: the result screen hides the band on a tuned
  value while `adoptResult` carries it into localStorage and the exported JSON, where no screen gate
  can reach it. Two parts each deferred this to the other, which is the same shape of gap that
  produced the wiring hole, so it is decided here rather than handed on. The fallout is four reads
  in `src/ui/result.ts` and is authored in step 10; `Report.ci90` stays REQUIRED, because a Report is
  always a measurement.
- **Delete the `perGameSens: Partial<Record<GameId, number>>;` member outright.** Tier two now lives
  on `Prescription`, behind the pinned-k gate. Keeping the field would reintroduce the implicit k of
  1: it was computed from the arena's own count total, and turning that into a native in-game
  sensitivity is only correct when the factor between the browser's movement deltas and real mouse
  counts is known to be 1, which nothing measures. It is a required field today, so this deletion is
  what forces steps 6, 9, 11 and 13 to remove its producers and consumers in the same commit.
- Add, next to `tuned?`:

```ts
  /** The three-tier prescription: the multiply factor, its interval, the located optimum, and (only
   *  behind a pinned count convention) the per-game table. Optional because a phase-1 build can
   *  finish a session with no anchor at all, and because an anchor interval that spans a ratio of 1
   *  has no factor to report. Absent means the screen renders its honest fallback rather than a
   *  fabricated multiplier. Phase 1b owns the shape and the builder; the field lives here because
   *  the Result is what gets persisted and exported. */
  prescription?: Prescription;
```

and at the top of the file `import type { Prescription } from './optimizer/result';`. This is a
type-only import, so it is erased at build time and the `optimizer/result.ts` to `types.ts` cycle
never exists at runtime. The interface itself is authored in step 6.

`PersistedPrefs`: delete `dpi: Dpi;`, keep the rest, and rewrite the interface comment's parenthetical
from "hardware-measured once (dpi, the seeded search window)" to "measured once (the seeded search
window in counts)". Change `bounds: [Counts360, Counts360];`.

- [ ] **Step 2: Rename the identifiers mechanically**

The compound names were obtained by
`grep -rhoE "[A-Za-z_$][A-Za-z0-9_$]*[Cc][Mm]360[A-Za-z0-9_$]*" --include="*.ts" src tests | sort -u`,
so this list is exhaustive as of HEAD. Order matters: the compounds go first, then the standalone
identifiers, which are matched with word boundaries so they cannot eat a compound.

Three mechanical traps, all three verified by running them on a copy of `src` and `tests` in this
repo. Read them before pasting:

1. **BSD sed does not understand `\b`.** macOS is what this repo runs on, and `sed -e
   's/\bcm360\b/counts/g'` matches NOTHING here and exits 0, so the two standalone renames would
   silently no-op and leave every `cm360` in place while every other expression succeeded. The
   POSIX word boundaries BSD sed does support are `[[:<:]]` and `[[:>:]]`.
2. **Word boundaries eat module specifiers.** With working boundaries, `s/[[:<:]]cm360[[:>:]]/counts/g`
   rewrites `from './cm360'` to `from './counts'`, because `/` and `'` are both non-word characters.
   That silently repoints eight files at the module task 2 created, which resolves and exports
   different names. The specifier is therefore parked behind a placeholder before the identifier
   pass and restored after.
3. **zsh does not word-split an unquoted `$FILES`.** `sed ... $FILES` hands sed one giant filename
   and fails with "File name too long". The list goes through `xargs`.

```bash
cd "$(git rev-parse --show-toplevel)"
grep -rl "[Cc][Mm]360" --include="*.ts" src tests \
  | grep -v -e '^src/convert/cm360.ts$' -e '^src/convert/turn-rate.ts$' \
            -e '^tests/convert/cm360.test.ts$' -e '^tests/convert/turn-rate.test.ts$' \
  > /tmp/campeon-rename-files.txt
wc -l < /tmp/campeon-rename-files.txt        # 75

# 1. park the module specifiers
xargs sed -i '' \
  -e "s#convert/cm360#convert/@CM360MOD@#g" \
  -e "s#'\./cm360'#'./@CM360MOD@'#g" \
  < /tmp/campeon-rename-files.txt

# 2. the rename: compounds first, then the two standalone identifiers
xargs sed -i '' \
  -e 's/monitorDistanceMatchCm360/monitorDistanceMatchCounts/g' \
  -e 's/cm360FromTurnCounts/countsFromTurnCounts/g' \
  -e 's/optimalCm360/optimalCounts/g' \
  -e 's/biasZeroCm360/biasZeroCounts/g' \
  -e 's/gpPeakCm360/gpPeakCounts/g' \
  -e 's/peakCm360/peakCounts/g' \
  -e 's/prevCm360/prevCounts/g' \
  -e 's/adoptedCm360/adoptedCounts/g' \
  -e 's/measuredCm360/measuredCounts/g' \
  -e 's/announceCm360/announceCounts/g' \
  -e 's/nudgeCm360/nudgeCounts/g' \
  -e 's/seedCm360/seedCounts/g' \
  -e 's/sourceCm360/sourceCounts/g' \
  -e 's/setCm360/setCounts/g' \
  -e 's/PROVISIONAL_CM360/PROVISIONAL_COUNTS/g' \
  -e 's/FINE_STEP_CM360/FINE_STEP_COUNTS/g' \
  -e 's/STEP_CM360/STEP_COUNTS/g' \
  -e 's/[[:<:]]Cm360[[:>:]]/Counts360/g' \
  -e 's/[[:<:]]cm360[[:>:]]/counts/g' \
  < /tmp/campeon-rename-files.txt

# 3. restore the module specifiers
xargs sed -i '' \
  -e "s#convert/@CM360MOD@#convert/cm360#g" \
  -e "s#'\./@CM360MOD@'#'./cm360'#g" \
  < /tmp/campeon-rename-files.txt

grep -rn "[Cc][Mm]360" --include="*.ts" src tests
grep -rn "@CM360MOD@" --include="*.ts" src tests   # must print nothing
```

The four excluded files are `convert/cm360.ts`, `convert/turn-rate.ts` and their tests. They are
deleted in task 5 and quarantined in step 11, so renaming their internals would only churn code that
is about to disappear, and it would brand their parameters, which breaks their own passing tests.

The final grep prints exactly this, measured by running the block above. Every line is cleared by a
later step in this task except the four doomed files, which task 5 deletes:

| line | cleared by |
|---|---|
| `src/ui/setup.ts:7` `from '../convert/cm360'` | step 11 (the import goes) |
| `src/ui/options/options.ts:22` `from '../../convert/cm360'` | step 9 (moves to `convert/counts`) |
| `src/engine/camera-rig.ts:3` `TURN_CM from '../convert/cm360'` | step 3 (the import goes) |
| `src/convert/schools.ts:3,31,32` (import, plus `cm360_tgt`/`cm360_src` in the derivation comment) | step 9 |
| `src/dev/arena-harness.ts:16,103,148,152,205,233` (`CM360`, uppercase, which the sed does not match) | step 9 |
| `tests/ui/setup.test.ts:4`, `tests/optimizer/result.test.ts:3`, `tests/convert/yaw-table.test.ts:3` | step 13 and task 5 step 2 |
| `tests/convert/schools.test.ts:26` (the same derivation comment) | step 13 |
| `src/convert/cm360.ts:12,13`; `src/convert/turn-rate.ts:3,4,6,7,8,11,12,13,17`; `tests/convert/cm360.test.ts:2,4`; `tests/convert/turn-rate.test.ts:2,6,7,8,11,12,13,19` | task 5 (deleted) |

Anything else is a compound the list missed: rename it by hand and record it here.

Note two deliberate consequences. `data-result="cm360"` and `data-range="cm360"` become
`data-result="counts"` and `data-range="counts"`, which is correct: they name the quantity, and the
tests that query them were renamed in the same pass. And the property-key blocklists in
`tests/engine/environment.test.ts:130`, `tests/ui/enemy/shadow.test.ts:108`,
`tests/ui/enemy/sparks.test.ts:62`, `tests/ui/enemy/meshes.test.ts:96` and
`tests/ui/viewmodel/revolver-mesh.test.ts:66` now read `'counts'`, which is what keeps the cosmetic
layers provably unable to reach the measurement.

- [ ] **Step 3: The engine, `src/engine/camera-rig.ts`**

Delete the `TURN_CM` import and the local `degreesPerCount`; the engine now has no unit constant in
it at all. Replace lines 2 to 3 with:

```ts
import { MathUtils, PerspectiveCamera } from 'three';
import type { AimSample, Counts360, Degrees } from '../types';
import { degreesPerCount } from '../convert/counts';
```

Delete the whole `degreesPerCount` block (lines 39 to 52 at HEAD) and replace the constructor and
setter with:

```ts
  constructor(counts: Counts360, aspect = 1) {
    this.camera = new PerspectiveCamera(verticalFovFor(aspect), aspect, 0.1, 1000);
    this.camera.rotation.order = 'YXZ';
    this.degPerCount = degreesPerCount(counts);
    this.sync();
  }

  setSensitivity(counts: Counts360): void {
    this.degPerCount = degreesPerCount(counts);
  }
```

The rig no longer re-exports `degreesPerCount`, so update the two importers:
`tests/engine/camera-rig.test.ts` imports it from `../../src/convert/counts` instead, and nothing in
`src/` imported it.

- [ ] **Step 4: The arena, `src/engine/arena.ts`**

Line 14: `import type { AimSample, ArenaScene, Counts360, Degrees, Ms, TargetHandle, TargetSpec } from '../types';`

`ArenaOptions`: replace `counts: Counts360;` and delete the `dpi: Dpi;` line.

Line 153: `this.rig = new CameraRig(opts.counts, w / Math.max(1, h));`

Lines 232 to 234:

```ts
  setSensitivity(counts: Counts360): void {
    this.rig.setSensitivity(counts);
  }
```

In the comment at line 251, "bearing()/radiusDeg()/counts stay byte-identical" is what the sed
produced and it is still the right claim.

- [ ] **Step 5: The instruments**

Phase 4 owns `src/instruments/flick.ts`, `strike.ts`, `recording.ts` and `acclimation.ts` (amendments
A1 and A2, finding 41). Everything below is rename fallout: a dropped second argument and a deleted
`ctx.dpi` read, without which the commit does not compile. No behaviour is redesigned here.

In each of `src/instruments/track.ts:309`, `flick.ts:124`, `strike.ts:68`, `calibrate.ts:60`, the
call becomes `scene.setSensitivity(ctx.counts);`. The `counts: ctx.counts` result fields at
`track.ts:298`, `flick.ts:103`, `strike.ts:57`, `calibrate.ts:40` were already renamed by the sed.

In `src/instruments/acclimation.ts`, `leadSeed` loses the DPI mix, which is the whole edit (line 82
at HEAD):

```ts
/** Deterministic private seed from the trial's identity - independent of the session stream. The
 *  DPI used to be mixed in here as a second identity component. It cannot be: the tool no longer
 *  measures one. It never distinguished two trials of the same session anyway, since it was constant
 *  across all of them, so removing it changes which lead-in geometry each trial draws but not how
 *  much of it: the seed is still a pure function of (count total, instrument). */
function leadSeed(ctx: TrialContext, id: InstrumentId): number {
  let h = 0x9e3779b9;
  const mix = (v: number): void => {
    h ^= Math.imul(v | 0, 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  };
  mix(Math.round(ctx.counts * 1e4));
  for (let i = 0; i < id.length; i++) mix(id.charCodeAt(i));
  return h >>> 0;
}
```

The `1e4` scale factor is left exactly as it was. It is not a centimetre constant: it only fixes the
resolution at which two count totals count as the same trial identity, and `v | 0` truncates
deterministically either way. `acclimationScale` needs no change at all beyond the sed, because it
works in `|ln(new/prev)|`, which is scale free.

Also update the module comment at lines 33 to 37: "With the arrival gain unknown (`ctx.prevCounts`
absent)" and "seeded from the trial's own identity (counts per 360, instrument)".

- [ ] **Step 6: The optimizer and the stats layer**

`src/optimizer/session-controller.ts`: delete `dpi: Dpi;` from `SessionConfig`, drop `Dpi` from the
type import, delete `dpi: config.dpi,` from the trial-context build at line 262, and rebrand where
arithmetic widens. The three finalize sites:

```ts
function fallbackReport(obs: readonly Observation[], lo: Counts360, hi: Counts360): Report {
  let best = { x: Math.log(Math.sqrt(lo * hi)), y: -Infinity };
  for (const o of obs) if (o.y > best.y) best = o;
  return {
    optimalCounts: counts360(clamp(Math.exp(best.x), lo, hi)),
    ci90: [lo, hi],
    curve: [...obs].map((o) => ({ x: o.x, mean: o.y })).sort((a, b) => a.x - b.x),
  };
}
```

```ts
  const peak = counts360(clamp(fit.optimalCounts, lo, hi));
```

```ts
  let ci: [Counts360, Counts360];
  try {
    const raw = bootstrapCi([...obs], iters, rng, opts.detrendDrift === true ? { drift: true } : {});
    ci = countsBounds(clamp(Math.min(raw[0], raw[1]), lo, hi), clamp(Math.max(raw[0], raw[1]), lo, hi));
  } catch {
    ci = [lo, hi]; // bootstrap could not bound it → honest wide range
  }
  if (opts.gpPeakCounts !== undefined) {
    const gp = clamp(opts.gpPeakCounts, lo, hi);
    const thresh = opts.disagreeLogThreshold ?? 0.15;
    if (Math.abs(Math.log(gp) - Math.log(peak)) > thresh) {
      ci = countsBounds(Math.min(ci[0], gp, peak), Math.max(ci[1], gp, peak));
    }
  }
```

and

```ts
  return {
    optimalCounts: peak,
```

In `runSession`, the seed helpers and the trial-context build:

```ts
  const levelAt = (k: number): Counts360 =>
    counts360(Math.exp(loX + ((k + 0.5) / coldStart) * (hiX - loX)));
  const orderedLevel = coldStartOrder(coldStart);
  const seedAt = (k: number): Counts360 => levelAt(orderedLevel[k] ?? k);
```

```ts
    const counts =
      trials.length < coldStart
        ? seedAt(trials.length)
        : counts360(clamp(engine.suggest(obs, bounds), lo, hi));
    const id = schedule[trials.length % schedule.length];
    config.onTrialStart?.(id, trials.length, counts);
```

```ts
    const prev = trials.length > 0 ? trials[trials.length - 1]!.counts : undefined;
    const result = await config.instruments[id].run(
      { counts, rng, profile, ...(prev !== undefined ? { prevCounts: prev } : {}) },
      config.scene,
    );
```

and near the end `let gpPeak: Counts360 | undefined;`. Add `counts360` and `countsBounds` to the
value import from `../types`. `ciStopWidth?: Counts360;` becomes `ciStopWidth?: number;` with the
comment "Stop early once the 90% CI, measured in counts, is narrower than this. A WIDTH, not a
position, so it is a plain number: a difference of two branded counts is not itself a count total."

Phase 4 takes this file for its own wiring task (amendment A3), which adds `currentTarget` to
`SessionConfig` and carries `reaches` out of `runSession`. Nothing here anticipates that: it lands
after phase 1.

`src/optimizer/evolution.ts`, `bandit.ts`, `bayesopt.ts`: the sed already changed the annotations. The
returns are `Math.exp(...)`, which is a plain number, so wrap each return in `counts360(...)` and add
`import { counts360 } from '../types';`. In `evolution.ts` that is the `return Math.exp(chosen);` in
`suggest`, `posteriorPeakWith`'s `return counts360(Math.exp(incumbent(gp, loX, hiX)));`, and the two
`if (history.length === 0) return counts360(Math.exp((loX + hiX) / 2));` guards; `posteriorPeak`
delegates, so it needs no change. `bayesopt.ts` has four such returns, read off the file: lines 70
and 107 become `return counts360(Math.exp((loX + hiX) / 2));` and lines 90 and 119 become
`return counts360(Math.exp(bestX));`. Line 97 is the `posteriorPeak` declaration, which delegates to
`posteriorPeakWith`, and line 104 is the `posteriorPeakWith` declaration; neither is a return.
`bandit.ts:35` returns an element of `arms`, already branded.

`src/stats/peak-fit.ts:108`: `export interface PeakFit { optimalCounts: number; ... }`. Leave it a
plain `number` and add to the interface: `/** The fitted vertex, exponentiated out of ln space.
Deliberately UNBRANDED: a least-squares vertex is not yet a count total the tool will report, and the
branding happens at the one boundary that clamps it into the searched window
(session-controller.finalizeReport). */` No change to the two construction sites beyond the sed.

`src/stats/bootstrap.ts`: the sed renamed the local `peakCm360` helper to `peakCounts`; nothing else
changes, it works in plain numbers throughout.

`src/optimizer/breakdown.ts`: signatures take `Counts360` after the sed. Two rebrands: `biasZero`
returns an interpolated value, so its `return` becomes `counts360(...)`, and the `peakCounts` local
at line 150 stays a plain `number` until it lands on the `FacetPeak`, where line 164 becomes
`return { instrument: id, peakCounts: counts360(peakCounts), spreadLn, laneConditioned };`. Add
`import { counts360 } from '../types';`. Update the two doc comments at lines 7 and 27 from
"cm/360 where" to "counts per 360 where", and line 107's section header to "testing the one latent
counts per 360 thesis as a claim".

`src/optimizer/result.ts`. Phase 1b owns this file and rewrites it in its task 9; this task does the
three things without which the commit does not compile, plus the interface `src/types.ts` now
references.

1. Delete `perGameSens` entirely: the `import { perGameSens } from '../convert/schools';` at line 2,
   the `const all = perGameSens(...)` and `perGameSensOut` computation at lines 48 to 51, and the
   `perGameSens: perGameSensOut,` return field at line 55. The field is gone from `Result`, and
   emitting a native sensitivity from browser counts is the k-of-1 assumption phase 3's gate exists
   to prevent.
2. Delete the `dpi: Dpi,` parameter (line 43) and drop `Dpi` from the type import. Delete the
   `games?: readonly GameId[],` parameter with it, and **keep `GameId` in the type import**: the
   game filter existed only to restrict `perGameSens`, it now has no body to affect, and
   `noUnusedParameters` is on in tsconfig.json so leaving the parameter fails the build, but the
   `Prescription` interface added in item 3 still uses `Partial<Record<GameId, number>>`, so
   deleting the import would be a TS2304 nine lines later. The interim signature is therefore
   `buildResult(report, trials, bounds?, profile?)`. Amendment A5 makes the options-object form
   phase 1b's, so it is not authored here; the positional call site is fixed in step 9.
3. Add the `Prescription` interface above `buildResult`. The block below is the contract's Decision 1
   as corrected by amendments A5 and A6, and it is byte-identical to the one phase 1b's task 9 step 3
   writes when it replaces this file, so the two commits do not disagree about the shape. Integration
   task 39 adds one further member, `k?: number`, and states why there. Nothing between this task and
   phase 1b task 9 reads `hardwareCounts`; it is declared here so the interface has one text.

```ts
/**
 * The three-tier prescription. Authored here in phase 1a because `Result.prescription` needs it in
 * the same commit that deletes `Result.perGameSens`; phase 1b owns `buildPrescription` and every
 * field it fills, and phases 3 and 4 fill the k and anchor sides.
 *
 * `ratio` and `ratioCi90` are OPTIONAL. As required fields they blocked tier two whenever k was
 * pinned but the anchor refused, which is a reachable state (a player who typed their game and
 * sensitivity but whose turn passes disagreed). `kLogSd` exists because the typed-sensitivity route
 * inherits the anchor's spread whole, so tier two has to widen rather than borrow tier one's
 * precision.
 */
export interface Prescription {
  /** anchor.counts / report.optimalCounts: the factor to multiply the current in-game sensitivity
   *  by. A ratio of two quantities counted in the same browser units, so k, yaw and any unit
   *  convention cancel exactly - the one claim on the payoff screen that assumes nothing. OPTIONAL
   *  (A5): absent exactly when the anchor refused; a session can still earn tier two without it. */
  ratio?: number;
  /** Conservative 90% band on the ratio: [anchor.lo / counts.hi, anchor.hi / counts.lo]. The
   *  endpoint quotient is wider than an independence-assuming error product on purpose: the
   *  dependence between the two CIs is not measured, and intervals widen, never narrow. Present
   *  exactly when `ratio` is. */
  ratioCi90?: [number, number];
  /** C*, the located optimum in browser counts per 360, copied verbatim from the Report. */
  counts: Counts360;
  countsCi90: [Counts360, Counts360];
  /** ONLY when k is pinned (lattice `scaled(k)` or a typed in-game sensitivity). Absent means
   *  unpinned and tier two is withheld - never a table computed from a guessed k. Computed by
   *  phase 3's tierTwoFrom, the single implementation of tier two (A4). */
  perGameSens?: Partial<Record<GameId, number>>;
  /** Absent exactly when `perGameSens` is: an unpinned k costs the tier, never the answer. */
  kSource?: 'lattice' | 'typed-sens';
  /** k's own uncertainty in ln space, inherited whole from the pin (A5). On the typed-sens route
   *  this is the anchor's reproduction spread landing whole on k, so it is not small; the screen
   *  must WIDEN each per-game row by it rather than borrowing tier one's precision. 0 on the
   *  lattice route as phase 3 currently pins it. Present exactly when `perGameSens` is. */
  kLogSd?: number;
  /** C* / k: the located optimum in the mouse's OWN counts (A6). Present exactly when k is
   *  pinned. Tier three renders THIS as convertible hardware counts; without it the screen keeps
   *  browser counts and must disclose the second unmeasured factor in any centimetre arithmetic. */
  hardwareCounts?: Counts360;
}
```

`ciConcord`'s `Cm360` annotations became `Counts360` in the sed and its ln-space width bucket is
scale invariant, so its thresholds are unchanged and still correct.

- [ ] **Step 7: The search window, `src/ui/options/settings.ts`**

```ts
import { counts360, countsBounds } from '../../types';
import type { Counts360 } from '../../types';

/**
 * The default search window, in counts per 360.
 *
 * The retired window was 15 to 60 cm with a hard clamp of 5 to 150 cm. Those are 4724 to 18898 and
 * 1575 to 47244 counts at 800 DPI, which is where the audience is, and they are rounded to the
 * nearest hundred here so the numbers read as the tool's own unit rather than as a converted
 * centimetre. It is only a default: calibration replaces it with a window seeded from what it
 * measured, and `boundsFromSeed` is what does that.
 */
export const DEFAULT_BOUNDS: [Counts360, Counts360] = countsBounds(4800, 19200);
const LO = 1600, HI = 47200, MIN_SPAN = 1600;

export function normalizeBounds(a: number, b: number): [Counts360, Counts360] {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return [...DEFAULT_BOUNDS];
  // Order, then clamp BOTH ends into [LO, HI] - lo is also capped at HI - MIN_SPAN so there is
  // always room below the ceiling for the minimum span (this is what prevents an inverted range
  // when both inputs exceed HI). Then guarantee the span by widening hi up to lo + MIN_SPAN.
  const lo = Math.min(Math.max(LO, Math.min(a, b)), HI - MIN_SPAN);
  let hi = Math.min(HI, Math.max(a, b));
  if (hi - lo < MIN_SPAN) hi = lo + MIN_SPAN;
  return countsBounds(lo, hi);
}

/** Center the optimizer's search window on a seed count total (the anchor), clamped to sane bounds. */
export function boundsFromSeed(seed: Counts360, factor = 1.7): [Counts360, Counts360] {
  if (!Number.isFinite(seed) || seed <= 0) return [...DEFAULT_BOUNDS];
  return normalizeBounds(seed / factor, seed * factor);
}

/** A count total for the arena to open at, given a window. The geometric midpoint, because the
 *  search itself is log-spaced: the arithmetic mean of 4800 and 19200 sits a full octave off centre. */
export const midOf = (bounds: readonly [Counts360, Counts360]): Counts360 =>
  counts360(Math.sqrt(bounds[0] * bounds[1]));
```

`midOf` is new. Its consumers are phase 1b's `session-view.ts` and phase 2's turn view, which both
need to open the arena at the centre of a window rather than at its slow edge; it is covered by
`tests/ui/options/settings.test.ts` in step 13 and handed off below rather than wired here, because
both files belong to other phases.

- [ ] **Step 8: Persistence and the shell**

`src/state/storage.ts`: delete the `if (!finite(c.dpi) || c.dpi <= 0) return null;` guard at line 28
and the `dpi: c.dpi,` at line 40. Replace the returned `bounds: [lo, hi],` with
`bounds: countsBounds(lo, hi),` and import `countsBounds` from `../types`. The remaining bounds
validation is unchanged and still correct in counts: finite, positive, ordered.

`src/ui/shell.ts`: drop `Cm360` and `Dpi` from the type import, add
`import { countsBounds } from '../types';`, delete `dpi: Dpi;` from `SessionDraft`, delete
`dpi: 800,` from `defaultDraft` and set `bounds: countsBounds(4800, 19200),`, delete `dpi: prefs.dpi,`
from `draftFromPrefs`, and delete `dpi: ctx.draft.dpi,` from `rememberPrefs`. Phase 2 owns this file
(A1) and adds `convention?`, `kPin?` and `turn?` to `SessionDraft` in its task 18; the four deletions
here are the type-deletion fallout and nothing else.

- [ ] **Step 9: The screens that carry a number**

`src/ui/arena-stage.ts`: `setCounts(counts: Counts360): void;` on the interface (comment: "Live
sensitivity change (range nudge) → arena.setSensitivity"; the trailing "at the fixed dpi" goes),
`counts: Counts360;` in the options with the `dpi: number;` line deleted, the destructure loses
`dpi`, the `new Arena({ ... counts, ... })` loses `dpi`, and line 106 becomes
`setCounts: (next) => arena.setSensitivity(next),`.

`src/ui/session-view.ts` is phase 1b's file (A1). Three edits, all fallout:

1. Line 16: `const FIRST_STOP_CI = 1900;   // a segment converges when the 90% CI, in counts per 360, is tighter than this`.
   The retired threshold was 6 cm, which is 1890 counts at 800 DPI, rounded to 1900. Leaving 6 would
   silently disarm early stopping altogether, because a bootstrap CI in counts is never 6 counts
   wide, so every segment would run to its hard ceiling. This is a rescale, not a redesign.
2. The `cm/360` label strings become `counts per 360`, so no line is lying at this commit: line 38
   (`searchLabel`'s `where`), line 53 (`announceEstimate`), line 112 (the prelock copy "the search
   evolves toward your sharpest counts per 360"), line 126 (`<small> counts per 360</small>`),
   line 233 (the visual estimate readout), line 240 (a comment) and line 308 (the dialed-in CI).
3. Line 187 loses `dpi: ctx.draft.dpi,` from the `createStage` call, line 248 loses
   `dpi: ctx.draft.dpi,` from the `runSession` config, line 289 becomes
   `const result = buildResult(report, allTrials, ctx.draft.bounds, ctx.draft.profile);` against the
   interim positional signature from step 6, and line 290 loses `dpi: ctx.draft.dpi,` from the saved
   `Session`.

The `.toFixed(1)` number formatting, `midOf` for the stage's opening count total, and the
options-object `buildResult` call are all phase 1b's, and are listed in the hand-offs rather than
authored here.

`src/ui/range-nudge.ts`: after the sed the signature is
`nudgeCounts(current: Counts360, step: number, bounds: [Counts360, Counts360]): Counts360`. Wrap the
return in `counts360(...)` and import it.

`src/ui/range.ts`:

```ts
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
```

The "inside the display rounding" test is what the `d === 0` form preserves: the readout shows whole
counts, so anything that rounds to the same whole count is the measured value and must not claim a
difference. The retired `Math.abs(d) < 0.05` was a centimetre tolerance and in counts it would call
a genuine 1-count difference a difference while the display showed none.

Then in the screen body: delete `const dpi = ctx.draft.dpi;`, type the two live values as counts
(`const measuredCounts: Counts360 = measured.optimalCounts;` and
`let current: Counts360 = carried.optimalCounts;`), replace the three `fmt(` call sites for the
readout, the confirm lead and the confirm measured with `fmtCounts(`, change the HUD
`<small> cm/360</small>` to `<small> counts per 360</small>`, the hint copy to "The bracket keys
nudge counts per 360, hold", the confirm copy to "This saves <span data-confirm="num"></span> counts
per 360 as a number you picked by" and "Your measured <span data-confirm="measured"></span> counts
per 360 stays saved, and reset brings it back.", `deps.createStage(root, { canvas, counts: current,
reducedMotion: reduced })`, `stage.setCounts(current)`, `adoptResult(measured, current)` (two
arguments now), and rename the local `applyCm` to `applyCounts(next: Counts360)` so the name states
the unit it applies.

`src/ui/range-adopt.ts`, replacing the body wholesale with phase 1b's H3 form, which is the one that
compiles once `Result.perGameSens` is gone and `Result.prescription` exists:

```ts
import type { Counts360, Result } from '../types';

/**
 * Build a "tuned by feel" Result from a measured one at a hand-picked count total. KEEPS the measured
 * breakdown (it characterizes the measured run, not the hand-picked value) and drops every MEASURED
 * readout a hand-picked value cannot honestly carry: the 90 percent interval, the performance
 * `curve`/`bounds` (no measured curve to plot), the `driftZ` session-drift disclosure, the
 * `facetConcordance`, and the `prescription`.
 *
 * Two of those are load bearing. The interval was measured around where the SEARCH peaked, and the
 * screen already refused to print it on a tuned value; carrying it in the object anyway meant it
 * reached localStorage and the exported JSON, where the screen's gate cannot follow, so a tuned
 * value has carried a measured interval in every export this tool has ever written. The
 * prescription is the same defect one tier up: its ratio is measured against the optimum the search
 * found, so on a hand-picked value it would report a multiply factor for a number nothing measured.
 * Pure: returns a new object, never mutates the input.
 */
export function adoptResult(measured: Result, adoptedCounts: Counts360): Result {
  const {
    ci90: _ci90, curve: _curve, bounds: _bounds, driftZ: _driftZ, facetConcordance: _facet,
    prescription: _prescription, ...rest
  } = measured;
  return {
    ...rest,
    optimalCounts: adoptedCounts,
    tuned: true,
  };
}
```

The `perGameSens` import goes with the field. Dropping `ci90` is what step 1's optionality is for:
it is settled there rather than deferred, because two parts each deferred it to the other and
`tuned-value-has-no-measured-ci` is an existing canon rule this repo was breaking. The reads it
forces in `src/ui/result.ts` are step 10 item 3.

`src/convert/schools.ts`: delete `perGameSens` outright (amendment A6: tier two exists in exactly one
place, behind the gate, and `tierTwoFrom` in phase 3's `src/input/count-convention.ts` is that
place). The `sensFor` import goes with it, so the file's remaining content is the schools list and
`monitorDistanceMatchCounts(sourceCounts: Counts360, sourceFovDeg, targetFovDeg, fraction): Counts360`
with its two returns wrapped in `counts360(...)` and `counts360` imported from `../types`. In the
derivation comment, `cm360_tgt`/`cm360_src` become `counts_tgt`/`counts_src` (the sed cannot see
them, they are compounds joined by an underscore), and append one sentence: "Stated in counts,
unchanged: the match is a ratio of view angles, so it holds in whatever unit the turn distance is
measured in." Also update the `'360'` school's note from "cm per 360° - FOV-agnostic" to "counts per
360 - FOV-agnostic".

`src/ui/options/options.ts`:

- `sensFor` no longer comes from `convert/cm360`, and the sensitivity column goes with it. Delete the
  import, delete `<th>Sensitivity</th>` from the table head at line 73, and delete the
  `<td class="t-figure-text" data-sens="${e.id}">` cell at line 101. Amendment A6 forbids emitting a
  native sensitivity from browser counts with k assumed to be 1, and this screen has no pinned k to
  gate on: it never runs a session, so there is nothing here that could measure one.
- Line 70's note becomes: "These are the community-derived yaw constants I use to turn counts per 360
  into a native in-game number. I show them read only, since they are reference rather than a
  setting. There is no sensitivity column: a native number also needs the factor between the
  browser's movement deltas and your mouse's own counts, and nothing on this screen measures that."
  The `${ctx.draft.dpi} dpi` clause goes with the field.
- Line 69's header sub loses the dangling qualifier and becomes
  `<span class="t-label options__sub">degrees per count at sens 1</span>`. The window midpoint
  readout moves into the search-window panel, where it belongs and where line 128's write still has a
  target: line 61 becomes
  `<p class="options__readout">Searching <span class="t-figure options__figure" data-bounds-out>${lo} to ${hi}</span> counts per 360, centred on <span data-mid-sub>${mid}</span>.</p>`
- The eight remaining "cm/360" strings, at lines 55, 61, 69, 81, 83, 88, 133 and 140, become
  "counts per 360". Line 83's input bounds become `min="1000" max="60000" step="10"` and its value
  expression becomes `${measured !== undefined ? Math.round(measured) : mid}` (a count total carries
  no decimal place). Line 88's readout and line 149's `out.toFixed(1)` become `Math.round(out)`.
- Line 148 becomes
  `const out = monitorDistanceMatchCounts(counts360(num('from')), num('source'), num('target'), Number.isFinite(frac) ? frac : 0);`
  with `counts360` imported from `../../types`. The private `windowMid(lo, hi)` at line 25 is left
  exactly as it is: it works in plain numbers and is correct in any unit.

`src/dev/arena-harness.ts`: replace the `CM360` and `DPI` constants with
`const COUNTS360 = counts360(9450);` (9450 counts is the 30 cm at 800 DPI the harness used to open
at, and `CM360` is uppercase so the sed did not touch it), pass `counts: COUNTS360` to `new Arena` at
line 103 and to the two option objects at lines 233 and 254, delete every `dpi: DPI,` line, and:
line 148 becomes `const dpc = degreesPerCount(COUNTS360);`, line 152 becomes
`` `counts/360 ${COUNTS360}   deg/count ${dpc.toFixed(4)}\n` ``, and line 205 becomes
`degPerCount: () => degreesPerCount(COUNTS360),`. `degreesPerCount` is imported from
`../convert/counts`.

- [ ] **Step 10: The result screen and the plot, minimum to compile**

Phase 1b owns `src/ui/result.ts` and `src/ui/convergence-plot.ts` and rewrites both. Three things are
forced here.

1. `Result.perGameSens` is gone, and line 90 dereferences it (`const sens = r.perGameSens[g.id as
   GameId];`), so the per-game table cannot survive this commit. Delete the `rows` builder at lines
   89 to 94, delete the `<table class="result__games">...</table>` at line 151, and delete the two
   lines inside the your-game `change` handler that move `data-current` between rows that no longer
   exist (lines 177 to 178). Keep the `<select data-action="your-game">`, the `ctx.draft.currentGame`
   write and the `rememberPrefs(ctx)` call: the game pick is a real remembered preference that setup
   and the case study both read, and it is not a measurement claim. In the table's place, one line
   that says what is missing and why, so the screen is honest at this commit rather than merely
   quiet: `<p class="result__saved">A native in-game number needs the factor between the browser's movement deltas and your mouse's own counts. Nothing here has measured that yet, so this screen stops at the count total.</p>`
2. The unit labels, so nothing on the screen is lying: replace `cm/360` with `counts per 360` at
   lines 43, 104, 110 and 124, and `centimetres per 360` with `counts per 360` at lines 53, 55 and
   56 (the three `srSummary` branches). Those seven are every unit spelling in the file, read off the
   file rather than counted from memory.
3. `Result.ci90` is optional as of step 1, and this file reads it at four sites: line 56 (the third
   `srSummary` branch), line 83 (`ciConcord`), line 110 (the interval paragraph) and line 197 (the
   `plotGeometry` input). All four already sit behind a `!tuned && !bounded` runtime gate, but a
   parameter and two template reads give the compiler nothing to narrow, and line 197 fails outright
   because `exactOptionalPropertyTypes` forbids handing `T | undefined` to an optional `ci90?: T`.
   One local binding makes the existing gate visible to the compiler and changes no rendered output
   on any measured Result. In `mount()`, immediately after the `concord` line, replace that line with:

```ts
      // `Result.ci90` is optional now: adoptResult drops it, because a value the player tuned by
      // feel carries no measured interval (and the old code carried one into localStorage and the
      // export, where this screen's gate could not reach it). Every read below was ALREADY gated on
      // !tuned && !bounded at runtime; this binding is what lets the compiler see that gate, so it
      // is undefined in exactly the cases the screen already refused to print a band in.
      const ci = !tuned && !bounded ? r.ci90 : undefined;
      const concord = ci ? ciConcord(r.optimalCounts, ci) : undefined;
```

  Then: `srSummary` takes the binding as a fourth parameter,
  `(r: Result, tuned: boolean, bounded?: 'low' | 'high', ci?: readonly [Counts360, Counts360])`,
  which needs `Counts360` added to line 2's type import (the sed does not add it: this file had no
  `Cm360` annotation to rename). Its call site becomes `srSummary(r, tuned, bounded, ci)`, and its
  third branch splits so the no-interval case says so rather than printing `undefined`:

```ts
      : ci
        ? `Your most-evolved sensitivity is ${fmt(r.optimalCounts)} counts per 360, with a 90% confidence interval from ${fmt(ci[0])} to ${fmt(ci[1])}.`
        : `Your most-evolved sensitivity is ${fmt(r.optimalCounts)} counts per 360. No measured interval was recorded with it.`;
```

  The interval paragraph's third ternary branch becomes
  `` : ci ? `<p class="result__ci reveal" data-reveal style="--reveal-i:2">90% confidence interval <span data-result="ci">${fmt(ci[0])} to ${fmt(ci[1])}</span> counts per 360</p>` : '' ``,
  and the `plotGeometry` call's `ci90: r.ci90,` becomes `...(ci ? { ci90: ci } : {}),`. No existing
  case in `tests/ui/result.test.ts` changes: every fixture there is a measured Result, so `ci` is
  defined and every branch renders exactly what it rendered before.

`src/ui/convergence-plot.ts` needs one wrap and nothing else at this commit. The sed brands
`xTicks: { counts: Counts360; px: number }[]`, and line 65 builds it from the plain numbers in
`NICE_TICKS`, so it becomes
`const xTicks = NICE_TICKS.filter((t) => t >= lo && t <= hi).map((t) => ({ counts: counts360(t), px: xToPx(t) }));`
with `counts360` imported from `../types`. The ladder's VALUES are still centimetres and the filter
therefore returns nothing inside a count-space window, which is a live defect and phase 1b's; it is
in the hand-offs, and it is not fixed here because choosing a tick ladder is a design decision about
their plot, not rename fallout.

Phase 1b's task 11 replaces the number, the interval, the tier blocks and this holding sentence with
tier one, tier two and tier three. Its stated expected failure must be re-derived against this state:
after this task the old screen no longer throws on a missing `perGameSens`, because the read is gone.

- [ ] **Step 11: Quarantine the modules that measured the retired quantity**

Seven files are deleted in task 5 or by phase 2. They must still compile, and the only thing they
need from this task is to stop importing types that no longer exist. Keep the edits to that.

`src/convert/cm360.ts`, `src/convert/turn-rate.ts` and `src/input/dpi.ts` were held out of the sed,
so their identifiers are internally consistent; they only need their `../types` imports made local:

```ts
/** Local to this module, which computes in a unit the tool no longer uses. `Cm360` and `Dpi` left
 *  types.ts with the rest of the physical unit chain; these aliases exist so the module still
 *  compiles until task 5 deletes it, and they are deliberately NOT exported so nothing new can
 *  depend on them. */
type Cm360 = number;
type Dpi = number;
```

`cm360.ts` needs neither (it already annotates in plain `number`), `turn-rate.ts` needs both (line 4)
and `dpi.ts` needs `Dpi` (line 1). Their four test files are untouched and still pass.

`src/input/dpi-sweep.ts` line 1: replace the `Dpi` type import with the same local alias comment and
`type Dpi = number;`.

Do the same in `src/ui/calibrate/sweep-view.ts` for its `Counts360`/`Dpi` type imports (the sed
renamed `Cm360` there), with `type SweepCounts = number;` where it annotated the turn distance.

`src/ui/calibrate/spin-view.ts`: it imported two one-line formulas from the module task 5 deletes.
Replace the `turn-rate` import with the count-space form, which is what the module was always
computing underneath:

```ts
/** The dial's rendered gain. In count space the seed IS the swept count total, so there is no DPI
 *  and no 2.54 in the mapping any more: one 360 spans PROVISIONAL_COUNTS counts. Quarantined here
 *  rather than added to convert/counts.ts because the whole dial is the defect phase 2 removes (it
 *  measures its own constant), and nothing new should be able to import it. */
const degPerCountForSpin = (counts: number): number => 360 / counts;
```

Then `const PROVISIONAL_COUNTS = 9450;` (the sed renamed the constant; 9450 counts is the 30 cm at
800 DPI it assumed), line 59 becomes `const degPerCount = degPerCountForSpin(PROVISIONAL_COUNTS);`,
line 149 becomes `const seed = counts360(acc.pathLength());` with `counts360` imported from
`../../types`, and `onSeed: (counts: Counts360) => void`. Drop the now-unused `opts.dpi` from the
options interface and its destructuring, and delete the sentence "point at the typed route rather
than discarding the measured dpi" from the comment at line 178, replacing it with "point at the typed
route".

`src/ui/setup.ts` is phase 2's file (A1) and its task 18 replaces it wholesale. The edits here are
exactly the ones without which this commit does not compile, and the interim state is not a design:
`SessionDraft.dpi` and `PersistedPrefs.dpi` are gone, `convert/cm360.ts` and `input/dpi.ts` are
deleted one task later, and `usableNumbers`/`problem()`/the typed field set all read one or the other.

- Delete the `cmPer360` import and the `isValidDpi, parseDpi, MIN_DPI, MAX_DPI` import; add
  `import { countsForSens } from '../convert/counts';`.
- `commitGuided(seedCounts: number)`: delete the two `dpi` lines (53 to 55); the bounds line already
  reads `ctx.draft.bounds = boundsFromSeed(counts360(seedCounts));`.
- Replace `usableNumbers` and `commitManual` with:

```ts
  /** True when this sensitivity can safely reach the arena. Zero or negative divides by zero in
   *  `countsForSens`, and the tool no longer asks for a DPI, so this is the whole gate now. */
  function usableNumbers(sens: number): boolean {
    return Number.isFinite(sens) && sens > 0;
  }

  /** Commit the typed route. `countsForSens` is exact rather than estimated: given the game and the
   *  sensitivity the player is currently using, 360 / (yaw * sens) IS their counts per 360. Returns
   *  false without committing on an unusable number, so a bad value cannot poison the draft (and,
   *  through rememberPrefs, every later visit). */
  function commitManual(sens: number, game: GameId, goal: number): boolean {
    if (!usableNumbers(sens)) return false;
    ctx.draft.currentSens = sens;
    ctx.draft.currentGame = game;
    ctx.draft.profile = { ...ctx.draft.profile, speedAccuracy: goal };
    ctx.draft.bounds = boundsFromSeed(countsForSens(sens, yawFor(game)));
    rememberPrefs(ctx);
    ctx.navigate('session');
    return true;
  }
```

- Delete the `Mouse DPI` label and input at line 164, delete `'dpi'` from the `fields` tuple at
  line 207, delete the DPI branch of `problem()` at lines 211 to 212, change the `problem()` return
  type to `{ field: 'sens'; msg: string } | null`, and change line 232 to
  `commitManual(Number(val('sens')), val('game') as GameId, Number(val('goal')));`.
- The returning-visitor block at lines 119 to 123: `const remembered = stored;` (a stored prefs blob
  no longer carries a DPI to validate, and `storage.loadPrefs` already rejects a malformed bounds
  pair), and the lead copy becomes
  `` `You've calibrated before. Searching ${remembered.bounds[0]} to ${remembered.bounds[1]} counts per 360.` ``
  with the `<span class="mono">${remembered.dpi} dpi</span>` fragment removed.
- Line 183 to 184: `if (!p || !usableNumbers(p.currentSens)) return;` and delete `ctx.draft.dpi = p.dpi;`.

`src/ui/calibrate-flow.ts` needs no change: its `dpi` field is a step-machine payload of its own, and
phase 2 deletes the sweep step that fills it.

- [ ] **Step 12: The case study's numbers, which the rename converts in name but not in value**

`src/ui/case-study/*` belongs to phase 1b (A1), which rewrites its prose. The values below are
rename fallout: the sed turns `peakCm360: 28.1` into `peakCounts: 28.1`, which is both a TS2322 (a
bare number where `FacetPeak.peakCounts?: Counts360` is wanted) and a page claiming 28.1 counts per
360, a quantity 300 times smaller than any real one. Converting only the four peaks would be worse
than leaving them, because they would then be plotted against a `bounds` of `[15, 60]` and land far
outside the figure, so the whole worked example moves to counts at once, at 800 DPI, rounded to the
nearest fifty.

In `src/ui/case-study/content.ts`, `demoConvergence` becomes:

```ts
/**
 * A WORKED EXAMPLE with invented numbers, drawn so the shape of a converged sweep is legible on a
 * page a reader may reach before ever playing. Nothing here is measured, and every surface that
 * renders it labels it as an illustration (see `buildFigure` in case-study.ts). Four mark-sets
 * scattered across the sweep, a concave fit peaked near 9150 counts per 360, and four per-facet
 * peaks that sit near one another without fully agreeing, which is the ordinary case.
 */
export function demoConvergence(): PlotInput {
  // Branded at every boundary, because the sed brands `PlotInput` too: `bounds`, `ci90`, `peak` and
  // `PlotMark.counts` are all `Counts360` by the time this file compiles, and a plain literal there
  // is a TS2322. The plain locals below (`v`, `c`) are the arithmetic side, where a count total
  // widens back to a number anyway.
  const bounds: [Counts360, Counts360] = countsBounds(4800, 19200);
  const peakValue = 9150;
  const peak = counts360(peakValue);
  const at = (counts: number) => -Math.pow(Math.log(counts) - Math.log(peakValue), 2);
  const insts: InstrumentId[] = ['track', 'flick', 'calibrate', 'strike'];
  const xs = [5650, 7250, 9150, 11650, 14800];
  const jitter: Record<InstrumentId, number> = { track: 0.04, flick: -0.05, calibrate: 0.02, strike: -0.03 };
  const marks = insts.flatMap((instrument) =>
    xs.map((v) => ({ counts: counts360(v), instrument, score: at(v) + jitter[instrument] })),
  );
  const curve = [5050, 6300, 7875, 9150, 10700, 13225, 17325].map((c) => ({ x: Math.log(c), mean: at(c) }));
  const facetPeaks = [
    { instrument: 'track' as InstrumentId, peakCounts: counts360(8850), spreadLn: 0.07, laneConditioned: false },
    { instrument: 'flick' as InstrumentId, peakCounts: counts360(9575), spreadLn: 0.08, laneConditioned: false },
    { instrument: 'calibrate' as InstrumentId, peakCounts: counts360(9200), spreadLn: 0.06, laneConditioned: false },
    { instrument: 'strike' as InstrumentId, peakCounts: counts360(10400), spreadLn: 0.11, laneConditioned: true },
  ];
  return { bounds, marks, curve, ci90: countsBounds(8650, 9800), peak, facetPeaks, size: { width: 640, height: 280 } };
}
```

with `import { counts360, countsBounds } from '../../types';` added, and `Counts360` added to the
file's existing `import type { InstrumentId } from '../../types';`.

Every number is the old one multiplied by 800 / 2.54 =
314.96 and rounded to the nearest fifty: 29 cm becomes 9150, the window 15 to 60 becomes 4800 to
19200, 28.1 / 30.4 / 29.2 / 33.0 become 8850 / 9575 / 9200 / 10400, and the CI 27.4 to 31.1 becomes
8650 to 9800, which still brackets the peak (the property `tests/ui/case-study/content.test.ts`
asserts).

In `src/ui/case-study/case-study.ts`, `buildResultCardFigure` shows the same worked example as a
card, and the sed renamed its `cm360:` key to `counts:`, so its strings move with the fixture:
`counts: '9,150'`, `ci: '90% ci 8,650 to 9,800 counts per 360'`, and the four facet values `'8,850'`,
`'9,575'`, `'9,200'`, `'10,400'`.

In `src/ui/case-study/chrome.ts`, `specimenCard`'s parameter is now `counts: string` (the sed), so
line 146's tag text becomes `'your counts per 360'`. That is the only string touched here.

The ten "cm/360" prose strings in `content.ts` (lines 28, 33, 35, 40, 43, 75, 99, 111, 128, 138) are
not touched: they are copy, the sed does not match them, and phase 1b claims them.

- [ ] **Step 13: Fix the tests**

Run `npx tsc --noEmit`. Every remaining error is one of four classes, and the fix is mechanical:

1. `error TS2322: Type 'number' is not assignable to type 'Counts360'.` and its second line
   `Type 'number' is not assignable to type '{ readonly __unit: "counts360"; }'.` A literal or a
   computed number is being handed to a count total. Wrap it: `counts360(9450)`, or `countsBounds(lo,
   hi)` for a pair. This is the brand doing its job, so read each site before wrapping and confirm
   the VALUE is a plausible count total, not a leftover centimetre.
2. `error TS2554: Expected 1 arguments, but got 2.` A `setSensitivity`, `sensFor`, `adoptResult` or
   `degreesPerCount` call still passes a DPI. Delete the second argument.
3. `error TS2339: Property 'cm360' does not exist on type ...`, or `'dpi'`, or `'perGameSens'`. A
   field the sed could not see because it was built from a string or a spread, or one of the two
   deleted members. Rename or delete it.
4. `error TS2578: Unused '@ts-expect-error' directive.` Only in `tests/types.test.ts`, and only if
   the brand was weakened. Do not silence it.

The value-bearing and structural expectations that must change, because a count total is not a
centimetre:

- `tests/types.test.ts`: the contract-object case loses its `Cm360` import and becomes
  `const trial: TrialResult = { instrument: 'track', counts: counts360(8240), score: 0.8, raw: { eLead: 1.2 }, at: 0 };`
  with the local `const cm: Cm360 = 34;` deleted. The three brand cases are unchanged.
- `tests/engine/camera-rig.test.ts`: import `degreesPerCount` from `../../src/convert/counts`; the
  describe becomes `counts per 360 → degrees per count`; the two expectations become
  `expect(degreesPerCount(counts360(20000))).toBeCloseTo(0.018, 6)` and
  `expect(degreesPerCount(counts360(10708.66))).toBeCloseTo(0.033618, 6)` with the comment "20000
  counts/360 is 50.8 cm at 1000 DPI, and 10708.66 is 34 cm at 800 DPI: the same two settings the cm
  form was pinned at, which is why the expected degrees are unchanged"; the rejection case
  (`rejects a non-positive cm360 or dpi`) is renamed to `rejects a non-positive count total`, drops
  its DPI arguments and keeps `counts360(0)`, `counts360(-1)`; every `new CameraRig(34, 800)` becomes
  `new CameraRig(counts360(10708.66))`; `rig.setSensitivity(68, 800)` becomes
  `rig.setSensitivity(counts360(21417.32))` with the comment "double the counts is half the
  deg/count". The file stays at 9 cases.
- `tests/engine/arena*.test.ts` and `tests/engine/camera-fov.test.ts`: the `new Arena({...})` and
  `new CameraRig(...)` fixtures lose `dpi` and take `counts: counts360(9450)`.
- `tests/instruments/fake-scene.ts`: `setSensitivity(_c: Counts360): void {}`.
- `tests/instruments/*.test.ts`, `tests/optimizer/*.test.ts`, `tests/stats/peak-fit.test.ts`,
  `tests/ui/*.test.ts`, `tests/state/*.test.ts`: `counts:` and `bounds:` literals get wrapped, and
  every `dpi:` and `perGameSens:` member is deleted from a fixture (`tests/ui/shell.test.ts:192`,
  `tests/state/storage.test.ts:16`, `tests/state/export.test.ts:11`, `tests/ui/range.test.ts:10`,
  `tests/ui/result.test.ts:9`, and the `session()`/`fakeCtx()`/`draft` literals around them). The
  optimizer, stats and objective tests are scale free (they work in ln space), so their VALUES may
  stay as they are, with one comment added at the top of `tests/optimizer/session-controller.test.ts`:
  "These fixtures use small count totals (15 to 60) because the search is scale free in ln space, and
  keeping the numbers small keeps the fitted peaks in this file comparable to the ones it was written
  against. Nothing here depends on them being physically plausible; tests/convert/
  counts-invariance.test.ts is the test that pins scale freedom as a property."
- `tests/ui/range-nudge.test.ts`: bounds become `countsBounds(4800, 19200)`, and the steps become
  `nudgeCounts(counts360(9000), 150, bounds)` expecting 9150, `-150` expecting 8850, the clamp cases
  `counts360(19100)` with `+150` expecting 19200 and `counts360(4900)` with `-150` expecting 4800,
  and the fine step `nudgeCounts(counts360(9000), 30, bounds)` expecting 9030.
- `tests/ui/range.test.ts`: the announce expectations become
  `'8,390 counts per 360, 150 above your measured 8,240.'` and
  `'8,090 counts per 360, 150 below your measured 8,240.'` for a draft measured at 8240 with two
  clicks down after one up; `$(root, 'counts').textContent` at the lower bound becomes `'4,800'`; the
  "spells the unit out" case becomes `expect(announceCounts(8240, 8240)).toContain('counts per 360')`
  and `expect(announceCounts(5000, 8240)).not.toContain('cm/360')`; the display-rounding case becomes
  `expect(announceCounts(8240.4, 8240)).toContain('your measured value')` and
  `expect(announceCounts(8270, 8240)).toContain('30 above')`. Update the mounted draft fixture's
  bounds and the measured `optimalCounts` to `countsBounds(4800, 19200)` and `counts360(8240)`.
- `tests/ui/options/settings.test.ts`: rewrite both describes in counts against LO 1600, HI 47200 and
  MIN_SPAN 1600. `normalizeBounds(19200, 4800)` is `[4800, 19200]` (reorders);
  `normalizeBounds(300, 2900)` is `[1600, 3200]` (lo clamped, span widened); `normalizeBounds(9600,
  9600)` is `[9600, 11200]` (degenerate); `normalizeBounds(NaN, 12000)` is `DEFAULT_BOUNDS`;
  `normalizeBounds(60000, 61000)` is `[45600, 47200]` (both above HI, clamp and never invert);
  `normalizeBounds(46800, 47000)` is `[45600, 47200]` (near the ceiling, lo pulled down to keep the
  span); `normalizeBounds(6400, 6600)` is `[6400, 8000]`; the invariant loop asserts `lo >= 1600`,
  `hi <= 47200`, `hi - lo >= 1600`. `boundsFromSeed(counts360(9450))` gives lo close to 5558.8 and hi
  16065; `boundsFromSeed(counts360(900))` gives `[1600, 3200]`; a NaN or zero seed gives
  `DEFAULT_BOUNDS`. Add one case for the new helper:
  `expect(midOf(countsBounds(4800, 19200))).toBe(9600)` with the comment "the geometric midpoint,
  exact here because 4800 * 19200 is a perfect square; the arithmetic mean would be 12000, a third
  of an octave high". The file goes from 4 cases to 5.
- `tests/ui/options/options.test.ts`: drop `dpi` from the prefs and draft fixtures, change the two
  bounds-status expectations at lines 129 and 140 to the count strings for the window the test
  applies, and rewrite `the game table follows the applied window` onto the readout that survives:
  it now asserts `host.querySelector('[data-mid-sub]')!.textContent` changes after apply (from the
  9,600-ish midpoint of the mounted window to the midpoint of the applied one) and that
  `host.querySelectorAll('[data-yaw-row]').length` is still 8 with no `[data-sens]` cell anywhere,
  with a comment naming the reason: a sensitivity column here would emit a native in-game number
  from browser counts with the convention factor assumed to be 1. The file stays at 12 cases.
- `tests/ui/setup.test.ts`: delete the four-case `it.each` for the DPI field (line 127), the
  `never persists a dpi the arena cannot use` case and the
  `hides the saved-calibration fast path when the stored dpi is unusable` case, which is six cases
  and takes the file from 28 to 22. Keep `a zero or missing sensitivity is refused too` (drop its
  trailing `data-field="dpi"` assertion), rewrite `clears the message as soon as the number is
  corrected` to type into `sens` rather than `dpi`, change line 55's reachability assertion to
  `[data-field="sens"]`, drop `dpi` from the draft and prefs fixtures and from the
  `sweepOpts.onResult`/`savedPrefs` expectations, and change the `commitManual` assertions to expect
  `ctx.draft.bounds` seeded from `countsForSens(sens, yawFor(game))`. The spin stub's `onSeed` now
  hands over a count total, so `spinOpts.onSeed(counts360(9450))` and the expectation becomes
  `expect(ctx.draft.bounds).toEqual(boundsFromSeed(counts360(9450)))`.
- `tests/state/storage.test.ts` and `tests/state/export.test.ts`: drop `dpi` from every prefs and
  session fixture, and drop the non-positive-dpi input from inside
  `validates on read: malformed or nonsensical blobs degrade to null` (there is no such field to
  reject any more); keep every bounds-validation input. Both files keep their case counts.
- `tests/ui/session-view.test.ts`: `searchLabel` and `announceEstimate` expectations become the count
  strings the interim screen produces, which still formats with `toFixed(1)`, for example
  `expect(searchLabel(0, 8240, 8, 30)).toContain('testing 8240.0 counts per 360')` and
  `expect(announceEstimate({ optimalCounts: counts360(8240), ci90: countsBounds(7800, 8700) })).toBe('Dialed in around 8240.0 counts per 360, 90% CI 7800.0 to 8700.0')`.
  Phase 1b's task 10 replaces the formatting and these expectations with thousands-separated whole
  counts; this task does not pre-empt it.
- `tests/ui/result.test.ts`: delete `perGameSens` from the `RESULT` fixture and `dpi` from the
  session and draft literals, and delete the two cases the per-game table carried:
  `renders a per-game row for every game and highlights the current one` and
  `the your-game selector re-highlights the matching row (deferred game pick)`. The file goes from 37
  to 35. `the game pick writes the draft and is REMEMBERED for the next visit` stays and still
  passes: the select survives, only the rows are gone.
- `tests/optimizer/result.test.ts`: delete the `sensFor` import and the two `perGameSens` assertions
  in the first case, delete `can restrict per-game output to a subset` outright (there is no game
  filter left), and drop the DPI argument and the `undefined` games slot from every `buildResult`
  call, so they read `buildResult(report, trials)` and `buildResult(report, trials, countsBounds(4800, 19200))`.
  The file goes from 18 to 17.
- `tests/convert/schools.test.ts`: delete the `per-game output (360-distance)` describe entirely, both
  cases, along with the `perGameSens` import, and rewrite the derivation comment at line 26 in
  counts. `monitorDistanceMatchCounts` takes a `counts360(...)` first argument and its expectations
  are ratios, so they are unchanged. The file goes from 6 to 4.
- `tests/ui/range-adopt.test.ts`: the fixture loses `perGameSens` and gains a `prescription`, and the
  first case splits into three, so the file goes from 5 to 7:

```ts
import { describe, it, expect } from 'vitest';
import { adoptResult } from '../../src/ui/range-adopt';
import { counts360, countsBounds } from '../../src/types';
import type { Result } from '../../src/types';

const measured: Result = {
  optimalCounts: counts360(9450),
  ci90: countsBounds(8600, 10400),
  breakdown: { biasZeroCounts: counts360(9300), precisionFloorDeg: 0.35, ttkMs: 510, hitRate: 0.86 },
  curve: [{ x: Math.log(9450), mean: 0.2 }],
  bounds: countsBounds(4800, 19200),
  driftZ: -0.4,
  // A prescription measured against the SEARCH's optimum, which is exactly what must not ride along
  // onto a number the player picked by hand.
  prescription: {
    ratio: 1.09,
    ratioCi90: [1.02, 1.17],
    counts: counts360(9450),
    countsCi90: countsBounds(8600, 10400),
  },
};

describe('adoptResult', () => {
  it('sets the adopted count total and flags the result tuned', () => {
    const tuned = adoptResult(measured, counts360(10200));
    expect(tuned.optimalCounts).toBe(10200);
    expect(tuned.tuned).toBe(true);
  });

  it('DROPS the prescription, so a hand-picked number carries no multiply factor', () => {
    // The factor was measured against where the SEARCH peaked. Carried onto a value the player
    // dialled by feel it would report a change from their current sensitivity that nothing measured,
    // and it would ride into localStorage and the exported JSON, where the screen's gate cannot
    // reach it.
    expect('prescription' in adoptResult(measured, counts360(10200))).toBe(false);
  });

  it('DROPS the measured 90 percent interval, because a tuned value carries none', () => {
    // tuned-value-has-no-measured-ci is a canon rule this repo already had, and the code was
    // breaking it in the one place nobody looked. The result screen hid the band on a tuned value,
    // so on screen the rule held; the field itself rode into localStorage and the exported JSON,
    // where there is no screen to gate it, and the export is the artifact a player keeps.
    expect('ci90' in adoptResult(measured, counts360(10200))).toBe(false);
  });

  it('keeps the measured breakdown (characterizes the measured run, not the hand-picked value)', () => {
    expect(adoptResult(measured, counts360(10200)).breakdown.ttkMs).toBe(510);
  });

  it('does not mutate the measured result', () => {
    const before = JSON.stringify(measured);
    adoptResult(measured, counts360(10200));
    expect(JSON.stringify(measured)).toBe(before);
  });

  it('DROPS the measured curve/bounds (a hand-picked value has no measured curve - honesty)', () => {
    const tuned = adoptResult(measured, counts360(10200));
    expect('curve' in tuned).toBe(false);
    expect('bounds' in tuned).toBe(false);
  });

  it('DROPS the drift disclosure and the facet concordance', () => {
    const tuned = adoptResult(measured, counts360(10200));
    expect('driftZ' in tuned).toBe(false);
    expect('facetConcordance' in tuned).toBe(false);
  });
});
```

- `tests/ui/case-study/content.test.ts`: `the convergence demo is concave with four organism mark-sets
  converging near the peak` asserts only ordering properties (peak inside bounds, CI bracketing the
  peak), so it passes unchanged against the counts fixture. No edit.
- `tests/ui/calibrate-views.test.ts`: the spin stub's `dpi` option is gone; the sweep view is
  untouched.

- [ ] **Step 14: Run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: tsc silent; the suite green at **836 passing**. From 844 at the end of task 3:

| file | before | after | delta |
|---|---|---|---|
| `tests/ui/setup.test.ts` | 28 | 22 | -6 |
| `tests/ui/result.test.ts` | 37 | 35 | -2 |
| `tests/convert/schools.test.ts` | 6 | 4 | -2 |
| `tests/optimizer/result.test.ts` | 18 | 17 | -1 |
| `tests/ui/range-adopt.test.ts` | 5 | 7 | +2 |
| `tests/ui/options/settings.test.ts` | 4 | 5 | +1 |

The deltas sum to -8 (six deleted DPI-field cases, two deleted per-game-table cases, two deleted
`perGameSens` cases in schools, one deleted game-filter case, two added adopt cases for the dropped
prescription and the dropped interval, one added `midOf` case), and 844 - 8 is 836. If your run
prints anything else, one of these files moved under you; reconcile the difference before committing
rather than adjusting the number.

- [ ] **Step 15: Commit**

```bash
git add -A src tests
git commit -m "feat(units): the tool measures counts per 360, not centimetres

DPI cancels out of every number the tool reports, so measuring it bought a printed label and
a wallet card. The engine now takes counts directly, degreesPerCount is 360 / counts, and
TURN_CM and the 2.54 are gone from the engine entirely. Cm360 and Dpi are deleted rather than
aliased, so tsc had to enumerate every call site; the branded Counts360 is what made that
possible. Result.perGameSens goes with them: a native in-game sensitivity computed from the
browser's own counts assumes the convention factor is 1, and nothing measures that, so tier
two moves behind the gate. One commit because a half-swapped unit either does not compile or,
worse, compiles with a field named cm360 holding counts.

Result.ci90 also becomes optional in the same commit, so adoptResult can drop it.
tuned-value-has-no-measured-ci is a canon rule this repo already had and the code was
breaking it: the result screen hid the band on a hand-picked value, so the rule held on
screen, while the field itself rode into localStorage and the exported JSON where no screen
gate can reach it. A value the player tuned by feel now carries no interval anywhere."
```

---

### Task 5: Delete `convert/cm360.ts`, `convert/turn-rate.ts` and `input/dpi.ts`

**Files:**
- Delete: `src/convert/cm360.ts`, `src/convert/turn-rate.ts`, `src/input/dpi.ts`
- Delete: `tests/convert/cm360.test.ts`, `tests/convert/turn-rate.test.ts`, `tests/input/dpi.test.ts`
- Modify: `tests/convert/yaw-table.test.ts`

- [ ] **Step 1: Confirm nothing imports them any more**

Run:

```bash
grep -rn "convert/cm360\|convert/turn-rate\|input/dpi'\|input/dpi\"" --include="*.ts" src tests
```

Expected, exactly these five lines, all of which are inside the files being deleted or the one test
to fix:

```
src/convert/turn-rate.ts:3:import { TURN_CM } from './cm360';
tests/convert/cm360.test.ts:2:import { cmPer360, sensFor, crossGame, TURN_CM } from '../../src/convert/cm360';
tests/convert/turn-rate.test.ts:2:import { degPerCountFor, cm360FromTurnCounts, turnCountsFor } from '../../src/convert/turn-rate';
tests/convert/yaw-table.test.ts:3:import { sensFor, cmPer360 } from '../../src/convert/cm360';
tests/input/dpi.test.ts:2:import { parseDpi, isValidDpi, normalizeByDpr, MIN_DPI, MAX_DPI } from '../../src/input/dpi';
```

The importer list obtained by grepping at HEAD was `src/ui/setup.ts`, `src/ui/options/options.ts`,
`src/engine/camera-rig.ts`, `src/convert/schools.ts`, `src/ui/calibrate/spin-view.ts`,
`src/input/pointer-lock.ts`, `tests/ui/setup.test.ts`, `tests/optimizer/result.test.ts`,
`tests/convert/cm360.test.ts`, `tests/convert/turn-rate.test.ts`, `tests/convert/yaw-table.test.ts`
and `tests/input/dpi.test.ts`. Tasks 3 and 4 moved every source importer onto `convert/counts.ts` or
onto a quarantined local, and step 13 moved `tests/ui/setup.test.ts` and
`tests/optimizer/result.test.ts`, which is why only the doomed files and `yaw-table.test.ts` are
left. If the grep prints anything else, fix that file before deleting.

- [ ] **Step 2: Rewrite the one test that survives**

`tests/convert/yaw-table.test.ts` line 3 becomes
`import { sensFor, countsForSens } from '../../src/convert/counts';` plus
`import { counts360 } from '../../src/types';`. It imports `cmPer360` as well as `sensFor` at HEAD,
so read the file: every `cmPer360(dpi, sens, yaw)` call is replaced by `countsForSens(sens, yaw)`
from the same module, and every `sensFor(cm, dpi, yaw)` call becomes `sensFor(counts360(...), yaw)`.
The yaw table is what the file is testing, so each asserted sensitivity is unchanged as long as the
count total is the same physical setting: 34 cm at 800 DPI is `counts360((34 * 800) / 2.54)`.

- [ ] **Step 3: Delete**

```bash
git rm src/convert/cm360.ts src/convert/turn-rate.ts src/input/dpi.ts \
       tests/convert/cm360.test.ts tests/convert/turn-rate.test.ts tests/input/dpi.test.ts
```

`turn-rate.ts` goes because a turn distance in centimetres has no consumer left. `cm360.ts` goes
because its whole content was the 2.54 and the three formulas that carried it. `dpi.ts` goes because
its parser and bounds validated a number the tool no longer asks for, and its `normalizeByDpr` was
the live bug described in task 3. Their file-local type aliases from task 4 step 11 go with them.

- [ ] **Step 4: Run the full suite and the token gate**

Run: `npx tsc --noEmit && npm test && grep -rn "[Cc][Mm]360" --include="*.ts" src tests`
Expected: tsc silent; the suite green at **823 passing** (836 minus the 13 cases in the three deleted
files: 4 in `dpi.test.ts`, 6 in `cm360.test.ts`, 3 in `turn-rate.test.ts`); and the grep prints
nothing at all. The clean grep is the real gate for this task: it proves the retired identifier is
gone from the whole repo, which is what lets later phases treat `counts` as the only unit name.

- [ ] **Step 5: Commit**

```bash
git add -A src tests
git commit -m "refactor(convert): delete cm360.ts, turn-rate.ts and dpi.ts

Every consumer moved to convert/counts.ts in the unit swap. What is left in these three files
is the 2.54, a DPI parser for a number nobody asks for, and the DPR division that could not
have reconciled anything."
```

---

### Task 6: The invariance test, the one that carries the thesis

**Files:**
- Test: `tests/convert/counts-invariance.test.ts`

Tier one is a quotient of two count measurements, so it must not move when the whole count stream is
scaled. That is the claim the design rests on and it needs a test that would go red if any fixed unit
constant, any devicePixelRatio division, or any unscaled window ever came back.

**Sequencing, load bearing.** This task runs through the SHIPPED path, `buildPrescription`, not
through a local re-implementation of the ratio, because a test that computes the quotient itself
cannot catch the shipped composition losing it (amendment A7). `buildPrescription` is authored by
phase 1b task 9, which imports phase 3's `tierTwoFrom`, so this task is executed AFTER phase 1b task
9 and phase 3 task 27 have landed, and it is the last of phase 1a's tasks to run rather than the
sixth. It passes no `k`: tier one is k-free by construction, and an absent k is exactly the state the
invariance is a claim about.

It does not import phase 4's `Anchor` type. The anchor is written as a bare `{ counts, ci90 }`
literal, which is exactly `buildPrescription`'s `AnchorReading` parameter, so this file has no
dependency on `src/anchor/reconcile.ts` landing. Do NOT add `sources` or `disagreementPct` to that
literal: those members live on phase 4's `Anchor`, not on the reading this function takes, and a
fresh object literal argument is excess-property-checked rather than merely assignability-checked, so
either one is `error TS2353: Object literal may only specify known properties`. Phase 4's own call
site is safe because it passes an `Anchor` variable, and a non-fresh value is allowed extra members.

- [ ] **Step 1: Write the test**

Create `tests/convert/counts-invariance.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { finalizeReport } from '../../src/optimizer/session-controller';
import { trialsToObservations } from '../../src/optimizer/objective';
import { buildPrescription } from '../../src/optimizer/result';
import { sensRatio } from '../../src/convert/counts';
import { mulberry32 } from '../../src/stats/rng';
import { counts360, countsBounds } from '../../src/types';
import type { Prescription } from '../../src/optimizer/result';
import type { InstrumentId, Profile, Report, TrialResult } from '../../src/types';

/**
 * The thesis: the tool reports a RATIO of two count measurements, so whatever factor sits between a
 * browser movement delta and a real mouse count divides out of the answer exactly. Scale every count
 * in a recorded session by k and the reported multiplier must not move.
 *
 * This runs the shipped path deliberately: recorded trials → blended observations → fitted report →
 * `buildPrescription`. An earlier draft computed the quotient in the test with `sensRatio`, which
 * pins the formula and not the pipeline: production could stop dividing two counts by the same
 * arena's counts and this file would still pass.
 *
 * On "byte-identical". It is exact at k = 1 and only there, and pretending otherwise would be the
 * same false precision this design exists to refuse. The pipeline routes counts through Math.log and
 * Math.exp and ln(k * c) is not ln k + ln c in doubles, so the deviation is around 1e-10. Even the
 * bare quotient is not bitwise invariant: (k * a) / (k * b) differs from a / b in the last ulp for
 * about a third of random count pairs at k = 1.5 and k = 7.3, and never for a power of two. So the
 * tolerance is 1e-9, and the last two cases are what make that tolerance load bearing. They inject
 * the two shapes a real unit leak takes. A search window left in a fixed unit while the stream
 * scales is caught as a REFUSAL, not as a deviation: the vertex lands a factor of three past the
 * ceiling, the Report records peakAtBound, and buildPrescription declines the whole prescription
 * rather than reporting the clamp as a factor. A surviving 2.54 or a devicePixelRatio division on
 * ONE side of the quotient stays interior and has to be caught by the tolerance instead; it moves
 * the ratio by 50 percent, eight orders of magnitude above 1e-9. Do not tighten this to toBe: that
 * would pin floating point rounding, not the invariance.
 */
const profile: Profile = {
  speedAccuracy: 0.5,
  instrumentWeights: { track: 1, flick: 1, calibrate: 0, strike: 0 },
};

/** A log-spaced sweep, in counts per 360, and the count total the simulated player peaks at. */
const LEVELS = [4800, 5800, 7000, 8400, 10100, 12200, 14700, 17700];
const PEAK = 8240;
/** The anchor: the count total this player's hands already believe in. */
const ANCHOR = 9000;

/** One recorded session, with every count scaled by `k`. The scores are a fixed concave curve in
 *  ln space plus a seeded jitter, so the recording is identical run to run and identical across k
 *  except for the counts themselves. */
function recordedSession(k: number): TrialResult[] {
  const out: TrialResult[] = [];
  const ids: InstrumentId[] = ['track', 'flick'];
  const rng = mulberry32(11);
  LEVELS.forEach((c, i) => {
    for (const id of ids) {
      const x = Math.log(c) - Math.log(PEAK);
      out.push({
        instrument: id,
        counts: counts360(c * k),
        score: 1 - x * x + (rng() * 2 - 1) * 0.01,
        raw: {},
        at: i * 1000,
      });
    }
  });
  return out;
}

/** The whole reported-number path, through the code that ships. Split in two on purpose: the raw
 *  form returns the Report as well as the Prescription, so a REFUSAL is observable rather than
 *  throwing inside an assertion, and `scaleWindow` false is the defect injection the refusal case
 *  needs. The `ratio` form is what the invariance cases call, and it asserts. */
function reportedPrescription(
  k: number,
  scaleWindow = true,
): { report: Report; p: Prescription | null } {
  const bounds = scaleWindow ? countsBounds(4000 * k, 20000 * k) : countsBounds(4000, 20000);
  const report = finalizeReport(
    trialsToObservations(recordedSession(k), profile),
    bounds,
    mulberry32(7),
    { bootstrapIters: 200 },
  );
  // The anchor is a bare AnchorReading. It must NOT carry phase 4's `sources` or `disagreementPct`:
  // a fresh object literal argument is excess-property-checked, so either one is a TS2353.
  const anchor = {
    counts: counts360(ANCHOR * k),
    ci90: countsBounds(ANCHOR * k * 0.96, ANCHOR * k * 1.04),
  };
  return { report, p: buildPrescription(report, anchor) };
}

function reportedRatio(k: number): number {
  const { p } = reportedPrescription(k);
  // buildPrescription refuses only when it has no anchor to work from or the vertex hit a bound,
  // and neither holds here. The assertions are inside the helper so a refusal reads as a refusal
  // rather than as a NaN ratio.
  expect(p, 'buildPrescription must not refuse an anchor it was handed').toBeTruthy();
  expect(p!.ratio, 'an anchor must produce a ratio').toBeDefined();
  return p!.ratio!;
}

const FACTORS = [1, 2, 1.5, 0.5, 7.3];

describe('the reported ratio is invariant to the count convention', () => {
  it('does not move when every count in a recorded session is scaled', () => {
    const base = reportedRatio(1);
    expect(base).toBeGreaterThan(1); // this player is measured faster than they believe
    for (const k of FACTORS) {
      const r = reportedRatio(k);
      expect(Math.abs(r / base - 1), `k = ${k}`).toBeLessThan(1e-9);
    }
  });

  it('is bitwise identical at k = 1, which is the only k where exactness is claimable', () => {
    expect(reportedRatio(1)).toBe(reportedRatio(1));
  });

  it('rounds to the same displayed multiplier at every k, which is what the player is told', () => {
    const shown = FACTORS.map((k) => reportedRatio(k).toFixed(2));
    expect(shown).toEqual(['1.09', '1.09', '1.09', '1.09', '1.09']);
  });

  it('sensRatio itself cancels the factor, exactly at a power of two and to one ulp otherwise', () => {
    const base = sensRatio(counts360(ANCHOR), counts360(PEAK));
    for (const k of [1, 2, 0.5]) {
      // A power of two scales a double exactly, so there is nothing left to round.
      expect(sensRatio(counts360(ANCHOR * k), counts360(PEAK * k)), `k = ${k}`).toBe(base);
    }
    for (const k of [1.5, 7.3]) {
      const r = sensRatio(counts360(ANCHOR * k), counts360(PEAK * k));
      expect(Math.abs(r / base - 1), `k = ${k}`).toBeLessThan(4 * Number.EPSILON);
    }
  });

  it('goes red when a window does NOT scale with the stream: the pipeline refuses outright', () => {
    // A search window left in a fixed unit while the count stream is scaled puts the vertex a factor
    // of three past the ceiling, so finalizeReport records peakAtBound and buildPrescription refuses
    // the whole prescription rather than reporting the clamp as a factor. An earlier draft of this
    // file asserted a deviation of 2.006582377496116 here; that number is the clamped optimum
    // (65700 / 20000 = 3.285 against a true 1.0926) and it is unreachable through the shipped path,
    // because the refusal fires first. The refusal IS the catch, and it is a stronger one.
    const leaked = reportedPrescription(7.3, false);
    expect(leaked.report.peakAtBound).toBe('high');
    expect(leaked.p).toBeNull();
  });

  it('goes red when only ONE side of the quotient is scaled, so the tolerance is load bearing', () => {
    // The leak that stays interior and therefore has to be caught by the tolerance rather than by a
    // refusal: a devicePixelRatio division applied to the anchor and not to the arena, or a
    // surviving 2.54 on one side. The session and its window are both scaled by 2, so the located
    // optimum doubles, while the anchor is left where it was. The deviation is 0.5, eight orders of
    // magnitude above 1e-9, which is what proves the first case's tolerance is not so loose it has
    // stopped looking.
    const base = reportedRatio(1);
    const report = finalizeReport(
      trialsToObservations(recordedSession(2), profile),
      countsBounds(8000, 40000),
      mulberry32(7),
      { bootstrapIters: 200 },
    );
    const halved = buildPrescription(report, {
      counts: counts360(ANCHOR), // the anchor alone left undivided by the DPR the arena applied
      ci90: countsBounds(ANCHOR * 0.96, ANCHOR * 1.04),
    })!;
    expect(halved).toBeTruthy();
    expect(Math.abs(halved.ratio! / base - 1)).toBeGreaterThan(0.4);
  });
});
```

- [ ] **Step 2: Prove it fails for the right reason**

The implementation this test guards already exists, so red-first here means injecting the defect it
exists to catch. Inject it through the surviving NUMERIC control, because that is the case the
tolerance is for: temporarily change the last case's `counts360(ANCHOR)` to `counts360(ANCHOR * 2)`,
so the anchor scales with the stream after all and the quotient cancels exactly. Then run:

Run: `npx vitest run tests/convert/counts-invariance.test.ts -t 'only ONE side'`
Expected: FAIL, 1 test, with `AssertionError: expected <deviation> to be greater than 0.4`, where
`<deviation>` is the residual floating-point difference between the two fits and prints below 1e-9.
It is NOT exactly zero and the plan does not quote a digit string for it: the two reports are fitted
independently, so the invariance that is exact in algebra is approximate in doubles, which is the
same fact the tolerance in the first case exists for. If it prints something above 1e-9, the
cancellation itself is broken and that is a finding rather than a typo.

Then revert that one token (`ANCHOR * 2` back to `ANCHOR`) before continuing.

The refusal case cannot be inverted the same way, because there is nothing to loosen: it asserts
`peakAtBound === 'high'` and `p === null`. To see it fail on purpose, temporarily pass `true` for
`scaleWindow` in `reportedPrescription(7.3, false)` and confirm the run reports
`AssertionError: expected undefined to be 'high'`, then revert. That is a check on the plan's
reasoning, not a required step.

- [ ] **Step 3: Run the test to verify it passes**

Run: `npx vitest run tests/convert/counts-invariance.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 4: Run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: tsc silent, and the suite 6 higher than whatever the preceding task left it at. Counting
phase 1a's tasks alone, that is 829 (823 after task 5, plus these 6); phase 1b, 3 and 4 have landed
their own tasks in between by the time this one runs, so take the preceding run's total as the
baseline and check the delta is exactly 6.

- [ ] **Step 5: Commit**

```bash
git add tests/convert/counts-invariance.test.ts
git commit -m "test(convert): pin the ratio's invariance to the count convention

Scale every count in a recorded session and the reported multiplier must not move. It runs
through buildPrescription rather than recomputing the quotient, because a test that does its
own division pins the formula and not the pipeline. Exact at k = 1 and to 1e-9 at k of 2, 1.5,
0.5 and 7.3, with the measured floating-point deviations recorded in the file so nobody
tightens it to toBe. Two injected controls close it: an unscaled search window, which the
pipeline refuses outright because the vertex lands past a bound, and an anchor left undivided
by a factor the arena applied, which stays interior and moves the ratio by 50 percent."
```

---

## Hand-offs to other phases

**To phase 1b (the payoff screen).** After task 4:

- `Report` carries `optimalCounts: Counts360` and `ci90: [Counts360, Counts360]`; `Result` carries
  `optimalCounts`, `ci90`, `bounds?` and `breakdown.biasZeroCounts`, all branded;
  `FacetPeak.peakCounts?: Counts360`. `Counts360` is branded, so a literal in a fixture needs
  `counts360(...)`; `countsBounds(lo, hi)` exists for pairs and `midOf(bounds)` in
  `src/ui/options/settings.ts` for the geometric centre of a window.
- **`Result.perGameSens` is GONE and `Result.prescription?: Prescription` exists.** `Prescription` is
  authored in `src/optimizer/result.ts` at the contract's Decision 1 shape as corrected by amendments
  A5 and A6: `ratio?`, `ratioCi90?`, `counts`, `countsCi90`, `perGameSens?`, `kSource?`, `kLogSd?`,
  `hardwareCounts?`. The block in task 4 step 6 is byte-identical to the one your task 9 step 3
  writes, member comments included, so your task's "preserves that export" claim is true and there is
  one text for the shape. Integration task 39 adds `k?: number` and states why there.
  Finding 40's `perGameCi90?` was not adopted by A5; if you and phase 3 want tier two to carry a
  band, add the field in your task 9 rather than leaving `kLogSd` computed and dropped.
- **`Result.ci90` is OPTIONAL** (round 3 decision D1), settled in task 4 step 1 rather than deferred
  back to you. `adoptResult` drops it, so a value the player tuned by feel carries no measured
  interval anywhere, not just on screen. `Report.ci90` is still required. `src/ui/result.ts`'s four
  reads are already rewired onto one narrowed `const ci = !tuned && !bounded ? r.ci90 : undefined;`
  binding (task 4 step 10 item 3), which is the same gate the screen already applied at runtime, so
  no rendered output changes on a measured Result and no case in `tests/ui/result.test.ts` moves.
  Your task 11 replaces that block wholesale; keep the optionality and the binding, or replace it
  with an equivalent narrowing, but do not restore a required `ci90`.
- **`buildResult`'s interim signature is `buildResult(report, trials, bounds?, profile?)`.** The
  `dpi` parameter is deleted (A5 gives phase 1a only that removal) and the `games?` filter went with
  `perGameSens`, since it had nothing left to filter and `noUnusedParameters` is on. The
  options-object form is yours: `src/ui/session-view.ts:289` currently reads
  `buildResult(report, allTrials, ctx.draft.bounds, ctx.draft.profile)`.
- `sensRatio(anchor, optimum)` in `src/convert/counts.ts` is the named home for tier one's quotient,
  and you are asked to call it in `buildPrescription` rather than open-code
  `anchor.counts / cStar`: two implementations of the same quotient is two places for it to drift,
  and `sensRatio`'s guard refuses a zero or a NaN instead of returning an Infinity as a multiply
  factor. Your task 9 step 3 currently open-codes it. Either is defensible, because
  `tests/convert/counts-invariance.test.ts` runs through `buildPrescription` and catches a lost
  cancellation either way, but decide it in your document rather than leaving it undecided. Phase
  1a's doc comment on `sensRatio` deliberately claims no caller, so whichever way you go, no comment
  in the repo describes a call site that does not exist.
- **`src/ui/convergence-plot.ts` has a live defect after the unit swap that no test catches, and it
  is yours.** Phase 1a touched one line in it, the `xTicks` builder, and only to wrap the tick value
  in `counts360(...)` so the branded `xTicks: { counts: Counts360; px: number }[]` compiles.
  `NICE_TICKS = [10, 15, 20, 25, 30, 35, 40, 50, 60, 80]` is a centimetre tick ladder,
  and `xTicks` filters it to `t >= lo && t <= hi`. With a window of 4800 to 19200 counts that filter
  is empty, so the plot silently loses every x-axis tick and label. The ladder needs count-space
  values (for example 2000, 3000, 4000, 5000, 6000, 8000, 10000, 12000, 16000, 20000, 30000) and a
  test asserting at least three ticks render inside the default window.
- `src/ui/result.ts` still holds the pre-rewrite screen with its seven unit spellings corrected to
  "counts per 360" and the per-game table removed (the field it read is gone), replaced by one
  sentence saying a native number needs the convention factor. Your task 11 replaces that sentence
  with tier two. Three consequences for your task: the old screen no longer throws on a missing
  `perGameSens`, so re-derive your step 2 expected failure against the state task 4 leaves;
  `tests/ui/result.test.ts` is already down to 35 cases with the two per-game cases deleted; and the
  `ci` binding described above is already in `mount()`, so `srSummary` takes four parameters.
- `src/ui/session-view.ts` has had only rename fallout: `FIRST_STOP_CI` rescaled to 1900 counts, the
  `cm/360` labels replaced, the three `dpi` arguments deleted, and the positional `buildResult` call.
  Its numbers still format with `.toFixed(1)`, so they read "8240.0". The thousands-separated whole
  count (`Math.round(v).toLocaleString('en-US')`, no decimal, because the anchor's interval is about
  4% wide and a tenth of a count claims precision it does not have), and opening the stage at
  `midOf(ctx.draft.bounds)` rather than `bounds[0]`, are both yours;
  `tests/ui/session-view.test.ts`'s expectations move with them.
- `src/ui/case-study/*`: the worked example's NUMBERS are converted (`content.ts`'s `demoConvergence`
  entirely, `case-study.ts`'s specimen-card strings, and `chrome.ts`'s one tag label), because the
  rename relabelled them as counts and would otherwise have shipped 28.1 counts per 360 on a
  user-facing page. The ten "cm/360" prose strings in `content.ts` (lines 28, 33, 35, 40, 43, 75, 99,
  111, 128, 138), the card-sweep and spin narration, and `src/ui/concord.ts`'s two `BOUNDED_COPY`
  strings are untouched and are yours, along with finding 18's `tests/ui/canon-copy.test.ts`.
- The `adoptResult` open question from the previous round is CLOSED, not handed on: `ci90` and
  `prescription` are both dropped, and `Result.ci90` is optional. `src/ui/range-adopt.ts` holds one
  authored body, the one in task 4 step 9, and `tests/ui/range-adopt.test.ts` is at 7 cases with a
  case pinning each drop. If your document still carries an `adoptResult` body of its own, delete it
  so there is one.

**To phase 2 (the turn).** `src/input/dpi-sweep.ts` and `src/ui/calibrate/sweep-view.ts` now declare a
file-local `type Dpi = number` / `type SweepCounts = number` because those types left `src/types.ts`;
delete the files rather than the aliases. `src/ui/calibrate/spin-view.ts` has a file-local
`degPerCountForSpin` and `PROVISIONAL_COUNTS = 9450` in place of the deleted `convert/turn-rate.ts`,
and its `onSeed` now emits a `Counts360` taken straight from `acc.pathLength()`, with no DPI in the
path. Do not reintroduce the retired token in a comment: task 5 step 4 gates on
`grep -rn "[Cc][Mm]360" --include="*.ts" src tests` printing nothing, and your task 19 should run the
same gate.

`src/ui/setup.ts` is yours and your task 18 replaces it, but it is NOT untouched at the end of phase
1a, and the interim state is forced rather than designed: `SessionDraft.dpi` and `PersistedPrefs.dpi`
no longer exist, and `convert/cm360.ts` and `input/dpi.ts` are deleted in task 5, so the DPI field,
its validation branch, the `isValidDpi`/`parseDpi` imports and the `cmPer360` seed all had to go in
phase 1a or the build breaks. What is there now: `usableNumbers(sens)` takes one argument,
`commitManual(sens, game, goal)` seeds the window with `countsForSens(sens, yawFor(game))` (the exact
typed route), the typed step has three fields (game, sens, goal), and the returning-visitor lead says
"You've calibrated before. Searching lo to hi counts per 360." Six cases were deleted from
`tests/ui/setup.test.ts`, taking it to 22. Nothing about that interim is a claim on your design.
`midOf(bounds)` in `src/ui/options/settings.ts` gives the geometric centre of a window if your turn
view wants to open the arena at it.

**To phase 3 (the convention).** `rawDeltasFrom(events)` in `src/input/pointer-lock.ts` returns the
untouched `movementX` stream as `number[]`, which is exactly `conventionFrom`'s parameter, and the
controller exposes `onRawDelta(cb: (dx, dy) => void)` fed from the same coalesced batch as the
samples. Nothing divides by `devicePixelRatio` anywhere any more, so a spacing other than 1 is real
signal rather than a DPR artefact. `perGameSens` is deleted from `src/convert/schools.ts` (amendment
A6), so `tierTwoFrom` in `src/input/count-convention.ts` is the only place in the repo that turns a
count total into a native in-game sensitivity; `sensFor(counts, yaw)` in `src/convert/counts.ts` is
the arithmetic, and its doc comment now warns that its `counts` argument must be hardware counts.
The options screen's sensitivity column is deleted for the same reason.

**To phase 4 (the anchor).** `TrialContext` is `{ counts, rng, profile, prevCounts? }` and
`TrialResult.counts` is a `Counts360`, so a submovement threshold expressed in counts per second has
a count-space quantity to compare against. `src/instruments/acclimation.ts`'s private lead-in seed no
longer mixes a DPI (it was constant across a session and the tool no longer measures one), so
`leadSeed` is `Math.round(ctx.counts * 1e4)` plus the instrument id; the scale factor is unchanged
and is not a unit constant. `src/instruments/flick.ts`, `strike.ts`, `track.ts`, `calibrate.ts` and
`acclimation.ts` are yours (A2, finding 41) and phase 1a touched them only to drop the second
argument to `scene.setSensitivity` and the deleted `ctx.dpi` read.
`src/optimizer/session-controller.ts` is phase 1a's for the unit swap and yours for the wiring task
amendment A3 requires: at the end of phase 1a, `SessionConfig` has no `dpi`, `ciStopWidth` is a plain
`number` (a width, not a position), and the trial context is built at one site, immediately before
`config.instruments[id].run(...)`, which is where `observer.beginTrial(...)` goes.


### Task 9: The Prescription shape and the ratio that refuses before it guesses

**Files:**
- Modify: `src/optimizer/result.ts` (full rewrite, shown below)
- Create: `tests/optimizer/prescription.test.ts`
- Modify: `tests/optimizer/result.test.ts` (full rewrite, shown below)
- Modify: `src/ui/session-view.ts` (one call site, signature only; line 289 at HEAD)
- Modify: `tests/optimizer/facet-concordance.test.ts:82,89` (two call sites, signature only)

Preconditions this task assumes, all landed before it starts:

1. Phase 1a tasks 1 to 5 have ALL landed and `Cm360`, `Dpi`, `Session.dpi` and `SessionDraft.dpi`
   are GONE. `src/types.ts` exports `Counts360` and `counts360`; `Report` reads
   `{ optimalCounts: Counts360; ci90: [Counts360, Counts360]; curve; driftZ?; peakAtBound? }` with
   `curve[].x` the natural log of the counts-per-360 value; `src/convert/counts.ts` exists with
   `sensFor(counts: Counts360, yaw: number): number`. `Result.perGameSens` is deleted outright,
   `Result` carries `prescription?: Prescription` (phase 1a task 4, per findings F2/F6 and
   amendment A5), `Result.ci90` is OPTIONAL per the contract's Round 3 decision D1 (absent means
   tuned by feel; task 11's screen guards every read accordingly), and `perGameSens` in
   `src/convert/schools.ts` is gone with `cm360.ts` (phase 1a
   task 5, per F5). Phase 1a's minimal compile patch also removed the old result screen's per-game
   table read; this part rebuilds tier two behind the k gate in task 11.
2. Phase 3 tasks 23 to 27 have landed. They are sequenced BEFORE this part on purpose:
   `src/input/lattice.ts` and `src/input/count-convention.ts` are pure modules that depend only on
   phase 1a's types and converters, and A4 makes phase 3 the single owner of `KPin` and
   `tierTwoFrom`. This task imports both; there is no second implementation of tier two anywhere
   (the `PinnedK`/`perGameFromCounts` pair this part once declared is deleted by this rewrite).

If 1a's mechanical rename sweep left interim edits in `src/optimizer/result.ts`, they are
irrelevant except for one export: task 4 declared a first cut of the `Prescription` interface here
so that `types.ts` could import it in the same commit that deleted `Result.perGameSens` (hand-off
H1 below). Step 3 replaces the whole file and replaces that interface too: the shape below adds
`hardwareCounts?: Counts360` (A6), which task 4's seven-member cut does not have, and integration
task 39 later adds `k?: number`. Nothing reads `hardwareCounts` before task 11, so every
intermediate state compiles, and this step is the source of truth for the shape until task 39
amends it.

- [ ] **Step 1: Write the failing test**

Create `tests/optimizer/prescription.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  buildPrescription, ratioFraming, CONFIRMED_MAX_ABS_LN, type AnchorReading,
} from '../../src/optimizer/result';
import type { KPin } from '../../src/input/count-convention';
import { counts360, type Counts360, type Report } from '../../src/types';
import { sensFor } from '../../src/convert/counts';
import { yawFor } from '../../src/convert/yaw-table';

const c = counts360;
const ci = (lo: number, hi: number): [Counts360, Counts360] => [c(lo), c(hi)];

const report: Report = {
  optimalCounts: c(8000),
  ci90: ci(7500, 8600),
  curve: [{ x: Math.log(8000), mean: 0.4 }],
};
const anchor: AnchorReading = { counts: c(7040), ci90: ci(6800, 7300) };
// The two allowed pin routes and the unpinned refusal, in phase 3's own KPin shape. There is no
// third route: a k inferred from a discrete DPI prior is the false-precision shortcut the spec bans.
const LATTICE_2: KPin = { pinned: true, k: 2, source: 'lattice', logSd: 0 };
const TYPED_125: KPin = { pinned: true, k: 1.25, source: 'typed-sens', logSd: 0.12 };
const UNPINNED: KPin = { pinned: false, reason: 'gate-closed' };

describe('buildPrescription', () => {
  it('the ratio is anchor counts over located counts, with the conservative quotient interval', () => {
    const p = buildPrescription(report, anchor)!;
    expect(p).not.toBeNull();
    expect(p.ratio).toBe(7040 / 8000); // 0.88 exactly
    // Endpoint quotient [aLo/cHi, aHi/cLo]: deliberately wider than an independence-assuming
    // combination, because the dependence between the two CIs is not measured. Widen, never narrow.
    expect(p.ratioCi90).toEqual([6800 / 8600, 7300 / 7500]);
    expect(p.ratio!).toBeGreaterThanOrEqual(p.ratioCi90![0]);
    expect(p.ratio!).toBeLessThanOrEqual(p.ratioCi90![1]);
  });

  it('copies C* and its CI verbatim; this layer never refits', () => {
    const p = buildPrescription(report, anchor)!;
    expect(p.counts).toBe(report.optimalCounts);
    expect(p.countsCi90).toBe(report.ci90); // same reference: provably no recomputation
  });

  it('the ratio is byte-identical under scaling every count by the same factor', () => {
    // The unit-freedom thesis at the payoff layer: C0 and C* are counted in the same browser
    // units, so a convention factor k multiplies numerator and denominator alike and cancels.
    // The factors below keep every product exactly representable (integer inputs, few-bit
    // factors), so both quotients are the correctly rounded image of the same real number and
    // Object.is is exact rather than approximate. The full-pipeline version (a recorded session,
    // k = 7.3, exact at k = 1 and 1e-9 elsewhere per amendment A7) is phase 1a's task 6, and it
    // runs through THIS function, buildPrescription, because this is the shipped path; this test
    // pins the identity the payoff layer itself must preserve.
    const base = buildPrescription(report, anchor)!;
    for (const k of [2, 0.5, 1.5, 4]) {
      const scaled = buildPrescription(
        { ...report, optimalCounts: c(8000 * k), ci90: ci(7500 * k, 8600 * k) },
        { counts: c(7040 * k), ci90: ci(6800 * k, 7300 * k) },
      )!;
      expect(Object.is(scaled.ratio, base.ratio)).toBe(true);
      expect(Object.is(scaled.ratioCi90![0], base.ratioCi90![0])).toBe(true);
      expect(Object.is(scaled.ratioCi90![1], base.ratioCi90![1])).toBe(true);
    }
  });

  it('refuses with neither an anchor nor a pinned k: nothing to say, never a padded factor', () => {
    expect(buildPrescription(report, null)).toBeNull();
    expect(buildPrescription(report, null, UNPINNED)).toBeNull();
  });

  it('a refused anchor with a pinned k still yields tier two, with the ratio fields ABSENT (A5)', () => {
    // The reachable state that forced ratio/ratioCi90 optional: lattice scaled(k) pinned k, but
    // the turn disagreed and the flick anchor refused. Tier two is honest on its own; requiring
    // the ratio here would withhold a table whose one assumption IS measured.
    const p = buildPrescription(report, null, LATTICE_2)!;
    expect(p).not.toBeNull();
    expect('ratio' in p).toBe(false);
    expect('ratioCi90' in p).toBe(false);
    expect(p.counts).toBe(report.optimalCounts);
    expect(p.kSource).toBe('lattice');
    expect(p.perGameSens!.cs2).toBeCloseTo(sensFor(c(4000), yawFor('cs2')), 12);
  });

  it('refuses on a clamped vertex, even with k pinned: a factor or table against a bound would prescribe the window edge', () => {
    expect(buildPrescription({ ...report, peakAtBound: 'high' }, anchor)).toBeNull();
    expect(buildPrescription({ ...report, peakAtBound: 'low' }, anchor)).toBeNull();
    expect(buildPrescription({ ...report, peakAtBound: 'high' }, null, LATTICE_2)).toBeNull();
  });

  it('refuses degenerate inputs rather than emitting a plausible wrong number', () => {
    // A non-null but degenerate anchor is a CALLER BUG, not an honest refusal, so the whole
    // prescription refuses (tier two included) rather than papering over it: reconcile() returns
    // null when it cannot anchor, never NaN or an inverted interval.
    expect(buildPrescription(report, { counts: c(NaN), ci90: ci(6800, 7300) })).toBeNull();
    expect(buildPrescription(report, { counts: c(7040), ci90: ci(0, 7300) })).toBeNull();
    expect(buildPrescription(report, { counts: c(7040), ci90: ci(7300, 6800) })).toBeNull();
    expect(buildPrescription({ ...report, ci90: ci(8600, 7500) }, anchor)).toBeNull();
  });

  it('emits the per-game table ONLY under a pinned k, at true counts = browser counts / k', () => {
    const p = buildPrescription(report, anchor, LATTICE_2)!;
    expect(p.kSource).toBe('lattice');
    // k = 2 means the browser doubled hardware counts, so true counts per 360 = 8000 / 2 and the
    // native sens follows 360 / (yaw * trueCounts). The arithmetic lives in phase 3's
    // tierTwoFrom, the ONLY implementation of tier two (A4); this asserts the wiring, not a copy.
    expect(p.perGameSens!.cs2).toBeCloseTo(sensFor(c(4000), yawFor('cs2')), 12);
    expect(p.perGameSens!.valorant).toBeCloseTo(sensFor(c(4000), yawFor('valorant')), 12);
  });

  it('withholds tier two without k: the fields are ABSENT, not defaulted to k = 1', () => {
    const p = buildPrescription(report, anchor)!;
    // Spelling k = 1 here would be the exact silent factor error the lattice's one-sided
    // contract exists to prevent; absence is the only honest encoding of "unpinned".
    expect('perGameSens' in p).toBe(false);
    expect('kSource' in p).toBe(false);
    expect('kLogSd' in p).toBe(false);
    expect('hardwareCounts' in p).toBe(false);
  });

  it('treats an unpinned KPin exactly like an absent one: the refusal costs the tier, never the ratio', () => {
    const p = buildPrescription(report, anchor, UNPINNED)!;
    expect('perGameSens' in p).toBe(false);
    expect('kSource' in p).toBe(false);
    expect(p.ratio).toBe(7040 / 8000);
  });

  it('carries kLogSd and the hardware counts whole, so tier two can widen and tier three can disclose (A5, A6)', () => {
    const p = buildPrescription(report, anchor, TYPED_125)!;
    // The typed-sens route inherits the anchor's spread whole; the screen folds it into each
    // per-game row's band in quadrature with the search's own interval (D3). hardwareCounts =
    // C* / k is the only honest number tier three may call centimetre-convertible when k is
    // pinned.
    expect(p.kLogSd).toBe(0.12);
    expect(p.hardwareCounts).toBe(8000 / 1.25);
    const q = buildPrescription(report, anchor, LATTICE_2)!;
    expect(q.kLogSd).toBe(0);
    expect(q.hardwareCounts).toBe(4000);
  });

  it('can restrict the table to a subset of games', () => {
    const p = buildPrescription(report, anchor, TYPED_125, ['cs2', 'valorant'])!;
    expect(Object.keys(p.perGameSens!).sort()).toEqual(['cs2', 'valorant']);
  });
});

describe('ratioFraming', () => {
  it('directional when the interval excludes no-change', () => {
    expect(ratioFraming([0.79, 0.97])).toBe('directional');
    expect(ratioFraming([1.02, 1.31])).toBe('directional');
  });

  it('confirmed when the interval contains 1 and is confined within the resolution floor', () => {
    expect(ratioFraming([0.96, 1.04])).toBe('confirmed');
    // ln(1.05) = 0.0488 sits just under the 0.05 floor: the widest band still read as "already
    // there". Pinned so the constant cannot drift below the copy that quotes 5%.
    expect(Math.log(1.05)).toBeLessThanOrEqual(CONFIRMED_MAX_ABS_LN);
    expect(ratioFraming([0.96, 1.05])).toBe('confirmed');
  });

  it('indistinct when the interval contains 1 but is wider than the floor', () => {
    // The screen must then DROP the change framing (spec error path: an interval spanning a
    // ratio of 1 cannot distinguish a change from none).
    expect(ratioFraming([0.94, 1.04])).toBe('indistinct');
    expect(ratioFraming([0.9, 1.2])).toBe('indistinct');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/optimizer/prescription.test.ts`
Expected: FAIL at import time with `SyntaxError: [vitest] The requested module '/src/optimizer/result.ts' does not provide an export named 'buildPrescription'` (the module exists and exports `Prescription`, `ciConcord` and `buildResult`; the function is what is missing)

- [ ] **Step 3: Write the implementation (full replacement of `src/optimizer/result.ts`)**

```ts
import type { Counts360, GameId, Profile, Report, Result, TrialResult } from '../types';
import { counts360 } from '../types';
import { sensRatio } from '../convert/counts';
import { tierTwoFrom, type KPin } from '../input/count-convention';
import { computeBreakdown, facetConcordance } from './breakdown';
import { mulberry32 } from '../stats/rng';

export type CiConcord = 'tight' | 'moderate' | 'wide';

/**
 * Bucket the 90% CI into a LOG-SPACE WIDTH-RELATIVE descriptor by thresholds only - NOT an invented
 * agreement score. Reads exactly the CI width in ln space, `ln(hi) - ln(lo)`, the same scale the
 * curve is fit on, and scale-invariant (an 8000 to 8800 CI buckets identically to a 16000 to 17600
 * one - which is also why the cm-to-counts unit change left the thresholds untouched). The
 * descriptor is purely a width bucket; the COPY that renders it must never assert a single cause (a
 * wide CI cannot distinguish short-session sampling noise from facet disagreement). Returns
 * undefined for a degenerate/non-finite CI so no descriptor is fabricated for an unmeasurable bound.
 */
export function ciConcord(_optimal: Counts360, ci90: readonly [Counts360, Counts360]): CiConcord | undefined {
  const [lo, hi] = ci90;
  if (!(lo > 0) || !(hi > 0) || !(hi > lo)) return undefined;
  const w = Math.log(hi) - Math.log(lo); // CI width in ln space (scale-invariant)
  if (w <= 0.18) return 'tight';   // ratio hi/lo below about 1.20
  if (w >= 0.55) return 'wide';    // ratio hi/lo above about 1.73
  return 'moderate';
}

/**
 * The payoff, shaped by what each claim assumes (spec: "The result screen, ordered by what each
 * claim assumes"). Tier one is `ratio`, present only when an anchor was measurable; tier two is
 * `perGameSens`, present ONLY under a pinned k; tier three is `counts`, restated by the screen
 * with the optional typed-DPI arithmetic. The shape is canonical (plan contract, Decision 1 as
 * amended by A5: ratio/ratioCi90 optional, kLogSd added). `hardwareCounts` goes one field beyond
 * the amended contract and is flagged in this part's hand-offs: A6 requires tier three to render
 * C*/k when k is pinned, and the screen has no other honest access to k.
 */
export interface Prescription {
  /** anchor.counts / report.optimalCounts: the factor to multiply the current in-game sensitivity
   *  by. A ratio of two quantities counted in the same browser units, so k, yaw and any unit
   *  convention cancel exactly - the one claim on the payoff screen that assumes nothing. OPTIONAL
   *  (A5): absent exactly when the anchor refused; a session can still earn tier two without it. */
  ratio?: number;
  /** Conservative 90% band on the ratio: [anchor.lo / counts.hi, anchor.hi / counts.lo]. The
   *  endpoint quotient is wider than an independence-assuming error product on purpose: the
   *  dependence between the two CIs is not measured, and intervals widen, never narrow. Present
   *  exactly when `ratio` is. */
  ratioCi90?: [number, number];
  /** C*, the located optimum in browser counts per 360, copied verbatim from the Report. */
  counts: Counts360;
  countsCi90: [Counts360, Counts360];
  /** ONLY when k is pinned (lattice `scaled(k)` or a typed in-game sensitivity). Absent means
   *  unpinned and tier two is withheld - never a table computed from a guessed k. Computed by
   *  phase 3's tierTwoFrom, the single implementation of tier two (A4). */
  perGameSens?: Partial<Record<GameId, number>>;
  /** Absent exactly when `perGameSens` is: an unpinned k costs the tier, never the answer. */
  kSource?: 'lattice' | 'typed-sens';
  /** k's own uncertainty in ln space, inherited whole from the pin (A5). On the typed-sens route
   *  this is the anchor's reproduction spread landing whole on k, so it is not small; the screen
   *  folds it into each per-game row's 90% band in quadrature with `countsCi90` (D3), so the
   *  band carries BOTH the search's precision and the pin's. 0 on the lattice route as phase 3
   *  currently pins it, and the band still renders then, carrying the search term alone.
   *  Present exactly when `perGameSens` is. */
  kLogSd?: number;
  /** C* / k: the located optimum in the mouse's OWN counts (A6). Present exactly when k is
   *  pinned. Tier three renders THIS as convertible hardware counts; without it the screen keeps
   *  browser counts and must disclose the second unmeasured factor in any centimetre arithmetic. */
  hardwareCounts?: Counts360;
}

/** The C0 reading tier one divides by. A structural subset of reconcile.ts's `Anchor` (phase 4),
 *  declared here so this module never imports a file it does not own: phase 4 passes its Anchor
 *  straight in and TypeScript checks it structurally. */
export interface AnchorReading { counts: Counts360; ci90: [Counts360, Counts360]; }

/**
 * Build the payoff tiers, or refuse. Every early return here is a measured-honesty gate, not
 * defensiveness: this function would rather hand the screen nothing than a plausible wrong factor,
 * because the factor is the number a player will actually type into their game.
 */
export function buildPrescription(
  report: Report,
  anchor: AnchorReading | null,
  k?: KPin,
  games?: readonly GameId[],
): Prescription | null {
  // A clamped vertex is a bound with the evidence pointing past it (Report.peakAtBound). A factor
  // OR a per-game table taken against a bound would prescribe the edge of MY search window as if
  // it were the player's best, so the whole prescription refuses and the screen keeps its bound
  // copy instead.
  if (report.peakAtBound !== undefined) return null;
  const cStar = report.optimalCounts;
  const [cLo, cHi] = report.ci90;
  const positive = (v: number): boolean => Number.isFinite(v) && v > 0;
  if (![cStar, cLo, cHi].every(positive) || cHi < cLo) return null;
  // Tier one exists only with an anchor. anchor === null is the honest refusal (turn disagreed,
  // flick refused) and costs the ratio alone; a NON-null anchor with a NaN, non-positive count or
  // inverted interval means the caller has a bug this module must not paper over: refuse the
  // whole prescription outright (pinned by 'refuses degenerate inputs').
  let tierOne: { ratio: number; ratioCi90: [number, number] } | null = null;
  if (anchor !== null) {
    const [aLo, aHi] = anchor.ci90;
    if (![anchor.counts, aLo, aHi].every(positive) || aHi < aLo) return null;
    // sensRatio is the ONE implementation of the tier-one quotient (phase 1a's hand-off): a second
    // open-coded copy of the same division would be a second place for it to drift. The positive
    // checks above already satisfy its own guard, so it cannot throw here.
    tierOne = { ratio: sensRatio(anchor.counts, cStar), ratioCi90: [aLo / cHi, aHi / cLo] };
  }
  // Tier two rides only on a pinned k, and phase 3's tierTwoFrom is its ONLY implementation (A4):
  // a second path to the same number would be a second place for k to go missing. An unpinned
  // KPin costs the tier, never the ratio.
  let tierTwo:
    | { perGameSens: Partial<Record<GameId, number>>; kSource: 'lattice' | 'typed-sens'; kLogSd: number; hardwareCounts: Counts360 }
    | null = null;
  if (k !== undefined && k.pinned) {
    const t = tierTwoFrom(cStar, k, games);
    // hardwareCounts carries the SAME division tierTwoFrom performs, surfaced so tier three can
    // render mouse-own counts when k is pinned (A6) - one k, applied in one commit of arithmetic.
    if (t !== null) tierTwo = { ...t, hardwareCounts: counts360(cStar / k.k) };
  }
  // Neither tier earned: there is nothing to prescribe. The located counts still reach the screen
  // through the Result itself, so refusing here costs the factor and the table and nothing else.
  if (tierOne === null && tierTwo === null) return null;
  return {
    counts: cStar,
    countsCi90: report.ci90,
    ...(tierOne ?? {}),
    ...(tierTwo ?? {}),
  };
}

export type RatioFraming = 'directional' | 'confirmed' | 'indistinct';

/** Everything the ratio interval allows must sit within this of no change (in |ln|) before the
 *  screen may read it as "already at your best". 0.05 sits just above the anchor's simulated
 *  accuracy floor (about 4% MAE across the spec's Monte Carlo conditions), so the confirmed claim
 *  never outruns the instrument's own resolution; below that floor, "move by 3%" would be noise
 *  dressed as an instruction. */
export const CONFIRMED_MAX_ABS_LN = 0.05;

/**
 * Which sentence the ratio has earned. 'directional': the interval excludes 1, a change is
 * distinguishable from none, the multiply instruction leads. 'confirmed': the interval contains 1
 * AND is confined within CONFIRMED_MAX_ABS_LN of it - the best outcome the instrument can report,
 * phrased by the screen as what the interval supports and no more (see F33: the copy must not
 * claim the session "had every chance", which is a claim about the design, not a measurement).
 * 'indistinct': the interval contains 1 but is not confined, so the screen drops the change
 * framing rather than report a change it cannot distinguish from none (spec, error-path list,
 * final item). Callers pass a buildPrescription vetted interval; this classifier never repairs one.
 */
export function ratioFraming(ratioCi90: readonly [number, number]): RatioFraming {
  const [lo, hi] = ratioCi90;
  if (lo > 1 || hi < 1) return 'directional';
  return Math.max(Math.abs(Math.log(lo)), Math.abs(Math.log(hi))) <= CONFIRMED_MAX_ABS_LN
    ? 'confirmed'
    : 'indistinct';
}

export interface BuildResultOpts {
  /** Restrict tier two's table (default: every yaw-table game). */
  games?: readonly GameId[];
  /** Search bounds, persisted with the verbatim curve so the plot survives a reload. */
  bounds?: [Counts360, Counts360];
  profile?: Profile;
}

/**
 * Assemble the player-facing Result: the located optimum in counts per 360 + CI, the breakdown of
 * how each facet contributed, and (when `bounds` is supplied) the Report's fitted `curve` copied
 * VERBATIM with the bounds persisted, so the result screen can redraw the convergence plot with a
 * correct x-axis after a localStorage reload (strictly downstream of scoring - NO smoothing, NO
 * refit). `profile` is the SAME profile the optimizer fused with; omitting it leaves the affine
 * contributions NaN (rendered as a dash) and the lean absent, so old/headless callers stay
 * number-only.
 *
 * The per-game table no longer lives on the Result: it is tier two of the Prescription and exists
 * only under a pinned k (buildPrescription). Computing it from counts alone would need exactly the
 * k = 1 guess the lattice's one-sided contract forbids.
 */
export function buildResult(
  report: Report,
  trials: readonly TrialResult[],
  opts: BuildResultOpts = {},
): Result {
  const { bounds, profile } = opts;
  return {
    optimalCounts: report.optimalCounts,
    ci90: report.ci90,
    breakdown: computeBreakdown(trials, report.optimalCounts, profile),
    ...(bounds ? { curve: report.curve, bounds } : {}),
    // The strike lean is the user's REAL taste knob (profile.speedAccuracy), not the hardcoded
    // instrumentWeights.strike (=1). Carry it so the result screen can label the strike rows. Omit
    // it without a profile so old/headless callers stay number-only.
    ...(profile && Number.isFinite(profile.speedAccuracy) ? { speedAccuracy: profile.speedAccuracy } : {}),
    // A4: the measured session-drift readout, copied VERBATIM from the Report. Absent when the
    // extended fit fell back (or for old reports) so the result screen dashes it - never padded.
    ...(report.driftZ !== undefined ? { driftZ: report.driftZ } : {}),
    // Bounds honesty: the clamped-vertex disclosure, copied verbatim. Absent for interior peaks and
    // for old reports; never inferred from the optimum happening to sit on an edge.
    ...(report.peakAtBound !== undefined ? { peakAtBound: report.peakAtBound } : {}),
    // A5: the per-facet peaks + concordance tier. Seeded on the trial count (a decoupled stream)
    // so this readout is deterministic and never perturbs the scored sequence.
    facetConcordance: facetConcordance(trials, mulberry32(0xface ^ trials.length)),
  };
}
```

- [ ] **Step 4: Run the new test to verify it passes**

Run: `npx vitest run tests/optimizer/prescription.test.ts`
Expected: PASS (15 tests: 12 buildPrescription + 3 ratioFraming)

- [ ] **Step 5: Rewrite `tests/optimizer/result.test.ts` onto counts and the new signature (full replacement)**

```ts
import { describe, it, expect } from 'vitest';
import { buildResult, ciConcord } from '../../src/optimizer/result';
import { counts360, type Counts360, type Profile, type Report, type TrialResult } from '../../src/types';

const c = counts360;
const ci = (lo: number, hi: number): [Counts360, Counts360] => [c(lo), c(hi)];

const report: Report = { optimalCounts: c(8000), ci90: ci(7000, 9200), curve: [{ x: Math.log(8000), mean: 0.1 }] };
const trials: TrialResult[] = [
  { instrument: 'calibrate', counts: c(7000), score: 0.5, raw: { gain: 1.1, sigmaR: 0.4 }, at: 0 },
  { instrument: 'calibrate', counts: c(9200), score: 0.5, raw: { gain: 0.9, sigmaR: 0.35 }, at: 0 },
  { instrument: 'strike', counts: c(8200), score: 1, raw: { ttkMs: 510, hitRate: 0.86 }, at: 0 },
];
const profile: Profile = { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } };

describe('buildResult', () => {
  it('carries the optimum + CI in counts per 360', () => {
    const r = buildResult(report, trials);
    expect(r.optimalCounts).toBe(8000);
    expect(r.ci90).toEqual([7000, 9200]);
  });

  it('includes the breakdown', () => {
    const r = buildResult(report, trials);
    expect(r.breakdown.ttkMs).toBe(510);
    expect(r.breakdown.precisionFloorDeg).toBeCloseTo(0.35, 6);
    expect(r.breakdown.biasZeroCounts).toBeGreaterThan(7000);
    expect(r.breakdown.biasZeroCounts).toBeLessThan(9200);
  });

  it('copies the report curve VERBATIM and stores the search bounds for the plot', () => {
    const r = buildResult(report, trials, { bounds: ci(4000, 16000) });
    expect(r.curve).toEqual(report.curve); // byte-for-byte, no smoothing/refit
    expect(r.bounds).toEqual([4000, 16000]);
  });

  it('omits curve/bounds when no bounds are supplied (old/headless callers stay number-only)', () => {
    const r = buildResult(report, trials);
    expect(r.curve).toBeUndefined();
    expect(r.bounds).toBeUndefined();
  });

  it('threads the profile into the breakdown so track/flick fuse their affine contribution', () => {
    const probe = (instrument: 'track' | 'flick', counts: number, score: number): TrialResult => ({
      instrument, counts: c(counts), score, raw: {}, at: 0,
    });
    const tf = [
      ...trials,
      probe('flick', 5500, 0.4), probe('flick', 8800, 0.9),
      probe('track', 6300, 0.5), probe('track', 10000, 0.8),
    ];
    const r = buildResult(report, tf, { profile });
    expect(Number.isFinite(r.breakdown.flickContribZ!)).toBe(true);
    expect(Number.isFinite(r.breakdown.trackContribZ!)).toBe(true);
  });

  it('without a profile the affine contributions stay NaN (old callers stay number-only)', () => {
    const r = buildResult(report, trials);
    expect(Number.isNaN(r.breakdown.trackContribZ!)).toBe(true);
    expect(Number.isNaN(r.breakdown.flickContribZ!)).toBe(true);
  });

  it('plumbs the profile speedAccuracy lean into the Result (the real taste knob)', () => {
    const r = buildResult(report, trials, { profile: { ...profile, speedAccuracy: 0.7 } });
    expect(r.speedAccuracy).toBeCloseTo(0.7, 9);
  });

  it('omits speedAccuracy without a profile (old/headless callers stay number-only)', () => {
    const r = buildResult(report, trials);
    expect(r.speedAccuracy).toBeUndefined();
  });

  it('carries the measured session-drift readout (driftZ) verbatim from the Report (A4)', () => {
    const r = buildResult({ ...report, driftZ: 0.42 }, trials);
    expect(r.driftZ).toBe(0.42);
  });

  it('omits driftZ when the Report has none (fell back / old report, dashed, never padded)', () => {
    const r = buildResult(report, trials);
    expect(r.driftZ).toBeUndefined();
  });

  it('carries the peakAtBound disclosure verbatim from the Report (a bound stays a bound)', () => {
    const r = buildResult({ ...report, peakAtBound: 'high' }, trials);
    expect(r.peakAtBound).toBe('high');
    const l = buildResult({ ...report, peakAtBound: 'low' }, trials);
    expect(l.peakAtBound).toBe('low');
  });

  it('omits peakAtBound when the Report has none (old persisted results degrade gracefully)', () => {
    // Absence must mean "no clamp was recorded", never be inferred from the optimum sitting on
    // an edge: an old saved Result cannot have the flag fabricated for it in either direction.
    const r = buildResult(report, trials);
    expect(r.peakAtBound).toBeUndefined();
    const edge = buildResult({ ...report, optimalCounts: c(16000) }, trials);
    expect(edge.peakAtBound).toBeUndefined();
  });
});

describe('ciConcord', () => {
  // The descriptor is a LOG-SPACE WIDTH-RELATIVE threshold bucket, NOT an invented agreement
  // score: it reads only ln(hi) - ln(lo), so it survived the cm-to-counts unit change untouched.
  it('buckets a narrow CI as tight', () => {
    expect(ciConcord(c(3100), ci(3000, 3200))).toBe('tight'); // ln width about 0.065
  });
  it('buckets a mid CI as moderate', () => {
    expect(ciConcord(c(8000), ci(7000, 9200))).toBe('moderate'); // ln width about 0.273
  });
  it('buckets a broad CI as wide', () => {
    expect(ciConcord(c(8000), ci(4500, 12500))).toBe('wide'); // ln width about 1.02
  });
  it('is scale-invariant (width-relative in ln space, not absolute)', () => {
    expect(ciConcord(c(3100), ci(3000, 3200))).toBe(ciConcord(c(6200), ci(6000, 6400)));
    expect(ciConcord(c(8000), ci(7000, 9200))).toBe(ciConcord(c(16000), ci(14000, 18400)));
  });
  it('returns undefined for a degenerate/non-finite CI (no fabricated descriptor)', () => {
    expect(ciConcord(c(8000), [c(NaN), c(9200)])).toBeUndefined();
    expect(ciConcord(c(8000), [c(0), c(9200)])).toBeUndefined();
    expect(ciConcord(c(8000), [c(9200), c(8000)])).toBeUndefined(); // hi <= lo
  });
});
```

- [ ] **Step 6: Repoint the two external buildResult call sites (signature only)**

In `src/ui/session-view.ts`, inside `finalize()` (line 289 at HEAD), the call becomes exactly:

```ts
const result = buildResult(report, allTrials, { bounds: ctx.draft.bounds, profile: ctx.draft.profile });
```

(Whatever interim spelling phase 1a's compile patch left, the replacement above is the complete
final form of the statement: find the single `buildResult(` call in the file and make it read as
shown. The `anchor` and `k` options arrive in integration task 40, the wiring task that owns this
`finalize` block; see hand-off H5 below. They do not arrive here.)

In `tests/optimizer/facet-concordance.test.ts`, both `buildResult(` calls (lines 82 and 89 at
HEAD) lose the dpi/games/bounds positional arguments; the tests assert only the concordance
attachment, which is unconditional, so each call becomes exactly:

```ts
const r = buildResult(report, trials, { profile });
```

and

```ts
const measured = buildResult(report, trials, { profile });
```

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS, zero failures (the suite total grows by the 15 prescription tests; nothing else regresses)

- [ ] **Step 8: Commit**

```bash
git add src/optimizer/result.ts tests/optimizer/prescription.test.ts tests/optimizer/result.test.ts src/ui/session-view.ts tests/optimizer/facet-concordance.test.ts
git commit -m "feat(prescription): the payoff shape, and a ratio that refuses before it guesses" -m "buildPrescription owns tier one (the anchor/optimum quotient with a widen-only interval) and wires tier two through phase 3's tierTwoFrom, the single implementation of the k division (A4). ratio and ratioCi90 are optional per A5: a pinned k with a refused anchor still earns the table. kLogSd rides so the screen can widen tier two by k's own spread, and hardwareCounts rides so tier three can disclose instead of overclaim (A6). Absence is never spelled k = 1."
```
### Task 10: The convergence plot moves to a counts log axis, same curve, honest label

**Files:**
- Modify: `src/ui/convergence-plot.ts` (full rewrite, shown below)
- Modify: `tests/ui/convergence-plot.test.ts` (full rewrite, shown below)
- Modify: `tests/ui/convergence-plot.render.test.ts` (full rewrite, shown below)
- Modify: `src/ui/session-view.ts:21-23` (`marksFromTrials`, one mapping line)
- Modify: `tests/ui/session-view.test.ts:31-38` (the marks-mapping expectation keys)

Preconditions: `FacetPeak.peakCounts` (renamed from `peakCm360` by phase 1a) and
`TrialResult.counts` (renamed from `cm360`) exist in `src/types.ts`.

- [ ] **Step 1: Write the failing test (full replacement of `tests/ui/convergence-plot.test.ts`)**

```ts
import { describe, it, expect } from 'vitest';
import { countTicks, plotGeometry, tickLabel } from '../../src/ui/convergence-plot';
import { counts360, type Counts360 } from '../../src/types';

const c = counts360;
const size = { width: 600, height: 300 };
const bounds: [Counts360, Counts360] = [c(1500), c(24000)];

describe('countTicks', () => {
  it('walks the 1/1.5/2/3/5/7 ladder per decade inside the bounds', () => {
    expect(countTicks(1500, 24000)).toEqual([1500, 2000, 3000, 5000, 7000, 10000, 15000, 20000]);
  });
  it('thins to 1/2/5 when the full ladder would shingle the labels', () => {
    expect(countTicks(200, 90000)).toEqual([200, 500, 1000, 2000, 5000, 10000, 20000, 50000]);
  });
  it('labels compactly: a 10px mono tick cannot afford five digits', () => {
    expect(tickLabel(800)).toBe('800');
    expect(tickLabel(1500)).toBe('1.5k');
    expect(tickLabel(8000)).toBe('8k');
    expect(tickLabel(20000)).toBe('20k');
  });
});

describe('plotGeometry', () => {
  it('maps the counts bounds (log axis) to the padded x-extent', () => {
    const g = plotGeometry({ bounds, marks: [], size });
    const left = g.xToPx(1500);
    const right = g.xToPx(24000);
    expect(left).toBeCloseTo(g.pad, 6);
    expect(right).toBeCloseTo(size.width - g.pad, 6);
    expect(g.xToPx(6000)).toBeCloseTo((left + right) / 2, 6); // log midpoint: sqrt(1500 * 24000) = 6000
  });

  it('places marks inside the plot and tags them with their instrument', () => {
    const g = plotGeometry({ bounds, marks: [{ counts: c(8000), score: 0.2, instrument: 'flick' }], size });
    expect(g.marks).toHaveLength(1);
    expect(g.marks[0].instrument).toBe('flick');
    expect(g.marks[0].px).toBeGreaterThan(g.pad);
    expect(g.marks[0].px).toBeLessThan(size.width - g.pad);
    expect(g.marks[0].py).toBeGreaterThanOrEqual(g.pad);
    expect(g.marks[0].py).toBeLessThanOrEqual(size.height - g.pad);
  });

  it('builds an SVG path for the fitted curve and a CI rect + peak line', () => {
    const curve = [
      { x: Math.log(3000), mean: 0 },
      { x: Math.log(8000), mean: 0.5 },
      { x: Math.log(15000), mean: 0.1 },
    ];
    const g = plotGeometry({ bounds, marks: [], curve, ci90: [c(7000), c(9500)], peak: c(8000), size });
    expect(g.curvePath).toMatch(/^M /);
    expect(g.ciRectPx).not.toBeNull();
    expect(g.ciRectPx!.width).toBeGreaterThan(0);
    expect(g.peakPx).toBeGreaterThan(g.pad);
  });

  it('handles empty data without throwing (no curve, no band)', () => {
    const g = plotGeometry({ bounds, marks: [], size });
    expect(g.curvePath).toBeNull();
    expect(g.ciRectPx).toBeNull();
    expect(g.peakPx).toBeNull();
    expect(g.facetPeaks).toEqual([]);
  });

  it('maps A5 facet peaks to the axis with spread whiskers in ln space', () => {
    const g = plotGeometry({
      bounds, marks: [], size,
      facetPeaks: [
        { instrument: 'track', peakCounts: c(8000), spreadLn: 0.1, laneConditioned: false },
        { instrument: 'strike', peakCounts: c(10000), spreadLn: 0.2, laneConditioned: true },
      ],
    });
    expect(g.facetPeaks).toHaveLength(2);
    const track = g.facetPeaks[0];
    expect(track.px).toBeCloseTo(g.xToPx(8000), 6);
    // whisker ends are exp(ln(peak) +/- spreadLn) mapped through the SAME log axis
    expect(track.whisker!.x0).toBeCloseTo(g.xToPx(Math.exp(Math.log(8000) - 0.1)), 6);
    expect(track.whisker!.x1).toBeCloseTo(g.xToPx(Math.exp(Math.log(8000) + 0.1)), 6);
    expect(g.facetPeaks[1].laneConditioned).toBe(true);
  });

  it('skips unfittable facet peaks (undefined) and whiskers (no spread), never fakes geometry', () => {
    const g = plotGeometry({
      bounds, marks: [], size,
      facetPeaks: [
        { instrument: 'calibrate', laneConditioned: false }, // no peak: dashed in copy, absent here
        { instrument: 'flick', peakCounts: c(7000), laneConditioned: false }, // peak but no spread
      ],
    });
    expect(g.facetPeaks).toHaveLength(1);
    expect(g.facetPeaks[0].instrument).toBe('flick');
    expect(g.facetPeaks[0].whisker).toBeNull();
  });

  it('clamps a facet whisker that would overflow the plot extent', () => {
    const g = plotGeometry({
      bounds, marks: [], size,
      facetPeaks: [{ instrument: 'track', peakCounts: c(23000), spreadLn: 0.5, laneConditioned: false }],
    });
    expect(g.facetPeaks[0].whisker!.x1).toBeLessThanOrEqual(size.width - g.pad);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/ui/convergence-plot.test.ts`
Expected: FAIL at import time with `SyntaxError: [vitest] The requested module '/src/ui/convergence-plot.ts' does not provide an export named 'countTicks'` (the renamed old module still enumerates its cm-era ticks by hand and exports no ladder)

- [ ] **Step 3: Write the implementation (full replacement of `src/ui/convergence-plot.ts`)**

```ts
import type { Counts360, FacetPeak, InstrumentId } from '../types';

export interface PlotSize { width: number; height: number; }
export interface PlotMark { counts: Counts360; score: number; instrument: InstrumentId; }
export interface PlotInput {
  bounds: [Counts360, Counts360];
  marks: readonly PlotMark[];
  /** Fitted curve; each x is the natural log OF the counts-per-360 value (ln(counts), the same
   *  scale the optimizer fits on - "counts/360" names the unit, never a division). */
  curve?: readonly { x: number; mean: number }[];
  ci90?: [Counts360, Counts360];
  peak?: Counts360;
  /**
   * A5's per-facet peaks, drawn as markers along the top of the plot: each probe's OWN best
   * sensitivity, so the eye can SEE the one-number thesis being tested against the blended peak
   * line. Entries without a fittable peak are skipped (dashed in copy, never faked in geometry).
   */
  facetPeaks?: readonly FacetPeak[];
  size: PlotSize;
  pad?: number;
}
export interface PlotMarkPx extends PlotMark { px: number; py: number; }
export interface FacetPeakPx {
  instrument: InstrumentId;
  px: number;
  /** The facet's bootstrap SPREAD (not a CI - see FacetPeak.spreadLn) as a horizontal whisker,
   *  clamped to the plot extent; null when the spread is missing. */
  whisker: { x0: number; x1: number } | null;
  /** strike: taste-conditioned, excluded from the tier - rendered hollow/dashed. */
  laneConditioned: boolean;
}
export interface PlotGeometry {
  size: PlotSize;
  pad: number;
  xToPx(counts: number): number;
  xTicks: { counts: number; px: number }[];
  marks: PlotMarkPx[];
  curvePath: string | null;
  ciRectPx: { x: number; width: number } | null;
  peakPx: number | null;
  facetPeaks: FacetPeakPx[];
  yRange: [number, number];
}

/**
 * Log-decade tick ladder for a counts axis. The old hand-enumerated cm ticks (10..80) covered one
 * decade of a physical unit; counts bounds move with hardware and with k, spanning anywhere from a
 * few hundred to tens of thousands, so the ladder is generated per decade instead of enumerated.
 * The 1/1.5/2/3/5/7 mantissas keep near-even spacing in ln space (steps of 1.33x to 1.5x). When
 * bounds span enough decades that the full ladder would shingle 10px labels into each other, the
 * ladder thins to 1/2/5 and then to decades: thinning keeps ln spacing even, where dropping every
 * other tick would alternate 1.5x and 2x gaps.
 */
const TICK_MANTISSAS = [1, 1.5, 2, 3, 5, 7] as const;
export function countTicks(lo: number, hi: number): number[] {
  const build = (mants: readonly number[]): number[] => {
    const out: number[] = [];
    for (let dec = Math.floor(Math.log10(lo)); dec <= Math.ceil(Math.log10(hi)); dec++) {
      for (const m of mants) {
        const v = m * 10 ** dec;
        if (v >= lo && v <= hi) out.push(v);
      }
    }
    return out;
  };
  for (const mants of [TICK_MANTISSAS, [1, 2, 5], [1]] as const) {
    const t = build(mants);
    if (t.length <= 9) return t;
  }
  return build([1]);
}

/** Tick label: 8000 reads "8k", 1500 reads "1.5k". Tabular mono at 10px cannot afford five
 *  digits per tick without the labels colliding at the 360px result-plot width. */
export function tickLabel(v: number): string {
  return v >= 1000 ? `${v / 1000}k` : String(v);
}

export function plotGeometry(input: PlotInput): PlotGeometry {
  const { bounds, marks, curve, ci90, peak, size } = input;
  const pad = input.pad ?? 28;
  const [lo, hi] = bounds;
  const lLo = Math.log(lo), lHi = Math.log(hi);
  const x0 = pad, x1 = size.width - pad;
  const y0 = size.height - pad, y1 = pad;

  const xToPx = (counts: number): number =>
    x0 + ((Math.log(counts) - lLo) / (lHi - lLo)) * (x1 - x0);

  const ys = [...marks.map((m) => m.score), ...(curve?.map((c) => c.mean) ?? [])];
  let yMin = ys.length ? Math.min(...ys) : 0;
  let yMax = ys.length ? Math.max(...ys) : 1;
  if (yMax - yMin < 1e-9) { yMin -= 0.5; yMax += 0.5; }
  const span = yMax - yMin;
  yMin -= span * 0.08; yMax += span * 0.08;
  const yToPx = (score: number): number =>
    y0 + ((score - yMin) / (yMax - yMin)) * (y1 - y0);

  const xTicks = countTicks(lo, hi).map((t) => ({ counts: t, px: xToPx(t) }));
  const marksPx: PlotMarkPx[] = marks.map((m) => ({ ...m, px: xToPx(m.counts), py: yToPx(m.score) }));

  let curvePath: string | null = null;
  if (curve && curve.length >= 2) {
    curvePath = curve
      .map((c, i) => `${i === 0 ? 'M' : 'L'} ${xToPx(Math.exp(c.x)).toFixed(2)},${yToPx(c.mean).toFixed(2)}`)
      .join(' ');
  }

  const ciRectPx =
    ci90 && ci90[1] > ci90[0]
      ? { x: xToPx(ci90[0]), width: xToPx(ci90[1]) - xToPx(ci90[0]) }
      : null;

  const peakPx = peak !== undefined ? xToPx(peak) : null;

  const clampX = (px: number): number => Math.max(x0, Math.min(x1, px));
  const facetPeaks: FacetPeakPx[] = (input.facetPeaks ?? [])
    .filter((f): f is FacetPeak & { peakCounts: Counts360 } => f.peakCounts !== undefined && Number.isFinite(f.peakCounts))
    .map((f) => ({
      instrument: f.instrument,
      px: clampX(xToPx(f.peakCounts)),
      whisker:
        f.spreadLn !== undefined && Number.isFinite(f.spreadLn) && f.spreadLn > 0
          ? {
              x0: clampX(xToPx(Math.exp(Math.log(f.peakCounts) - f.spreadLn))),
              x1: clampX(xToPx(Math.exp(Math.log(f.peakCounts) + f.spreadLn))),
            }
          : null,
      laneConditioned: f.laneConditioned,
    }));

  return { size, pad, xToPx, xTicks, marks: marksPx, curvePath, ciRectPx, peakPx, facetPeaks, yRange: [yMin, yMax] };
}

const NS = 'http://www.w3.org/2000/svg';
const el = (name: string, attrs: Record<string, string>): SVGElement => {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};
const ORGANISM_VAR: Record<InstrumentId, string> = {
  track: 'var(--instrument-track)', flick: 'var(--instrument-flick)', calibrate: 'var(--instrument-calibrate)', strike: 'var(--instrument-strike)',
};

/**
 * The color key the plots never had: one swatch chip per probe, in the same organism color the
 * marks use. Pure markup string (unit-testable); aria-hidden because it decodes an aria-hidden
 * plot - the accessible story is the figcaption + live-region copy, not the colors.
 */
export function plotLegendHtml(ids: readonly InstrumentId[] = ['track', 'flick', 'calibrate', 'strike']): string {
  const items = ids
    .map(
      (id) =>
        `<span class="plot-legend__item" data-legend="${id}"><span class="plot-legend__swatch" style="background:${ORGANISM_VAR[id]}"></span>${id}</span>`,
    )
    .join('');
  return `<span class="plot-legend mono" aria-hidden="true">${items}</span>`;
}

/** Thin renderer: clears `svg` and draws the geometry (CI band, curve, marks, peak, ticks).
 *  Same curve as before the unit change, honest label: the axis is the log of counts per 360 now,
 *  and the ticks say so in counts. */
export function renderConvergencePlot(svg: SVGElement, g: PlotGeometry, yLabel?: string): void {
  svg.setAttribute('viewBox', `0 0 ${g.size.width} ${g.size.height}`);
  svg.replaceChildren();

  if (g.ciRectPx) {
    svg.appendChild(el('rect', {
      x: g.ciRectPx.x.toFixed(2), y: String(g.pad), width: g.ciRectPx.width.toFixed(2),
      height: String(g.size.height - 2 * g.pad), fill: 'var(--color-primary)', 'fill-opacity': '0.12', 'data-ci': '',
    }));
  }
  if (g.curvePath) {
    svg.appendChild(el('path', {
      d: g.curvePath, fill: 'none', stroke: 'var(--text-strong)', 'stroke-width': '2',
      'stroke-opacity': '0.7', 'data-curve': '',
    }));
  }
  if (g.peakPx !== null) {
    svg.appendChild(el('line', {
      x1: g.peakPx.toFixed(2), y1: String(g.pad), x2: g.peakPx.toFixed(2),
      y2: String(g.size.height - g.pad), stroke: 'var(--color-primary)', 'stroke-width': '1.5', 'data-peak': '',
    }));
  }
  for (const m of g.marks) {
    const filled = m.instrument === 'track' || m.instrument === 'flick';
    svg.appendChild(el('circle', {
      cx: m.px.toFixed(2), cy: m.py.toFixed(2), r: '4',
      fill: filled ? ORGANISM_VAR[m.instrument] : 'none',
      stroke: ORGANISM_VAR[m.instrument], 'stroke-width': '1.5',
      'data-mark': m.instrument,
    }));
  }
  // A5 facet-peak markers: each probe's OWN best, as a diamond on a top rail with its spread
  // whisker - the eye compares them against the answer line (the thesis, tested visibly).
  // strike (taste-conditioned, excluded from the tier) renders hollow + dashed.
  const railY = g.pad + 7;
  for (const f of g.facetPeaks) {
    if (f.whisker) {
      svg.appendChild(el('line', {
        x1: f.whisker.x0.toFixed(2), y1: String(railY), x2: f.whisker.x1.toFixed(2), y2: String(railY),
        stroke: ORGANISM_VAR[f.instrument], 'stroke-width': '1', 'stroke-opacity': '0.5',
        'data-facet-whisker': f.instrument,
      }));
    }
    svg.appendChild(el('rect', {
      x: (f.px - 4).toFixed(2), y: String(railY - 4), width: '8', height: '8',
      transform: `rotate(45 ${f.px.toFixed(2)} ${railY})`,
      fill: f.laneConditioned ? 'none' : ORGANISM_VAR[f.instrument],
      stroke: ORGANISM_VAR[f.instrument], 'stroke-width': '1.5',
      ...(f.laneConditioned ? { 'stroke-dasharray': '2 2' } : {}),
      'data-facet-peak': f.instrument,
    }));
  }
  for (const t of g.xTicks) {
    const label = el('text', {
      x: t.px.toFixed(2), y: String(g.size.height - 8), 'text-anchor': 'middle',
      fill: 'var(--text-muted)', 'font-size': '10', 'font-family': 'var(--font-mono)',
    });
    label.textContent = tickLabel(t.counts);
    svg.appendChild(label);
  }

  if (yLabel) {
    const yc = g.size.height / 2;
    const lab = el('text', {
      x: '10', y: yc.toFixed(1), 'text-anchor': 'middle',
      transform: `rotate(-90 10 ${yc.toFixed(1)})`,
      fill: 'var(--text-muted)', 'font-size': '10', 'font-family': 'var(--font-mono)', 'data-ylabel': '',
    });
    lab.textContent = yLabel;
    svg.appendChild(lab);
  }
}
```

- [ ] **Step 4: Rewrite the render test (full replacement of `tests/ui/convergence-plot.render.test.ts`)**

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { plotGeometry, plotLegendHtml, renderConvergencePlot } from '../../src/ui/convergence-plot';
import { counts360, type Counts360 } from '../../src/types';

const c = counts360;
const bounds: [Counts360, Counts360] = [c(1500), c(24000)];

describe('renderConvergencePlot', () => {
  it('renders a mark per observation and the curve path', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const g = plotGeometry({
      bounds,
      marks: [
        { counts: c(5000), score: 0.1, instrument: 'track' },
        { counts: c(9000), score: 0.3, instrument: 'strike' },
      ],
      curve: [{ x: Math.log(4000), mean: 0 }, { x: Math.log(12000), mean: 0.4 }],
      size: { width: 600, height: 300 },
    });
    renderConvergencePlot(svg, g);
    expect(svg.querySelectorAll('[data-mark]').length).toBe(2);
    expect(svg.querySelector('[data-curve]')).not.toBeNull();
  });

  it('labels the counts axis with compact ladder ticks', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const g = plotGeometry({ bounds, marks: [], size: { width: 600, height: 300 } });
    renderConvergencePlot(svg, g);
    const texts = [...svg.querySelectorAll('text')].map((t) => t.textContent);
    expect(texts).toEqual(['1.5k', '2k', '3k', '5k', '7k', '10k', '15k', '20k']);
  });

  it('renders A5 facet-peak diamonds on the top rail, hollow + dashed for the taste-conditioned lane', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const g = plotGeometry({
      bounds,
      marks: [],
      size: { width: 600, height: 300 },
      facetPeaks: [
        { instrument: 'track', peakCounts: c(8000), spreadLn: 0.1, laneConditioned: false },
        { instrument: 'strike', peakCounts: c(10000), spreadLn: 0.2, laneConditioned: true },
      ],
    });
    renderConvergencePlot(svg, g);
    const track = svg.querySelector('[data-facet-peak="track"]')!;
    const strike = svg.querySelector('[data-facet-peak="strike"]')!;
    expect(track).not.toBeNull();
    expect(strike).not.toBeNull();
    expect(track.getAttribute('fill')).toContain('--instrument-track'); // filled: a real estimate of the latent
    expect(strike.getAttribute('fill')).toBe('none'); // taste-conditioned: hollow
    expect(strike.getAttribute('stroke-dasharray')).toBe('2 2'); // and dashed: excluded from the tier
    expect(svg.querySelectorAll('[data-facet-whisker]').length).toBe(2);
  });

  it('plotLegendHtml emits one organism-colored chip per probe, aria-hidden', () => {
    const holder = document.createElement('div');
    holder.innerHTML = plotLegendHtml();
    const legend = holder.querySelector('.plot-legend')!;
    expect(legend.getAttribute('aria-hidden')).toBe('true');
    for (const id of ['track', 'flick', 'calibrate', 'strike']) {
      const item = legend.querySelector(`[data-legend="${id}"]`)!;
      expect(item).not.toBeNull();
      expect(item.querySelector('.plot-legend__swatch')).not.toBeNull();
    }
  });
});
```

(The original file's legend assertions are preserved verbatim above; if the file at HEAD carries
additional legend assertions beyond these four tests, carry them over unchanged with `cm360:` mark
keys changed to `counts:`.)

- [ ] **Step 5: Repoint `marksFromTrials` and its test (the only PlotMark producers outside this phase's files)**

In `src/ui/session-view.ts`, make `marksFromTrials` read exactly:

```ts
export function marksFromTrials(trials: readonly TrialResult[]): PlotMark[] {
  return trials.map((t) => ({ counts: t.counts, score: t.score, instrument: t.instrument }));
}
```

In `tests/ui/session-view.test.ts`, the mapping test (line 31 at HEAD) changes its title and its
two expected objects, leaving the fixture trial literals exactly as phase 1a's sweep left them:

```ts
  it('maps trials to plot marks preserving counts/score/instrument', () => {
```

and the expectation becomes:

```ts
    expect(marksFromTrials(trials)).toEqual([
      { counts: 30, score: 0.4, instrument: 'flick' },
      { counts: 42, score: -0.1, instrument: 'track' },
    ]);
```

- [ ] **Step 6: Run the plot tests, then the full suite**

Run: `npx vitest run tests/ui/convergence-plot.test.ts tests/ui/convergence-plot.render.test.ts tests/ui/session-view.test.ts`
Expected: PASS
Run: `npm test`
Expected: PASS, zero failures

- [ ] **Step 7: Commit**

```bash
git add src/ui/convergence-plot.ts tests/ui/convergence-plot.test.ts tests/ui/convergence-plot.render.test.ts src/ui/session-view.ts tests/ui/session-view.test.ts
git commit -m "feat(plot): the convergence axis moves to a counts log scale, same curve, honest label" -m "The geometry is unchanged: a log axis is a log axis in any unit. What changes is the tick ladder (generated per decade, since counts bounds move with hardware and with k) and the labels (compact 8k form, since five-digit ticks collide at 360px)."
```
### Task 11: The payoff screen, ordered by what each claim assumes

**Files:**
- Modify: `src/ui/result.ts` (full rewrite, shown below)
- Modify: `src/optimizer/result.ts` (extend `BuildResultOpts`, attach the prescription)
- Modify: `tests/ui/result.test.ts` (full rewrite, shown below)
- Modify: `tests/optimizer/result.test.ts` (append one describe block)

Prerequisite: task 9 has landed (`Result.prescription?: Prescription` already exists on the type,
from phase 1a task 4; task 9 supplied the real `buildPrescription` behind it).

Design intent, so the executor knows what is deliberate: the screen is the argument. Tier one leads
because it assumes nothing (a ratio of two counts in the same units). Tier two exists only under a
pinned k, carries a per-row 90% band built from the search's own interval and k's spread combined
in quadrature (A5, D3), and when withheld the screen says why in a player's words. Tier three renders HARDWARE counts when k is
pinned and otherwise renders browser counts while naming the second unmeasured factor (A6): the
tier whose whole job is refusing to overclaim cannot be the one that quietly overclaims. A factor
of 1.00 with a confined interval is the best outcome the instrument reports, phrased as what the
interval supports and no more (F33). The unit is spelled "counts per 360" everywhere on this
screen, never a slashed compact form (F36).

- [ ] **Step 1: Write the failing test (full replacement of `tests/ui/result.test.ts`)**

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { result as resultScreen, typedCm } from '../../src/ui/result';
import type { AppContext, Route, SessionDraft } from '../../src/ui/shell';
import { counts360, type Counts360, type Result, type Session, type TrialResult } from '../../src/types';
import type { Prescription } from '../../src/optimizer/result';

const c = counts360;
const ci = (lo: number, hi: number): [Counts360, Counts360] => [c(lo), c(hi)];

// A typed-sens pin with k = 2: hardwareCounts = 8240 / 2, and kLogSd carries the anchor's spread.
const PRES: Prescription = {
  ratio: 0.88, ratioCi90: [0.79, 0.97],
  counts: c(8240), countsCi90: ci(7800, 8700),
  perGameSens: { cs2: 1.59, valorant: 0.5, apex: 1.59, ow2: 5.3, cod: 5.3, fortnite: 6.3, r6: 6.1, pubg: 15.7 },
  kSource: 'typed-sens',
  kLogSd: 0.12,
  hardwareCounts: c(4120),
};
const RESULT: Result = {
  optimalCounts: c(8240), ci90: ci(7800, 8700),
  breakdown: { biasZeroCounts: c(7940), precisionFloorDeg: 0.42, ttkMs: 511, hitRate: 0.86, trackContribZ: 0.6, flickContribZ: -0.3 },
  curve: [{ x: Math.log(5000), mean: 0.2 }, { x: Math.log(8240), mean: 0.9 }, { x: Math.log(13000), mean: 0.3 }],
  bounds: ci(4000, 16000),
  prescription: PRES,
};
const TRIALS: TrialResult[] = [
  { instrument: 'flick', counts: c(5600), score: 0.4, raw: {}, at: 0 },
  { instrument: 'track', counts: c(7900), score: 0.8, raw: {}, at: 0 },
  { instrument: 'strike', counts: c(10200), score: 0.5, raw: {}, at: 0 },
];
function session(id: string, trials: TrialResult[]): Session {
  return { id, profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } },
    trials, status: 'complete', createdAt: 0 };
}
function fakeCtx(sessions: Session[] = [session('s1', TRIALS)]): AppContext & { nav: Route[] } {
  const nav: Route[] = [];
  const draft: SessionDraft = { currentGame: 'cs2', currentSens: 1, bounds: ci(4000, 16000),
    profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } } };
  return {
    nav, route: 'result', draft,
    navigate(r: Route) { nav.push(r); },
    storage: { saveSession() {}, loadSessions: () => sessions, saveResult() {}, exportJson: () => '{}' },
    lastResult: { sessionId: 's1', result: RESULT },
  } as AppContext & { nav: Route[] };
}
function mount(res?: Result): HTMLElement {
  const host = document.createElement('div');
  const ctx = fakeCtx();
  if (res) ctx.lastResult = { sessionId: 's1', result: res };
  resultScreen(host, ctx).mount();
  return host;
}
const noPrescription = (): Result => {
  const { prescription: _p, ...rest } = RESULT;
  return rest;
};
// The reachable A5 state: k pinned, anchor refused - a prescription with no ratio fields.
const kOnlyPres = (): Prescription => {
  const { ratio: _r, ratioCi90: _rc, ...rest } = PRES;
  return rest;
};
// k unpinned: a prescription with tier one only.
const unpinnedPres = (): Prescription => {
  const { perGameSens: _g, kSource: _k, kLogSd: _l, hardwareCounts: _h, ...rest } = PRES;
  return rest;
};

describe('result screen, tier one (assumes nothing)', () => {
  it('leads with the multiply factor when the interval excludes no change', () => {
    const host = mount();
    expect(host.querySelector('[data-result="ratio"]')).toBeTruthy();
    expect(host.querySelector('[data-result="ratio"]')!.textContent).toBe('0.88');
    expect(host.querySelector('[data-result="ratio-ci"]')!.textContent).toBe('0.79 to 0.97');
    expect((host.querySelector('[data-tier="one"]') as HTMLElement).dataset.hero).toBe('ratio');
    expect(host.textContent).toContain('Multiply your in-game sensitivity by');
  });

  it('prices the wider interval as completeness, in the width note', () => {
    const note = mount().querySelector('[data-result="ratio-note"]')!.textContent!;
    // Tier one is wider than the plot band because it carries the anchor too; the copy must say
    // so as a fact about the question answered, never as an apology.
    expect(note).toContain('wider');
    expect(note.toLowerCase()).toContain('two measurements');
    expect(note.toLowerCase()).toContain('easier question');
  });

  it('a factor of 1.00 with a confined interval reads as a finding the interval supports (F33)', () => {
    const host = mount({ ...RESULT, prescription: { ...PRES, ratio: 1.0, ratioCi90: [0.97, 1.04] } });
    expect(host.querySelector('[data-result="ratio"]')!.textContent).toBe('1.00');
    expect((host.querySelector('[data-tier="one"]') as HTMLElement).dataset.hero).toBe('confirmed');
    const t = host.querySelector('[data-result="ratio-confirmed"]')!.textContent!;
    expect(t).toContain('tightest this instrument resolves');
    expect(t).toContain('change nothing');
    // F33: no claim about the session's design ("every chance to move you") and no claim beyond
    // the interval's own resolution - the sentence states only what the interval allows.
    expect(t).not.toContain('every chance');
  });

  it('an interval that includes no change drops the multiply framing (spec error path)', () => {
    const host = mount({ ...RESULT, prescription: { ...PRES, ratio: 0.93, ratioCi90: [0.85, 1.08] } });
    expect(host.querySelector('[data-result="ratio"]')).toBeNull();
    expect(host.querySelector('[data-result="counts360"]')!.textContent).toBe('8,240');
    expect(host.querySelector('[data-result="ci"]')!.textContent).toBe('7,800 to 8,700');
    expect(host.querySelector('[data-result="ratio-withheld"]')!.textContent).toContain('includes 1.00');
  });

  it('without a prescription the location stands alone and says why', () => {
    const host = mount(noPrescription());
    expect(host.querySelector('[data-result="counts360"]')!.textContent).toBe('8,240');
    expect(host.querySelector('[data-result="ratio-unavailable"]')!.textContent).toContain('leave the factor blank');
  });

  it('a k-only prescription (A5) leads with the located counts, factor blank, tier two intact', () => {
    const host = mount({ ...RESULT, prescription: kOnlyPres() });
    expect(host.querySelector('[data-result="ratio"]')).toBeNull();
    expect(host.querySelector('[data-result="counts360"]')!.textContent).toBe('8,240');
    expect(host.querySelector('[data-result="ratio-unavailable"]')!.textContent).toContain('leave the factor blank');
    expect(host.querySelectorAll('[data-game]').length).toBe(8); // the table earned its gate
  });

  it('renders a single sr-only summary sentence near the number (rendered once, NOT a live region)', () => {
    const host = mount();
    const summaries = host.querySelectorAll('.result__sr-summary');
    expect(summaries.length).toBe(1);
    const sr = summaries[0]!;
    expect(sr.getAttribute('aria-live')).toBeNull();
    const t = sr.textContent!;
    expect(t).toContain('0.88');
    expect(t).toContain(' to ');   // ranges spoken as "to", never an en-dash glyph
    expect(t).not.toContain('–');
  });

  it('a tuned value shows no factor even if a stale prescription rides the Result (honesty gate)', () => {
    const host = mount({ ...RESULT, tuned: true });
    expect(host.querySelector('[data-result="ratio"]')).toBeNull();
    expect(host.textContent).toContain('tuned by feel');
    expect(host.querySelector('[data-result="ratio-note"]')).toBeNull();
  });

  it('a bounded result keeps the bound copy and prefixes tier three with the bound direction', () => {
    const host = mount({ ...RESULT, peakAtBound: 'high' });
    expect(host.textContent).toContain('Where the search stopped');
    expect(host.querySelector('[data-result="bounded"]')!.textContent).toContain('at least 8,240');
    expect(host.querySelector('[data-result="ratio"]')).toBeNull(); // no factor against a bound
    expect(host.querySelector('[data-tier="three"]')!.textContent).toContain('At least');
    expect(host.querySelector('[data-result="tier-two-withheld"]')!.textContent).toContain('edge of the window');
  });
});

describe('result screen, tier two (one measured factor)', () => {
  it('shows the per-game table only because k is pinned, and renders every game row', () => {
    const host = mount();
    expect(host.querySelectorAll('[data-game]').length).toBe(8);
    expect(host.querySelector('[data-game="cs2"]')!.getAttribute('data-current')).toBe('true');
  });

  it('names the typed-sens route in words a player can act on, without claiming an exact pin', () => {
    const note = mount().querySelector('.result__k-note')!.textContent!;
    expect(note).toContain('sensitivity you typed');
    // A5: the typed route inherits the anchor's spread whole, so the note may not say "exactly".
    expect(note.toLowerCase()).not.toContain('exactly');
  });

  it('names the lattice route when the movement stream pinned k', () => {
    const host = mount({ ...RESULT, prescription: { ...PRES, kSource: 'lattice', kLogSd: 0 } });
    expect(host.querySelector('.result__k-note')!.textContent).toContain('movement stream');
  });

  it('widens each row by the search interval and k spread combined in quadrature (A5, D3)', () => {
    const host = mount(); // countsCi90 [7800, 8700] and kLogSd 0.12 from the typed route
    const bands = host.querySelectorAll('[data-sens-band]');
    expect(bands.length).toBe(8);
    // Half-width in ln space: hypot(ln(8700/7800)/2, 1.6448536269514722 * 0.12)
    // = hypot(0.05460, 0.19738) = 0.20479. cs2 sens 1.59 * exp(-/+ 0.20479) = 1.296 to 1.951.
    // k's spread ALONE would give 1.305 to 1.937, narrower than the evidence: the band must carry
    // the search's own precision too, and hypot can only widen (D3).
    expect(host.querySelector('tr[data-game="cs2"] [data-sens-band]')!.textContent).toBe('1.296 to 1.951');
  });

  it('renders the search band alone when the pin carries no spread (lattice, kLogSd 0)', () => {
    const host = mount({ ...RESULT, prescription: { ...PRES, kSource: 'lattice', kLogSd: 0 } });
    // An exactly pure lattice pins k with zero spread, and the drill bootstrap is still there: a
    // bare three-decimal sensitivity would present a number the player types into their game as
    // if it were exact (D3). Half-width = ln(8700/7800)/2 = 0.05460; 1.59 * exp(-/+ 0.05460).
    expect(host.querySelectorAll('[data-sens-band]').length).toBe(8);
    expect(host.querySelector('tr[data-game="cs2"] [data-sens-band]')!.textContent).toBe('1.506 to 1.679');
  });

  it('omits the band for a degenerate countsCi90 rather than fabricating one', () => {
    const host = mount({ ...RESULT, prescription: { ...PRES, countsCi90: ci(8240, 8240) } });
    expect(host.querySelectorAll('[data-game]').length).toBe(8); // the table itself survives
    expect(host.querySelector('[data-sens-band]')).toBeNull();
  });

  it('withholds tier two in a sentence a player understands when k is unpinned', () => {
    const host = mount({ ...RESULT, prescription: unpinnedPres() });
    expect(host.querySelector('.result__games')).toBeNull();
    const t = host.querySelector('[data-result="tier-two-withheld"]')!.textContent!;
    expect(t).toContain('one measured factor');
    expect(t).toContain('your game and current in-game sensitivity');
  });

  it('the your-game selector re-highlights the matching row and REMEMBERS the pick', () => {
    const host = document.createElement('div');
    const ctx = fakeCtx();
    const saved: unknown[] = [];
    ctx.storage.savePrefs = (p) => void saved.push(p);
    resultScreen(host, ctx).mount();
    const select = host.querySelector('[data-action="your-game"]') as HTMLSelectElement;
    select.value = 'valorant';
    select.dispatchEvent(new Event('change'));
    expect(host.querySelector('tr[data-game="valorant"]')!.getAttribute('data-current')).toBe('true');
    expect(host.querySelectorAll('tr[data-current="true"]').length).toBe(1);
    expect(ctx.draft.currentGame).toBe('valorant');
    expect(saved.length).toBe(1);
    expect((saved[0] as { currentGame: string }).currentGame).toBe('valorant');
  });

  it('a tuned value renders no tier two at all (its k evidence was dropped with the measurement)', () => {
    const host = mount({ ...RESULT, tuned: true });
    expect(host.querySelector('[data-tier="two"]')).toBeNull();
    expect(host.querySelector('[data-result="tier-two-withheld"]')).toBeNull();
  });
});

describe('result screen, tier three (arithmetic on your input)', () => {
  it('renders HARDWARE counts when k is pinned, and says so (A6)', () => {
    const host = mount();
    const span = host.querySelector('[data-result="tier-three-counts"]')!;
    expect(span.textContent).toBe('4,120'); // 8,240 browser counts / k of 2
    expect(span.getAttribute('data-counts-kind')).toBe('hardware');
    const t = host.querySelector('[data-tier="three"]')!.textContent!;
    expect(t).toContain('hardware counts');
    expect(t).toContain('divided by DPI, times 2.54');
  });

  it('converts the hardware counts through a typed DPI, labelled as arithmetic, no extra caveat needed', () => {
    const host = mount();
    const input = host.querySelector('[data-action="dpi-convert"]') as HTMLInputElement;
    input.value = '800';
    input.dispatchEvent(new Event('input'));
    const out = host.querySelector('[data-result="dpi-converted"]') as HTMLElement;
    expect(out.hidden).toBe(false);
    expect(out.textContent).toContain('4,120 ÷ 800 × 2.54');
    expect(out.textContent).toContain('13.1 cm per 360'); // 4120 / 800 * 2.54 = 13.08
    expect(out.textContent!.toLowerCase()).toContain('arithmetic on the dpi you typed');
    expect(out.textContent!.toLowerCase()).not.toContain('second unmeasured factor');
  });

  it('falls back to BROWSER counts when k is unpinned and names the second unmeasured factor (A6)', () => {
    const host = mount({ ...RESULT, prescription: unpinnedPres() });
    const span = host.querySelector('[data-result="tier-three-counts"]')!;
    expect(span.textContent).toBe('8,240');
    expect(span.getAttribute('data-counts-kind')).toBe('browser');
    expect(host.querySelector('[data-tier="three"]')!.textContent).toContain('browser counts');
    const input = host.querySelector('[data-action="dpi-convert"]') as HTMLInputElement;
    input.value = '800';
    input.dispatchEvent(new Event('input'));
    const out = host.querySelector('[data-result="dpi-converted"]')!;
    expect(out.textContent).toContain('26.2 cm per 360'); // 8240 / 800 * 2.54 = 26.16
    // The tier that exists to refuse overclaiming may not quietly overclaim: the conversion
    // names BOTH unmeasured factors, the typed DPI and the browser-to-mouse scale.
    expect(out.textContent!.toLowerCase()).toContain('second unmeasured factor');
  });

  it('clears the conversion for a DPI that is not a positive number: no guess, no zero', () => {
    const host = mount();
    const input = host.querySelector('[data-action="dpi-convert"]') as HTMLInputElement;
    const out = host.querySelector('[data-result="dpi-converted"]') as HTMLElement;
    for (const bad of ['800', '-5']) { // prime with a good value first, then poison
      input.value = bad;
      input.dispatchEvent(new Event('input'));
    }
    expect(out.hidden).toBe(true);
    expect(out.textContent).toBe('');
  });

  it('typedCm is pure arithmetic that refuses instead of guessing', () => {
    expect(typedCm(8240, 800)).toBeCloseTo(26.162, 3);
    expect(typedCm(8240, 0)).toBeNull();
    expect(typedCm(8240, -1)).toBeNull();
    expect(typedCm(8240, NaN)).toBeNull();
  });
});

describe('result screen, evidence blocks', () => {
  it('shows breakdown contributions and renders NaN as -', () => {
    const host = mount({ ...RESULT, breakdown: { ...RESULT.breakdown, precisionFloorDeg: NaN } });
    expect(host.querySelector('[data-breakdown="ttkMs"]')!.textContent).toContain('511');
    expect(host.querySelector('[data-breakdown="precisionFloorDeg"]')!.textContent).toContain('-');
  });

  it('groups the breakdown into origin vs readings tiers', () => {
    const host = mount();
    const origin = host.querySelector('[data-tier="origin"]')!;
    const readings = host.querySelector('[data-tier="readings"]')!;
    expect(origin.querySelector('[data-breakdown="biasZeroCounts"]')).toBeTruthy();
    expect(readings.querySelector('[data-breakdown="precisionFloorDeg"]')).toBeTruthy();
    expect(readings.querySelector('[data-breakdown="ttkMs"]')).toBeTruthy();
    expect(readings.querySelector('[data-breakdown="hitRate"]')).toBeTruthy();
    expect(origin.querySelector('[data-breakdown="ttkMs"]')).toBeNull();
  });

  it('pins every data-breakdown value span byte-identically (storage/export pinning)', () => {
    const host = mount();
    expect(host.querySelector('[data-breakdown="biasZeroCounts"]')!.textContent).toBe('7,940 counts per 360');
    expect(host.querySelector('[data-breakdown="precisionFloorDeg"]')!.textContent).toBe('0.42°');
    expect(host.querySelector('[data-breakdown="ttkMs"]')!.textContent).toBe('511 ms');
    expect(host.querySelector('[data-breakdown="hitRate"]')!.textContent).toBe('86%');
  });

  it('renders the convergence plot (curve + peak + a mark per persisted trial) as the climax', () => {
    const host = mount();
    const svg = host.querySelector('figure svg') as SVGElement | null;
    expect(svg).toBeTruthy();
    expect(svg!.getAttribute('aria-hidden')).toBe('true');
    expect(svg!.getAttribute('viewBox')).toMatch(/^0 0 \d/); // fixed viewBox, not clientWidth
    expect(svg!.querySelector('[data-curve]')).toBeTruthy();
    expect(svg!.querySelector('[data-peak]')).toBeTruthy();
    expect(svg!.querySelectorAll('[data-mark]').length).toBe(TRIALS.length);
  });

  it('renders number-only (no plot) for an OLD result that lacks curve/bounds', () => {
    const { curve: _c, bounds: _b, ...old } = RESULT;
    const host = mount(old);
    expect(host.querySelector('figure svg')).toBeNull();
    expect(host.querySelector('[data-result="counts360"], [data-result="ratio"]')).toBeTruthy();
  });

  it('does NOT draw the plot for a tuned-by-feel result (no measured curve claim)', () => {
    const host = mount({ ...RESULT, tuned: true });
    expect(host.querySelector('figure svg')).toBeNull();
  });

  it('renders the track/flick facet micro-plot on the shared counts log axis', () => {
    const host = mount();
    const micro = host.querySelector('svg[data-facets]') as SVGElement | null;
    expect(micro).toBeTruthy();
    expect(micro!.getAttribute('viewBox')).toMatch(/^0 0 \d/);
    const marks = micro!.querySelectorAll('[data-mark="track"], [data-mark="flick"]');
    expect(marks.length).toBe(2);
    expect(micro!.querySelector('[data-mark="strike"]')).toBeNull();
  });

  it('renders the affine contribution numbers (dash when NaN, no fabrication)', () => {
    const host = mount({ ...RESULT, breakdown: { ...RESULT.breakdown, trackContribZ: NaN } });
    expect(host.querySelector('[data-breakdown="flickContribZ"]')!.textContent).toContain('0.3');
    expect(host.querySelector('[data-breakdown="trackContribZ"]')!.textContent).toContain('-');
  });

  it('omits the facet micro-plot for an OLD result that lacks contributions', () => {
    const { trackContribZ: _t, flickContribZ: _f, ...bk } = RESULT.breakdown;
    const host = mount({ ...RESULT, breakdown: bk });
    expect(host.querySelector('svg[data-facets]')).toBeNull();
    expect(host.querySelector('[data-breakdown="trackContribZ"]')).toBeNull();
  });

  it('shows the CI-concord readout (tight) for a sharp measured CI', () => {
    const host = mount({ ...RESULT, ci90: ci(8100, 8300) });
    const concord = host.querySelector('[data-result="concord"]')!;
    expect(concord).toBeTruthy();
    expect(concord.textContent!.toLowerCase()).toContain('concur');
  });

  it('frames a wide CI as a possibility LIST naming BOTH causes (never asserts one)', () => {
    const host = mount({ ...RESULT, ci90: ci(4500, 12500) });
    const txt = host.querySelector('[data-result="concord"]')!.textContent!.toLowerCase();
    expect(txt).toContain('short');
    expect(txt).toContain('disagree');
    expect(txt).not.toMatch(/because the (facets|views) disagree/);
  });

  it('gates the concord readout behind !tuned and omits it for a degenerate CI', () => {
    expect(mount({ ...RESULT, tuned: true }).querySelector('[data-result="concord"]')).toBeNull();
    expect(mount({ ...RESULT, ci90: [c(NaN), c(NaN)] }).querySelector('[data-result="concord"]')).toBeNull();
  });

  it('shows the session-drift readout with NEUTRAL copy: practice or fatigue, never one cause', () => {
    const host = mount({ ...RESULT, driftZ: 0.42 });
    const v = host.querySelector('[data-result="driftZ"]')!;
    expect(v.textContent).toContain('0.42');
    const txt = host.textContent!.toLowerCase();
    expect(txt).toContain('practice');
    expect(txt).toContain('fatigue');
    expect(txt).toContain('removed from the number');
    expect(txt).not.toMatch(/practice gain|fatigue loss|because of practice|because of fatigue/);
  });

  it('dashes the drift readout when the extended fit fell back (no removal claim)', () => {
    const host = mount(); // RESULT has no driftZ
    const v = host.querySelector('[data-result="driftZ"]')!;
    expect(v.textContent).toBe('-');
    const txt = host.textContent!.toLowerCase();
    expect(txt).not.toMatch(/\bremoved from the number\b/);
    expect(txt).toMatch(/not separable|nothing was removed/);
    expect(txt).toMatch(/plain fit/);
  });

  it('gates the drift readout behind !tuned', () => {
    expect(mount({ ...RESULT, driftZ: 0.42, tuned: true }).querySelector('[data-result="driftZ"]')).toBeNull();
  });

  it('labels the strike rows with the chosen speed/accuracy lean, attributed to the user', () => {
    const host = mount({ ...RESULT, speedAccuracy: 0.8 });
    const lean = host.querySelector('[data-result="strikeLean"]')!;
    const t = lean.textContent!.toLowerCase();
    expect(t).toContain('speed');
    expect(t).toMatch(/you chose|your call|your choice/);
    expect(host.textContent!.toLowerCase()).toContain('skill');
    const acc = mount({ ...RESULT, speedAccuracy: 0.2 });
    expect(acc.querySelector('[data-result="strikeLean"]')!.textContent!.toLowerCase()).toContain('accuracy');
    expect(mount().querySelector('[data-result="strikeLean"]')).toBeNull(); // absent lean: no label
  });
});

// A5 thesis block + payoff arc, carried over from the cm/360 screen with counts formatting.
const FC: NonNullable<Result['facetConcordance']> = {
  facets: [
    { instrument: 'track', peakCounts: c(7900), spreadLn: 0.08, laneConditioned: false },
    { instrument: 'flick', peakCounts: c(8400), spreadLn: 0.11, laneConditioned: false },
    { instrument: 'calibrate', laneConditioned: false }, // unfittable: dashed, never faked
    { instrument: 'strike', peakCounts: c(10200), spreadLn: 0.2, laneConditioned: true },
  ],
  tier: 'some-spread',
};

describe('result screen, A5 thesis block', () => {
  it('renders the tier copy, each facet peak in counts (dash when unfittable), and the strike note', () => {
    const host = mount({ ...RESULT, facetConcordance: FC });
    const thesis = host.querySelector('[data-result="thesis"]')!;
    expect(thesis.getAttribute('data-thesis-tier')).toBe('some-spread');
    const txt = thesis.textContent!;
    expect(txt).toContain('7,900');
    expect(txt).toContain('8,400');
    expect(txt).toContain('counts per 360');
    expect(thesis.querySelector('[data-thesis-facet="calibrate"]')!.textContent).toContain('-');
    expect(thesis.querySelector('[data-thesis-facet="strike"]')!.innerHTML).toContain('sup');
    expect(txt.toLowerCase()).toContain('excluded from the verdict');
  });

  it('reports an inconclusive tier plainly: no verdict, never a hidden pass', () => {
    const host = mount({ ...RESULT, facetConcordance: { facets: FC.facets } });
    const thesis = host.querySelector('[data-result="thesis"]')!;
    expect(thesis.getAttribute('data-thesis-tier')).toBe('inconclusive');
    expect(thesis.textContent!.toLowerCase()).toContain('no verdict');
  });

  it('divergence is shown as honest doubt, never asserting a cause', () => {
    const host = mount({ ...RESULT, facetConcordance: { ...FC, tier: 'divergent' } });
    const txt = host.querySelector('[data-result="thesis"]')!.textContent!.toLowerCase();
    expect(txt).toContain('disagree');
    expect(txt).not.toMatch(/because|caused by/);
  });

  it('draws the facet-peak diamonds on the MAIN convergence plot', () => {
    const host = mount({ ...RESULT, facetConcordance: FC });
    const svg = host.querySelector('svg[data-plot]')!;
    expect(svg.querySelectorAll('[data-facet-peak]').length).toBe(3);
    expect(svg.querySelector('[data-facet-peak="strike"]')!.getAttribute('stroke-dasharray')).toBe('2 2');
    expect(svg.querySelector('[data-facet-peak="calibrate"]')).toBeNull();
  });

  it('renders NO thesis block when facetConcordance is absent or the value is tuned', () => {
    expect(mount().querySelector('[data-result="thesis"]')).toBeNull();
    expect(mount({ ...RESULT, facetConcordance: FC, tuned: true }).querySelector('[data-result="thesis"]')).toBeNull();
  });
});

describe('result screen, payoff arc', () => {
  it('the range CTA is the PRIMARY action and leads the row', () => {
    const host = mount();
    const actions = host.querySelector('.result__actions')!;
    const buttons = [...actions.querySelectorAll('button')];
    expect(buttons[0].getAttribute('data-action')).toBe('range');
    expect(buttons[0].className).toContain('action--primary');
    expect(actions.querySelector('[data-action="again"]')!.className).toContain('action--ghost');
    expect(actions.querySelector('[data-action="export"]')!.className).toContain('action--ghost');
  });

  it('adds a plot legend keying the organism colors', () => {
    const legend = mount().querySelector('.result__plot .plot-legend')!;
    expect(legend).toBeTruthy();
    expect(legend.querySelectorAll('[data-legend]').length).toBe(4);
  });

  it('stages the reveal: number right after the lead, actions last', () => {
    const host = mount();
    const beats = [...host.querySelectorAll('[data-reveal]')];
    expect(beats.length).toBeGreaterThanOrEqual(8);
    const idx = (el: Element): number => Number((el as HTMLElement).style.getPropertyValue('--reveal-i'));
    expect(idx(host.querySelector('.result__number')!)).toBe(1);
    const actionsIdx = idx(host.querySelector('.result__actions')!);
    for (const b of beats) expect(idx(b)).toBeLessThanOrEqual(actionsIdx);
  });

  it('arms the reveal class on the next frame so the CSS cascade can run', async () => {
    const host = document.createElement('div');
    resultScreen(host, fakeCtx()).mount();
    const root = host.querySelector('.result')!;
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(root.classList.contains('is-revealed')).toBe(true);
  });

  it('run again navigates home and the range CTA navigates to the range', () => {
    const host = document.createElement('div');
    const ctx = fakeCtx();
    resultScreen(host, ctx).mount();
    (host.querySelector('[data-action="again"]') as HTMLButtonElement).click();
    (host.querySelector('[data-action="range"]') as HTMLButtonElement).click();
    expect(ctx.nav).toContain('hero');
    expect(ctx.nav).toContain('range');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/ui/result.test.ts -t 'leads with the multiply factor when the interval excludes no change'`
Expected: FAIL. The precise failure depends on what phase 1a's compile patch left in the old
screen, and both outcomes are red for the same underlying reason (no `[data-result="ratio"]`
exists on the old screen):
- If the old screen still dereferences the deleted per-game field (`r.perGameSens[g.id]`,
  src/ui/result.ts:90 at HEAD), `mount()` throws before any assertion runs:
  `TypeError: Cannot read properties of undefined (reading 'cs2')`.
- If phase 1a's patch already removed that read (it must have, to compile after
  `Result.perGameSens` was deleted), the assertion itself fails:
  `AssertionError: expected null to be truthy`.
Either message is this task's expected red. Any OTHER error means something else broke; stop and
look before writing the screen.

- [ ] **Step 3: Extend buildResult to attach the prescription (edits in `src/optimizer/result.ts`)**

Replace the `BuildResultOpts` interface with:

```ts
export interface BuildResultOpts {
  /** Restrict tier two's table (default: every yaw-table game). */
  games?: readonly GameId[];
  /** Search bounds, persisted with the verbatim curve so the plot survives a reload. */
  bounds?: [Counts360, Counts360];
  profile?: Profile;
  /** The reconciled C0 reading (phase 2's turn, phase 4's reconciliation). null or omitted means
   *  no anchor this session; the ratio fields are then omitted, never padded. */
  anchor?: AnchorReading | null;
  /** Phase 3's pin, straight off the draft (SessionDraft.kPin). Absent or unpinned costs tier
   *  two, never tier one. */
  k?: KPin;
}
```

and in `buildResult`, replace the two lines

```ts
  const { bounds, profile } = opts;
  return {
```

with

```ts
  const { bounds, profile } = opts;
  const prescription = buildPrescription(report, opts.anchor ?? null, opts.k, opts.games);
  return {
```

then add, directly under the `breakdown:` line inside the returned object:

```ts
    // The payoff tiers. null when nothing was earned (no anchor AND no pinned k) or the vertex
    // clamped: the screen then leads with the located counts and says why the factor is
    // withheld, never a padded ratio.
    ...(prescription ? { prescription } : {}),
```

Append to `tests/optimizer/result.test.ts` (bottom of the file, with
`import type { KPin } from '../../src/input/count-convention';` added to the imports):

```ts
describe('buildResult prescription attachment', () => {
  const anchor = { counts: c(7040), ci90: ci(6800, 7300) };
  const latticePin: KPin = { pinned: true, k: 2, source: 'lattice', logSd: 0 };

  it('attaches the prescription when an anchor is supplied (tier one rides the Result)', () => {
    const r = buildResult(report, trials, { anchor });
    expect(r.prescription).toBeDefined();
    expect(r.prescription!.ratio).toBe(7040 / 8000);
  });

  it('omits it with neither an anchor nor a pinned k: absent, never a padded ratio', () => {
    const r = buildResult(report, trials);
    expect('prescription' in r).toBe(false);
    const s = buildResult(report, trials, { k: { pinned: false, reason: 'gate-closed' } });
    expect('prescription' in s).toBe(false);
  });

  it('attaches a k-only prescription when the anchor refused but k is pinned (A5)', () => {
    const r = buildResult(report, trials, { k: latticePin });
    expect(r.prescription).toBeDefined();
    expect('ratio' in r.prescription!).toBe(false);
    expect(r.prescription!.kSource).toBe('lattice');
  });

  it('omits it when the vertex clamped (a factor against a bound refuses)', () => {
    const r = buildResult({ ...report, peakAtBound: 'high' }, trials, { anchor, k: latticePin });
    expect('prescription' in r).toBe(false);
    expect(r.peakAtBound).toBe('high'); // the bound disclosure itself still rides
  });
});
```

- [ ] **Step 4: Write the screen (full replacement of `src/ui/result.ts`)**

```ts
import { rememberPrefs, type AppContext, type Screen } from './shell';
import type { FacetConcordance, GameId, Result } from '../types';
import { GAME_YAW } from '../convert/yaw-table';
import { buildExportBundle, toJson, triggerDownload } from '../state/export';
import { plotGeometry, plotLegendHtml, renderConvergencePlot } from './convergence-plot';
import { BOUNDED_COPY, BOUNDED_LEAD, CONCORD_COPY, THESIS_COPY, THESIS_INCONCLUSIVE } from './concord';
import { marksFromTrials } from './session-view';
import {
  ciConcord, ratioFraming, CONFIRMED_MAX_ABS_LN, type Prescription, type RatioFraming,
} from '../optimizer/result';

const fmt = (v: number, digits = 1): string => (Number.isFinite(v) ? v.toFixed(digits) : '-');
// Counts are whole units at four-plus digits: rounded and grouped, because 8240 misreads as a
// year and the group separator is part of the number's legibility budget. Tabular figures come
// from the CSS (canon: every measured number gets them).
const fmtCounts = (v: number): string => (Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '-');
// Two decimals is the factor's honest resolution: the anchor floor is about 4%, so a third
// decimal would print noise (CONFIRMED_MAX_ABS_LN in optimizer/result.ts is the same judgement).
const fmtRatio = (v: number): string => (Number.isFinite(v) ? v.toFixed(2) : '-');

// Percent form of the confirmed band, derived from the classifier's own constant so the copy can
// never drift from the maths (the band is defined in ln space, hence expm1).
const CONFINED_PCT = Math.round(Math.expm1(CONFIRMED_MAX_ABS_LN) * 100);
// Two-sided 90% z, the same constant the anchor CI uses, so tier two's band and tier one's band
// mean the same coverage.
const Z90 = 1.6448536269514722;

// ── Tier-one copy. The screen is ordered by how much each claim assumes and the ordering IS the
// argument: the factor leads BECAUSE it assumes nothing (a ratio of two counts in the same units).
// Each variant below is one branch of the spec's error-path list; none may claim what its data
// cannot distinguish (canon invariant 2). Deliberately the least sophisticated sentences on the
// page: tier one earns the lead by assumptions, never by rhetoric.
const RATIO_WIDTH_NOTE =
  'This interval is wider than the band in the plot below, because the factor carries two measurements: where you aim best, and where you started. A narrower number would answer an easier question.';
// F33: only what the interval supports. No "the session had every chance to move you" (a claim
// about the design, not a measurement) and no "measured no move worth making" (the instrument
// cannot resolve below its own floor, so it cannot certify a move worthless).
const ratioConfirmedNote = (pct: number): string =>
  `Every factor this interval allows is within ${pct}% of no change, and ${pct}% is the tightest this instrument resolves: there is no change here it can distinguish. The honest instruction is to change nothing.`;
const RATIO_INDISTINCT_NOTE =
  'The factor against where you started came back with an interval that includes 1.00, so I will not prescribe a change I cannot tell apart from no change.';
const RATIO_UNAVAILABLE_NOTE =
  'The headline factor needs a clean read of where your hands started, and this session did not produce one. I report the location and leave the factor blank.';

// ── Tier-two copy. The one assumption, named, in words a player can act on. Two routes pin k and
// no third exists (the discrete DPI prior is the false-precision shortcut the spec bans). The
// typed route may NOT claim an exact pin: it inherits the anchor's spread whole (kLogSd, A5), so
// its note names the spread and the table carries it as a band.
const K_NOTE: Record<'lattice' | 'typed-sens', string> = {
  lattice:
    'One measured factor stands between my counts and your mouse. This session it showed up in the movement stream itself, so the table below is in your games’ own units.',
  'typed-sens':
    'One measured factor stands between my counts and your mouse. The in-game sensitivity you typed pinned it, to within the spread of the turn it was compared against, and each row below folds that spread into its 90% band.',
};
const TIER_TWO_WITHHELD =
  'No per-game numbers this session. They need one measured factor, the scale between what your browser reports and what your mouse actually counts, and nothing this session pinned it down. Telling me your game and current in-game sensitivity at setup pins it.';
const TIER_TWO_BOUNDED =
  'No per-game numbers for a bounded result. The number above is an edge of the window I searched, and converting an edge would hand you my search setting as if it were your best.';

// ── Tier-three copy. The tool's own unit, plus arithmetic the player can opt into. The conversion
// renders WITH its arithmetic visible so it can never read as a measurement; the canon test pins
// that no cm/360 string appears anywhere on this screen. Two variants (A6): with k pinned the
// number is HARDWARE counts (C*/k, the division done once in buildPrescription) and the DPI
// conversion carries one caveat; without k the number is BROWSER counts and every centimetre
// claim must name the second unmeasured factor, because this is the tier whose whole job is
// refusing to overclaim.
const TIER_THREE_EXPLAINER =
  'If you know your mouse’s DPI, that is counts divided by DPI, times 2.54, in centimetres.';
const BROWSER_COUNTS_NOTE =
  'These are counts as the browser reports them; the scale between them and your mouse’s own counts went unmeasured this session.';

/** Tier three's optional conversion: centimetres from the player's OWN typed DPI. Pure arithmetic
 *  on their input. It lives here in the shell, off every measured path, so nothing upstream can
 *  mistake it for a measurement. Returns null (never 0, never a guess) for a DPI that is not a
 *  positive finite number. Exported for the unit test. */
export const typedCm = (counts: number, dpi: number): number | null =>
  Number.isFinite(dpi) && dpi > 0 && Number.isFinite(counts) ? (counts / dpi) * 2.54 : null;

const convertedLine = (counts: number, dpiTyped: string, cm: number, hardware: boolean): string =>
  `${fmtCounts(counts)} ÷ ${dpiTyped} × 2.54 = ${cm.toFixed(1)} cm per 360, arithmetic on the DPI you typed. If that DPI is off, this length is off by the same factor.${
    hardware
      ? ''
      : ' It also carries a second unmeasured factor: the scale between browser deltas and your mouse’s own counts, which nothing this session pinned.'
  }`;

// The strike lean. track / flick / calibrate are pure skill readings; strike is the only facet
// that encodes the user's chosen speed and accuracy taste (profile.speedAccuracy, NOT the
// hardcoded instrumentWeights.strike). Claim only what the weighting provably does, never a
// fabricated counterfactual ms.
const strikeLean = (sa: number): string => {
  const side = sa > 0.5 ? 'speed' : sa < 0.5 ? 'accuracy' : 'an even balance';
  return `leaning toward ${side}, which you chose`;
};
// Signed standardized contribution (z-score units). Dash for NaN/missing, never a fabricated pick.
const fmtZ = (v: number | undefined): string =>
  v !== undefined && Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}σ` : '-';

// Session-drift copy (A4). The measured trend is per-session learning OR fatigue; the data cannot
// distinguish the two, so the copy names BOTH and never asserts one cause (honesty invariant).
// When the extended fit fell back the value is dashed and the copy makes NO removal claim.
const driftNote = (v: number | undefined): string =>
  v !== undefined && Number.isFinite(v)
    ? 'Session drift is removed from the number. It could be practice or it could be fatigue, and the data cannot separate the two.'
    : 'Session drift was not separable this run, so nothing was removed and the number is the plain fit.';

// A5 thesis block: each probe's own peak (or a dash, never faked), strike flagged as the
// taste-conditioned lane that is EXCLUDED from the verdict tier. Pure markup over measured values.
function thesisHtml(fc: FacetConcordance): string {
  const rows = fc.facets
    .map((f) => {
      const peak = f.peakCounts !== undefined && Number.isFinite(f.peakCounts) ? fmtCounts(f.peakCounts) : '-';
      return `<span class="result__thesis-facet" data-thesis-facet="${f.instrument}"><span class="dot dot--${f.instrument}"></span> ${f.instrument} ${peak}${f.laneConditioned ? '<sup>*</sup>' : ''}</span>`;
    })
    .join(' · ');
  const starred = fc.facets.some((f) => f.laneConditioned && f.peakCounts !== undefined);
  return `<div class="result__thesis" data-result="thesis" data-thesis-tier="${fc.tier ?? 'inconclusive'}">
    <p class="result__thesis-line">${fc.tier ? THESIS_COPY[fc.tier] : THESIS_INCONCLUSIVE}</p>
    <p class="result__thesis-facets mono">each probe's own peak (counts per 360, marked ◆ on the plot): ${rows}</p>
    ${starred ? `<p class="result__thesis-note"><sup>*</sup>Strike encodes the speed and accuracy lean you chose. It is shown here and excluded from the verdict.</p>` : ''}
  </div>`;
}

// The ratio pair as the screen consumes it: both fields or neither (they are built together in
// buildPrescription). Narrowed once here so every render branch below can trust it.
interface RatioReading { ratio: number; ci: [number, number]; }

// A single screen-reader summary sentence rendered ONCE near the number (not a live region: the
// result is static). Ranges are spelled " to " so no en-dash glyph is ever voiced; a tuned value
// carries NO measured-interval claim, and the ratio variants mirror the visible hero exactly.
function srSummary(
  r: Result,
  ratioP: RatioReading | undefined,
  framing: RatioFraming | undefined,
  tuned: boolean,
  bounded: 'low' | 'high' | undefined,
): string {
  if (tuned) return `Your sensitivity, tuned by feel: ${fmtCounts(r.optimalCounts)} counts per 360. It carries no measured interval.`;
  if (bounded) return `Your number reads as ${bounded === 'high' ? 'at least' : 'at most'} ${fmtCounts(r.optimalCounts)} counts per 360. The fitted curve peaks past the ${bounded === 'high' ? 'slow' : 'fast'} edge of the searched window, so the edge is a bound and no measured interval is reported.`;
  if (ratioP && framing === 'directional') return `Multiply your in-game sensitivity by ${fmtRatio(ratioP.ratio)}, 90% interval ${fmtRatio(ratioP.ci[0])} to ${fmtRatio(ratioP.ci[1])}. You aim best at ${fmtCounts(r.optimalCounts)} counts per 360.`;
  if (ratioP && framing === 'confirmed') return `The factor came back as ${fmtRatio(ratioP.ratio)}: every value its interval allows is within ${CONFINED_PCT}% of no change, the tightest this instrument resolves.`;
  const tail = ratioP
    ? 'The factor against your starting point includes no change, so I do not prescribe one.'
    : 'No starting-point factor was measurable this session.';
  // D1: ci90 is optional on the Result. This branch is measured-only in practice, so the interval
  // is always there; a missing one is simply left unspoken rather than fabricated.
  const interval = r.ci90 ? `, 90% interval ${fmtCounts(r.ci90[0])} to ${fmtCounts(r.ci90[1])}` : '';
  return `You aim best at ${fmtCounts(r.optimalCounts)} counts per 360${interval}. ${tail}`;
}

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
      const hasFacets =
        !tuned && r.bounds !== undefined &&
        (bk.trackContribZ !== undefined || bk.flickContribZ !== undefined);
      // Bounds honesty: gated on the persisted flag ONLY, never inferred from the optimum sitting
      // on an edge. A tuned value already dropped every measured claim.
      const bounded = !tuned ? r.peakAtBound : undefined;
      // The tier-one gate: a tuned value has no measured ratio even if a stale prescription rides
      // the Result (range-adopt drops it, but the screen must not depend on that), and a bounded
      // number is an edge no factor may be taken against (buildPrescription also refuses; this
      // gate covers old persisted Results that predate the refusal).
      const p: Prescription | undefined = !tuned && !bounded ? r.prescription : undefined;
      // A5: the ratio fields are optional now (a pinned k with a refused anchor still ships tier
      // two). Narrow them once; a prescription without them renders the counts hero + the
      // factor-blank sentence, NOT the indistinct sentence, because nothing was measured.
      const ratioP: RatioReading | undefined =
        p && p.ratio !== undefined && p.ratioCi90 !== undefined
          ? { ratio: p.ratio, ci: p.ratioCi90 }
          : undefined;
      const framing = ratioP ? ratioFraming(ratioP.ci) : undefined;
      const heroMode: 'tuned' | 'bounded' | 'ratio' | 'confirmed' | 'counts' =
        tuned ? 'tuned'
        : bounded ? 'bounded'
        : framing === 'directional' ? 'ratio'
        : framing === 'confirmed' ? 'confirmed'
        : 'counts';
      const showRatioHero = heroMode === 'ratio' || heroMode === 'confirmed';
      // D1: Result.ci90 is optional now (absent means tuned by feel; phase 1a task 4). A measured
      // Result always carries it; the truthiness guard keeps tsc honest under strict and renders
      // nothing from a malformed one rather than fabricating an interval.
      const concord = !tuned && !bounded && r.ci90 ? ciConcord(r.optimalCounts, r.ci90) : undefined;
      const lean = r.speedAccuracy;
      const fc = !tuned ? r.facetConcordance : undefined;

      const lead =
        heroMode === 'tuned' ? 'Your number'
        : heroMode === 'bounded' ? BOUNDED_LEAD
        : heroMode === 'ratio' ? 'Multiply your in-game sensitivity by'
        : heroMode === 'confirmed' ? 'The factor came back as'
        : 'Where you aim best';
      const heroNumber = showRatioHero && ratioP
        ? `<span data-result="ratio">${fmtRatio(ratioP.ratio)}</span><small>×</small>`
        : `<span data-result="counts360">${fmtCounts(r.optimalCounts)}</span><small> counts per 360</small>`;
      const ciLine = tuned
        ? `<p class="result__ci result__ci--tuned reveal" data-reveal style="--reveal-i:2">You picked this one by feel, so it carries no measured interval.</p>`
        : bounded
          ? `<p class="result__ci result__ci--bounded reveal" data-result="bounded" data-bounded="${bounded}" data-reveal style="--reveal-i:2">${BOUNDED_COPY[bounded](fmtCounts(r.optimalCounts))}</p>`
          : showRatioHero && ratioP
            ? `<p class="result__ci reveal" data-reveal style="--reveal-i:2">90% interval <span data-result="ratio-ci">${fmtRatio(ratioP.ci[0])} to ${fmtRatio(ratioP.ci[1])}</span>. ${
                heroMode === 'ratio'
                  ? 'A ratio of two counts measured the same way, so your game, mouse DPI and driver settings all cancel out of it.'
                  : `Everything this interval allows sits within ${CONFINED_PCT}% of no change.`
              }</p>`
            : r.ci90
              ? `<p class="result__ci reveal" data-reveal style="--reveal-i:2">90% interval <span data-result="ci">${fmtCounts(r.ci90[0])} to ${fmtCounts(r.ci90[1])}</span> counts per 360</p>`
              : '';
      const heroNote = tuned || bounded
        ? ''
        : heroMode === 'ratio'
          ? `<p class="result__ratio-note reveal" data-result="ratio-note" data-reveal style="--reveal-i:3">${RATIO_WIDTH_NOTE}</p>`
          : heroMode === 'confirmed'
            ? `<p class="result__ratio-note reveal" data-result="ratio-confirmed" data-reveal style="--reveal-i:3">${ratioConfirmedNote(CONFINED_PCT)}</p>`
            : ratioP
              ? `<p class="result__ratio-note reveal" data-result="ratio-withheld" data-reveal style="--reveal-i:3">${RATIO_INDISTINCT_NOTE}</p>`
              : `<p class="result__ratio-note reveal" data-result="ratio-unavailable" data-reveal style="--reveal-i:3">${RATIO_UNAVAILABLE_NOTE}</p>`;

      // Tier two: the table exists only under a pinned k. A tuned value renders no tier two at
      // all (its k evidence was dropped with the measurement, and explaining k against a hand
      // pick would be noise). Every row carries a 90% band built from two independent sources
      // combined in quadrature: the search's own precision (the drill bootstrap, read straight
      // off countsCi90) and k's spread (kLogSd, A5). Math.hypot is never smaller than either
      // input, so the band can only widen, never narrow (D3, and the same rule the interval has
      // already been fixed against four times). It renders even when kLogSd is 0 (an exactly
      // pure lattice): the bootstrap is still there, and a bare three-decimal sensitivity would
      // present a number the player types into their game as if it were exact. A degenerate
      // countsCi90 renders no band at all rather than a fabricated one. The withheld sentence
      // must be one a player can act on.
      const kSpread = p?.kLogSd !== undefined && Number.isFinite(p.kLogSd) && p.kLogSd > 0 ? p.kLogSd : 0;
      const searchHalfLn =
        p !== undefined && p.countsCi90[0] > 0 && p.countsCi90[1] > p.countsCi90[0]
          ? Math.log(p.countsCi90[1] / p.countsCi90[0]) / 2
          : null;
      const halfLn = searchHalfLn === null ? null : Math.hypot(searchHalfLn, Z90 * kSpread);
      const rows = p?.perGameSens
        ? GAME_YAW.map((g) => {
            const sens = p.perGameSens![g.id];
            const current = g.id === ctx.draft.currentGame;
            const bandCell =
              halfLn !== null
                ? `<td class="mono">${
                    sens === undefined
                      ? '-'
                      : `<span data-sens-band>${(sens * Math.exp(-halfLn)).toFixed(3)} to ${(sens * Math.exp(halfLn)).toFixed(3)}</span>`
                  }</td>`
                : '';
            return `<tr data-game="${g.id}"${current ? ' data-current="true"' : ''}>
              <td>${g.label}</td><td class="mono">${sens === undefined ? '-' : sens.toFixed(3)}</td>${bandCell}</tr>`;
          }).join('')
        : '';
      const tierTwo = tuned
        ? ''
        : `<div class="result__tier reveal" data-tier="two" data-reveal style="--reveal-i:9">
            <p class="result__tier-head t-label">No. 2 · one measured factor</p>
            ${p?.perGameSens && p.kSource
              ? `<p class="result__k-note">${K_NOTE[p.kSource]}</p>
                <label class="field result__game-pick"><span>Your game</span>
                  <select data-action="your-game">${GAME_YAW.map((g) => `<option value="${g.id}"${g.id === ctx.draft.currentGame ? ' selected' : ''}>${g.label}</option>`).join('')}</select></label>
                <table class="result__games"><thead><tr><th>Game</th><th>Sensitivity</th>${halfLn !== null ? '<th>90% band</th>' : ''}</tr></thead><tbody>${rows}</tbody></table>`
              : `<p class="result__tier-note" data-result="tier-two-withheld">${bounded ? TIER_TWO_BOUNDED : TIER_TWO_WITHHELD}</p>`}
          </div>`;

      // Tier three (A6): hardware counts when k is pinned (buildPrescription did the one
      // division and carried it as hardwareCounts), browser counts plus the second-factor
      // disclosure when it is not. The DPI conversion always divides the number SHOWN, so the
      // arithmetic on screen and the arithmetic performed can never disagree.
      const hw = !tuned && !bounded ? p?.hardwareCounts : undefined;
      const convertBase = hw !== undefined ? hw : r.optimalCounts;
      const boundedPrefix = bounded === 'high' ? 'At least ' : bounded === 'low' ? 'At most ' : '';
      const tierThreeLine = hw !== undefined
        ? `<span class="mono" data-result="tier-three-counts" data-counts-kind="hardware">${fmtCounts(hw)}</span> hardware counts of mouse travel make one full turn at this sensitivity. The measured browser factor is already divided out of this number. ${TIER_THREE_EXPLAINER}`
        : `${boundedPrefix}<span class="mono" data-result="tier-three-counts" data-counts-kind="browser">${fmtCounts(r.optimalCounts)}</span> browser counts of mouse travel make one full turn at this sensitivity. ${TIER_THREE_EXPLAINER} ${BROWSER_COUNTS_NOTE}`;
      const tierThree = `<div class="result__tier reveal" data-tier="three" data-reveal style="--reveal-i:10">
          <p class="result__tier-head t-label">No. 3 · arithmetic on your input</p>
          <p class="result__counts-line">${tierThreeLine}</p>
          <label class="field result__dpi-field"><span>Mouse DPI, if you know it</span>
            <input type="number" min="1" step="1" inputmode="numeric" data-action="dpi-convert"></label>
          <p class="result__converted mono" data-result="dpi-converted" hidden></p>
        </div>`;

      const root = document.createElement('section');
      root.className = 'screen screen--shell result fade-in';
      // Staged reveal: each data-reveal block fades/rises in sequence (--reveal-i drives the CSS
      // delay; reduced motion renders everything instantly). The NUMBER lands first, then the
      // evidence around it, then the tiers in assumption order, then the actions.
      root.innerHTML = `
        <div class="wrap stack result__inner">
          <div class="result__tier result__tier--one" data-tier="one" data-hero="${heroMode}">
            <p class="result__tier-head t-label reveal" data-reveal style="--reveal-i:0">No. 1 · assumes nothing</p>
            <p class="result__lead reveal" data-reveal style="--reveal-i:0">${lead}</p>
            <h1 class="display result__number reveal" data-reveal style="--reveal-i:1">${heroNumber}</h1>
            <p class="result__sr-summary sr-only">${srSummary(r, ratioP, framing, tuned, bounded)}</p>
            ${ciLine}
            ${heroNote}
          </div>
          ${concord
            ? `<p class="result__concord reveal" data-result="concord" data-concord="${concord}" data-reveal style="--reveal-i:4">${CONCORD_COPY[concord]}</p>`
            : ''}
          ${!tuned && r.curve && r.bounds
            ? `<figure class="result__plot reveal" data-reveal style="--reveal-i:5"><svg data-plot aria-hidden="true"></svg>
                <figcaption>${bounded
                  ? 'The four probes still climbing at the edge of the searched window. The answer line and the band stop where the search stopped.'
                  : 'The four probes converging on your one number.'} ${plotLegendHtml()}</figcaption></figure>`
            : ''}
          <p class="result__credit reveal" data-reveal style="--reveal-i:6">Measured across four environments and six organisms: dragonfly, falcon, spider, raptor, archerfish, mantis shrimp.</p>
          <div class="result__tier reveal" data-tier="origin" data-reveal style="--reveal-i:7">
            <p class="result__tier-head t-label">Where the number comes from</p>
            <div class="result__breakdown">
              <div><span class="result__bk-label"><span class="dot dot--calibrate"></span> Bias zero <em>archerfish</em></span><span data-breakdown="biasZeroCounts">${fmtCounts(bk.biasZeroCounts)} counts per 360</span></div>
              ${!tuned
                ? `<div><span class="result__bk-label">Session drift <em>practice or fatigue</em></span><span data-result="driftZ">${fmtZ(r.driftZ)}</span></div>`
                : ''}
            </div>
            ${!tuned ? `<p class="result__drift-note">${driftNote(r.driftZ)}</p>` : ''}
            ${fc ? thesisHtml(fc) : ''}
            ${hasFacets
              ? `<figure class="result__facets"><svg data-facets aria-hidden="true"></svg>
                  <figcaption>Track and flick, the two intercept probes, marked where they pull on the blend.
                    <span class="result__facet-z"><span class="dot dot--track"></span> track <span data-breakdown="trackContribZ">${fmtZ(bk.trackContribZ)}</span> · <span class="dot dot--flick"></span> flick <span data-breakdown="flickContribZ">${fmtZ(bk.flickContribZ)}</span></span></figcaption></figure>`
              : ''}
          </div>
          <div class="result__tier reveal" data-tier="readings" data-reveal style="--reveal-i:8">
            <p class="result__tier-head t-label">Readings at that sensitivity</p>
            <div class="result__breakdown">
              <div><span class="result__bk-label">Precision floor</span><span data-breakdown="precisionFloorDeg">${fmt(bk.precisionFloorDeg, 2)}°</span></div>
              <div><span class="result__bk-label"><span class="dot dot--strike"></span> Time to kill <em>mantis shrimp</em>${lean !== undefined ? ` <span class="result__lean" data-result="strikeLean">${strikeLean(lean)}</span>` : ''}</span><span data-breakdown="ttkMs">${fmt(bk.ttkMs, 0)} ms</span></div>
              <div><span class="result__bk-label">Hit rate</span><span data-breakdown="hitRate">${Number.isFinite(bk.hitRate) ? Math.round(bk.hitRate * 100) + '%' : '-'}</span></div>
            </div>
            ${lean !== undefined
              ? `<p class="result__lean-note">Track, flick and calibrate are pure skill readings. The strike pair encodes the speed and accuracy lean you chose, so it reports the balance you set.</p>`
              : ''}
          </div>
          ${tierTwo}
          ${tierThree}
          <p class="result__saved reveal" data-reveal style="--reveal-i:11">Saved locally. Nothing leaves your machine.</p>
          <div class="result__actions reveal" data-reveal style="--reveal-i:11">
            ${bounded ? `<button class="action action--primary" data-action="widen-search">Widen the search window</button>` : ''}
            <button class="action ${bounded ? 'action--secondary' : 'action--primary'}" data-action="range">Step into the range</button>
            <button class="action action--secondary" data-action="case-study">Read how this works</button>
            <button class="action action--ghost" data-action="again">Run again</button>
            <button class="action action--ghost" data-action="export">Export JSON</button>
          </div>
        </div>`;
      root.querySelector('[data-action="again"]')!.addEventListener('click', () => ctx.navigate('hero'));
      root.querySelector('[data-action="range"]')!.addEventListener('click', () => ctx.navigate('range'));
      // The honest next step for a bounded result: the options screen owns the search-window
      // control, so the offer to search wider routes there instead of inventing a second mechanism.
      root.querySelector('[data-action="widen-search"]')?.addEventListener('click', () => ctx.navigate('options'));
      root.querySelector('[data-action="case-study"]')!.addEventListener('click', () => ctx.navigate('case-study'));
      root.querySelector('[data-action="export"]')!.addEventListener('click', () => {
        const sessions = ctx.storage.loadSessions();
        const results = ctx.lastResult ? { [ctx.lastResult.sessionId]: ctx.lastResult.result } : {};
        triggerDownload('campeon-result.json', toJson(buildExportBundle(sessions, results, 0)));
      });
      const sel = root.querySelector('[data-action="your-game"]') as HTMLSelectElement | null;
      sel?.addEventListener('change', () => {
        root.querySelectorAll('tr[data-current="true"]').forEach((tr) => tr.removeAttribute('data-current'));
        root.querySelector(`tr[data-game="${sel.value}"]`)?.setAttribute('data-current', 'true');
        // The pick writes the draft and is remembered, so the next visit highlights the right
        // game without re-asking.
        ctx.draft.currentGame = sel.value as GameId;
        rememberPrefs(ctx);
      });
      // Tier three's converter: pure arithmetic on the typed value, rendered with the arithmetic
      // VISIBLE (counts, DPI, 2.54) so it can never read as a measurement. It divides convertBase,
      // the SAME number the tier displays (hardware when pinned, browser otherwise), and the
      // browser variant restates the second unmeasured factor. A non-positive or empty DPI clears
      // the line entirely: no guess, no zero, no held stale value.
      const dpiInput = root.querySelector('[data-action="dpi-convert"]') as HTMLInputElement | null;
      const dpiOut = root.querySelector('[data-result="dpi-converted"]') as HTMLElement | null;
      dpiInput?.addEventListener('input', () => {
        if (!dpiOut) return;
        const cm = typedCm(convertBase, Number(dpiInput.value));
        if (cm === null) { dpiOut.hidden = true; dpiOut.textContent = ''; return; }
        dpiOut.hidden = false;
        dpiOut.textContent = convertedLine(convertBase, dpiInput.value.trim(), cm, hw !== undefined);
      });
      host.appendChild(root);

      // Climax: redraw the convergence plot. Guard mirrors the markup guard: never plot a tuned
      // value (no measured curve) or an old number-only Result. Marks come from the persisted
      // trials via the pure marksFromTrials; curve/peak/CI are copied verbatim from the Result
      // (which copied them verbatim from the Report). This layer never refits.
      if (!tuned && r.curve && r.bounds) {
        const svg = root.querySelector('[data-plot]') as unknown as SVGElement | null;
        if (svg) {
          const sessionId = ctx.lastResult?.sessionId;
          const trials = ctx.storage.loadSessions().find((s) => s.id === sessionId)?.trials ?? [];
          const g = plotGeometry({
            bounds: r.bounds, marks: marksFromTrials(trials),
            curve: r.curve, peak: r.optimalCounts, size: PLOT_SIZE,
            // D1: ci90 is optional, and exactOptionalPropertyTypes forbids assigning undefined to
            // PlotInput's optional member, so it spreads in only when present.
            ...(r.ci90 ? { ci90: r.ci90 } : {}),
            // A5's per-facet peaks ride the top rail of the SAME plot, so the thesis copy below
            // has its visible counterpart: four probes, their own bests, one answer line.
            ...(fc ? { facetPeaks: fc.facets } : {}),
          });
          renderConvergencePlot(svg, g, 'blended score');
        }
      }

      // Stage the reveal on the next frame (CSS transitions from the data-reveal initial state);
      // under reduced motion the CSS renders everything instantly and this class is inert.
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => root.classList.add('is-revealed'));
      } else {
        root.classList.add('is-revealed');
      }

      // The two intercept probes (track + flick) as organism-colored marks on the SAME shared
      // counts log axis, anchored to the one answer (peak line). Reuses the pure
      // plotGeometry/renderConvergencePlot seam (no fork); guard mirrors `hasFacets`.
      if (hasFacets && r.bounds) {
        const svg = root.querySelector('[data-facets]') as unknown as SVGElement | null;
        if (svg) {
          const sessionId = ctx.lastResult?.sessionId;
          const trials = ctx.storage.loadSessions().find((s) => s.id === sessionId)?.trials ?? [];
          const facetMarks = marksFromTrials(trials).filter(
            (m) => m.instrument === 'track' || m.instrument === 'flick',
          );
          const g = plotGeometry({
            bounds: r.bounds, marks: facetMarks, peak: r.optimalCounts, size: FACET_SIZE,
          });
          renderConvergencePlot(svg, g);
        }
      }
    },
    unmount() { host.replaceChildren(); },
  };
}
```

- [ ] **Step 5: Run the two rewritten test files**

Run: `npx vitest run tests/ui/result.test.ts tests/optimizer/result.test.ts`
Expected: PASS (49 tests in result.test.ts: 9 tier one, 9 tier two, 5 tier three, 16 evidence, 5 thesis, 5 arc; result.test.ts grows by the 4 attachment tests)

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS, zero failures

- [ ] **Step 7: Commit**

```bash
git add src/ui/result.ts src/optimizer/result.ts tests/ui/result.test.ts tests/optimizer/result.test.ts
git commit -m "feat(result): the payoff screen ordered by what each claim assumes" -m "Tier one leads because it assumes nothing: multiply your sensitivity by a ratio of two counts in the same units. A confined factor of 1.00 is reported as exactly what the interval supports, no more (F33). Tier two appears only under a pinned k, carries a per-row 90% band combining the search's own interval with k's spread in quadrature (A5, D3), and says why when withheld. Tier three renders hardware counts when k is pinned and otherwise names the second unmeasured factor in every centimetre claim (A6), because the tier that exists to refuse overclaiming must not quietly overclaim."
```
### Task 12: Tier styling, counts-true bound copy, and the canon sweep test

**Files:**
- Modify: `src/ui/concord.ts` (the two BOUNDED_COPY strings and their doc comment)
- Modify: `src/styles/shell.css` (append the tier styles to the result section)
- Create: `tests/ui/result-canon.test.ts`

`src/ui/concord.ts` is owned by this phase (amendment A1). BOUNDED_COPY and BOUNDED_LEAD are
rendered only by the payoff screen (session-view imports only CONCORD_COPY), so this task claims
those strings as payoff-screen words. No other phase edits this file.

- [ ] **Step 1: Write the failing test**

Create `tests/ui/result-canon.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { result as resultScreen } from '../../src/ui/result';
import type { AppContext, Route, SessionDraft } from '../../src/ui/shell';
import { counts360, type Counts360, type Result } from '../../src/types';
import type { Prescription } from '../../src/optimizer/result';

const c = counts360;
const ci = (lo: number, hi: number): [Counts360, Counts360] => [c(lo), c(hi)];

const PRES: Prescription = {
  ratio: 0.88, ratioCi90: [0.79, 0.97],
  counts: c(8240), countsCi90: ci(7800, 8700),
  perGameSens: { cs2: 1.59, valorant: 0.5 },
  kSource: 'typed-sens',
  kLogSd: 0.12,
  hardwareCounts: c(4120),
};
const RESULT: Result = {
  optimalCounts: c(8240), ci90: ci(7800, 8700),
  breakdown: { biasZeroCounts: c(7940), precisionFloorDeg: 0.42, ttkMs: 511, hitRate: 0.86 },
  prescription: PRES,
};

function mount(res: Result): HTMLElement {
  const host = document.createElement('div');
  const draft: SessionDraft = { currentGame: 'cs2', currentSens: 1, bounds: ci(4000, 16000),
    profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } } };
  const ctx = {
    route: 'result' as Route, draft,
    navigate() {},
    storage: { saveSession() {}, loadSessions: () => [], saveResult() {}, exportJson: () => '{}' },
    lastResult: { sessionId: 's1', result: res },
  } as unknown as AppContext;
  resultScreen(host, ctx).mount();
  return host;
}

// Every honesty branch of the hero, so the sweeps below cover each sentence the screen can speak.
const VARIANTS: Record<string, Result> = {
  directional: RESULT,
  confirmed: { ...RESULT, prescription: { ...PRES, ratio: 1.0, ratioCi90: [0.97, 1.04] } },
  indistinct: { ...RESULT, prescription: { ...PRES, ratio: 0.93, ratioCi90: [0.85, 1.08] } },
  kOnly: (() => { const { ratio: _r, ratioCi90: _rc, ...rest } = PRES; return { ...RESULT, prescription: rest }; })(),
  unanchored: (() => { const { prescription: _p, ...rest } = RESULT; return rest; })(),
  bounded: { ...RESULT, peakAtBound: 'high' },
  tuned: { ...RESULT, tuned: true },
};

describe('result screen canon', () => {
  it('orders the tiers structurally: one, two, three in DOM order', () => {
    const host = mount(RESULT);
    const one = host.querySelector('[data-tier="one"]');
    const two = host.querySelector('[data-tier="two"]');
    const three = host.querySelector('[data-tier="three"]');
    expect(one).toBeTruthy();
    expect(two).toBeTruthy();
    expect(three).toBeTruthy();
    // The ordering is the argument (least assuming first), so it is pinned as DOM structure,
    // not left to CSS: a stylesheet reorder cannot silently invert the epistemics.
    expect(one!.compareDocumentPosition(two!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(two!.compareDocumentPosition(three!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('labels each tier with what it assumes', () => {
    const host = mount(RESULT);
    const head = (tier: string): string =>
      host.querySelector(`[data-tier="${tier}"] .result__tier-head`)!.textContent!;
    expect(head('one')).toBe('No. 1 · assumes nothing');
    expect(head('two')).toBe('No. 2 · one measured factor');
    expect(head('three')).toBe('No. 3 · arithmetic on your input');
  });

  it('the only centimetre on the page is the typed-DPI arithmetic, and no cm/360 survives', () => {
    const host = mount(RESULT);
    expect(host.textContent).not.toContain('cm/360');
    expect(host.textContent).not.toContain('cm per 360'); // absent until the player types a DPI
    const input = host.querySelector('[data-action="dpi-convert"]') as HTMLInputElement;
    input.value = '800';
    input.dispatchEvent(new Event('input'));
    const out = host.querySelector('[data-result="dpi-converted"]')!;
    expect(out.textContent).toContain('cm per 360');
    expect(out.textContent).toContain('2.54');
    expect(host.textContent).not.toContain('cm/360'); // still nowhere, even after converting
  });

  it('spells the unit counts per 360 everywhere, never a slashed compact form (F36)', () => {
    for (const res of Object.values(VARIANTS)) {
      const text = mount(res).textContent!;
      expect(text).toContain('counts per 360');
      expect(text).not.toContain('counts/360');
    }
  });

  it('a bounded result also speaks counts, never the deleted unit', () => {
    const host = mount(VARIANTS.bounded);
    expect(host.textContent).not.toContain('cm/360');
    expect(host.querySelector('[data-result="bounded"]')!.textContent).toContain('counts per 360');
  });

  it('no em dash, en dash, or double hyphen reaches visible copy, in any hero variant', () => {
    for (const res of Object.values(VARIANTS)) {
      const text = mount(res).textContent!;
      expect(text).not.toMatch(/[—–]/);
      expect(text).not.toContain('--');
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/ui/result-canon.test.ts -t 'a bounded result also speaks counts'`
Expected: FAIL with an AssertionError whose message ends `not to contain 'cm/360'` (the mount
itself succeeds - the screen is task 11's - but BOUNDED_COPY in `src/ui/concord.ts` still says
`cm/360`, which is precisely the defect this test pins; step 3 is the fix)

- [ ] **Step 3: Move the bound copy onto counts (edits in `src/ui/concord.ts`)**

Replace the sentence in the BOUNDED_COPY doc comment

```
points (high = the slow end of the cm/360 scale, low = the fast end). The caller interpolates the
```

with

```
points (high = the slow end of the counts-per-360 scale, low = the fast end). The caller interpolates the
```

and replace the two copy strings:

```ts
export const BOUNDED_COPY: Record<'low' | 'high', (v: string) => string> = {
  high: (v) =>
    `The fitted curve peaks past the slow edge of the window I searched. Your number reads as at least ${v} counts per 360, a bound this session cannot see past.`,
  low: (v) =>
    `The fitted curve peaks past the fast edge of the window I searched. Your number reads as at most ${v} counts per 360, a bound this session cannot see past.`,
};
```

- [ ] **Step 4: Append the tier styles to `src/styles/shell.css`**

Append directly after the `.result__saved` rule (the end of the result section):

```css
/* The three assumption tiers (No. 1 assumes nothing, No. 2 one measured factor, No. 3 arithmetic
   on your input). The ordering is DOM structure pinned by result-canon.test.ts; these rules only
   dress it: museum-tag heads, prose-measure notes, tabular figures on every measured number
   (canon 5). Zero radius everywhere is inherited; nothing here rounds a corner. */
.result__ratio-note,
.result__tier-note,
.result__k-note {
  font: var(--type-body-sm);
  color: var(--text-muted);
  max-width: var(--measure-prose);
  margin-top: var(--space-3);
}
.result__counts-line { max-width: var(--measure-prose); }
.result__counts-line .mono,
.result__number,
.result__converted {
  font-variant-numeric: tabular-nums slashed-zero;
}
/* Tier two's k-spread band (A5): measured widening, quieter than the point value it widens. */
.result__games [data-sens-band] {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums slashed-zero;
}
.result__dpi-field { max-width: 22rem; margin-top: var(--space-4); }
.result__converted { color: var(--text-muted); margin-top: var(--space-3); }
```

- [ ] **Step 5: Run the canon test**

Run: `npx vitest run tests/ui/result-canon.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Full suite and the type gate**

Run: `npm test`
Expected: PASS, zero failures
Run: `npm run build`
Expected: PASS (tsc emits no errors, vite build completes)

- [ ] **Step 7: Commit**

```bash
git add src/ui/concord.ts src/styles/shell.css tests/ui/result-canon.test.ts
git commit -m "feat(result): tier styling, counts-true bound copy, and the canon sweep test" -m "The bound copy was the last user-facing string on the payoff path still speaking cm/360. The canon test pins the whole screen: tiers in DOM order, tier heads naming their assumptions, centimetres only as typed-DPI arithmetic, the unit spelled counts per 360 in every hero variant, and no em dash, en dash, or double hyphen anywhere."
```
### Task 13: The case study moves onto counts, and the canon test covers it

**Files:**
- Modify: `src/ui/case-study/content.ts` (copy strings, the worked-example fixture)
- Modify: `src/ui/case-study/case-study.ts` (the gate figure line, the specimen-card figure values)
- Modify: `tests/ui/case-study/chrome.test.ts:7` (one fixture label)
- Create: `tests/ui/case-study/canon.test.ts`

The case study is user-facing and was in nobody's partition (F18); amendment A1 assigns
`src/ui/case-study/*` to this phase. At this task's start, phase 1a's sweep has already renamed
the IDENTIFIERS in these files (`peakCm360` to `peakCounts`, the `cm360` fixture keys to `counts`)
and, per F8, its task 4 step 12 already replaced the whole `demoConvergence` fixture so its own
commit typechecks: bounds of 4800 to 19200, a peak of 9150, facet peaks of `counts360(8850)`,
`counts360(9575)`, `counts360(9200)` and `counts360(10400)`, a ci of 8650 to 9800 (the old cm
values times 800 / 2.54, rounded to the nearest fifty), the matching specimen-card strings
(`'9,150'`, `'90% ci 8,650 to 9,800 counts per 360'`, `'8,850'` / `'9,575'` / `'9,200'` /
`'10,400'`), and the chrome.ts card tag, which already reads `'your counts per 360'`. What the
sweep could NOT touch is copy: `cm/360` carries a slash, so the word-bounded rename never matched
it, and the whole card-sweep and spin narrative still describes the deleted instrument. Left as
is, the page would narrate a calibration that no longer exists. This task rewrites the copy,
replaces the worked-example fixture and specimen card wholesale with this task's own values on a
4700 to 19000 scale, superseding the interim numbers phase 1a landed, and extends canon coverage
beyond the result screen.

- [ ] **Step 1: Write the failing test**

Create `tests/ui/case-study/canon.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { caseStudy } from '../../../src/ui/case-study/case-study';
import { demoConvergence } from '../../../src/ui/case-study/content';
import type { AppContext } from '../../../src/ui/shell';

beforeEach(() => {
  class IO { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } root = null; rootMargin = ''; thresholds = []; }
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IO;
});

function mountCase(): HTMLElement {
  const host = document.createElement('div');
  const ctx = { navigate() {}, route: 'case-study', storage: {} as never, draft: {} as never } as unknown as AppContext;
  caseStudy(host, ctx).mount();
  return host;
}

describe('case study canon (the spec test extended beyond the result screen, F18)', () => {
  it('speaks counts per 360 and never the retired unit', () => {
    const text = mountCase().textContent!;
    expect(text).not.toContain('cm/360');
    // "cm per 360" is reserved for the result screen's typed-DPI conversion line; the case study
    // may say "centimetres" when explaining that conversion, but never quotes the retired unit.
    expect(text).not.toContain('cm per 360');
    expect(text).toContain('counts per 360');
  });

  it('tells the blind-turn story, not the card sweep or the spin', () => {
    const text = mountCase().textContent!.toLowerCase();
    // The deleted instrument's narrative markers. "specimen card" (a UI idiom) stays legal;
    // the WALLET card, the drag-a-card sweep and the DPI measurement claim do not.
    expect(text).not.toMatch(/drag a card|card('|’)s width|wallet card/);
    expect(text).not.toContain('measure your dpi');
    expect(text).toContain('blind');
    expect(text).toContain('turn all the way around');
  });

  it('the specimen-card figure quotes counts, not centimetre-shaped values relabelled', () => {
    const card = mountCase().querySelector('.cs-ui--card')!;
    expect(card).toBeTruthy();
    expect(card.textContent).toContain('your counts per 360');
    expect(card.textContent).toContain('9,260');
    expect(card.textContent).toContain('8,630 to 9,800 counts per 360');
    // The sed relabel trap (F18): 29.4 was centimetres; as counts it would be fabricated.
    expect(card.textContent).not.toContain('29.4');
  });

  it('the worked-example fixture lives on a counts scale, not relabelled centimetres', () => {
    const demo = demoConvergence();
    // 15 to 60 was the cm-era window; a counts axis is three orders of magnitude up. This pins
    // the whole fixture, not just the four peaks phase 1a already converted.
    expect(demo.bounds[0]).toBeGreaterThan(1000);
    expect(demo.ci90![0]).toBeGreaterThan(1000);
    expect(demo.marks.every((m) => m.counts > 1000)).toBe(true);
    for (const f of demo.facetPeaks!) {
      expect(f.peakCounts === undefined || f.peakCounts > 1000).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/ui/case-study/canon.test.ts -t 'speaks counts per 360'`
Expected: FAIL with an AssertionError whose message ends `not to contain 'cm/360'` (the premise
eyebrow alone still renders the token three times; the mount itself succeeds because the screen
needs only a stubbed ctx)

- [ ] **Step 3: Rewrite the copy and the fixture**

All edits below quote the strings as they stand after phase 1a's sweep (identifiers renamed,
copy untouched). In `src/ui/case-study/content.ts`:

1. Premise eyebrow. Replace
   `eyebrow: ['the problem', 'a case study', 'cm/360'],` with
   `eyebrow: ['the problem', 'a case study', 'counts per 360'],`

2. Premise body[0]. Replace the whole string beginning `'One number decides how far your hand
   travels'` with:

```ts
      'One number decides how far your hand travels to turn all the way around: <strong>counts per 360</strong>, the mouse counts of travel that make one full turn. It is the unit the instrument itself measures in, independent of any game by construction, and every in-game slider you have ever touched is this number wearing different clothes. If you know your mouse\'s DPI, the result screen will turn it into centimetres for you, labelled as arithmetic on your input rather than as a measurement.',
```

3. Premise body[2]. In the string beginning `'So I rebuilt the four'`, replace the closing
   `a single master cm/360 with a confidence interval.` with
   `a single master counts per 360 with a confidence interval.`

4. Premise body[3]. Replace the whole string beginning `'<strong>What a session costs
   you.</strong> Two calibration steps first: drag a card\'s width across your pad'` with:

```ts
      '<strong>What a session costs you.</strong> One calibration step first: turn all the way around three times, blind, alternating direction, so I can read where your hands already play and seed the search there. No card, no ruler, no DPI to look up. After that you play the four drills in short trials, at sensitivities the search picks. The first <span class="cs-mark">8 trials</span> seed the gene pool, and a whole session is capped at <span class="cs-mark">30 trials</span>. I have not timed sessions across a range of players, so I am not going to quote you a duration I never measured.',
```

5. Premise spec rows. Replace
   `{ k: 'the variable', v: 'cm/360 · physical cm per 360° turn' },` with
   `{ k: 'the variable', v: 'counts per 360 · mouse counts of travel per full 360° turn' },`
   and `{ k: 'the ask', v: 'calibrate · 4 drills · 8 seeding trials · 30 trial cap', mono: true },` with
   `{ k: 'the ask', v: 'three blind turns · 4 drills · 8 seeding trials · 30 trial cap', mono: true },`
   and `{ k: 'output', v: 'one cm/360 + a 90% confidence interval', mono: true },` with
   `{ k: 'output', v: 'one counts per 360 + a 90% confidence interval', mono: true },`

6. Flick body[2]. Replace `cheap at lower cm/360` with `cheap at lower counts per 360` and
   `sharper at higher cm/360` with `sharper at higher counts per 360` (the direction survives the
   unit change: counts scale with centimetres, so lower still means more sensitive).

7. Calibrate body[1]. Replace `Cm/360 drives bias steeply` with `Counts per 360 drives bias
   steeply`, and in the spec rows replace
   `{ k: 'headline', v: 'bias-zero cm/360 (gain g = 1)' },` with
   `{ k: 'headline', v: 'bias-zero counts per 360 (gain g = 1)' },`

8. Strike body[1]. Replace `is your speed↔accuracy operating point at each cm/360.` with
   `is your speed↔accuracy operating point at each sensitivity.`

9. Engine body[0]. Replace `I sweep each environment across cm/360 and` with
   `I sweep each environment across counts per 360 and`.

10. Engine body[2]. Replace `its own 90% ci is tighter than <span class="cs-mark">6
    cm/360</span>` with `its own 90% ci is tighter than <span class="cs-mark">1,900 counts per
    360</span>` (the value phase 1a pinned as FIRST_STOP_CI in the session controller; if 1a
    landed a different constant, quote that one, because this page may not contradict the code).
    In the spec rows replace
    `{ k: 'segment stop', v: '90% ci tighter than 6 cm/360 · refine buys 6 generations', mono: true },` with
    `{ k: 'segment stop', v: '90% ci tighter than 1,900 counts per 360 · refine buys 6 generations', mono: true },`

11. Honesty body[5] (the input gate). Replace the whole string beginning `'<strong>I gate raw
    input,'` with:

```ts
      '<strong>I gate raw input, and then I let you walk past the gate.</strong> A measured session wants pointer-lock raw capture, and the blind turn runs an acceleration check because os mouse acceleration would make one true turn distance impossible to pin down. When that check fails, or when the browser refuses the lock outright, I still let you type your game and current in-game sensitivity by hand. Those typed numbers seed the search and pin the one browser-to-mouse factor the per-game table needs; they are never treated as a measured anchor, and the button says so both times it appears. Showing you the gate and the door beside it beats pretending the door is not there.',
```

    and in the spec rows replace
    `{ k: 'the input gate', v: 'raw capture preferred · typed numbers seed only, never measured' },` with
    `{ k: 'the input gate', v: 'raw capture preferred · typed game + sens seeds and pins k, never an anchor' },`

12. Colophon body[3]. Replace `so nobody redoes a sweep they already earned.` with
    `so nobody redoes a calibration they already earned.`

13. The worked-example fixture. Replace the whole `demoConvergence` function AND its doc comment
    with the block below (phase 1a's step 12 already imports `counts360` from `'../../types'`;
    add `type Counts360` beside it). Phase 1a landed peaks of 8850 / 9575 / 9200 / 10400 around a
    fit peak of 9150 on the 4800 to 19200 window, so its own commit typechecks; this block
    replaces that interim fixture whole, peaks included. The old 15 to 60 cm window at 800 DPI is
    roughly 4,700 to 19,000 counts, and every value below is that mapping rounded to legible
    numbers, with the fit peak at 9250:

```ts
/**
 * A WORKED EXAMPLE with invented numbers, drawn so the shape of a converged sweep is legible on a
 * page a reader may reach before ever playing. Nothing here is measured, and every surface that
 * renders it labels it as an illustration (see `buildFigure` in case-study.ts). Four mark-sets
 * scattered across the sweep, a concave fit peaked near 9250 counts per 360, and four per-facet
 * peaks that sit near one another without fully agreeing, which is the ordinary case.
 */
export function demoConvergence(): PlotInput {
  const bounds: [Counts360, Counts360] = [counts360(4700), counts360(19000)];
  const peak = 9250;
  const at = (v: number) => -Math.pow(Math.log(v) - Math.log(peak), 2);
  const insts: InstrumentId[] = ['track', 'flick', 'calibrate', 'strike'];
  const xs = [5700, 7250, 9250, 11700, 14800];
  const jitter: Record<InstrumentId, number> = { track: 0.04, flick: -0.05, calibrate: 0.02, strike: -0.03 };
  const marks = insts.flatMap((instrument) =>
    xs.map((v) => ({ counts: counts360(v), instrument, score: at(v) + jitter[instrument] })),
  );
  const curve = [5000, 6300, 7900, 9250, 10800, 13200, 17300].map((v) => ({ x: Math.log(v), mean: at(v) }));
  const facetPeaks = [
    { instrument: 'track' as InstrumentId, peakCounts: counts360(8900), spreadLn: 0.07, laneConditioned: false },
    { instrument: 'flick' as InstrumentId, peakCounts: counts360(9600), spreadLn: 0.08, laneConditioned: false },
    { instrument: 'calibrate' as InstrumentId, peakCounts: counts360(9250), spreadLn: 0.06, laneConditioned: false },
    { instrument: 'strike' as InstrumentId, peakCounts: counts360(10450), spreadLn: 0.11, laneConditioned: true },
  ];
  return {
    bounds, marks, curve,
    ci90: [counts360(8630), counts360(9800)],
    peak: counts360(9250),
    facetPeaks,
    size: { width: 640, height: 280 },
  };
}
```

In `src/ui/case-study/case-study.ts`:

14. `buildGateFigure`. Replace the line
    `'The sweep says your mouse speeds up the faster you move, which makes one true turn distance impossible to pin down.',` with
    `'The check says your mouse speeds up the faster you move, which makes one true turn distance impossible to pin down.',`

15. `buildResultCardFigure`. Replace the `specimenCard({ ... })` argument (phase 1a's step 12
    left it at `'9,150'`, `'90% ci 8,650 to 9,800 counts per 360'` and `'8,850'` / `'9,575'` /
    `'9,200'` / `'10,400'`; those strings move with the fixture this task owns) with:

```ts
    art: specimenCard({
      counts: '9,260',
      ci: '90% ci 8,630 to 9,800 counts per 360',
      facets: [
        { instrument: 'track', label: 'track', value: '8,900' },
        { instrument: 'flick', label: 'flick', value: '9,600' },
        { instrument: 'calibrate', label: 'calibrate', value: '9,250' },
        { instrument: 'strike', label: 'strike', value: '10,450' },
      ],
      note: 'The four views broadly agree; a few more trials would tighten this band.',
    }),
```

    (9,260 is the old 29.4 cm headline at 800 DPI, rounded to the nearest ten and sitting inside
    the quoted ci, matching the demo fixture's scale. The facet values are the demo fixture's own
    peaks, comma-grouped exactly as `fmtCounts` would print them.)

In `src/ui/case-study/chrome.ts`:

16. Nothing to edit. Phase 1a's task 4 step 12 already made line 146 read
    `tag.textContent = 'your counts per 360';`. Verify it reads that way and leave the file
    alone; a grep for `'your cm/360'` here should find nothing.

In `tests/ui/case-study/chrome.test.ts`:

17. Replace `const el = monoLabel(['ii', 'the instruments', 'cm/360']);` (line 7 at HEAD) with
    `const el = monoLabel(['ii', 'the instruments', 'counts per 360']);` and, if the test asserts
    the rendered text of that third segment, update the expected string to match.

- [ ] **Step 4: Run the canon test and the existing case-study tests**

Run: `npx vitest run tests/ui/case-study/`
Expected: PASS (the new canon.test.ts's 4 tests, plus the existing case-study, chrome, content,
reveal and wiring suites; content.test.ts is value-agnostic about the demo fixture and stays
green)

- [ ] **Step 5: Full suite and the type gate**

Run: `npm test`
Expected: PASS, zero failures
Run: `npm run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/ui/case-study/content.ts src/ui/case-study/case-study.ts tests/ui/case-study/chrome.test.ts tests/ui/case-study/canon.test.ts
git commit -m "feat(case-study): the page tells the counts story, and the canon test covers it" -m "The rename swept the identifiers but not the narrative: the case study still opened on cm/360 as the true unit, walked the reader through a card sweep that no longer exists, and would have shipped centimetre-shaped demo values relabelled as counts. The copy now tells the blind-turn story, the worked example lives on a counts scale end to end, and the canon sweep extends past the result screen to the one other page that speaks to the player at length."
```

## Hand-offs to other phases

**H1, to phase 1a (`src/types.ts` + `src/optimizer/result.ts`, inside its task 4).** Delete
`Result.perGameSens` outright (keeping it would reintroduce the implicit k = 1; tier two now
lives on `Prescription` behind the k gate) and add to the `Result` interface:

```ts
  /** The payoff tiers (tier one's ratio + interval when an anchor was measurable, tier two's
   *  k-gated table, tier three's counts), built by buildPrescription and attached by buildResult.
   *  Absent when nothing was earned or the vertex clamped: the screen then leads with the located
   *  counts and says why the factor is withheld. Never padded, never recomputed at render time. */
  prescription?: Prescription;
```

with `import type { Prescription } from './optimizer/result';` alongside the existing GpParams
import. Because that import must resolve in task 4's own commit and this part's task 9 runs
later, task 4 must ALSO add the `Prescription` interface export to `src/optimizer/result.ts` in
the same commit: declare the seven-member cut its own step 6 shows (ratio and ratioCi90 optional
per A5, kLogSd per A5, no `hardwareCounts`), which is enough for
`Result.prescription?: Prescription` to resolve. Task 9's full-file replacement then swaps in the
eight-member shape with `hardwareCounts?: Counts360` (A6), and integration task 39 adds
`k?: number` and states why. This document's task 9 step 3 is the single source of truth for the
shape between those two points.

**H2, to phase 1a, the renames this part's code is written against (verification list, all landed
before task 9).** `Report.optimalCounts`, `Report.ci90: [Counts360, Counts360]`,
`Result.optimalCounts`, `Result.ci90`, `Result.bounds?: [Counts360, Counts360]`,
`Result.breakdown.biasZeroCounts`, `TrialResult.counts`, `FacetPeak.peakCounts`. If 1a chose
different field names, say so before task 9 executes; every fixture here follows these spellings.

**H3, to phase 1a's task 4 step 9 (`src/ui/range-adopt.ts`), which AUTHORS this edit (F24); it is
reproduced here only because F36 corrected it after the partition was drawn.** `adoptResult` must
destructure out every measured claim, now INCLUDING `ci90`: the screen already hides the interval
for a tuned value, but the exported JSON and localStorage carried it, and "a tuned value carries
no measured interval" must hold in the artifact a player exports, not just on screen:

```ts
export function adoptResult(measured: Result, adoptedCounts: Counts360): Result {
  // prescription and ci90 leave with the other measured claims: a hand-picked value has no
  // measured ratio and no measured interval, and the exported JSON must not carry either
  // (honesty invariant; ci90 added per F36).
  const { curve: _curve, bounds: _bounds, driftZ: _driftZ, facetConcordance: _facet, prescription: _p, ci90: _ci90, ...rest } = measured;
  return { ...rest, optimalCounts: adoptedCounts, tuned: true };
}
```

`Result.ci90` is optional as of that same task-4 commit: the contract's Round 3 decision D1
settles it (`ci90?: [Counts360, Counts360]`, absent means tuned by feel, decided rather than
deferred again), so the destructure above type-checks as written and phase 1a adds the test
asserting `'ci90' in adoptResult(measured, adopted)` is false. This part's screen already guards
every `r.ci90` read (task 11, the D1 comments). There is no `perGameSens` recompute and no dpi
parameter in this function under any circumstances (F5).

**H4, to phases 2, 3 and 4: extend the canon sweep to your screens.** Task 13's
`tests/ui/case-study/canon.test.ts` and task 12's `tests/ui/result-canon.test.ts` cover the two
screens this phase owns. The spec's canon test is repo-wide ("no cm/360 string in user-facing
copy outside the conditional conversion line"), so each of you adds the same three assertions (no
`cm/360`, no `cm per 360`, no card-sweep narrative) to the mount test of every screen you create
or rewrite: setup, the turn view and calibrate-flow (phase 2), and any surface phases 3 and 4
touch. This part cannot mount screens that do not exist yet, which is the only reason the sweep
is split.

**H5, to the integration part, the wiring this screen waits for (integration tasks 38 and 40, per
A3/F11; the integration part takes `src/optimizer/session-controller.ts` for task 38 and the
`finalize` block of `src/ui/session-view.ts` for task 40; task 36 is the
`ArenaScene.activeTarget()` getter, a different task, and calling it "the wiring" was this
hand-off's earlier error, corrected per D2).** After task 9 the finalize call reads:

```ts
const result = buildResult(report, allTrials, { bounds: ctx.draft.bounds, profile: ctx.draft.profile });
```

Integration task 40 AUTHORS the final form of that statement, and nothing here is applied on top
of it: it reconciles `ctx.draft.turn` with the anchor built from the reaches accumulated across
every segment (`allReaches`), then passes `anchor` and `ctx.draft.kPin` into `buildResult` as the
`anchor` and `k` options, each spread in conditionally so an absent one is absent rather than
undefined. Verify against task 40's authored code only that: `reconcile()`'s `Anchor` reaches
`buildResult` as a VARIABLE, which is structurally assignable to `AnchorReading` (a fresh object
literal would be excess-property-checked and `sources` would be TS2353); and that `ctx.draft.kPin`
is the `KPin` phase 2's `commitManual`/`commitGuided` store via phase 3's `pinConvention` (phase 2
task 18 authors that seam), so no `{ value, source }` shape exists anywhere - the earlier version
of this hand-off that named one was wrong (F9). Until tasks 38 and 40 land, the live screen shows
the tier-one fallback sentence ("I report the location and leave the factor blank"), which is the
honest description of a build without the anchor wired. Nothing in this plan is done until
integration task 41 renders tier one from a simulated end-to-end session.

**H6, contract flags (not edits).** (1) `Prescription.hardwareCounts?: Counts360` goes one field
beyond the contract's amended Decision 1: A6 requires tier three to render `optimalCounts / k`
when k is pinned, and the screen has no honest access to k otherwise (the pin lives on the draft,
which does not survive a reload with the persisted Result). The contract should add the field; if
it instead chooses to persist the pin, say so before task 9 executes. (2) A tuned result renders
no tier two at all, because `adoptResult` drops the prescription and the k evidence with it;
carrying `kSource` through adoption would restore it and is a deliberate non-goal here. (3)
Tier two's per-row 90% band is derived at render time (task 11) as the quadrature of the search's
own interval (`countsCi90`) and the pin's spread (`kLogSd`), per D3, and it renders whenever
`countsCi90` is usable, kLogSd of 0 included. Nothing stores a `perGameCi90` on the
`Prescription` (F40's alternative), so there is no second stored interval to drift.


### Task 15: the reference turn estimator

**Files:**
- Create: `src/anchor/reference-turn.ts`
- Test: `tests/anchor/reference-turn.test.ts`

Assumes phase 1a has FULLY landed: `Counts360` and `counts360` exist in `src/types.ts`, and `Cm360`,
`Dpi`, `Session.dpi` and `SessionDraft.dpi` are gone. Reuses `mean` and `sampleStd` from
`src/scoring/stats.ts` (read them: `mean(xs)` is the arithmetic mean, `sampleStd(xs)` is the N minus 1
sample sd, 0 for one or fewer elements).

The estimator's weight is ONE-SIDED (amendment A6): the self-measured log sd may be pulled UP toward
the prior, never down. Phase 4's reconcile builds the turn-alone `ci90` straight from this number, so
shrinking a wide spread here is interval-narrowing, which the canon forbids outright.

- [ ] **Step 1: Write the failing test**

Create `tests/anchor/reference-turn.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { turnFromPasses, TURN_PRIOR_LOG_SD, TURN_AGREE_SPREAD_PCT } from '../../src/anchor/reference-turn';

describe('turnFromPasses: refusals', () => {
  it('returns null under three passes, never a number', () => {
    expect(turnFromPasses([])).toBeNull();
    expect(turnFromPasses([8000])).toBeNull();
    expect(turnFromPasses([8000, 8100])).toBeNull();
  });

  it('returns null on any non-finite or non-positive pass instead of filtering it out', () => {
    // Filtering would fabricate agreement out of a broken recording; the estimator refuses instead.
    expect(turnFromPasses([8000, 0, 8100])).toBeNull();
    expect(turnFromPasses([8000, -50, 8100])).toBeNull();
    expect(turnFromPasses([8000, Number.NaN, 8100])).toBeNull();
    expect(turnFromPasses([8000, Number.POSITIVE_INFINITY, 8100])).toBeNull();
  });
});

describe('turnFromPasses: the estimate', () => {
  it('identical passes: exact counts, zero spread, agreed, and the weight lifted to half the prior', () => {
    const est = turnFromPasses([8000, 8000, 8000])!;
    expect(est).not.toBeNull();
    expect(est.counts).toBeCloseTo(8000, 6);
    expect(est.spreadPct).toBeCloseTo(0, 9);
    // Zero self-measured sd still lands at half the prior: the shrinkage is one-sided, so a lucky
    // triple is pulled UP toward the prior rather than earning a zero-width weight.
    expect(est.logSd).toBeCloseTo(TURN_PRIOR_LOG_SD / 2, 12);
    expect(est.agreed).toBe(true);
    expect(est.passes).toBe(3);
  });

  it('combines in log space: the counts are the geometric mean, not the arithmetic one', () => {
    // Reproduction error is multiplicative and the optimizer searches ln space, so an arithmetic
    // mean here (9333) would bias the seed high on every asymmetric triple.
    const est = turnFromPasses([4000, 8000, 16000])!;
    expect(est.counts).toBeCloseTo(8000, 6);
  });

  it('pulls an over-confident spread up toward the prior, halfway', () => {
    // Log sd exactly 0.1 by construction, below the 0.15 prior: three samples make a terrible
    // variance estimate, so an implausibly tight trio is regularized up to (0.1 + prior) / 2.
    const passes = [9, 9.1, 9.2].map((l) => Math.exp(l));
    expect(turnFromPasses(passes)!.logSd).toBeCloseTo((0.1 + TURN_PRIOR_LOG_SD) / 2, 9);
  });

  it('never narrows a spread wider than the prior: the measured sd stands', () => {
    // Log sd exactly 0.3 by construction. Two-sided shrinkage would report (0.3 + 0.15) / 2 =
    // 0.225, a spread 25 percent tighter than measured. reconcile builds the turn-alone ci90
    // straight from this number, so narrowing here IS interval-narrowing, and the canon says
    // intervals widen, never narrow. Do not "restore the symmetric average" for elegance.
    const passes = [9, 9.3, 9.6].map((l) => Math.exp(l));
    const est = turnFromPasses(passes)!;
    expect(est.logSd).toBeCloseTo(0.3, 9);
    expect(est.logSd).toBeGreaterThan((0.3 + TURN_PRIOR_LOG_SD) / 2); // the two-sided value is the defect
  });

  it('flags disagreement beyond the threshold but still reports the spread honestly', () => {
    const est = turnFromPasses([8000, 8000, 10000])!;
    expect(est.agreed).toBe(false);
    expect(est.spreadPct).toBeGreaterThan(TURN_AGREE_SPREAD_PCT);
    // No outlier drop at exactly three: the outlier and the spread are indistinguishable, and two
    // sloppy passes voting out the honest one would manufacture agreement.
    expect(est.passes).toBe(3);
  });
});

describe('turnFromPasses: the fourth pass', () => {
  it('a fourth pass isolates the odd one out, and passes says the estimate rests on three', () => {
    const est = turnFromPasses([8000, 8000, 10000, 8100])!;
    expect(est.agreed).toBe(true);
    expect(est.passes).toBe(3);
    const expected = Math.exp((Math.log(8000) + Math.log(8000) + Math.log(8100)) / 3);
    expect(est.counts).toBeCloseTo(expected, 6);
  });

  it('a fourth pass that cannot isolate one outlier keeps all passes and stays disagreed', () => {
    // Two passes sit beyond the reject distance from the median, so dropping them would leave
    // fewer than three survivors: the drop is skipped, the spread stands, and the view blocks
    // rather than averages.
    const est = turnFromPasses([8000, 9500, 11000, 6500])!;
    expect(est.agreed).toBe(false);
    expect(est.passes).toBe(4);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/anchor/reference-turn.test.ts`
Expected: FAIL, `tests/anchor/reference-turn.test.ts (0 test)`, with
`Error: Failed to load url ../../src/anchor/reference-turn (resolved id: ../../src/anchor/reference-turn) in /<repo>/tests/anchor/reference-turn.test.ts. Does the file exist?`
and the summary line `Test Files  1 failed (1)`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/anchor/reference-turn.ts`:

```ts
// The blind reference turn: three reproductions of a full 360 by feel, combined into one counts
// estimate that carries its own weight. Pure - the view (src/ui/calibrate/turn-view.ts) feeds it
// pass magnitudes and renders its verdicts. Replaces the spin's single tap-when-green pass, which
// computed its dial from a fixed provisional turn distance (30 cm at 800 DPI, 9450 counts) and so
// measured its own constant.
import { counts360, type Counts360 } from '../types';
import { mean, sampleStd } from '../scoring/stats';

export interface TurnEstimate {
  /** Counts per full 360: the geometric mean of the kept passes. Geometric because reproduction
   *  error is multiplicative (a sloppy pass overshoots by a factor, not by a fixed count) and the
   *  optimizer searches ln space, so this is the mean in the space the estimate is used in. */
  counts: Counts360;
  /** Relative spread of the kept passes, (max - min) / mean, as a percentage. A CONSISTENCY
   *  indicator, never a CI, and the spec requires it shown to the player: the view renders it in
   *  the fourth-pass offer, the setup screen renders it on agreement and on the spread block. */
  spreadPct: number;
  /** The weight this estimate carries into phase 4's reconciliation, AND the number the turn-alone
   *  ci90 is built from there, which is why the regularization below is one-sided. An implausibly
   *  tight trio is pulled up toward TURN_PRIOR_LOG_SD (three samples make a terrible variance
   *  estimate; simulation showed the shrunk self-measured weight matches oracle weighting to
   *  within a tenth of a percent, spec 2026-07-25, "what the simulations established"). A trio
   *  wider than the prior keeps its measured sd untouched: intervals widen, never narrow. */
  logSd: number;
  /** True when the kept passes landed within TURN_AGREE_SPREAD_PCT of each other. False is not a
   *  failure: the view offers a fourth pass, and only a still-disagreeing fourth blocks. */
  agreed: boolean;
  /** How many passes the estimate actually rests on, after any outlier drop, so a downstream
   *  reader never mistakes a rescued 3-of-4 for a clean 3-of-3. */
  passes: number;
}

/** Prior log-space sd of a blind full-turn reproduction. Anchors the one-sided shrinkage below;
 *  simulation put honest reproduction spreads at roughly 5 to 15 percent, and exp(0.15) - 1 is
 *  16 percent, just above the top of that band. */
export const TURN_PRIOR_LOG_SD = 0.15;

const MIN_PASSES = 3;

/** Kept passes agree when their relative spread is at or below this. A chosen operating point, not
 *  a measured bound: tighter routes honest sessions to the fourth pass routinely, looser averages
 *  passes the player visibly fumbled. 15 keeps the fourth pass for genuine disagreement. */
export const TURN_AGREE_SPREAD_PCT = 15;

/** A pass is an outlier when its log distance from the median pass exceeds this (a 15 percent
 *  factor). Applied only from the fourth pass on: with exactly three, the outlier and the spread
 *  are indistinguishable (pinned by "flags disagreement beyond the threshold" in
 *  tests/anchor/reference-turn.test.ts), so three disagreeing passes earn an offer, not a rescue. */
const REJECT_LOG = Math.log(1.15);

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Combine blind full-turn passes into one estimate, or refuse.
 * - Under three passes: null. Two passes cannot even hint at their own spread.
 * - Any non-finite or non-positive pass: null, never filtered. A zero-count pass is a recording
 *   fault, and silently dropping it would fabricate agreement out of a broken series.
 * - From four passes on, a single pass far from the median log is dropped (the fourth pass exists
 *   to expose exactly that pass), but never below three survivors.
 */
export function turnFromPasses(passCounts: readonly number[]): TurnEstimate | null {
  if (passCounts.length < MIN_PASSES) return null;
  for (const c of passCounts) if (!Number.isFinite(c) || c <= 0) return null;

  const logs = passCounts.map((c) => Math.log(c));
  let kept = logs;
  if (logs.length > MIN_PASSES) {
    const med = median(logs);
    const survivors = logs.filter((l) => Math.abs(l - med) <= REJECT_LOG);
    if (survivors.length >= MIN_PASSES) kept = survivors;
  }

  const counts = counts360(Math.exp(mean(kept)));
  const linear = kept.map((l) => Math.exp(l));
  const spreadPct = ((Math.max(...linear) - Math.min(...linear)) / mean(linear)) * 100;
  // One-sided shrinkage toward the prior. An implausibly TIGHT trio is pulled up to
  // (sd + prior) / 2, because three samples make a terrible variance estimate and simulation
  // matched oracle weighting there. A trio WIDER than the prior keeps its measured sd: phase 4's
  // reconcile builds the turn-alone ci90 straight from this number, so the two-sided average
  // would report a genuine 0.30 as 0.225, an interval 25 percent tighter than measured (pinned by
  // 'never narrows a spread wider than the prior'). The canon permits widening only.
  const sd = sampleStd(kept);
  const logSd = Math.max(sd, (sd + TURN_PRIOR_LOG_SD) / 2);
  return { counts, spreadPct, logSd, agreed: spreadPct <= TURN_AGREE_SPREAD_PCT, passes: kept.length };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/anchor/reference-turn.test.ts`
Expected: PASS, `Tests  9 passed (9)`

- [ ] **Step 5: Commit**

```bash
git add src/anchor/reference-turn.ts tests/anchor/reference-turn.test.ts
git commit -m "feat(anchor): the blind turn estimates its own weight, floored one-sided at the prior" -m "Three reproductions cannot honestly estimate their own variance alone, so a tight trio's log sd is pulled up halfway toward TURN_PRIOR_LOG_SD; a trio wider than the prior keeps its measured sd untouched, because reconcile builds the turn-alone ci90 from this number and intervals widen, never narrow."
```

### Task 16: the turn pass machine, pure

**Files:**
- Create: `src/ui/calibrate/turn-view.ts` (the pure machine half; the DOM shell lands in task 17)
- Test: `tests/ui/turn-view.test.ts`

The machine holds the whole interaction contract: three blind passes, a fourth-pass offer on
disagreement, and the acceleration pass only on browsers without raw pointer input. Keeping it
pure and exported mirrors the `calibrateReducer` pattern, so jsdom can drive every path without a
pointer lock. This task needs only phase 1a; the lattice import arrives with the shell in task 17.

- [ ] **Step 1: Write the failing test**

Create `tests/ui/turn-view.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  initialTurnMachine, turnTap, turnDirection,
  MIN_PASS_COUNTS, NATURAL_PASSES, type TurnMachine,
} from '../../src/ui/calibrate/turn-view';

/** One entry per completed pass: the first tap arms recording, the second finishes it at `c`. */
function runPasses(m: TurnMachine, passCounts: number[], mode: 'raw' | 'os-adjusted'): TurnMachine {
  let s = m;
  for (const c of passCounts) {
    s = turnTap(s, 0, mode); // arm: counts are ignored on a non-recording tap
    s = turnTap(s, c, mode); // finish
  }
  return s;
}

describe('turn machine: the pass loop', () => {
  it('starts idle with no passes and no verdict', () => {
    expect(initialTurnMachine()).toEqual({ phase: 'idle', passes: [], estimate: null, blockReason: null });
  });

  it('alternates direction right-left-right-left, so asymmetry cancels instead of averaging in', () => {
    expect([0, 1, 2, 3].map(turnDirection)).toEqual(['right', 'left', 'right', 'left']);
  });

  it('an arming tap starts recording and commits nothing, whatever counts ride along', () => {
    const s = turnTap(initialTurnMachine(), 999999, 'raw');
    expect(s.phase).toBe('recording');
    expect(s.passes).toEqual([]);
  });

  it('a finishing tap below the floor is an accidental click: ignored, the pass stays live', () => {
    const recording = turnTap(initialTurnMachine(), 0, 'raw');
    const after = turnTap(recording, MIN_PASS_COUNTS - 1, 'raw');
    expect(after).toBe(recording); // identity, so the shell can detect the refusal and explain it
  });
});

describe('turn machine: verdicts', () => {
  it('three agreeing passes on raw input complete without a fast pass', () => {
    // Raw pointer input bypasses OS acceleration at the source; demanding a probe pass anyway
    // would be theater.
    const s = runPasses(initialTurnMachine(), [8000, 8100, 8050], 'raw');
    expect(s.phase).toBe('done');
    expect(s.estimate!.agreed).toBe(true);
    expect(s.estimate!.passes).toBe(NATURAL_PASSES);
    const geo = Math.exp((Math.log(8000) + Math.log(8100) + Math.log(8050)) / 3);
    expect(s.estimate!.counts).toBeCloseTo(geo, 6);
  });

  it('three agreeing passes on os-adjusted input demand the deliberately fast pass', () => {
    const s = runPasses(initialTurnMachine(), [8000, 8100, 8050], 'os-adjusted');
    expect(s.phase).toBe('fast-idle');
  });

  it('an honest fast pass completes; the estimate stays the natural passes own, untouched', () => {
    let s = runPasses(initialTurnMachine(), [8000, 8100, 8050], 'os-adjusted');
    const before = s.estimate!.counts;
    s = turnTap(s, 0, 'os-adjusted');       // arm the fast pass
    s = turnTap(s, 8020, 'os-adjusted');    // same full turn, just faster: totals match
    expect(s.phase).toBe('done');
    expect(s.estimate!.counts).toBe(before); // the probe verifies, it never shades the number
  });

  it('an accelerated fast pass blocks rather than shading the number', () => {
    let s = runPasses(initialTurnMachine(), [8000, 8100, 8050], 'os-adjusted');
    s = turnTap(s, 0, 'os-adjusted');
    s = turnTap(s, 12000, 'os-adjusted'); // ~1.5x the slow total: OS accel inflated the fast turn
    expect(s.phase).toBe('blocked');
    expect(s.blockReason).toBe('accel');
  });

  it('three disagreeing passes offer a fourth rather than failing or averaging', () => {
    const s = runPasses(initialTurnMachine(), [8000, 8000, 10000], 'raw');
    expect(s.phase).toBe('fourth-offer');
    expect(s.estimate!.agreed).toBe(false);
  });

  it('the fourth pass isolates the odd one out and completes', () => {
    let s = runPasses(initialTurnMachine(), [8000, 8000, 10000], 'raw');
    s = turnTap(s, 0, 'raw');    // accept the offer
    s = turnTap(s, 8050, 'raw'); // the fourth agrees with the first two
    expect(s.phase).toBe('done');
    expect(s.estimate!.passes).toBe(3); // turnFromPasses dropped the outlier
  });

  it('a fourth pass that still cannot settle blocks with the spread reason', () => {
    let s = runPasses(initialTurnMachine(), [8000, 9500, 11000], 'raw');
    expect(s.phase).toBe('fourth-offer');
    s = turnTap(s, 0, 'raw');
    s = turnTap(s, 6500, 'raw');
    expect(s.phase).toBe('blocked');
    expect(s.blockReason).toBe('spread');
  });

  it('done and blocked absorb further taps: nothing after the verdict moves the number', () => {
    const done = runPasses(initialTurnMachine(), [8000, 8100, 8050], 'raw');
    expect(turnTap(done, 5000, 'raw')).toBe(done);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/ui/turn-view.test.ts`
Expected: FAIL, `tests/ui/turn-view.test.ts (0 test)`, with
`Error: Failed to load url ../../src/ui/calibrate/turn-view (resolved id: ../../src/ui/calibrate/turn-view) in /<repo>/tests/ui/turn-view.test.ts. Does the file exist?`
and the summary line `Test Files  1 failed (1)`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/ui/calibrate/turn-view.ts`:

```ts
// The blind reference turn: three reproductions of a full 360 by feel, right then left then
// right. Deliberately shows NO dial, NO degree readout and NO arc that completes. The spin this
// replaces computed its dial from a fixed provisional turn distance (30 cm at 800 DPI, 9450
// counts), filled, turned green and invited the finishing click at exactly the counts matching
// that constant, whoever the player was, with overshoot hidden by Math.min(360, deg) - the
// instrument measured its own constant. The machine below cannot: no state in it knows a target
// count. What the screen may show is which pass is up and that recording is live; the copy says
// why it refuses to show more. Nothing moves, so there is no reduced-motion variant to plumb.
import { turnFromPasses, type TurnEstimate } from '../../anchor/reference-turn';
import { accelVerdict } from '../../input/accel-check';
import type { PointerLockMode } from '../../types';

/** Why the turn refused: 'accel' = the fast pass accumulated materially more than the slow ones;
 *  'spread' = four passes never settled close enough to honestly average. */
export type TurnBlockReason = 'accel' | 'spread';

export type TurnPhase =
  | 'idle' | 'recording' | 'fourth-offer' | 'fast-idle' | 'fast-recording' | 'done' | 'blocked';

export interface TurnMachine {
  phase: TurnPhase;
  /** Committed pass magnitudes (path-length counts). The live pass accumulates outside and only
   *  lands here on its finishing tap. */
  passes: readonly number[];
  estimate: TurnEstimate | null;
  blockReason: TurnBlockReason | null;
}

export const NATURAL_PASSES = 3;

/** Floor below which a finishing tap is an accidental click, not a turn. Far under any real 360
 *  (sens 20 at the CS2 yaw is still ~820 counts), so unlike the spin's MIN_DONE_DEG it cannot
 *  steer where a genuine pass ends - it can only reject a double-click. */
export const MIN_PASS_COUNTS = 200;

export function initialTurnMachine(): TurnMachine {
  return { phase: 'idle', passes: [], estimate: null, blockReason: null };
}

/** Pass direction, alternating right-left-right-left. Alternation cancels directional asymmetry
 *  (pad friction, wrist range) out of the estimate instead of averaging it in. */
export function turnDirection(passIdx: number): 'right' | 'left' {
  return passIdx % 2 === 0 ? 'right' : 'left';
}

/**
 * Advance on a classified tap. `pathCounts` is the |dx| path length accumulated since the current
 * pass started; it is read only on a finishing tap. Ignored taps return the SAME object so the
 * shell can detect the refusal by identity and explain the no-op instead of staying silent.
 */
export function turnTap(m: TurnMachine, pathCounts: number, mode: PointerLockMode): TurnMachine {
  switch (m.phase) {
    case 'idle':
    case 'fourth-offer':
      return { ...m, phase: 'recording' };
    case 'fast-idle':
      return { ...m, phase: 'fast-recording' };
    case 'recording': {
      if (pathCounts < MIN_PASS_COUNTS) return m;
      const passes = [...m.passes, pathCounts];
      if (passes.length < NATURAL_PASSES) return { ...m, passes, phase: 'idle' };
      const estimate = turnFromPasses(passes);
      // turnFromPasses refuses on a corrupt series. The floor above bars that path here, but a
      // refusal still maps to a refusal, never to proceeding on a series the estimator rejected.
      if (estimate === null) return { ...m, passes, phase: 'blocked', blockReason: 'spread' };
      if (!estimate.agreed) {
        // Three disagreeing passes earn a fourth; a fourth that still disagrees blocks. Spec error
        // path: "turn passes disagreeing offers a fourth pass before blocking".
        return passes.length === NATURAL_PASSES
          ? { ...m, passes, estimate, phase: 'fourth-offer' }
          : { ...m, passes, estimate, phase: 'blocked', blockReason: 'spread' };
      }
      // Raw pointer input bypasses OS acceleration at the source, so a fast pass would have
      // nothing to detect. Everywhere else the deliberately fast turn IS the accel probe: the
      // lattice cannot substitute, because an accelerated delta is still an integer after
      // rounding (spec, "acceleration").
      return mode === 'raw'
        ? { ...m, passes, estimate, phase: 'done' }
        : { ...m, passes, estimate, phase: 'fast-idle' };
    }
    case 'fast-recording': {
      if (pathCounts < MIN_PASS_COUNTS) return m;
      if (m.estimate === null) return { ...m, phase: 'blocked', blockReason: 'spread' }; // unreachable: fast phases exist only past an agreed estimate
      // accelVerdict's default 10 percent tolerance, tight rather than apologetic: a full turn is
      // 3 to 6 times the 8.56 cm card that forced accelTolForWidth to widen, so edge slop is a
      // proportionally small fraction of the pass (the widener is deleted in this change).
      return accelVerdict(m.estimate.counts, pathCounts).accelerated
        ? { ...m, phase: 'blocked', blockReason: 'accel' }
        : { ...m, phase: 'done' };
    }
    case 'done':
    case 'blocked':
      return m; // terminal states absorb input: nothing after the verdict may move the number
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/ui/turn-view.test.ts`
Expected: PASS, `Tests  12 passed (12)`

- [ ] **Step 5: Commit**

```bash
git add src/ui/calibrate/turn-view.ts tests/ui/turn-view.test.ts
git commit -m "feat(calibrate): the turn pass machine, blind by construction" -m "No state in the machine knows a target count, so it cannot invite a finishing click at its own constant, which is the spin defect this replaces."
```

### Task 17: the turn view shell

**Files:**
- Modify: `src/ui/calibrate/turn-view.ts` (append the DOM shell below the machine)
- Test: `tests/ui/turn-view.test.ts` (append the DOM describes)

The shell is DOM only: no canvas, no rAF loop, no palette import. It reuses only existing CSS
classes (`src/styles/*.css` is phase 1b's file and is not touched). The hold-to-reposition
affordance is carried over from the spin verbatim, because running out of mousepad is real.

Two sequencing prerequisites beyond task 16:
1. **Phase 3 tasks 23 to 25 must have landed.** The shell imports `conventionFromGated` from
   `src/input/lattice.ts`: the turn is the only place in the app with a long raw delta stream, so
   the lattice tap is authored here, by this task, because phase 2 owns the file. Phase 3's H1 is a
   verification note against what this task writes and carries no edits to apply.
2. **Phase 1a must have removed `normalizeByDpr` from `flattenCoalesced`** (its rename work in
   `src/input/pointer-lock.ts`). The lattice must see the browser's raw `movementX`/`movementY`;
   a stream already divided by DPR would report the DPR itself as k, a finding about a bug rather
   than about the mouse.

- [ ] **Step 1: Write the failing test**

In `tests/ui/turn-view.test.ts`, replace the import block at the top of the file:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  initialTurnMachine, turnTap, turnDirection,
  MIN_PASS_COUNTS, NATURAL_PASSES, type TurnMachine,
} from '../../src/ui/calibrate/turn-view';
```

with:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
  createTurnView, fourthOfferLead, initialTurnMachine, turnTap, turnDirection,
  MIN_PASS_COUNTS, NATURAL_PASSES, type TurnMachine,
} from '../../src/ui/calibrate/turn-view';

type TurnOpts = Parameters<typeof createTurnView>[1];

function mountTurn(over: Partial<TurnOpts> = {}): { host: HTMLElement; view: { dispose(): void } } {
  const host = document.createElement('div');
  const view = createTurnView(host, {
    onTurn: () => {}, onBlocked: () => {}, onManual: () => {}, onBack: () => {}, ...over,
  });
  return { host, view };
}
```

and append to the end of the file:

```ts
describe('turn view: blind means blind', () => {
  it('renders no canvas, no dial and no degree readout', () => {
    const { host, view } = mountTurn();
    expect(host.querySelector('canvas')).toBeNull(); // the spin's dial was a canvas; its absence is the point
    expect(host.textContent).not.toContain('°');
    view.dispose();
  });

  it('shows which pass is up and a recording mark, and nothing that encodes progress', () => {
    const { host, view } = mountTurn();
    expect(host.querySelector('[data-turn="pass"]')!.textContent).toContain('Pass 1 of 3');
    expect(host.querySelector('[data-turn="rec"]')).toBeTruthy();
    view.dispose();
  });

  it('says why it refuses to show progress: the blindness is the trust signal', () => {
    const { host, view } = mountTurn();
    const why = host.querySelector('[data-turn="why"]')!.textContent!;
    expect(why).toContain('on purpose');
    expect(why.toLowerCase()).toContain('not of your turn');
    view.dispose();
  });

  it('preserves the hold-to-reposition helper from the spin verbatim', () => {
    const { host, view } = mountTurn();
    expect(host.querySelector('.cal-helper')!.textContent)
      .toBe('Out of room? Hold the button, slide your mouse back, then let go.');
    view.dispose();
  });
});

describe('turn view: the fourth-pass offer names the measured spread', () => {
  it('renders the spread to one decimal, in tabular figures', () => {
    // Spec: "Afterwards it reports the spread honestly." The number is the honest part of the
    // sentence, so it is pinned here, mono per canon (every measured number gets tabular figures).
    const lead = fourthOfferLead(22.37, 'left');
    expect(lead).toContain('<span class="mono">22.4</span> percent apart');
    expect(lead).toContain('to the left');
  });
});

describe('turn view: a way out and a spoken instruction', () => {
  it('renders real focusable buttons for back and the typed fallback, and they are wired', () => {
    const onBack = vi.fn(); const onManual = vi.fn();
    const { host, view } = mountTurn({ onBack, onManual });
    for (const control of ['back', 'manual']) {
      const el = host.querySelector(`[data-turn="${control}"]`) as HTMLButtonElement | null;
      expect(el, `${control} control`).toBeTruthy();
      expect(el!.tagName).toBe('BUTTON');
      expect(el!.hasAttribute('disabled')).toBe(false);
      expect(el!.textContent!.trim().length).toBeGreaterThan(0); // a real accessible name
    }
    (host.querySelector('[data-turn="back"]') as HTMLButtonElement).click();
    (host.querySelector('[data-turn="manual"]') as HTMLButtonElement).click();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onManual).toHaveBeenCalledTimes(1);
    view.dispose();
  });

  it('marks the instruction line as a polite live region', () => {
    const { host, view } = mountTurn();
    const lead = host.querySelector('[data-turn="lead"]')!;
    expect(lead.getAttribute('aria-live')).toBe('polite');
    expect(lead.getAttribute('aria-atomic')).toBe('true');
    view.dispose();
  });

  it('renders exactly one h1 naming the step, sentence case, no revived "+" prefix', () => {
    const { host, view } = mountTurn();
    const h1s = host.querySelectorAll('h1');
    expect(h1s.length).toBe(1);
    expect(host.querySelector('h2')).toBeNull();
    const title = h1s[0]!.textContent!;
    expect(title.startsWith('+')).toBe(false);
    expect(title).toMatch(/^[A-Z]/);
    view.dispose();
  });
});

describe('turn view: voice', () => {
  it('first person singular: no institutional we, no lowercase standalone i', () => {
    const { host, view } = mountTurn();
    expect(host.textContent!).not.toMatch(/\bwe\b|\bwe'll\b|\bus\b/i);
    expect(host.textContent!).not.toMatch(/\bi\b/); // case-sensitive: a lowercase standalone i is the violation
    view.dispose();
  });

  it('keeps emphasis out of the caps in the copy strings', async () => {
    // The phase copy is rewritten at runtime behind a pointer lock jsdom cannot grant, so the
    // strings are checked at the source, same as the retired calibrate-views check.
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('src/ui/calibrate/turn-view.ts', 'utf8');
    const copyLines = src.split('\n').filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'));
    expect(copyLines.join('\n')).not.toMatch(/['`][^'`]*\b(LEFT|RIGHT|FAST|SLOW)\b[^'`]*['`]/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/ui/turn-view.test.ts`
Expected: FAIL with `SyntaxError: The requested module '/src/ui/calibrate/turn-view.ts' does not provide an export named 'createTurnView'`

- [ ] **Step 3: Write the minimal implementation**

Append to `src/ui/calibrate/turn-view.ts` (below the machine; also add these two lines to the
import block at the top):

```ts
import { createPointerLock } from '../../input/pointer-lock';
import { conventionFromGated, type Convention } from '../../input/lattice';
```

then append:

```ts
export interface TurnView { dispose(): void; }

const TAP_MS = 220;       // press shorter than this (with little movement) = a tap
const TAP_MOVE_MAX = 40;  // counts of movement during a press still considered "still" (a tap)
const TOO_SOON_MS = 1800; // how long the too-soon explanation holds the lead before reverting

const LEAD_START = 'This step measures one full turn, three times over, by feel. Click the box to begin.';

/** The fourth-pass offer, with the measured spread in it. Exported pure so jsdom can pin the copy
 *  without a pointer lock. The number renders in tabular figures per canon: a player being told
 *  how far apart their turns landed is the spread report the spec promises. */
export function fourthOfferLead(spreadPct: number, dir: 'right' | 'left'): string {
  return `Your three turns landed <span class="mono">${spreadPct.toFixed(1)}</span> percent apart, too far to honestly average. One more pass, to the ${dir}, shows which one was the odd one out. Click to start.`;
}

export function createTurnView(
  host: HTMLElement,
  opts: {
    /** The estimate plus what the delta stream said about the count convention. `convention` is
     *  null when the acceleration gate kept the lattice from running at all (any non-raw mode). */
    onTurn: (estimate: TurnEstimate, convention: Convention | null) => void;
    /** The refusal, with the measured spread when the reason is 'spread' (null on 'accel'), so the
     *  blocked screen can name the number instead of gesturing at it. */
    onBlocked: (reason: TurnBlockReason, spreadPct: number | null) => void;
    /** The typed fallback, chosen deliberately. */
    onManual: () => void;
    /** Leave the guided flow entirely. Every step owes the visitor a way out. */
    onBack: () => void;
  },
): TurnView {
  host.innerHTML = `
    <section class="screen screen--shell fade-in">
      <div class="wrap stack">
        <span class="cal-step" data-turn="pass">Pass 1 of ${NATURAL_PASSES} · to the right</span>
        <h1 class="display">The turn</h1>
        <p class="gate__lead" data-turn="lead" aria-live="polite" aria-atomic="true">${LEAD_START}</p>
        <p class="cal-sub" data-turn="sub"></p>
        <div class="calibrate__stage">
          <div class="calibrate__hint" data-turn="hint"><span class="cal-pulse"><span class="cal-pulse__dot"></span></span></div>
          <p class="cal-method mono" data-turn="rec" hidden>Recording</p>
        </div>
        <div class="cal-helper"><span><b>Out of room?</b> Hold the button, slide your mouse back, then let go.</span></div>
        <p class="cal-method mono" data-turn="why">No dial and no readout here, on purpose. A meter that filled toward done would tell your hand when to stop, and then the measurement would be of my meter, not of your turn.</p>
        <div class="cal-exit">
          <button type="button" class="action action--ghost" data-turn="back">Back</button>
          <button type="button" class="action action--ghost" data-turn="manual">Type the numbers instead</button>
        </div>
      </div>
    </section>`;

  const $ = (s: string): HTMLElement => host.querySelector(`[data-turn="${s}"]`) as HTMLElement;
  const stage = host.querySelector('.calibrate__stage') as HTMLElement;
  const pointer = createPointerLock(stage);

  let m = initialTurnMachine();
  let path = 0;              // |dx| accumulated across the live pass (the pass magnitude)
  let paused = false;        // counting suspended (set on mousedown until the press is classified)
  let repositioning = false; // UI: showing the reposition prompt (set by the hold timer)
  let downAt = 0, pressMoved = 0;
  let holdTimer: number | null = null;
  let tooSoonTimer: number | null = null;

  // Raw movement deltas from every pass, both axes interleaved: a browser that scales movementX
  // scales movementY identically, so dx and dy are samples of ONE lattice and interleaving them
  // doubles the sample count for free (pinned by 'reads both axis components as one lattice' in
  // tests/input/lattice.test.ts). Capped so a long calibration cannot grow it without bound; 4000
  // is sixty-six times the LATTICE_MIN_SAMPLES floor. Values go in untouched, even while a press
  // is being classified: conventionFrom drops zeros and non-finite entries itself, and anything
  // filtered, rounded or smoothed here is lattice evidence destroyed.
  const LATTICE_TAP_CAP = 4000;
  const latticeTap: number[] = [];

  const recordingNow = (): boolean => m.phase === 'recording' || m.phase === 'fast-recording';

  const off = pointer.onSample((s) => {
    if (!pointer.isLocked()) return;
    if (latticeTap.length < LATTICE_TAP_CAP) latticeTap.push(s.dx, s.dy);
    if (paused) { pressMoved += Math.abs(s.dx); return; } // press movement classifies tap vs hold; never counts
    // Path length, not the signed sum: unheld wobble cancels in a signed sum and under-counts the
    // turn, which biased the old spin's seed fast (same fix SpinSeedAccumulator carried).
    if (recordingNow()) path += Math.abs(s.dx);
  });

  function flashTooSoon(): void {
    if (tooSoonTimer !== null) clearTimeout(tooSoonTimer);
    $('lead').textContent = 'That click came too soon to be a full turn, so it did not count. Keep turning, and click when you are facing forward again.';
    tooSoonTimer = window.setTimeout(() => { tooSoonTimer = null; updateUi(); }, TOO_SOON_MS);
  }

  function advance(tapCounts: number): void {
    const next = turnTap(m, tapCounts, pointer.mode() ?? 'os-adjusted');
    if (next === m) { flashTooSoon(); return; } // the machine refused the tap: explain the no-op
    const wasRecording = recordingNow();
    m = next;
    if (recordingNow() && !wasRecording) path = 0; // a fresh pass counts from zero
    if (m.phase === 'done' && m.estimate !== null) {
      // Read the mode and run the gate BEFORE exiting the lock: pointerlockchange nulls mode().
      // `accel: null` is correct in both worlds: on raw no fast pass ran so there is no verdict,
      // and on any other mode the gate is closed by the mode alone before a verdict could matter
      // (an accelerated delta is still an integer after rounding, so the lattice cannot see it).
      const convention = conventionFromGated(latticeTap, { mode: pointer.mode(), accel: null });
      pointer.exit();
      opts.onTurn(m.estimate, convention);
      return;
    }
    if (m.phase === 'blocked' && m.blockReason !== null) {
      pointer.exit();
      opts.onBlocked(m.blockReason, m.estimate?.spreadPct ?? null);
      return;
    }
    updateUi();
  }

  const onDown = (ev: MouseEvent): void => {
    if (!pointer.isLocked() || ev.button !== 0) return;
    downAt = ev.timeStamp; pressMoved = 0; paused = true; // suspend counting until classified
    holdTimer = window.setTimeout(() => { repositioning = true; updateUi(); }, TAP_MS);
  };
  const onUp = (ev: MouseEvent): void => {
    if (ev.button !== 0 || downAt === 0) return;
    if (holdTimer !== null) { clearTimeout(holdTimer); holdTimer = null; }
    const dt = ev.timeStamp - downAt; // a DIFFERENCE of timestamps: invariant to the clock origin
    downAt = 0;
    const isTap = dt < TAP_MS && pressMoved < TAP_MOVE_MAX; // quick AND still = a tap; else a reposition
    paused = false;
    const wasRepositioning = repositioning;
    repositioning = false;
    if (isTap && !wasRepositioning) { advance(path); return; }
    updateUi(); // a hold ended: counting resumed, back to the live instruction
  };

  function updateUi(): void {
    const locked = pointer.isLocked();
    $('hint').style.display = locked ? 'none' : 'flex';
    $('rec').hidden = !(locked && recordingNow() && !repositioning);
    if (m.phase === 'fast-idle' || m.phase === 'fast-recording') {
      $('pass').textContent = 'Last pass · quick';
    } else if (m.passes.length >= NATURAL_PASSES) {
      $('pass').textContent = 'Pass 4 · the tie-breaker · to the left';
    } else {
      $('pass').textContent = `Pass ${m.passes.length + 1} of ${NATURAL_PASSES} · to the ${turnDirection(m.passes.length)}`;
    }
    if (!locked) { $('lead').textContent = LEAD_START; $('sub').textContent = ''; return; }
    if (repositioning) {
      $('lead').textContent = 'Slide your mouse back to the middle of your pad.';
      $('sub').textContent = "Let go when you're set. Counting stays paused while you hold.";
      return;
    }
    const dir = turnDirection(m.passes.length);
    switch (m.phase) {
      case 'idle':
        $('lead').textContent = m.passes.length === 0
          ? `Click once to start pass 1, then turn a full circle to the ${dir}, by feel, as if you were in your game.`
          : `Pass ${m.passes.length} is in. Click once to start pass ${m.passes.length + 1}, turning to the ${dir} this time.`;
        $('sub').textContent = m.passes.length === 0
          ? 'End facing the way you started, then click again to finish the pass.'
          : 'Alternating direction cancels a one-way drift instead of averaging it in.';
        break;
      case 'recording':
        $('lead').textContent = `Turning to the ${dir}. One full circle, and click when you are facing forward again.`;
        $('sub').textContent = '';
        break;
      case 'fourth-offer':
        // The estimate exists in this phase by construction (set on entry). The spread is the
        // honest part of the sentence, so it is rendered, not summarized.
        $('lead').innerHTML = fourthOfferLead(m.estimate!.spreadPct, dir);
        $('sub').textContent = '';
        break;
      case 'fast-idle':
        $('lead').innerHTML = `Your turns agree, within <span class="mono">${m.estimate!.spreadPct.toFixed(1)}</span> percent. One last pass, and this time quick: click, then turn a full circle as fast as feels natural.`;
        $('sub').textContent = 'A quick turn against your steady ones is how the acceleration check works here: your browser cannot hand me raw mouse input, so the OS may be scaling speed.';
        break;
      case 'fast-recording':
        $('lead').textContent = 'One quick full circle, then click.';
        $('sub').textContent = '';
        break;
      case 'done':
      case 'blocked':
        break; // terminal: the view is being torn down by the orchestrator
    }
  }

  // A denied lock says so in the live region and points at the typed route (the same honesty the
  // spin learned after its silent no-op left the step unusable with nothing said).
  const onStageClick = (): void => {
    if (pointer.isLocked()) return;
    void pointer.request().catch(() => {
      $('lead').textContent = 'Your browser blocked the pointer lock, so the turn cannot read your mouse. Use "Type the numbers instead" below.';
    });
  };
  const onLock = (): void => {
    if (!pointer.isLocked() && recordingNow()) {
      // Esc mid-pass: drop the LIVE pass only and re-arm its idle. Never stitch a pass across an
      // uncounted gap, which would commit a short turn as if it were full. Committed passes keep.
      m = {
        ...m,
        phase: m.phase === 'fast-recording'
          ? 'fast-idle'
          : (m.passes.length >= NATURAL_PASSES ? 'fourth-offer' : 'idle'),
      };
      path = 0;
    }
    updateUi();
  };
  // The two ways out, reachable by Tab even mid-pass. Both release the lock before leaving.
  const leave = (fn: () => void) => (): void => { pointer.exit(); fn(); };
  const onBackClick = leave(() => opts.onBack());
  const onManualClick = leave(() => opts.onManual());
  document.addEventListener('pointerlockchange', onLock);
  document.addEventListener('mousedown', onDown);
  document.addEventListener('mouseup', onUp);
  stage.addEventListener('click', onStageClick);
  $('back').addEventListener('click', onBackClick);
  $('manual').addEventListener('click', onManualClick);
  updateUi();

  return { dispose() {
    off();
    if (holdTimer !== null) clearTimeout(holdTimer);
    if (tooSoonTimer !== null) clearTimeout(tooSoonTimer);
    document.removeEventListener('pointerlockchange', onLock);
    document.removeEventListener('mousedown', onDown);
    document.removeEventListener('mouseup', onUp);
    stage.removeEventListener('click', onStageClick);
    $('back').removeEventListener('click', onBackClick);
    $('manual').removeEventListener('click', onManualClick);
    pointer.dispose();
  } };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/ui/turn-view.test.ts`
Expected: PASS, `Tests  22 passed (22)` (the 12 machine tests plus 10 shell tests)

- [ ] **Step 5: Commit**

```bash
git add src/ui/calibrate/turn-view.ts tests/ui/turn-view.test.ts
git commit -m "feat(calibrate): the turn view, blind, with the lattice tap and the spread in the copy" -m "No canvas, no rAF, no degree glyph: the tests pin the absences. The raw delta stream feeds conventionFromGated behind the acceleration gate, and the fourth-pass offer names the measured spread instead of gesturing at it. The hold-to-reposition affordance survives from the spin verbatim, because running out of mousepad is real."
```

### Task 18: the flow reworked onto the offer and the turn, and the pin site

**Files:**
- Modify: `src/ui/calibrate-flow.ts` (full rewrite)
- Modify: `src/ui/setup.ts` (full rewrite)
- Modify: `src/ui/shell.ts` (three optional fields on `SessionDraft`, plus their type imports)
- Test: `tests/ui/calibrate-flow.test.ts` (full rewrite)
- Test: `tests/ui/setup.test.ts` (full rewrite)

One task because these form one compilation unit: the reducer's new step names, the orchestrator
that renders them, and the draft fields the commit writes. The suite is only expected fully green
at step 8.

**Prerequisites, all hard:** phase 1a has fully landed (`countsForSens` in `src/convert/counts.ts`;
`boundsFromSeed` in `src/ui/options/settings.ts` reworked to `(seed: Counts360, factor?) =>
[Counts360, Counts360]`; `dpi` gone from `SessionDraft` and `PersistedPrefs`), and phase 3 tasks 23
to 26 have landed (`src/input/lattice.ts`, `src/input/count-convention.ts`). This task authors the
whole UI seam that pins k, because the contract's amendment A1 gives `setup.ts`,
`calibrate-flow.ts` and `shell.ts` to phase 2: the `'offer'` step, the `offerAccepted` routing flag
and its two reducer actions, the offer markup and its validation, and the `pinConvention` call
inside `commitGuided`. Phase 3's H2 is a verification note against this task and carries nothing to
apply; do not go looking for edits there. What phase 2 imports from phase 3 and never authors is
`pinConvention`, `TypedSensRoute` and `KPin` from `src/input/count-convention.ts`, and `Convention`
from `src/input/lattice.ts`. In the assembled plan, phase 3's estimator tasks must be sequenced
before this task.

**The shape of the flow (finding F3).** The game/current-sensitivity pair is the only reliable
route to k, and it needs BOTH halves: the exact counts the player's setting implies, and the
arena's own count for the same turn. So the pair is collected as an OFFER on the way into the
turn, never instead of it: intro -> offer (accept or skip) -> turn -> turn-done (the spread
report) -> commit. Skipping the offer costs the absolute numbers and never the ratio. The typed
fallback (no turn at all) remains, and it genuinely cannot pin k, so it leaves the pin refused.

- [ ] **Step 1: Write the failing reducer test**

Replace the entire contents of `tests/ui/calibrate-flow.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { calibrateReducer, initialCalState, type CalState } from '../../src/ui/calibrate-flow';

describe('calibrateReducer', () => {
  const s0: CalState = initialCalState();

  it('guided start moves to the offer, and resets the offer answer', () => {
    const s = calibrateReducer({ ...s0, offerAccepted: true }, { type: 'start-guided' });
    expect(s.step).toBe('offer');
    expect(s.offerAccepted).toBe(false); // last run's answer must not silently pin this run's k
  });

  it('the offer resolves to the turn either way, recording only whether the pair was given', () => {
    const atOffer: CalState = { step: 'offer', blockReason: null, offerAccepted: false };
    expect(calibrateReducer(atOffer, { type: 'offer-accepted' }))
      .toEqual({ step: 'turn', blockReason: null, offerAccepted: true });
    expect(calibrateReducer(atOffer, { type: 'offer-skipped' }))
      .toEqual({ step: 'turn', blockReason: null, offerAccepted: false });
  });

  it('carries no measurement state: routing, a refusal reason and one yes/no', () => {
    // The old reducer ferried a dpi between the sweep and the spin. The unit chain is deleted, and
    // a reducer field holding a number is the first place a physical unit could quietly grow back.
    // offerAccepted is a routing choice (which pin route the commit takes), never a measured value:
    // the pair itself lives on the draft and the pin is computed at commit against the turn.
    expect(s0).toEqual({ step: 'intro', blockReason: null, offerAccepted: false });
  });

  it('a completed turn moves to the done step, where the spread is reported before committing', () => {
    const s = calibrateReducer({ step: 'turn', blockReason: null, offerAccepted: true }, { type: 'turn-complete' });
    expect(s.step).toBe('turn-done');
    expect(s.offerAccepted).toBe(true); // the commit still needs to know which pin route to take
  });

  it('an accel refusal from the turn blocks with the accel reason', () => {
    const s = calibrateReducer({ step: 'turn', blockReason: null, offerAccepted: false }, { type: 'turn-blocked', reason: 'accel' });
    expect(s.step).toBe('blocked');
    expect(s.blockReason).toBe('accel');
  });

  it('a spread refusal (four passes never settled) blocks with the spread reason', () => {
    const s = calibrateReducer({ step: 'turn', blockReason: null, offerAccepted: false }, { type: 'turn-blocked', reason: 'spread' });
    expect(s.step).toBe('blocked');
    expect(s.blockReason).toBe('spread');
  });

  it('retry from blocked returns to the turn, clears the reason and keeps the offer answer', () => {
    const blocked: CalState = { step: 'blocked', blockReason: 'accel', offerAccepted: true };
    expect(calibrateReducer(blocked, { type: 'retry' }))
      .toEqual({ step: 'turn', blockReason: null, offerAccepted: true });
  });

  it('manual entry is reachable from intro and returns to it', () => {
    const m = calibrateReducer(s0, { type: 'start-manual' });
    expect(m.step).toBe('manual');
    expect(calibrateReducer(m, { type: 'back-to-intro' }).step).toBe('intro');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/ui/calibrate-flow.test.ts -t 'guided start moves to the offer'`
Expected: FAIL with `AssertionError: expected 'sweep' to be 'offer' // Object.is equality`

- [ ] **Step 3: Rewrite the reducer**

Replace the entire contents of `src/ui/calibrate-flow.ts` with:

```ts
// Pure step machine for the guided calibration (mirrors the gateReducer pattern: pure transitions,
// thin DOM in the screen). The guided path is offer -> turn -> turn-done: the game/sensitivity
// pair is asked for FIRST, as an offer alongside the turn rather than a fork away from it, because
// that pair is the one reliable route to the count convention k and k can only be measured against
// the turn the player is about to perform (spec, "in-game sensitivity, and why it is a different
// kind of ask"). Skipping the offer costs the absolute numbers and never the ratio. The reducer
// holds no measurement state: the dpi field died with the unit chain, and reintroducing a carried
// number here is how a physical unit would quietly grow back.
import type { TurnBlockReason } from './calibrate/turn-view';

export type CalStep = 'intro' | 'offer' | 'turn' | 'turn-done' | 'manual' | 'blocked';

/** Why the turn was blocked: 'accel' = OS acceleration detected (counts per 360 undefined);
 *  'spread' = four passes never settled close enough to honestly average. */
export type BlockReason = TurnBlockReason;

export interface CalState {
  step: CalStep;
  blockReason: BlockReason | null;
  /** Whether the player answered the offer with their game + sensitivity pair. Routing only: the
   *  pair itself lives on the draft, and the pin is computed at the commit, against the turn's own
   *  count (src/ui/setup.ts commitGuided). */
  offerAccepted: boolean;
}

export type CalAction =
  | { type: 'start-guided' }
  | { type: 'start-manual' }
  | { type: 'offer-accepted' }
  | { type: 'offer-skipped' }
  | { type: 'turn-complete' }
  | { type: 'turn-blocked'; reason: BlockReason }
  | { type: 'retry' }
  | { type: 'back-to-intro' };

export function initialCalState(): CalState {
  return { step: 'intro', blockReason: null, offerAccepted: false };
}

export function calibrateReducer(state: CalState, action: CalAction): CalState {
  switch (action.type) {
    case 'start-guided':
      // A fresh guided run re-asks the offer: last run's answer must not silently pin this run's k.
      return { ...state, step: 'offer', blockReason: null, offerAccepted: false };
    case 'start-manual':
      return { ...state, step: 'manual' };
    case 'offer-accepted':
      return { ...state, step: 'turn', offerAccepted: true };
    case 'offer-skipped':
      return { ...state, step: 'turn', offerAccepted: false };
    case 'turn-complete':
      return { ...state, step: 'turn-done' };
    case 'turn-blocked':
      return { ...state, step: 'blocked', blockReason: action.reason };
    case 'retry':
      // The offer answer survives a retry: the pair was typed once, and the pin is recomputed at
      // commit against the NEW turn, so re-asking would only cost patience.
      return { ...state, step: 'turn', blockReason: null };
    case 'back-to-intro':
      return { ...state, step: 'intro' };
  }
}
```

- [ ] **Step 4: Run the reducer test to verify it passes**

Run: `npx vitest run tests/ui/calibrate-flow.test.ts`
Expected: PASS, `Tests  8 passed (8)`. `tests/ui/setup.test.ts` is now failing against the new
reducer; it is replaced in the next step.

- [ ] **Step 5: Write the failing setup test**

Replace the entire contents of `tests/ui/setup.test.ts` with:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { setup, type SetupDeps } from '../../src/ui/setup';
import { countsForSens } from '../../src/convert/counts';
import { yawFor } from '../../src/convert/yaw-table';
import { boundsFromSeed } from '../../src/ui/options/settings';
import { counts360, type PersistedPrefs } from '../../src/types';
import type { TurnEstimate } from '../../src/anchor/reference-turn';
import type { Convention } from '../../src/input/lattice';
import type { AppContext, Route, SessionDraft } from '../../src/ui/shell';

type TurnOpts = Parameters<typeof import('../../src/ui/calibrate/turn-view').createTurnView>[1];

function fakeCtx(): AppContext & { nav: Route[] } {
  const nav: Route[] = [];
  // Typed as SessionDraft, no cast: phase 1a already deleted dpi, so the honest fixture simply
  // does not have one. counts360() is required by the brand and harmless if bounds stayed plain.
  const draft: SessionDraft = {
    currentGame: 'cs2', currentSens: 1,
    bounds: [counts360(4000), counts360(16000)],
    profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } },
  };
  return { route: 'setup', navigate(r: Route) { nav.push(r); }, draft, nav,
    storage: { saveSession() {}, loadSessions: () => [], saveResult() {}, exportJson: () => '' } } as AppContext & { nav: Route[] };
}

const EST: TurnEstimate = { counts: counts360(8000), spreadPct: 2.1, logSd: 0.08, agreed: true, passes: 3 };
const SCALED: Convention = { state: 'scaled', k: 2, purity: 1 };

function captureTurn(): { deps: SetupDeps; turn: () => TurnOpts; mounts: () => number } {
  let turnOpts: TurnOpts | null = null;
  let n = 0;
  const deps: SetupDeps = {
    createTurnView: ((_h: HTMLElement, o: TurnOpts) => {
      turnOpts = o; n += 1; return { dispose() {} };
    }) as SetupDeps['createTurnView'],
  };
  return { deps, turn: () => turnOpts!, mounts: () => n };
}

function rememberingCtx(prefs: PersistedPrefs | null): ReturnType<typeof fakeCtx> & { savedPrefs: () => PersistedPrefs | null } {
  const ctx = fakeCtx();
  let saved = prefs;
  ctx.storage.loadPrefs = () => saved;
  ctx.storage.savePrefs = (p) => { saved = p; };
  return Object.assign(ctx, { savedPrefs: () => saved });
}

const PREFS: PersistedPrefs = {
  currentGame: 'valorant', currentSens: 0.4, speedAccuracy: 0.7,
  bounds: [counts360(5000), counts360(14000)],
};

/** Walk the guided path to a mounted turn view: intro -> offer -> (accept | skip) -> turn.
 *  The offer opens with BOTH halves empty, so accepting means filling both: no test may lean on a
 *  prefill, because there is none to lean on. */
function startTurn(host: HTMLElement, accept?: { game: string; sens: string }): void {
  (host.querySelector('[data-action="start-guided"]') as HTMLButtonElement).click();
  if (accept) {
    const game = host.querySelector('[data-field="game"]') as HTMLSelectElement;
    game.value = accept.game;
    const sens = host.querySelector('[data-field="sens"]') as HTMLInputElement;
    sens.value = accept.sens;
    sens.dispatchEvent(new Event('input', { bubbles: true }));
    (host.querySelector('[data-action="offer-accept"]') as HTMLButtonElement).click();
  } else {
    (host.querySelector('[data-action="offer-skip"]') as HTMLButtonElement).click();
  }
}

describe('setup: the guided flow (the offer, then the blind turn)', () => {
  it('offers the guided path and the typed fork, with no card and no DPI anywhere', () => {
    const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx).mount();
    expect(host.querySelector('[data-action="start-guided"]')).toBeTruthy();
    expect(host.querySelector('[data-action="start-manual"]')).toBeTruthy();
    expect(host.querySelectorAll('.cal-preview li').length).toBe(1); // one measured step; the offer is a question, not a step
    const text = host.textContent!.toLowerCase();
    expect(text).not.toContain('card'); // the prop is gone, not merely optional
    expect(text).not.toContain('dpi');  // the unit chain is gone with it
  });

  it('start-guided asks for the game pair first, as an offer whose skip costs only the table', () => {
    const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx).mount();
    (host.querySelector('[data-action="start-guided"]') as HTMLButtonElement).click();
    expect(host.querySelector('h1')!.textContent).toBe('Name your game, if you like');
    expect(host.querySelector('[data-action="offer-accept"]')).toBeTruthy();
    expect(host.querySelector('[data-action="offer-skip"]')).toBeTruthy();
    expect(host.textContent).toContain('Skipping costs the per-game table, not the result.');
  });

  it('starts on no answer at all, so an ignored offer cannot be read as one', () => {
    // The anchoring defect that killed the spin dial, in a new costume. The spin prefilled a dial
    // and then measured the constant it had prefilled; an offer prefilled from defaultDraft()
    // ('cs2', 1) would let a player who clicks straight past it pin k off a pair nobody typed, and
    // k would then be wrong by the ratio of two yaws with nothing on the screen to show it. Empty
    // is the only value that means "no answer": storage cannot say whether a remembered
    // currentSens was typed or defaulted, so it never prefills this either.
    const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx).mount();
    (host.querySelector('[data-action="start-guided"]') as HTMLButtonElement).click();
    expect((host.querySelector('[data-field="game"]') as HTMLSelectElement).value).toBe('');
    expect((host.querySelector('[data-field="sens"]') as HTMLInputElement).value).toBe('');
  });

  it('a half-filled offer refuses and names the missing half', () => {
    // Half an offer is the one state that must not reach the turn: a sensitivity with no game is
    // not a pair, and silently dropping a number the player took the trouble to type is worse than
    // refusing it by name.
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    startTurn(host, { game: '', sens: '2' });
    expect(cap.mounts()).toBe(0); // the turn never started
    const err = host.querySelector('[data-error]')!;
    expect(err.getAttribute('role')).toBe('alert');
    expect(err.textContent!.toLowerCase()).toContain('game');
    expect(ctx.draft.currentSens).toBe(1); // and nothing reached the draft
  });

  it('skipping the offer mounts the blind turn without touching the draft', () => {
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    startTurn(host);
    expect(cap.turn()).toBeTruthy();
    expect(ctx.draft.currentSens).toBe(1); // a skip records nothing
  });

  it('accepting the offer records the pair on the draft, then mounts the turn', () => {
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    startTurn(host, { game: 'cs2', sens: '2' });
    expect(ctx.draft.currentSens).toBe(2);
    expect(cap.mounts()).toBe(1);
  });

  it('an unusable offered sensitivity refuses with a named alert and does not advance', () => {
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    startTurn(host, { game: 'cs2', sens: '0' });
    expect(cap.mounts()).toBe(0); // still on the offer
    const err = host.querySelector('[data-error]')!;
    expect(err.getAttribute('role')).toBe('alert');
    expect(err.textContent!.toLowerCase()).toContain('sensitivity');
    expect(host.querySelector('[data-field="sens"]')!.getAttribute('aria-invalid')).toBe('true');
  });

  it('a completed turn reports its own spread before anything commits', () => {
    // Spec: "Afterwards it reports the spread honestly." This screen is the agreed case: the
    // player is told how close their three turns landed, which is the moment the blind
    // instrument earns its blindness. Tabular figures per canon.
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    startTurn(host);
    cap.turn().onTurn(EST, null);
    const spread = host.querySelector('[data-done="spread"]')!;
    expect(spread.textContent).toBe('2.1');
    expect(spread.className).toContain('mono');
    expect(ctx.nav).toEqual([]); // reported BEFORE committing, not after
    expect(ctx.draft.turn).toBeUndefined();
  });

  it('continue commits the estimate, seeds counts bounds, remembers, and heads to the hunt', () => {
    const cap = captureTurn(); const ctx = rememberingCtx(null); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    startTurn(host);
    cap.turn().onTurn(EST, null);
    (host.querySelector('[data-action="turn-continue"]') as HTMLButtonElement).click();
    expect(ctx.draft.turn).toEqual(EST); // phase 4's reconciliation reads the turn's own spread
    expect(ctx.draft.bounds).toEqual(boundsFromSeed(EST.counts));
    expect(ctx.draft.profile.speedAccuracy).toBe(0.5);
    // Skipped offer plus a closed lattice gate: k is honestly unpinned, and the reason says the
    // estimator never ran (which the result screen turns into "type your sensitivity instead").
    expect(ctx.draft.kPin).toEqual({ pinned: false, reason: 'gate-closed' });
    expect(ctx.savedPrefs()).not.toBeNull();
    expect(ctx.nav).toEqual(['session']);
  });

  it('an accepted offer pins k by the typed route, inheriting the turn pass spread whole', () => {
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    startTurn(host, { game: 'cs2', sens: '2' });
    cap.turn().onTurn(EST, null);
    (host.querySelector('[data-action="turn-continue"]') as HTMLButtonElement).click();
    const pin = ctx.draft.kPin!;
    expect(pin.pinned).toBe(true);
    if (pin.pinned) {
      expect(pin.source).toBe('typed-sens');
      expect(pin.logSd).toBe(EST.logSd); // the reproduction error lands whole on k
      expect(pin.k).toBeCloseTo(8000 / countsForSens(2, yawFor('cs2')), 10);
    }
  });

  it('a scaled lattice pins k even when the offer was skipped', () => {
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    startTurn(host);
    cap.turn().onTurn(EST, SCALED);
    (host.querySelector('[data-action="turn-continue"]') as HTMLButtonElement).click();
    expect(ctx.draft.kPin).toEqual({ pinned: true, k: 2, source: 'lattice', logSd: 0 });
    expect(ctx.draft.convention).toEqual(SCALED);
  });

  it('the typed pair outranks the lattice when both exist', () => {
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    startTurn(host, { game: 'cs2', sens: '2' });
    cap.turn().onTurn(EST, SCALED);
    (host.querySelector('[data-action="turn-continue"]') as HTMLButtonElement).click();
    const pin = ctx.draft.kPin!;
    expect(pin.pinned && pin.source).toBe('typed-sens');
  });

  it('redo discards the pending estimate and remounts the turn, committing nothing', () => {
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    startTurn(host);
    cap.turn().onTurn(EST, SCALED);
    (host.querySelector('[data-action="redo-turn"]') as HTMLButtonElement).click();
    expect(cap.mounts()).toBe(2);
    expect(ctx.draft.turn).toBeUndefined();
    expect(ctx.nav).toEqual([]);
  });

  it('an accel refusal shows the acceleration screen, and retry remounts the turn', () => {
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    startTurn(host);
    cap.turn().onBlocked('accel', null);
    expect(host.querySelectorAll('h1').length).toBe(1);
    expect(host.querySelector('h1')!.textContent).toBe('Mouse acceleration is on');
    (host.querySelector('[data-action="retry"]') as HTMLButtonElement).click();
    expect(cap.mounts()).toBe(2);
  });

  it('a spread refusal names the measured spread and the fourth pass', () => {
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    startTurn(host);
    cap.turn().onBlocked('spread', 27.4);
    expect(host.querySelector('h1')!.textContent).toBe('Those turns never settled');
    expect(host.textContent!.toLowerCase()).toContain('fourth pass');
    const spread = host.querySelector('[data-blocked="spread"]')!;
    expect(spread.textContent).toBe('27.4'); // the honest number, not "too far apart"
    expect(spread.className).toContain('mono');
  });

  it('the turn can go back to the intro and hand off to the typed fallback, committing nothing', () => {
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    startTurn(host);
    cap.turn().onBack();
    expect(host.querySelector('[data-action="start-guided"]')).toBeTruthy();
    startTurn(host);
    cap.turn().onManual();
    expect(host.querySelector('[data-action="manual-begin"]')).toBeTruthy();
    expect(ctx.nav).toEqual([]);
  });
});

describe('setup: the typed fallback', () => {
  function manualStep(ctx: ReturnType<typeof fakeCtx>): HTMLElement {
    const host = document.createElement('div');
    setup(host, ctx).mount();
    (host.querySelector('[data-action="start-manual"]') as HTMLButtonElement).click();
    return host;
  }
  const type = (host: HTMLElement, field: string, value: string): void => {
    const el = host.querySelector(`[data-field="${field}"]`) as HTMLInputElement;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  it('has no DPI field: game and in-game sensitivity are the whole ask', () => {
    const host = manualStep(fakeCtx());
    expect(host.querySelector('[data-field="dpi"]')).toBeNull();
    expect(host.querySelector('[data-field="game"]')).toBeTruthy();
    expect(host.querySelector('[data-field="sens"]')).toBeTruthy();
  });

  it('writes sens/game plus counts-seeded bounds, clears stale turn state, leaves k unpinned, and navigates', () => {
    const ctx = fakeCtx();
    // A guided run the player is now replacing by typing: every trace of it must go.
    ctx.draft.turn = EST;
    ctx.draft.convention = SCALED;
    ctx.draft.kPin = { pinned: true, k: 2, source: 'lattice', logSd: 0 };
    const host = manualStep(ctx);
    type(host, 'sens', '0.5');
    (host.querySelector('[data-action="manual-begin"]') as HTMLButtonElement).click();
    expect(ctx.draft.currentSens).toBe(0.5);
    expect(ctx.draft.bounds).toEqual(boundsFromSeed(countsForSens(0.5, yawFor('cs2'))));
    expect(ctx.draft.turn).toBeUndefined();       // phase 4 must never reconcile against a replaced run
    expect(ctx.draft.convention).toBeUndefined();
    // Typing alone cannot pin k: without a turn there is no arena count to compare against, so
    // the typed numbers seed the search window only and the pin is honestly refused.
    expect(ctx.draft.kPin).toEqual({ pinned: false, reason: 'gate-closed' });
    expect(ctx.nav).toEqual(['session']);
  });

  it.each([['', 'empty'], ['0', 'zero'], ['-2', 'negative']])(
    'a %s sensitivity (%s) neither navigates nor reaches the draft, and says why', (bad) => {
      const ctx = fakeCtx(); const host = manualStep(ctx);
      type(host, 'sens', bad);
      (host.querySelector('[data-action="manual-begin"]') as HTMLButtonElement).click();
      expect(ctx.nav).toEqual([]);
      expect(ctx.draft.currentSens).toBe(1); // the draft is untouched
      const err = host.querySelector('[data-error]')!;
      expect(err.getAttribute('role')).toBe('alert');
      expect(err.textContent!.toLowerCase()).toContain('sensitivity');
      expect(host.querySelector('[data-field="sens"]')!.getAttribute('aria-invalid')).toBe('true');
    });

  it('clears the message as soon as the number is corrected, then commits', () => {
    const ctx = fakeCtx(); const host = manualStep(ctx);
    const begin = host.querySelector('[data-action="manual-begin"]') as HTMLButtonElement;
    type(host, 'sens', '0');
    begin.click();
    expect(begin.getAttribute('aria-disabled')).toBe('true');
    type(host, 'sens', '0.5');
    expect(host.querySelector('[data-error]')!.textContent).toBe('');
    expect(begin.getAttribute('aria-disabled')).toBe('false');
    begin.click();
    expect(ctx.nav).toEqual(['session']);
  });
});

describe('setup: remembered calibration', () => {
  it('offers the saved fast path as PRIMARY when the stored bounds are usable', () => {
    const ctx = rememberingCtx(PREFS); const host = document.createElement('div');
    setup(host, ctx).mount();
    const useSaved = host.querySelector('[data-action="use-saved"]') as HTMLButtonElement;
    expect(useSaved).toBeTruthy();
    expect(useSaved.className).toContain('action--primary');
    expect(host.querySelector('[data-remembered]')!.textContent).toContain('5,000');
    expect(host.querySelector('[data-action="start-guided"]')!.className).toContain('action--ghost');
  });

  it('shows NO fast path on a first visit', () => {
    const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx).mount();
    expect(host.querySelector('[data-action="use-saved"]')).toBeNull();
    expect(host.querySelector('[data-action="start-guided"]')!.className).toContain('action--primary');
  });

  it('hides the fast path when the stored bounds are malformed', () => {
    // A poisoned pref must not hand the optimizer an empty or inverted window on every visit.
    const ctx = rememberingCtx({ ...PREFS, bounds: [counts360(0), counts360(0)] });
    const host = document.createElement('div');
    setup(host, ctx).mount();
    expect(host.querySelector('[data-action="use-saved"]')).toBeNull();
  });

  it('use-saved re-applies the remembered prefs, resets the pin, and goes straight to the hunt', () => {
    const ctx = rememberingCtx(PREFS); const host = document.createElement('div');
    ctx.draft.currentSens = 9; // a drifted draft must not leak into the session
    ctx.draft.kPin = { pinned: true, k: 2, source: 'lattice', logSd: 0 }; // a stale pin must not either
    setup(host, ctx).mount();
    (host.querySelector('[data-action="use-saved"]') as HTMLButtonElement).click();
    expect(ctx.draft.currentGame).toBe('valorant');
    expect(ctx.draft.currentSens).toBe(0.4);
    expect(ctx.draft.bounds).toEqual([5000, 14000]);
    expect(ctx.draft.profile.speedAccuracy).toBe(0.7);
    // The pin is measured against one turn on one browser and is never persisted, so the fast
    // path cannot carry one: it resets to the honest refusal.
    expect(ctx.draft.kPin).toEqual({ pinned: false, reason: 'gate-closed' });
    expect(ctx.draft.turn).toBeUndefined();
    expect(ctx.nav).toEqual(['session']);
  });
});

describe('setup: voice', () => {
  it.each(['intro', 'offer', 'manual'] as const)('the %s step: one h1, sentence case, no "+", no we, no lowercase i', (step) => {
    const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx).mount();
    if (step === 'offer') (host.querySelector('[data-action="start-guided"]') as HTMLButtonElement).click();
    if (step === 'manual') (host.querySelector('[data-action="start-manual"]') as HTMLButtonElement).click();
    const h1s = host.querySelectorAll('h1');
    expect(h1s.length).toBe(1);
    expect(host.querySelector('h2')).toBeNull();
    expect(h1s[0]!.textContent!.startsWith('+')).toBe(false);
    expect(h1s[0]!.textContent!).toMatch(/^[A-Z]/);
    expect(host.textContent!).not.toMatch(/\bwe\b|\bwe'll\b|\bus\b/i);
    expect(host.textContent!).not.toMatch(/\bi\b/); // case-sensitive
  });

  it('the intro offers a way back out of the flow', () => {
    const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx).mount();
    (host.querySelector('[data-action="to-hero"]') as HTMLButtonElement).click();
    expect(ctx.nav).toEqual(['hero']);
  });
});
```

- [ ] **Step 6: Run the setup test to verify it fails**

Run: `npx vitest run tests/ui/setup.test.ts -t 'start-guided asks for the game pair first'`
Expected: FAIL with `TypeError: createSweepView is not a function` (the old orchestrator
destructures `createSweepView` from the injected deps, which the new fixture no longer supplies,
and clicking start-guided routes the OLD reducer to its 'sweep' step, which mounts it)

- [ ] **Step 7: Add the draft fields, then rewrite the orchestrator**

In `src/ui/shell.ts`, add three type imports alongside the existing type imports at the top:

```ts
import type { TurnEstimate } from '../anchor/reference-turn';
import type { Convention } from '../input/lattice';
import type { KPin } from '../input/count-convention';
```

And inside `export interface SessionDraft { ... }`, after the `bounds` field:

```ts
  /** The blind reference turn behind the current bounds, when the guided path ran. Phase 4's
   *  reconciliation reads its self-measured spread as the turn's weight; the typed fallback and
   *  the saved-prefs fast path clear it so a replaced run never haunts the reconcile (pinned in
   *  tests/ui/setup.test.ts). */
  turn?: TurnEstimate;
  /** What the delta stream said about the count convention during the turn; null when the
   *  acceleration gate kept the estimator from running at all. Kept beside the pin so the result
   *  screen can say WHY k is unpinned in the ran-and-refused case. */
  convention?: Convention | null;
  /** The count convention pin for THIS run, computed at the guided commit
   *  (src/ui/setup.ts commitGuided). Never persisted: rememberPrefs writes only game, sens, goal
   *  and bounds, because a pin is measured against one turn on one browser, and reusing last
   *  week's pin on a new browser is exactly the silent unit error the pin exists to prevent.
   *  Absent (a deep-linked draft that never passed setup) reads as unpinned. */
  kPin?: KPin;
```

Nothing else in `shell.ts` changes: `rememberPrefs` already persists only the `PersistedPrefs`
fields, which is the non-persistence guarantee the comment above relies on.

Then replace the entire contents of `src/ui/setup.ts` with:

```ts
// Guided calibration orchestrator. Pure step machine (calibrate-flow) under a thin shell that
// mounts the blind turn view and writes the session draft. The guided path is the offer (name
// your game and sensitivity, or skip), then the turn, then the spread report, then the commit,
// which is the single place k is pinned: the typed pair needs the arena's own count for the SAME
// turn, so the offer rides alongside the turn and never replaces it. Nothing here carries a
// physical unit: the card, the DPI field and the cm vocabulary left with the sweep (spec
// 2026-07-25, "deleting the measurement, not replacing the card").
import { rememberPrefs, type AppContext, type Screen } from './shell';
import type { GameId } from '../types';
import { GAME_YAW, yawFor } from '../convert/yaw-table';
import { countsForSens } from '../convert/counts';
import { boundsFromSeed } from './options/settings';
import { pinConvention, type TypedSensRoute } from '../input/count-convention';
import type { Convention } from '../input/lattice';
import { calibrateReducer, initialCalState, type CalState } from './calibrate-flow';
import { createTurnView, type TurnView } from './calibrate/turn-view';
import type { TurnEstimate } from '../anchor/reference-turn';

/** Thin-shell injection seam (mirrors sessionView's SessionViewDeps): production mounts the real
 *  pointer-locked turn view, but a jsdom test can swap in a fake to drive the onTurn to
 *  commitGuided chain without a pointer lock. */
export interface SetupDeps { createTurnView: typeof createTurnView; }
const DEFAULT_SETUP_DEPS: SetupDeps = { createTurnView };

export function setup(host: HTMLElement, ctx: AppContext, deps: SetupDeps = DEFAULT_SETUP_DEPS): Screen {
  const { createTurnView } = deps;
  let state: CalState = initialCalState();
  let view: TurnView | null = null;
  /** The turn awaiting the player's continue on the spread report. Outside the reducer on
   *  purpose: the reducer carries no measurement state. */
  let pending: { estimate: TurnEstimate; convention: Convention | null } | null = null;
  /** The measured spread behind a 'spread' block, for the blocked screen to name. */
  let blockedSpread: number | null = null;

  function dispatch(a: Parameters<typeof calibrateReducer>[1]): void {
    state = calibrateReducer(state, a);
    render();
  }

  function teardownView(): void { view?.dispose(); view = null; }

  function gameOptions(sel: GameId): string {
    return GAME_YAW.map((g) => `<option value="${g.id}"${g.id === sel ? ' selected' : ''}>${g.label}</option>`).join('');
  }

  /** The OFFER's picker, which starts on no answer at all, unlike the typed fallback's, which
   *  defaults to the draft. The difference is the whole point. The spin dial was deleted because it
   *  prefilled a number and then measured the number it had prefilled; a prefilled game beside a
   *  prefilled sensitivity is the same defect in new clothes, because k is pinned from that pair
   *  and a player who clicks past the offer would pin it against whatever `defaultDraft()` happened
   *  to hold ('cs2' and 1), wrong by the ratio of two yaws with nothing on the screen to show it.
   *  Empty is the only value that can mean "no answer", which is why a remembered `currentSens`
   *  never prefills this either: storage cannot say whether that number was typed or defaulted.
   *  Pinned by 'starts on no answer at all, so an ignored offer cannot be read as one'. */
  function offerGameOptions(): string {
    const opts = GAME_YAW.map((g) => `<option value="${g.id}">${g.label}</option>`).join('');
    return `<option value="" selected>Pick your game</option>${opts}`;
  }

  /** The guided commit, and the ONLY place k is pinned. The typed route needs both halves: the
   *  exact counts the player's own setting implies (the offer pair) and the arena's count for the
   *  same turn (the estimate). That is why the offer is collected alongside the turn rather than
   *  instead of it: skipping it costs the absolute numbers and never the ratio. */
  function commitGuided(estimate: TurnEstimate, convention: Convention | null): void {
    ctx.draft.turn = estimate; // phase 4's reconciliation reads the turn's own spread as its weight
    ctx.draft.convention = convention;
    const offered = state.offerAccepted && Number.isFinite(ctx.draft.currentSens) && ctx.draft.currentSens > 0;
    const typed: TypedSensRoute | null = offered
      ? { game: ctx.draft.currentGame, sens: ctx.draft.currentSens, arenaCounts: estimate.counts, anchorLogSd: estimate.logSd }
      : null;
    ctx.draft.kPin = pinConvention(convention, typed);
    ctx.draft.profile = { ...ctx.draft.profile, speedAccuracy: 0.5 }; // balanced default; tune later on options
    ctx.draft.bounds = boundsFromSeed(estimate.counts);
    // rememberPrefs persists game, sens, goal and bounds only. The pin, the turn and the
    // convention stay off disk on purpose: each is measured against one turn on one browser, and
    // reusing last week's pin on a new browser is the silent unit error the pin exists to prevent.
    rememberPrefs(ctx);
    ctx.navigate('session');
  }

  /** True when a stored bounds pair can seed the search. Guards the remembered fast path: a
   *  malformed pair would hand the optimizer an empty or inverted window on every later visit. */
  function usableBounds(b: readonly [number, number]): boolean {
    return Number.isFinite(b[0]) && Number.isFinite(b[1]) && b[0] > 0 && b[1] > b[0];
  }

  // The typed fallback: a genuine fallback, not a second pin route. Without a turn there is no
  // arena count to compare the pair against, so k stays honestly unpinned here (gate-closed: the
  // estimator never ran) and the typed numbers seed the search window only. Do not reintroduce a
  // DPI field here: the unit chain is deleted, not dormant.
  function commitManual(sens: number, game: GameId, goal: number): boolean {
    if (!(Number.isFinite(sens) && sens > 0)) return false;
    ctx.draft.currentSens = sens;
    ctx.draft.currentGame = game;
    ctx.draft.profile = { ...ctx.draft.profile, speedAccuracy: goal };
    ctx.draft.bounds = boundsFromSeed(countsForSens(sens, yawFor(game)));
    // A typed commit replaces any earlier guided run wholesale: the stale turn, its convention
    // and its pin are all cleared, because phase 4 must never weigh a turn the player chose to
    // type over (pinned in tests/ui/setup.test.ts).
    delete ctx.draft.turn;
    delete ctx.draft.convention;
    ctx.draft.kPin = pinConvention(null, null);
    rememberPrefs(ctx);
    ctx.navigate('session');
    return true;
  }

  function render(): void {
    teardownView();
    host.replaceChildren();

    if (state.step === 'turn') {
      view = createTurnView(host, {
        onTurn: (estimate, convention) => {
          pending = { estimate, convention };
          dispatch({ type: 'turn-complete' }); // the spread report comes BEFORE the commit
        },
        onBlocked: (reason, spreadPct) => {
          blockedSpread = spreadPct;
          dispatch({ type: 'turn-blocked', reason });
        },
        onManual: () => dispatch({ type: 'start-manual' }),
        onBack: () => dispatch({ type: 'back-to-intro' }),
      });
      return;
    }

    const root = document.createElement('section');
    root.className = 'screen screen--shell fade-in'; // every calibration screen is paper chrome
    root.innerHTML = stepHtml();
    host.appendChild(root);
    wire(root);
  }

  function stepHtml(): string {
    if (state.step === 'intro') {
      // A returning visitor's fast path: their calibration was measured once and remembered
      // (campeon.prefs.v1). Recalibrating stays one click away (a new mouse or pad invalidates the
      // old turn). Malformed stored bounds are not offered: recalibrating is the only honest
      // option then.
      const stored = ctx.storage.loadPrefs?.() ?? null;
      const remembered = stored !== null && usableBounds(stored.bounds) ? stored : null;
      const rememberedBlock = remembered
        ? `<div class="setup__remembered" data-remembered>
            <p class="setup__lead">You've calibrated before. Searching <span class="mono">${Math.round(remembered.bounds[0]).toLocaleString('en-US')}</span> to <span class="mono">${Math.round(remembered.bounds[1]).toLocaleString('en-US')}</span> counts per 360.</p>
            <button class="action action--primary" data-action="use-saved">Start from your saved calibration</button>
          </div>`
        : '';
      return `
      <div class="wrap stack setup__inner">
        <h1 class="display setup__title">Calibrate</h1>
        ${rememberedBlock}
        <p class="setup__lead">Nothing to measure or look up. Name your game if you like, then three blind turns read the turn distance your hands already know.</p>
        <ol class="cal-preview">
          <li><span class="cal-preview__n">1</span><span>The turn. Turn all the way around by feel, three times: right, left, right.</span></li>
        </ol>
        <button class="action ${remembered ? 'action--ghost' : 'action--primary'}" data-action="start-guided">${remembered ? 'Recalibrate' : 'Start the turn'}</button>
        <button class="action action--ghost" data-action="start-manual">I'll type my numbers instead</button>
        <p class="setup__lead setup__manual-note mono">Typed numbers are the starting point the search works out from.</p>
        <button class="action action--ghost" data-action="to-hero">Back</button>
      </div>`;
    }
    if (state.step === 'offer') return `
      <div class="wrap stack setup__inner">
        <h1 class="display setup__title">Name your game, if you like</h1>
        <p class="setup__lead">Your game and the sensitivity you have in it right now pin the absolute numbers, because that pair says exactly how far your hand travels for one turn. Both halves or neither: half a pair measures nothing. Skip it and you still get the change to make, just not the numbers to type.</p>
        <label class="field">Current game<select data-field="game">${offerGameOptions()}</select></label>
        <label class="field">In-game sensitivity<input class="mono" type="number" min="0.01" step="0.01" data-field="sens" value="" aria-describedby="setup-error"></label>
        <p class="field__error" id="setup-error" data-error role="alert"></p>
        <button class="action action--primary" data-action="offer-accept">Use these</button>
        <button class="action action--ghost" data-action="offer-skip">Skip, I don't know it</button>
        <p class="setup__lead setup__manual-note mono">Skipping costs the per-game table, not the result.</p>
        <button class="action action--ghost" data-action="back">Back</button>
      </div>`;
    if (state.step === 'turn-done' && pending !== null) {
      // 'done' always rests on exactly three kept passes: an agreeing trio keeps all three, a
      // rescued fourth drops the outlier back to three, and everything else blocks. So "your
      // three turns" is always the truth. The spread is the payoff of the blindness: no meter
      // told the hands where to stop, and they still landed this close.
      return `
      <div class="wrap stack setup__inner">
        <h1 class="display setup__title">Your turns agree</h1>
        <p class="gate__lead">Your three turns landed within <span class="mono" data-done="spread">${pending.estimate.spreadPct.toFixed(1)}</span> percent of each other. That agreement is the whole measurement: no meter told your hands where to stop.</p>
        <button class="action action--primary" data-action="turn-continue">Keep going</button>
        <button class="action action--ghost" data-action="redo-turn">Redo the turn</button>
      </div>`;
    }
    if (state.step === 'blocked') {
      const accel = state.blockReason === 'accel';
      return `
      <div class="wrap stack gate__inner">
        ${accel
          ? `<h1 class="display setup__title">Mouse acceleration is on</h1>
             <p class="gate__lead">Your mouse speeds up the faster you move, which makes one true turn distance impossible to pin down.</p>
             <p>Turn off "enhance pointer precision" (Windows) or your mouse driver's acceleration, then try again.</p>`
          : `<h1 class="display setup__title">Those turns never settled</h1>
             <p class="gate__lead">${blockedSpread !== null
               ? `Even with a fourth pass, your turns landed <span class="mono" data-blocked="spread">${blockedSpread.toFixed(1)}</span> percent apart, too far for one honest number.`
               : 'Even with a fourth pass, your turns landed too far apart for one honest number.'}</p>
             <p>A steadier ritual helps: same start posture, a full circle each time, the same finishing click. Or type your numbers below.</p>`}
        <button class="action action--primary" data-action="retry">Try again</button>
        <button class="action action--ghost" data-action="manual">I'll type my numbers instead</button>
        <p class="setup__lead setup__manual-note mono">Typed numbers are the starting point the search works out from.</p>
        <button class="action action--ghost" data-action="back">Back</button>
      </div>`;
    }
    if (state.step === 'manual') return `
      <div class="wrap stack setup__inner">
        <h1 class="display setup__title">Your numbers</h1>
        <label class="field">Current game<select data-field="game">${gameOptions(ctx.draft.currentGame)}</select></label>
        <label class="field">In-game sensitivity<input class="mono" type="number" min="0.01" step="0.01" data-field="sens" value="${ctx.draft.currentSens}" aria-describedby="setup-error"></label>
        <label class="field">Goal, precision to speed<input type="range" min="0" max="1" step="0.01" data-field="goal" value="${ctx.draft.profile.speedAccuracy}"></label>
        <p class="field__error" id="setup-error" data-error role="alert"></p>
        <button class="action action--primary" data-action="manual-begin">Begin</button>
        <button class="action action--ghost" data-action="back">Back</button>
      </div>`;
    // 'turn' returns early in render(). 'turn-done' with no pending estimate is unreachable:
    // only onTurn dispatches turn-complete, and it sets pending first.
    return '';
  }

  function wire(root: HTMLElement): void {
    const click = (sel: string, fn: () => void): void => root.querySelector(`[data-action="${sel}"]`)?.addEventListener('click', fn);
    const val = (sel: string): string => (root.querySelector(`[data-field="${sel}"]`) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';
    click('start-guided', () => dispatch({ type: 'start-guided' }));
    click('use-saved', () => {
      // Re-apply the remembered prefs to the draft (the shell already merged them at boot, but a
      // mid-session edit may have drifted the draft) and go straight to the hunt.
      const p = ctx.storage.loadPrefs?.();
      if (!p || !usableBounds(p.bounds)) return; // a poisoned pref never reaches the arena
      ctx.draft.currentGame = p.currentGame;
      ctx.draft.currentSens = p.currentSens;
      ctx.draft.profile = { ...ctx.draft.profile, speedAccuracy: p.speedAccuracy };
      ctx.draft.bounds = p.bounds;
      // The stored prefs carry no turn record and never a pin (see SessionDraft.kPin): stale
      // measurement state from an earlier run on this visit must not ride along either.
      delete ctx.draft.turn;
      delete ctx.draft.convention;
      ctx.draft.kPin = pinConvention(null, null);
      ctx.navigate('session');
    });
    click('start-manual', () => dispatch({ type: 'start-manual' }));
    click('offer-skip', () => dispatch({ type: 'offer-skipped' }));
    click('turn-continue', () => { if (pending !== null) commitGuided(pending.estimate, pending.convention); });
    click('redo-turn', () => { pending = null; dispatch({ type: 'retry' }); });
    click('retry', () => { blockedSpread = null; dispatch({ type: 'retry' }); });
    click('manual', () => dispatch({ type: 'start-manual' }));
    click('back', () => dispatch({ type: 'back-to-intro' }));
    click('to-hero', () => ctx.navigate('hero'));
    wireOfferValidation(root, val);
    wireManualValidation(root, val);
  }

  /** The offer validates at the boundary, exactly as the typed fallback does: the accept button
   *  stays focusable and clickable when the answer is wrong (a disabled control explains
   *  nothing). Pressing it names the problem in a role="alert" and refuses to advance.
   *
   *  Both halves are required, and refusing half an offer is the load-bearing part. k is
   *  arenaCounts / countsForSens(sens, yawFor(game)), so a sensitivity without its game is not a
   *  measurement of anything: pairing it with a defaulted game would pin k wrong by the ratio of
   *  two yaws, and pairing a game with a defaulted sensitivity would pin it wrong by the ratio of
   *  two sensitivities. Skipping is always available and costs only the per-game table, so there
   *  is no honest reason to accept half a pair. */
  function wireOfferValidation(root: HTMLElement, val: (sel: string) => string): void {
    const accept = root.querySelector('[data-action="offer-accept"]') as HTMLButtonElement | null;
    const errEl = root.querySelector('[data-error]') as HTMLElement | null;
    if (!accept || !errEl) return;
    let attempted = false;

    const problem = (): string | null => {
      const game = val('game');
      const raw = val('sens').trim();
      if (game === '') return 'Pick the game that sensitivity is from, or skip this step.';
      if (raw === '') return 'Type the sensitivity you have in that game, or skip this step.';
      const sens = Number(raw);
      return Number.isFinite(sens) && sens > 0 ? null : 'In-game sensitivity needs to be a number above zero.';
    };
    const show = (msg: string | null): void => {
      errEl.textContent = msg ?? '';
      accept.setAttribute('aria-disabled', msg ? 'true' : 'false');
      root.querySelector('[data-field="sens"]')?.setAttribute('aria-invalid', msg ? 'true' : 'false');
    };
    root.querySelector('[data-field="sens"]')?.addEventListener('input', () => { if (attempted) show(problem()); });
    root.querySelector('[data-field="game"]')?.addEventListener('change', () => { if (attempted) show(problem()); });
    accept.addEventListener('click', () => {
      attempted = true;
      const msg = problem();
      show(msg);
      if (msg !== null) { (root.querySelector('[data-field="sens"]') as HTMLElement | null)?.focus(); return; }
      // The offer only records the pair. k is measured against the arena's own count, which does
      // not exist until the turn passes are in, so the pin happens at the commit and not here.
      ctx.draft.currentGame = val('game') as GameId;
      ctx.draft.currentSens = Number(val('sens'));
      dispatch({ type: 'offer-accepted' });
    });
  }

  /** The typed fallback validates at the boundary, same contract as the offer above. Once a first
   *  attempt has failed, typing corrects the message live, so the fix is confirmed as it is made. */
  function wireManualValidation(root: HTMLElement, val: (sel: string) => string): void {
    const begin = root.querySelector('[data-action="manual-begin"]') as HTMLButtonElement | null;
    const errEl = root.querySelector('[data-error]') as HTMLElement | null;
    if (!begin || !errEl) return;
    let attempted = false;

    const problem = (): string | null => {
      const sens = Number(val('sens'));
      return Number.isFinite(sens) && sens > 0 ? null : 'In-game sensitivity needs to be a number above zero.';
    };
    const show = (msg: string | null): void => {
      errEl.textContent = msg ?? '';
      begin.setAttribute('aria-disabled', msg ? 'true' : 'false');
      root.querySelector('[data-field="sens"]')?.setAttribute('aria-invalid', msg ? 'true' : 'false');
    };
    root.querySelector('[data-field="sens"]')?.addEventListener('input', () => { if (attempted) show(problem()); });
    begin.addEventListener('click', () => {
      attempted = true;
      const msg = problem();
      show(msg);
      if (msg !== null) { (root.querySelector('[data-field="sens"]') as HTMLElement | null)?.focus(); return; }
      commitManual(Number(val('sens')), val('game') as GameId, Number(val('goal')));
    });
  }

  return {
    mount() { render(); },
    unmount() { teardownView(); host.replaceChildren(); },
  };
}
```

Note what is gone on purpose: `calibrationProgress` (a two-segment tracker makes no sense over one
measured step), the `matchMedia` reduced-motion read (the turn view draws nothing that moves), and
every import from `input/dpi`, `input/dpi-sweep`, `convert/cm360` and the two old views.

- [ ] **Step 8: Run the full suite and the build**

Run: `npx vitest run`
Expected: PASS, zero failures (`tests/ui/calibrate-flow.test.ts` 8, `tests/ui/setup.test.ts` 30, of
which 16 are in the guided-flow describe, 6 in the typed fallback with `it.each` expanded, 4 in
remembered calibration and 4 in voice; the old `tests/ui/calibrate-views.test.ts` still passes
because the old views are untouched until task 19).
Run: `npm run build`
Expected: PASS (tsc clean; the old views still compile because their own imports are intact)

- [ ] **Step 9: Commit**

```bash
git add src/ui/calibrate-flow.ts src/ui/setup.ts src/ui/shell.ts tests/ui/calibrate-flow.test.ts tests/ui/setup.test.ts
git commit -m "feat(setup): the offer rides alongside the turn, and the commit is the one pin site for k" -m "The game/sensitivity pair is collected as an offer on the way into the turn, because the typed route to k needs both the pair and the arena's count for the same turn; skipping costs the absolute numbers and never the ratio. The offer opens with both halves empty and refuses half a pair by name: a prefilled pair a player clicks past would pin k off numbers nobody typed, which is the anchoring defect the spin dial was deleted for. The spread report screen shows the agreed case its number before anything commits. The reducer still carries no measurement state, and the pin is never persisted."
```

### Task 19: delete the sweep and the spin

**Files:**
- Delete: `src/ui/calibrate/sweep-view.ts`
- Delete: `src/ui/calibrate/spin-view.ts`
- Delete: `src/input/dpi-sweep.ts`
- Delete: `tests/ui/calibrate-views.test.ts`
- Delete: `tests/input/dpi-sweep.test.ts`

This removes `CARD_WIDTH_CM`, `dpiFromSweep`, `dpiFromPasses`, `SweepAccumulator`,
`SpinSeedAccumulator`, `isPlausibleSweepDpi` and both view shells. `spin-view.ts` is deleted
rather than edited because the dial is the defect. Note `src/input/dpi.ts`, `src/convert/cm360.ts`
and `src/convert/turn-rate.ts` are NOT deleted here: they are phase 1a's files, and phase 1a's
quarantine step already freed its deletions from these views (see hand-offs), so this task's only
job is removing the views and the file-local aliases quarantined inside them.

- [ ] **Step 1: Verify the remaining importers are exactly the files being deleted**

Run: `grep -rn "spin-view\|sweep-view\|dpi-sweep" src tests --include="*.ts"`
Expected: matches only inside `src/ui/calibrate/sweep-view.ts`, `src/ui/calibrate/spin-view.ts`,
`src/input/dpi-sweep.ts`, `tests/ui/calibrate-views.test.ts` and `tests/input/dpi-sweep.test.ts`
(self-references and cross-references within the deleted set). If any other file matches, stop:
task 18 was not completed.

- [ ] **Step 2: Delete the files**

```bash
git rm src/ui/calibrate/sweep-view.ts src/ui/calibrate/spin-view.ts src/input/dpi-sweep.ts tests/ui/calibrate-views.test.ts tests/input/dpi-sweep.test.ts
```

- [ ] **Step 3: Run the retired-token gate, the full suite and the build**

Run: `grep -rn "[Cc][Mm]360" src tests --include="*.ts"`
Expected: no matches. Phase 1a's rename and deletions landed before this phase, so any hit here is
a token REINTRODUCED by phase 2's new files, which is exactly what this gate exists to catch.
Run: `npx vitest run`
Expected: PASS (the deleted test files simply no longer run)
Run: `npm run build`
Expected: PASS (nothing imports the deleted modules any more)

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(calibrate): delete the sweep and the spin, and the card leaves the codebase" -m "The spin dial computed itself from a fixed provisional turn distance and measured its own constant; the sweep existed to feed it a DPI that cancels out of every reported number. Replaced by the blind turn."
```

### Task 20: delete accelTolForWidth

**Files:**
- Modify: `src/input/accel-check.ts`
- Test: `tests/input/accel-check.test.ts`

The tolerance widener existed because an 8.56 cm card made edge-alignment slop a large fraction of
the sweep. A full turn is three to six times longer, so the `accelVerdict` default of 10 percent
holds without apology. Deletion only; `accelVerdict`, `accumulateMagnitude` and `AccelMeter` stay
(the turn machine and `src/dev/arena-harness.ts` use them).

- [ ] **Step 1: Remove the widener's tests**

In `tests/input/accel-check.test.ts`, replace the import line:

```ts
import { accumulateMagnitude, accelVerdict, accelTolForWidth, AccelMeter } from '../../src/input/accel-check';
```

with:

```ts
import { accumulateMagnitude, accelVerdict, AccelMeter } from '../../src/input/accel-check';
```

and delete the entire `describe('accelTolForWidth', ...)` block (the three tests asserting the
long-reference tolerance, the card loosening, and the clamp band).

- [ ] **Step 2: Run the file to verify it still passes**

Run: `npx vitest run tests/input/accel-check.test.ts`
Expected: PASS, `Tests  6 passed (6)` (the file held 9; the widener's three are gone)

- [ ] **Step 3: Remove the function**

In `src/input/accel-check.ts`, delete the whole block, jsdoc and all:

```ts
/**
 * Acceleration cross-check tolerance scaled to the sweep reference width (cm). The 10% default was
 * tuned for a ~40cm mousepad; on a short reference (the 8.56cm ID-1 card) the same physical
 * edge-alignment slop is a far larger FRACTION of the sweep, so a fixed 10% false-positives on
 * honest runs. We scale inversely with width (narrower reference -> looser tolerance), clamped to a
 * sane band. A short card is inherently a weak two-pass cross-check, so this is a best-effort guard
 * for os-adjusted browsers only - the primary acceleration defense is raw pointer input, which
 * bypasses OS acceleration at the source (and where the sweep view skips this check entirely).
 */
export function accelTolForWidth(referenceWidthCm: number): number {
  if (!(referenceWidthCm > 0)) return 0.1;
  return Math.min(0.25, Math.max(0.1, 2.0 / referenceWidthCm));
}
```

- [ ] **Step 4: Verify nothing still references it, then run the suite and build**

Run: `grep -rn "accelTolForWidth" src tests --include="*.ts"`
Expected: no matches
Run: `npx vitest run`
Expected: PASS
Run: `npm run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/input/accel-check.ts tests/input/accel-check.test.ts
git commit -m "feat(input): delete accelTolForWidth, a full turn needs no apology" -m "The widener compensated for the 8.56 cm card. The turn's accel pass covers three to six times that distance, so the accelVerdict default 10 percent is tight and honest."
```

### Hand-offs to other phases

- **From phase 1a (accepted, sequencing):** phase 2 runs after phase 1a completes. Phase 1a's
  quarantine step (its task 4 step 10) already reduced its `setup.ts` edit to the minimum that
  compiles and moved the doomed imports onto file-local aliases inside the old views, so phase
  1a's deletion tasks need NO reordering around phase 2: task 19 removes the quarantined aliases
  together with the files that hold them. Phase 2 assumes phase 1a's reworked
  `boundsFromSeed(seed: Counts360, factor?: number): [Counts360, Counts360]` keeps its name and
  shape in `src/ui/options/settings.ts`, that `counts360` is exported from `src/types.ts` per the
  contract, and that `normalizeByDpr` is gone from `flattenCoalesced` (task 17's lattice tap reads
  raw deltas; a DPR-divided stream would report the DPR itself as k).
- **From phase 3 (accepted, sequencing):** phase 3's H1 and H2 are VERIFICATION NOTES with nothing
  to apply, because amendment A1 gives `turn-view.ts`, `setup.ts`, `calibrate-flow.ts` and
  `shell.ts` to phase 2, and tasks 17 and 18 author both seams in full. Do not paste anything from
  H1 or H2 on top of them. Phase 3 keeps sole ownership of `src/input/lattice.ts` and
  `src/input/count-convention.ts`; phase 2 only imports `conventionFromGated`, `Convention`,
  `LatticeGate`, `pinConvention`, `TypedSensRoute` and `KPin` from them. Phase 3 tasks 23 to 25 must
  land before phase 2 task 17, and task 26 before task 18. The properties H1 asks a reviewer to
  check are honored in task 17: the tap is raw and unfiltered, it never touches `s.t`, and the gate
  is read before the lock is released so a nulled mode cannot report gate-closed on every session.
  The property H2 asks about is honored in task 18: the offer opens with both halves empty and
  refuses half a pair by name.
- **To phase 1b:** after task 19, `.cal-progress`, `.cal-pace`, `.cal-pace__fill`,
  `.cal-pace__label` and `.calibrate__readouts` in `src/styles/calibrate.css` have no remaining
  users; prune when you next touch the stylesheet. The case-study rewrite onto counts (including
  its sweep/spin narration) is yours by the explicit task finding F18 assigns to phase 1b.
- **To phase 4 (the turn's weight, load-bearing):** the turn estimate reaches you as
  `ctx.draft.turn` (a `TurnEstimate`), written by the guided commit and cleared by the typed
  fallback and the saved-prefs fast path. Its `logSd` is already regularized ONE-SIDED:
  `max(sampleStd, (sampleStd + TURN_PRIOR_LOG_SD) / 2)`, so it is never below half the prior and
  never below the measured spread. Use it as the turn's weight directly. Your reconcile's
  `Math.max(TURN_PRIOR_LOG_SD, turn.logSd)` floor must be DROPPED, along with the tests built on
  it (finding F14): flooring at the full prior overrides the self-measured weight for every
  agreed session and puts the one unmeasured parameter back on the critical path, which is the
  opposite of what the spec claims for the turn. If you keep any guard, it may only reject
  non-finite or negative values, never lift them.
- **To phase 4 (the pin and the clock test):** `ctx.draft.kPin` (a `KPin`) and
  `ctx.draft.convention` are on the draft for your wiring task; `kPin` may be `undefined` on a
  deep-linked draft that never passed setup, and `undefined` reads as unpinned. On the
  clock-offset test (finding F17): `tests/anchor/clock-stamp.test.ts`'s extension belongs with
  your reach observer, whose exact-equality frame lookup is the case the test protects.
  `turnFromPasses` consumes only pass magnitudes, no timestamps, and the turn view's only clock
  use is `ev.timeStamp - downAt`, a difference that is offset-invariant by construction; include
  `turnFromPasses` in your invariance run if you like, but it is vacuous there and must not be
  counted as the coverage the spec asks for.


### Task 23: The characteristic-function kernel

The modulus of the mean of `exp(2*pi*i*x/L)` over the observed absolute deltas is exactly one when
every delta is an integer multiple of `L`. So the largest `L` with a near-unit modulus is the lattice
spacing, and the lattice spacing is the count convention `k`. This task builds only the kernel: the
modulus, the candidate set, and the search. `conventionFrom` and its one-sided contract are task 24.

Nothing in this task depends on phase 1 or phase 2. `PointerLockMode` already exists in
`src/types.ts` and is untouched by the unit change.

**Files:**
- Create: `src/input/lattice.ts`
- Test: `tests/input/lattice.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../../src/stats/rng';
import {
  latticeModulus,
  spacingCandidates,
  latticeSpacing,
  LATTICE_PURITY_MIN,
  CONVENTION_K_MIN,
  CONVENTION_K_MAX,
} from '../../src/input/lattice';

/** One synthetic hand motion as REAL integer mouse counts: mixed signs, small magnitudes common,
 *  which is the shape a 1000 Hz sample stream actually has. `maxMag` is the largest single-event
 *  jump. Every fixture below is built from this, so a browser scaling is applied ON TOP of a stream
 *  that is honestly integral, which is the only way the collapse cases in task 24 mean anything. */
function handCounts(n: number, rng: () => number, maxMag = 18): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const mag = 1 + Math.floor(Math.pow(rng(), 1.6) * maxMag);
    out.push(rng() < 0.5 ? -mag : mag);
  }
  return out;
}

const scaledBy = (xs: readonly number[], k: number): number[] => xs.map((x) => x * k);
const absOf = (xs: readonly number[]): number[] => xs.map((x) => Math.abs(x));

describe('lattice kernel', () => {
  it('modulus is one on an exact lattice and far off it otherwise', () => {
    expect(latticeModulus([2, 4, 6, 8, 10, 12], 2)).toBeCloseTo(1, 12);
    // A stream on the 0.5 lattice scored at spacing 1: the half-integer deltas land at phase pi and
    // cancel the integer ones, so the modulus collapses to the parity imbalance (measured 0.200).
    const half = absOf(scaledBy(handCounts(120, mulberry32(0x5eed)), 0.5));
    expect(latticeModulus(half, 0.5)).toBeCloseTo(1, 12);
    expect(latticeModulus(half, 1)).toBeLessThan(0.25);
  });

  it('returns zero rather than NaN for a degenerate spacing or an empty stream', () => {
    // A caller that forgets to guard must get a refusal, never a plausible number.
    expect(latticeModulus([1, 2, 3], 0)).toBe(0);
    expect(latticeModulus([1, 2, 3], -1)).toBe(0);
    expect(latticeModulus([], 1)).toBe(0);
  });

  it('candidates divide the smallest observed deltas, largest first', () => {
    const cands = spacingCandidates(absOf(scaledBy(handCounts(120, mulberry32(0x1234)), 1.25)));
    expect(cands.length).toBeGreaterThan(0);
    for (let i = 1; i < cands.length; i++) expect(cands[i]!).toBeLessThan(cands[i - 1]!);
    expect(cands.some((c) => Math.abs(c - 1.25) < 1e-12)).toBe(true);
    for (const c of cands) {
      expect(c).toBeGreaterThanOrEqual(CONVENTION_K_MIN);
      expect(c).toBeLessThanOrEqual(CONVENTION_K_MAX);
    }
  });

  it('never scores a candidate below the plausible-convention floor', () => {
    // A spacing of 0.05 would mean twenty browser deltas per mouse count, which is not a coordinate
    // convention. Scoring it at all invites a pure-but-absurd k that rescales the per-game table by
    // an order of magnitude, so it is excluded from the candidate set rather than filtered later.
    const cands = spacingCandidates([0.05, 0.1, 0.15, 0.2, 0.25, 0.3]);
    for (const c of cands) expect(c).toBeGreaterThanOrEqual(CONVENTION_K_MIN);
    expect(cands.some((c) => Math.abs(c - 0.05) < 1e-12)).toBe(false);
    expect(cands.some((c) => Math.abs(c - 0.1) < 1e-12)).toBe(false);
  });

  it('takes the LARGEST pure spacing, because every sub-harmonic scores one too', () => {
    const stream = absOf(scaledBy(handCounts(120, mulberry32(0x5eed)), 1.5));
    // 0.75 divides every delta as well, and scores a perfect one. Picking the first pure candidate
    // found in an ascending scan would therefore report k = 0.75 and halve the emitted sensitivity.
    expect(latticeModulus(stream, 0.75)).toBeCloseTo(1, 12);
    const fit = latticeSpacing(stream);
    expect(fit.spacing).toBeCloseTo(1.5, 12);
    expect(fit.purity).toBeCloseTo(1, 12);
  });

  it('refuses a near-constant drag, which is pure at every candidate at once', () => {
    // The count of distinct quantum indices is bounded by the count of distinct deltas whatever L
    // is, so a stream with one delta value carries no information about which candidate is
    // fundamental. Purity zero, not purity one: there is no evidence here, not perfect evidence.
    const fit = latticeSpacing(new Array(120).fill(4));
    expect(fit.spacing).toBeNull();
    expect(fit.purity).toBe(0);
  });

  it('reports the best modulus it reached when nothing is pure', () => {
    const rng = mulberry32(0xf00d);
    const noisy = handCounts(120, rng, 18).map((x) => x + (rng() - 0.5) * 0.6);
    const fit = latticeSpacing(absOf(noisy));
    expect(fit.spacing).toBeNull();
    // Measured 0.216 for this fixture, 0.13 to 0.58 across 200 seeds: an off-lattice stream is
    // nowhere near the floor, which is what earns the floor the right to be as low as 0.98.
    expect(fit.purity).toBeGreaterThan(0.1);
    expect(fit.purity).toBeLessThan(LATTICE_PURITY_MIN);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/input/lattice.test.ts`

Expected: FAIL, `tests/input/lattice.test.ts (0 test)`, with

```
Error: Failed to load url ../../src/input/lattice (resolved id: ../../src/input/lattice) in /<repo>/tests/input/lattice.test.ts. Does the file exist?
```

and the summary lines `Test Files  1 failed (1)` and `Tests  no tests`. (Verified by running a
missing-module import in this repo under vitest 2.1.9: the resolved id echoes the relative
specifier, it is not an absolute path.)

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/input/lattice.ts
// The count convention k: how many browser movement deltas one real mouse count arrives as. k does
// NOT cancel out of the sensitivity we tell a player to type (unlike DPI, which cancels everywhere),
// so it is measured or withheld, never assumed.
//
// The estimator is a characteristic function over the observed absolute deltas. For a candidate
// spacing L the modulus of mean(exp(2*pi*i*x/L)) is exactly one when every delta is an integer
// multiple of L and falls off fast otherwise, so the largest L with a near-unit modulus is the
// lattice spacing and therefore k. Over 200 simulated sweeps per case it recovers k of 0.5, 1/3,
// 1.25, 1.5, 2 and 3 at 100 percent, where the integer gcd it replaces refused the fractional ones
// (pinned by 'recovers a non-unit lattice spacing over 200 sweeps per case').

/** Deltas at or below this are no motion at all. Zero is an integer multiple of EVERY spacing, so
 *  counting it lifts every candidate's modulus equally and buys no discrimination at all. */
const ZERO_DELTA_EPS = 1e-9;

/**
 * Modulus a candidate must reach to be called a lattice. Not 1.0: a single corrupt delta in a
 * 120-sample stream costs about 1.1 points of modulus (measured 0.9893 in 'tolerates one off-lattice
 * delta'), and a stream that is genuinely off-lattice reaches only 0.13 to 0.58, so 0.98 separates
 * the two by a wide margin without demanding a perfection real input never has. The shortfall below
 * one is not free: `pinConvention` carries it as k's own spread, because a candidate that leaves two
 * percent of the phase unaccounted for is not an exact pin.
 */
export const LATTICE_PURITY_MIN = 0.98;

/**
 * The band a count convention can plausibly occupy. k is a coordinate convention: raw integers (1),
 * a device-pixel-ratio scaling (0.5 to 3 in practice), or an OS scale factor. A spacing outside this
 * band is not a convention, it is a broken stream, and emitting it would rescale the entire per-game
 * table by an order of magnitude. Out-of-band candidates are therefore never scored at all, so the
 * estimator refuses instead of reporting a pure-but-absurd k (pinned by 'never scores a candidate
 * below the plausible-convention floor').
 */
export const CONVENTION_K_MIN = 0.125;
export const CONVENTION_K_MAX = 8;

/** How many multiples of the fundamental the smallest observed delta may be. A stream whose
 *  smallest event moved 12k and never once moved fewer counts is beyond this estimator; 12 covers
 *  every stream simulated. */
const MAX_FUNDAMENTAL_INDEX = 12;

/** How many of the smallest distinct deltas seed the candidate set. One suffices when every delta is
 *  on the lattice; five gives redundancy so a single corrupt smallest delta cannot remove the
 *  fundamental from the candidate set entirely. */
const CANDIDATE_SEEDS = 5;

/** Distinct absolute deltas the stream must carry before a spacing means anything. See the
 *  near-constant-drag test: distinct quantum indices are bounded by distinct delta values whatever L
 *  is, so a flat stream is perfectly pure at every candidate simultaneously. */
const MIN_DISTINCT_DELTAS = 6;

/**
 * |mean of exp(2*pi*i*x/spacing)| over `absDeltas`. Exactly one when every delta is an integer
 * multiple of `spacing`. Returns 0 for a non-positive spacing or an empty stream rather than NaN, so
 * an unguarded caller gets a refusal and not a number that looks like a reading.
 */
export function latticeModulus(absDeltas: readonly number[], spacing: number): number {
  if (!(spacing > 0) || absDeltas.length === 0) return 0;
  const w = (2 * Math.PI) / spacing;
  let re = 0;
  let im = 0;
  for (const x of absDeltas) {
    const theta = w * x;
    re += Math.cos(theta);
    im += Math.sin(theta);
  }
  return Math.hypot(re, im) / absDeltas.length;
}

/** Ascending distinct absolute deltas, deduped at a relative 1e-9 so float noise in a scaled stream
 *  does not present one physical value as two. */
function distinctAscending(absDeltas: readonly number[]): number[] {
  const out: number[] = [];
  for (const x of [...absDeltas].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last === undefined || x - last > 1e-9 * Math.max(1, x)) out.push(x);
  }
  return out;
}

/**
 * Candidate spacings, largest first. The fundamental divides every delta, so it divides the smallest
 * one: the candidates are `seed / n`, an exact finite set that needs no grid.
 *
 * A grid was the first attempt and it fails in both directions. The modulus at L = 1.251 has already
 * dropped to roughly 0.99 for deltas up to 50, so a grid fine enough to land on the peak is enormous
 * while a coarse one cannot resolve 1.25 from 1.2 at all. Capping the set at the smallest delta also
 * makes the classic spurious-large-L artifact impossible: an L far above the data puts every phase
 * near zero and reads as a perfect lattice.
 */
export function spacingCandidates(absDeltas: readonly number[]): number[] {
  const seeds = distinctAscending(absDeltas).slice(0, CANDIDATE_SEEDS);
  const out: number[] = [];
  for (const seed of seeds) {
    for (let n = 1; n <= MAX_FUNDAMENTAL_INDEX; n++) {
      const c = seed / n;
      if (!(c >= CONVENTION_K_MIN) || c > CONVENTION_K_MAX) continue;
      if (!out.some((e) => Math.abs(e - c) <= 1e-9 * Math.max(1, c))) out.push(c);
    }
  }
  return out.sort((a, b) => b - a);
}

export interface LatticeFit {
  /** The largest in-band candidate that cleared `LATTICE_PURITY_MIN`, or null when none did. */
  spacing: number | null;
  /** The modulus AT `spacing`, or the best any candidate reached when none cleared. It says how
   *  completely the spacing divides the stream, and it is not a confidence claim about k on its own:
   *  `pinConvention` is the one place that turns its shortfall below one into k's spread. */
  purity: number;
}

/**
 * The largest spacing the stream is a lattice on. Largest, because multiples of L are also multiples
 * of L/2 and of L/3, so every sub-harmonic scores a perfect one and only the largest is the
 * fundamental. An ascending scan would return L/12 and shrink the emitted sensitivity twelvefold.
 */
export function latticeSpacing(absDeltas: readonly number[]): LatticeFit {
  if (distinctAscending(absDeltas).length < MIN_DISTINCT_DELTAS) return { spacing: null, purity: 0 };
  let best = 0;
  for (const c of spacingCandidates(absDeltas)) {
    const p = latticeModulus(absDeltas, c);
    if (p > best) best = p;
    if (p >= LATTICE_PURITY_MIN) return { spacing: c, purity: p };
  }
  return { spacing: null, purity: best };
}

/** Finite, non-zero absolute deltas: the only samples that carry lattice information. Exported
 *  because both `conventionFrom` and its gated wrapper must count the SAME survivors as the sample
 *  floor does, and a second copy of this filter would drift from the first. */
export function usableAbsDeltas(rawDeltas: readonly number[]): number[] {
  const out: number[] = [];
  for (const d of rawDeltas) {
    const a = Math.abs(d);
    if (Number.isFinite(a) && a > ZERO_DELTA_EPS) out.push(a);
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/input/lattice.test.ts`

Expected: PASS, `Tests  7 passed (7)` (seven `it` blocks in the one describe).

- [ ] **Step 5: Commit**

```bash
git add src/input/lattice.ts tests/input/lattice.test.ts
git commit -m "feat(lattice): characteristic-function kernel for the count convention

The modulus of the mean of exp(2*pi*i*x/L) is one exactly when every delta is a multiple of L, so
the largest pure L is the lattice spacing. Candidates are divisors of the smallest observed delta
rather than a grid, because the modulus peak is far too sharp for any grid a browser can afford, and
capping candidates at the smallest delta makes a spurious large-L read impossible."
```


### Task 24: `conventionFrom` and the one-sided contract

The estimator now gets its public face, and with it the rule that carries this whole phase: it may
report a scaled convention or it may refuse, and it may NEVER report `k = 1`. A stream that was
scaled by a FRACTION and then re-rounded to integers is a perfect unit lattice and no statistic on
the stream separates it from a genuinely unit one. The collapse tests in this task are mandatory,
and so is the test that records the case which does NOT collapse: pure integer scaling survives
rounding untouched and is read correctly, because multiplying integers by 2 leaves integers and the
rounding is a no-op. Both directions are load-bearing. A future reader who concludes that all
scaling collapses would delete an estimator that works on the commonest scaling there is.

**Files:**
- Modify: `src/input/lattice.ts` (append after `usableAbsDeltas`)
- Modify: `tests/input/lattice.test.ts` (append after the `lattice kernel` describe block)

- [ ] **Step 1: Write the failing test**

Add to the import block at the top of `tests/input/lattice.test.ts`:

```ts
import { conventionFrom, LATTICE_MIN_SAMPLES } from '../../src/input/lattice';
```

Add these helpers below the existing `scaledBy` / `absOf` helpers:

```ts
/** The browser re-rounds to integers after scaling. This is the step that destroys the evidence,
 *  and only when the scaling was fractional or nonlinear: at an integer factor it changes nothing. */
const reRounded = (xs: readonly number[]): number[] => xs.map((x) => Math.round(x));
const meanAbs = (xs: readonly number[]): number =>
  xs.reduce((a, b) => a + Math.abs(b), 0) / xs.length;
```

Append these two describe blocks:

```ts
describe('conventionFrom', () => {
  it('recovers a non-unit lattice spacing over 200 sweeps per case', () => {
    // 1/3 and 1.25 are the cases that motivated replacing the integer gcd: the gcd refused every
    // one of them, this recovers all of them exactly.
    for (const k of [0.5, 1 / 3, 1.25, 1.5, 2, 3]) {
      let scaledRuns = 0;
      for (let r = 0; r < 200; r++) {
        const c = conventionFrom(scaledBy(handCounts(120, mulberry32(0x5eed + r)), k));
        if (c.state !== 'scaled') continue;
        expect(c.k).toBeCloseTo(k, 10);
        expect(c.purity).toBeGreaterThanOrEqual(LATTICE_PURITY_MIN);
        scaledRuns++;
      }
      expect(scaledRuns).toBe(200);
    }
  });

  it('tolerates one off-lattice delta without losing the fundamental', () => {
    // Five candidate seeds exist for exactly this: one corrupt smallest delta must not be able to
    // take the fundamental out of the candidate set. Measured purity 0.9893, above the 0.98 floor.
    const dirty = scaledBy(handCounts(120, mulberry32(0x1234)), 1.25);
    dirty[0] = 0.37;
    const c = conventionFrom(dirty);
    expect(c.state).toBe('scaled');
    if (c.state === 'scaled') expect(c.k).toBeCloseTo(1.25, 10);
  });

  it('reads both axis components as one lattice', () => {
    // A browser that scales movementX scales movementY by the same factor, so dx and dy are samples
    // of ONE lattice and the caller may interleave them. That doubles the sample count for free.
    const source = handCounts(120, mulberry32(0x2222));
    const interleaved: number[] = [];
    for (const v of source) interleaved.push(v * 1.5, Math.round(v * 0.4) * 1.5);
    const c = conventionFrom(interleaved);
    expect(c.state).toBe('scaled');
    if (c.state === 'scaled') expect(c.k).toBeCloseTo(1.5, 10);
  });

  it('refuses below the sample floor rather than reading a short stream', () => {
    const sixty = scaledBy(handCounts(60, mulberry32(0x777)), 0.5);
    expect(conventionFrom(sixty).state).toBe('scaled');
    const short = conventionFrom(sixty.slice(0, LATTICE_MIN_SAMPLES - 1));
    expect(short).toEqual({ state: 'indeterminate', reason: 'too-few-samples', purity: 0 });
  });

  it('does not let zeros or non-finite deltas count toward the sample floor', () => {
    // A zero is a multiple of every spacing, so padding the floor with zeros would let a 59-sample
    // stream pass a 60-sample gate on samples that carry no information whatsoever.
    const short = scaledBy(handCounts(60, mulberry32(0x777)), 0.5).slice(0, 59);
    expect(conventionFrom([...short, 0, 0, 0, 0, 0]).state).toBe('indeterminate');
    expect(conventionFrom([...short, NaN, Infinity, -Infinity]).state).toBe('indeterminate');
    expect(conventionFrom([...short, 0, NaN]).state).toBe('indeterminate');
  });

  it('refuses a stream with no lattice at all, and says how close it got', () => {
    const rng = mulberry32(0xf00d);
    const noisy = handCounts(120, rng, 18).map((x) => x + (rng() - 0.5) * 0.6);
    const c = conventionFrom(noisy);
    expect(c).toMatchObject({ state: 'indeterminate', reason: 'no-lattice' });
    expect(c.purity).toBeGreaterThan(0.1);
    expect(c.purity).toBeLessThan(LATTICE_PURITY_MIN);
  });

  it('has a sample floor of 60', () => {
    expect(LATTICE_MIN_SAMPLES).toBe(60);
  });
});

describe('conventionFrom is ONE-SIDED (the collapse tests)', () => {
  // READ THIS BEFORE CHANGING ANY TEST IN THIS BLOCK.
  //
  // Returning `{ state: 'scaled', k: 1 }` for a unit lattice looks tidier, reads better on the
  // result screen, and shows the per-game table to far more players. It is also a silent
  // factor-of-two error in the sensitivity we tell a player to type, and there is no test anywhere
  // downstream that can catch it, because the number stays entirely plausible.
  //
  // The reason: a stream that was scaled by a FRACTION and then re-rounded to integers IS a perfect
  // unit lattice. Measured on these fixtures over 200 sweeps per case, k = 0.5, k = 1.25, k = 1.5
  // and a nonlinear acceleration curve all read spacing 1 at purity 1.000 in 200 of 200 runs. And
  // the collapse is undetectable by any other statistic on the stream: a genuine unit stream against
  // a halved-then-rounded one gives a mean-delta ratio of 0.974 here, and the spec's two other
  // candidate separators do no better (odd fraction 0.515 against 0.546, ones fraction 0.053 against
  // 0.059).
  //
  // What the collapse is NOT, and this matters as much: it is not every scaling. Pure INTEGER
  // scaling survives the rounding untouched, because multiplying integers by 2 leaves integers and
  // the re-rounding is a literal no-op, so k = 2 and k = 3 are still read exactly ('an integer
  // scaling survives the rounding and is still read exactly', 200 of 200 at each factor). The
  // collapse is specific to scaling that is fractional or nonlinear: division, a fractional ratio,
  // and acceleration. A comment claiming that all scaling collapses would mislead in the opposite
  // direction and invite deleting an estimator that works on the commonest devicePixelRatio there
  // is.
  //
  // So spacing one is not evidence of k = 1. It is the absence of evidence about k, and the honest
  // return is `indeterminate` with reason `spacing-one`. The cost of refusing is one tier of the
  // result screen. The cost of guessing is a wrong number the player types into their game.

  it('reads a genuine integer stream as indeterminate, never as k = 1', () => {
    for (let r = 0; r < 200; r++) {
      const c = conventionFrom(handCounts(120, mulberry32(0x5eed + r)));
      expect(c).toMatchObject({ state: 'indeterminate', reason: 'spacing-one' });
    }
  });

  it('reads a halved-then-rounded stream as indeterminate, and cannot tell it from the genuine one', () => {
    // Matched fixtures: the halved stream comes from twice the hand motion, so both land on the same
    // delta distribution. This is the pair that would silently double the emitted sensitivity.
    const genuine = handCounts(120, mulberry32(0xc0de), 18);
    const halved = reRounded(scaledBy(handCounts(120, mulberry32(0xbeef), 36), 0.5));
    expect(conventionFrom(genuine)).toMatchObject({ state: 'indeterminate', reason: 'spacing-one' });
    expect(conventionFrom(halved)).toMatchObject({ state: 'indeterminate', reason: 'spacing-one' });
    // And the two streams look the same from outside: measured mean-delta ratio 0.974.
    expect(meanAbs(halved) / meanAbs(genuine)).toBeCloseTo(1, 1);
  });

  it('reads a 1.5-scaled-then-rounded stream as indeterminate', () => {
    const stream = reRounded(scaledBy(handCounts(120, mulberry32(0xc0de), 12), 1.5));
    expect(conventionFrom(stream)).toMatchObject({ state: 'indeterminate', reason: 'spacing-one' });
  });

  it('reads an accelerated-then-rounded stream as indeterminate across 200 sweeps', () => {
    // This is why the estimator is hard-gated on the acceleration check in task 25: an accelerated
    // delta is still an integer after rounding, so acceleration is completely invisible here. The
    // lattice provably cannot substitute for the accel gate, and this test is the proof.
    for (let r = 0; r < 200; r++) {
      const accelerated = reRounded(
        handCounts(120, mulberry32(0x5eed + r)).map((x) => Math.sign(x) * Math.pow(Math.abs(x), 1.2)),
      );
      expect(conventionFrom(accelerated)).toMatchObject({
        state: 'indeterminate',
        reason: 'spacing-one',
      });
    }
  });

  it('an integer scaling survives the rounding and is still read exactly', () => {
    // The one family that does NOT collapse, and it is the commonest scaling of all: a browser that
    // multiplies raw counts by a devicePixelRatio of 2. Multiplying integers by an integer leaves
    // integers, so the re-rounding changes nothing and the stream really is on the spacing-2
    // lattice. Recorded as a test so the block comment above cannot be read as "every scaling
    // collapses", which would justify deleting an estimator that works here 200 times out of 200.
    for (const k of [2, 3]) {
      for (let r = 0; r < 200; r++) {
        const stream = reRounded(scaledBy(handCounts(120, mulberry32(0x5eed + r)), k));
        const c = conventionFrom(stream);
        expect(c.state).toBe('scaled');
        if (c.state === 'scaled') expect(c.k).toBeCloseTo(k, 10);
      }
    }
  });

  it('never returns a scaled convention with k within two percent of one', () => {
    const streams: number[][] = [
      handCounts(240, mulberry32(0xa1)),
      reRounded(scaledBy(handCounts(240, mulberry32(0xa2), 36), 0.5)),
      reRounded(scaledBy(handCounts(240, mulberry32(0xa3), 12), 1.5)),
      reRounded(scaledBy(handCounts(240, mulberry32(0xa4), 18), 1.01)),
      reRounded(handCounts(240, mulberry32(0xa5)).map((x) => Math.sign(x) * Math.pow(Math.abs(x), 1.2))),
    ];
    for (const s of streams) {
      const c = conventionFrom(s);
      if (c.state === 'scaled') expect(Math.abs(c.k - 1)).toBeGreaterThan(0.02);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/input/lattice.test.ts -t 'reads a genuine integer stream as indeterminate, never as k = 1'`

Expected: FAIL with

```
TypeError: conventionFrom is not a function
```

(Verified in this repo: vitest 2.1.9 transforms the import to a member access, so a missing named
export from a module that DOES exist fails at the call site with that TypeError, not with a
link-time SyntaxError. The file still collects, so the summary reads `Tests  1 failed`.)

- [ ] **Step 3: Write the minimal implementation**

Append to `src/input/lattice.ts`:

```ts
/** Minimum usable (finite, non-zero) deltas before the estimator will speak at all. Below this the
 *  modulus of a short stream is high by chance: the candidate set is small and every candidate has
 *  few phases to disagree with. */
export const LATTICE_MIN_SAMPLES = 60;

/** Half-width of the band around unity that reads as `spacing-one`. Within two percent of 1 a
 *  stream cannot be distinguished from an integer stream that was rescaled by a fraction and
 *  re-rounded (the simulated collapse read 1.00 to 1.01), and no real coordinate convention lives
 *  there. */
const SPACING_ONE_TOL = 0.02;

/**
 * The count convention read off a raw movement-delta stream. `rawDeltas` may interleave the x and y
 * components of every sample, because a browser that scales one scales the other identically. It
 * carries no timestamps: the estimator is a function of the delta multiset alone, which is why there
 * is no clock-offset test for it to pass.
 *
 * ONE-SIDED BY CONSTRUCTION. A spacing of one is reported as `indeterminate` with reason
 * `spacing-one`, never as `k = 1`, because a stream that was scaled by a FRACTION and then
 * re-rounded to integers is a perfect unit lattice and no statistic separates it from a genuine one.
 * Reporting k = 1 there would be a silent factor-of-two error in the emitted sensitivity. See the
 * collapse tests in tests/input/lattice.test.ts, which exist to stop exactly that "tidy-up".
 *
 * The collapse is narrower than one-sidedness makes it sound, and the narrowness is why this
 * estimator is worth shipping: an INTEGER scaling survives rounding untouched, so a browser that
 * multiplies raw counts by a devicePixelRatio of 2 is reported correctly as `scaled(2)`. Division, a
 * fractional ratio and acceleration are the cases that hide, and they hide completely.
 *
 * `purity` on an indeterminate result describes the stream, not our confidence in a k: on
 * `spacing-one` it is the modulus at spacing 1 (usually exactly one, which is the whole problem), on
 * `no-lattice` it is the best any candidate reached, and on `too-few-samples` it is zero because
 * nothing was measured.
 */
export function conventionFrom(rawDeltas: readonly number[]): Convention {
  const abs = usableAbsDeltas(rawDeltas);
  if (abs.length < LATTICE_MIN_SAMPLES) {
    return { state: 'indeterminate', reason: 'too-few-samples', purity: 0 };
  }
  const fit = latticeSpacing(abs);
  if (fit.spacing === null) {
    return { state: 'indeterminate', reason: 'no-lattice', purity: fit.purity };
  }
  if (Math.abs(fit.spacing - 1) <= SPACING_ONE_TOL) {
    return { state: 'indeterminate', reason: 'spacing-one', purity: fit.purity };
  }
  return { state: 'scaled', k: fit.spacing, purity: fit.purity };
}
```

And add the type near the top of the file, directly under the constants:

```ts
/**
 * What the delta stream was able to say about k. There is deliberately no `k = 1` result: see
 * `conventionFrom`.
 *
 * - `scaled`: the stream sits on a lattice of spacing k, and `purity` says how completely it does,
 *   which `pinConvention` turns into k's own spread rather than discarding.
 * - `spacing-one`: the stream is a unit lattice, which is exactly what a stream scaled by a fraction
 *   and re-rounded also is. No claim about k either way.
 * - `too-few-samples`: fewer than `LATTICE_MIN_SAMPLES` usable deltas.
 * - `no-lattice`: no plausible spacing was pure enough, so either the stream is genuinely
 *   non-integral or its only pure spacing was outside the convention band.
 */
export type Convention =
  | { state: 'scaled'; k: number; purity: number }
  | {
      state: 'indeterminate';
      reason: 'spacing-one' | 'too-few-samples' | 'no-lattice';
      purity: number;
    };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/input/lattice.test.ts`

Expected: PASS, `Tests  20 passed (20)` (7 in the kernel describe, 7 in `conventionFrom`, 6 in the
collapse describe).

- [ ] **Step 5: Commit**

```bash
git add src/input/lattice.ts tests/input/lattice.test.ts
git commit -m "feat(lattice): conventionFrom, one-sided, with the collapse tests

A stream scaled by a fraction and then re-rounded to integers is a perfect unit lattice, and mean
delta, odd fraction and ones fraction cannot separate it from a genuine one. So spacing one returns
indeterminate rather than k = 1. The collapse tests carry a comment saying why, because returning
k = 1 looks tidier and is a silent factor-of-two error in the sensitivity a player types.

One test records the opposite risk: an integer scaling survives the rounding untouched and is read
exactly, so the contract is one-sided without the estimator being useless."
```


### Task 25: The acceleration hard gate

An accelerated delta is still an integer after rounding, so OS acceleration is completely invisible
to the lattice (task 24 pins that). The estimator therefore may not run at all unless raw pointer
mode was granted, and it fails closed. `conventionFrom` keeps its pure signature; the gate is a
wrapper, and a closed gate returns `null`, which is categorically different from `indeterminate`:
`indeterminate` means the estimator ran and refused, `null` means it was never entitled to run.

**Files:**
- Modify: `src/input/lattice.ts` (append after `conventionFrom`)
- Modify: `tests/input/lattice.test.ts` (append after the collapse describe block)

- [ ] **Step 1: Write the failing test**

Add to the import block at the top of `tests/input/lattice.test.ts`:

```ts
import { conventionFromGated, latticeGateOpen, type LatticeGate } from '../../src/input/lattice';
```

Append:

```ts
describe('the acceleration hard gate', () => {
  const halfStream = scaledBy(handCounts(120, mulberry32(0x5eed)), 0.5);

  it('is closed without raw pointer mode, whatever the stream says', () => {
    // An accelerated stream is integral after rounding, so the lattice cannot see acceleration at
    // all. Without raw input there is nothing else standing between an accelerated stream and a
    // confident k, so the estimator does not run.
    const gate: LatticeGate = { mode: 'os-adjusted', accel: { accelerated: false, ratio: 0.01 } };
    expect(latticeGateOpen(gate)).toBe(false);
    expect(conventionFromGated(halfStream, gate)).toBeNull();
  });

  it('is closed when no lock was granted at all', () => {
    expect(latticeGateOpen({ mode: null, accel: null })).toBe(false);
    expect(conventionFromGated(halfStream, { mode: null, accel: null })).toBeNull();
  });

  it('is closed when a verdict says acceleration survived raw mode', () => {
    // Raw input bypasses OS acceleration at the source, but a driver-level curve does not care.
    // A positive verdict closes the gate even on raw.
    const gate: LatticeGate = { mode: 'raw', accel: { accelerated: true, ratio: 0.42 } };
    expect(latticeGateOpen(gate)).toBe(false);
    expect(conventionFromGated(halfStream, gate)).toBeNull();
  });

  it('is open on raw with a clean verdict', () => {
    const gate: LatticeGate = { mode: 'raw', accel: { accelerated: false, ratio: 0.02 } };
    expect(latticeGateOpen(gate)).toBe(true);
    expect(conventionFromGated(halfStream, gate)).toEqual(conventionFrom(halfStream));
  });

  it('is open on raw with no verdict, because raw input bypasses OS acceleration at the source', () => {
    const gate: LatticeGate = { mode: 'raw', accel: null };
    expect(latticeGateOpen(gate)).toBe(true);
    const c = conventionFromGated(halfStream, gate);
    expect(c).toMatchObject({ state: 'scaled' });
  });

  it('returns null for a closed gate rather than an indeterminate result', () => {
    // These two are NOT the same fact and must not collapse into one. `indeterminate` means the
    // estimator ran and refused, so a longer stream might yet pin k. `null` means it never ran and
    // no amount of data on this browser will change that, which is the difference between "try
    // again" and "type your sensitivity instead" on the result screen.
    const closed = conventionFromGated(halfStream, { mode: 'os-adjusted', accel: null });
    expect(closed).toBeNull();
    const ran = conventionFromGated([1, 2, 3], { mode: 'raw', accel: null });
    expect(ran).toEqual({ state: 'indeterminate', reason: 'too-few-samples', purity: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/input/lattice.test.ts -t 'is closed without raw pointer mode, whatever the stream says'`

Expected: FAIL with

```
TypeError: latticeGateOpen is not a function
```

- [ ] **Step 3: Write the minimal implementation**

Add these imports to the top of `src/input/lattice.ts`, above the constants:

```ts
import type { PointerLockMode } from '../types';
import type { AccelVerdict } from './accel-check';
```

Append to `src/input/lattice.ts`:

```ts
/** What the input layer knows about the stream's provenance. `accel` is null when no cross-check
 *  pass was run, which is the normal case on raw input: the turn machine only runs its deliberately
 *  fast pass on os-adjusted browsers, where the mode alone already closes this gate. The field
 *  exists so a future raw-mode probe (a driver curve does not care about unadjustedMovement) can
 *  close it without a signature change. */
export interface LatticeGate {
  mode: PointerLockMode | null;
  accel: AccelVerdict | null;
}

/**
 * Whether the estimator is entitled to run. Fails closed, and the reason is a proof rather than a
 * precaution: an accelerated delta is still an integer after rounding, so acceleration is invisible
 * to the lattice ('reads an accelerated-then-rounded stream as indeterminate across 200 sweeps').
 * The lattice therefore cannot substitute for the acceleration check, and without raw input there is
 * nothing left to catch an accelerated stream before it becomes a confident k.
 */
export function latticeGateOpen(gate: LatticeGate): boolean {
  if (gate.mode !== 'raw') return false;
  return gate.accel === null || gate.accel.accelerated === false;
}

/**
 * `conventionFrom` behind the acceleration gate. Returns null when the gate is closed, which is a
 * DIFFERENT fact from `indeterminate`: indeterminate means the estimator ran and refused, so more
 * data could still pin k, while null means it was never entitled to run on this browser. The result
 * screen needs the distinction to choose between "keep going" and "type your sensitivity instead".
 */
export function conventionFromGated(
  rawDeltas: readonly number[],
  gate: LatticeGate,
): Convention | null {
  if (!latticeGateOpen(gate)) return null;
  return conventionFrom(rawDeltas);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/input/lattice.test.ts`

Expected: PASS, `Tests  26 passed (26)` (20 from tasks 23 and 24, plus 6 here).

- [ ] **Step 5: Commit**

```bash
git add src/input/lattice.ts tests/input/lattice.test.ts
git commit -m "feat(lattice): hard-gate the estimator on raw pointer mode

An accelerated delta is an integer after rounding, so the lattice cannot see acceleration and cannot
substitute for the accel check. Without raw input the estimator does not run. A closed gate returns
null rather than indeterminate, because 'never ran' and 'ran and refused' lead to different offers."
```


### Task 26: Route two, the typed in-game sensitivity, and the pin

The second route to k, and the only one the spec calls reliable. Given the game and the player's
current in-game sensitivity, true counts per 360 is `360 / (yaw * sens)` exactly, so comparing it
against what the arena counted MEASURES k. This task builds the pin: the two routes, their
precedence, and the refusal reasons.

**New module, flagged rather than assumed.** `src/input/count-convention.ts` is not in the spec's
"Modules" list, which named only `lattice.ts` for this phase. It is a new pure module and it is
assigned to phase 3 by amendment A1 of the contract. It exists because the gate has to be one
tested branch in one place: the alternative was `pinConvention` inside `lattice.ts`, which would make
the lattice import the yaw table and the count conversions and stop being the self-contained
estimator its tests treat it as.

**Prerequisite, and the sequencing it forces:** phase 1a tasks 1 and 2 must have landed
`Counts360` / `counts360` in `src/types.ts` and `sensFor` / `countsForSens` in
`src/convert/counts.ts`. This task imports both and will not compile before then. Nothing else in
phase 1a is required, and phase 1b task 9 imports FROM this file, so the executable order is phase
1a, then this phase, then phase 1b (see hand-off H3).

**Files:**
- Create: `src/input/count-convention.ts`
- Test: `tests/input/count-convention.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { counts360, type Counts360 } from '../../src/types';
import { countsForSens } from '../../src/convert/counts';
import { yawFor } from '../../src/convert/yaw-table';
import type { Convention } from '../../src/input/lattice';
import {
  kFromTypedSens,
  pinConvention,
  type TypedSensRoute,
} from '../../src/input/count-convention';

/** The arena's own count for one 360, in browser deltas, for a player whose true setting is `sens`
 *  in `game` on a browser whose convention is `k`. This is the fixture the whole route inverts. */
function arenaCountsFor(game: 'cs2' | 'valorant', sens: number, k: number): Counts360 {
  return counts360(countsForSens(sens, yawFor(game)) * k);
}

const typed = (over: Partial<TypedSensRoute> = {}): TypedSensRoute => ({
  game: 'cs2',
  sens: 2,
  arenaCounts: arenaCountsFor('cs2', 2, 1.5),
  anchorLogSd: 0.12,
  ...over,
});

const scaledLattice: Convention = { state: 'scaled', k: 2, purity: 1 };
const spacingOne: Convention = { state: 'indeterminate', reason: 'spacing-one', purity: 1 };

describe('kFromTypedSens', () => {
  it('measures k by comparing the arena count against the exact typed count', () => {
    for (const k of [0.5, 1.25, 1.5, 2]) {
      expect(kFromTypedSens(arenaCountsFor('cs2', 2, k), 'cs2', 2)).toBeCloseTo(k, 10);
      expect(kFromTypedSens(arenaCountsFor('valorant', 0.35, k), 'valorant', 0.35)).toBeCloseTo(k, 10);
    }
  });

  it('refuses a sensitivity that cannot be inverted', () => {
    const arena = arenaCountsFor('cs2', 2, 1.5);
    expect(kFromTypedSens(arena, 'cs2', 0)).toBeNull();
    expect(kFromTypedSens(arena, 'cs2', -1)).toBeNull();
    expect(kFromTypedSens(arena, 'cs2', NaN)).toBeNull();
  });

  it('refuses an arena count that is not a measurement', () => {
    expect(kFromTypedSens(counts360(0), 'cs2', 2)).toBeNull();
    expect(kFromTypedSens(counts360(NaN), 'cs2', 2)).toBeNull();
    expect(kFromTypedSens(counts360(-4000), 'cs2', 2)).toBeNull();
  });

  it('refuses an out-of-band k instead of rescaling the table by an order of magnitude', () => {
    // A decimal-point slip in the typed sensitivity is the realistic cause: 0.2 typed as 2 puts k a
    // factor of ten out. The band is the same one the lattice candidates live in.
    expect(kFromTypedSens(arenaCountsFor('cs2', 2, 20), 'cs2', 2)).toBeNull();
    expect(kFromTypedSens(arenaCountsFor('cs2', 2, 0.01), 'cs2', 2)).toBeNull();
  });
});

describe('pinConvention', () => {
  it('prefers the typed route when both are available', () => {
    // The lattice says 2, the typed route says 1.5. The typed route wins: it is exact arithmetic on
    // a number the player read off their own game, while the lattice is an inference about how the
    // browser reports deltas. They disagreeing is a signal about the browser, not a tie to split.
    const pin = pinConvention(scaledLattice, typed());
    expect(pin.pinned).toBe(true);
    if (pin.pinned) {
      expect(pin.k).toBeCloseTo(1.5, 10);
      expect(pin.source).toBe('typed-sens');
      expect(pin.logSd).toBe(0.12);
    }
  });

  it('inherits the anchor log sd on the typed route, because k inherits the reproduction error', () => {
    const pin = pinConvention(null, typed({ anchorLogSd: 0.3 }));
    expect(pin).toMatchObject({ pinned: true, source: 'typed-sens', logSd: 0.3 });
  });

  it('falls back to the lattice when the typed number is unusable', () => {
    const pin = pinConvention(scaledLattice, typed({ sens: 0 }));
    expect(pin).toEqual({ pinned: true, k: 2, source: 'lattice', logSd: 0 });
  });

  it('pins from an exactly pure lattice with no spread of its own', () => {
    // logSd 0 is not a fabricated interval HERE: purity exactly one says the spacing divides every
    // delta, and the spacing IS k, so there is no sampling step left to be uncertain about.
    expect(pinConvention(scaledLattice, null)).toEqual({
      pinned: true, k: 2, source: 'lattice', logSd: 0,
    });
  });

  it('carries an impure lattice shortfall as k spread rather than claiming zero', () => {
    // The purity floor is 0.98, not 1.0, so a pin can rest on a candidate that leaves part of the
    // phase unaccounted for, and a sub-harmonic or super-harmonic mis-pick is not impossible. A
    // zero-width claim there is uncertainty the evidence has not earned, so the shortfall below one
    // becomes k's log sd and tier two widens by it.
    const pin = pinConvention({ state: 'scaled', k: 1.25, purity: 0.985 }, null);
    expect(pin).toMatchObject({ pinned: true, k: 1.25, source: 'lattice' });
    if (pin.pinned) expect(pin.logSd).toBeCloseTo(0.015, 12);
  });

  it('refuses the typed route when the anchor carries no honest spread', () => {
    // Pinning k off an anchor whose uncertainty is unknown would emit a per-game table with an
    // implied zero-width claim it has not earned. Refuse the route instead.
    expect(pinConvention(null, typed({ anchorLogSd: NaN }))).toEqual({
      pinned: false, reason: 'typed-sens-implausible',
    });
    expect(pinConvention(null, typed({ anchorLogSd: -0.2 }))).toEqual({
      pinned: false, reason: 'typed-sens-implausible',
    });
  });

  it('reports gate-closed when the estimator never ran and nothing was typed', () => {
    expect(pinConvention(null, null)).toEqual({ pinned: false, reason: 'gate-closed' });
  });

  it('reports lattice-indeterminate when the estimator ran and refused', () => {
    expect(pinConvention(spacingOne, null)).toEqual({
      pinned: false, reason: 'lattice-indeterminate',
    });
    expect(pinConvention({ state: 'indeterminate', reason: 'no-lattice', purity: 0.2 }, null)).toEqual({
      pinned: false, reason: 'lattice-indeterminate',
    });
  });

  it('reports typed-sens-implausible when the only offer was unusable', () => {
    expect(pinConvention(spacingOne, typed({ sens: 0 }))).toEqual({
      pinned: false, reason: 'typed-sens-implausible',
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/input/count-convention.test.ts`

Expected: FAIL, `tests/input/count-convention.test.ts (0 test)`, with

```
Error: Failed to load url ../../src/input/count-convention (resolved id: ../../src/input/count-convention) in /<repo>/tests/input/count-convention.test.ts. Does the file exist?
```

and the summary lines `Test Files  1 failed (1)` and `Tests  no tests`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/input/count-convention.ts
// The two routes to k, and the gate that decides whether tier two of the result may be shown at all.
//
// k is pinned by exactly two routes and no others:
//   1. the lattice estimator returning `scaled(k)` (src/input/lattice.ts), or
//   2. the player naming their game and current in-game sensitivity, which gives true counts per 360
//      as 360 / (yaw * sens) EXACTLY, and therefore measures k by comparison against what the arena
//      counted.
// Anything else leaves k unpinned, and an unpinned k costs the absolute numbers but never the ratio:
// the arena is self-consistent in browser counts, so the rendered gain, the searched range and the
// tier-one ratio are all untouched by k. That is why refusing here costs a tier and not the answer.
import type { Counts360, GameId } from '../types';
import { countsForSens } from '../convert/counts';
import { yawFor } from '../convert/yaw-table';
import { CONVENTION_K_MAX, CONVENTION_K_MIN, type Convention } from './lattice';

/** The player's offer: the game they just closed and the sensitivity they had in it, plus the arena's
 *  own count for the turn they reproduced. */
export interface TypedSensRoute {
  game: GameId;
  /** Their current in-game sensitivity, as typed. */
  sens: number;
  /** The arena's count for one 360, in browser deltas: the anchor. */
  arenaCounts: Counts360;
  /**
   * The anchor's own log sd. k inherits it EXACTLY, because the comparison assumes the blind turn
   * reproduced the 360 their current setting produces, so the player's reproduction error lands
   * whole on k. This is the number that must widen the per-game table, and a route with no honest
   * spread here is refused rather than pinned at zero.
   */
  anchorLogSd: number;
}

/** Whether k is pinned, and by which of the two routes. `logSd` is k's own relative uncertainty in
 *  ln space, for the caller to widen tier two by: the purity shortfall on the lattice route (zero
 *  only when the lattice is exactly pure), and the anchor's spread on the typed route. */
export type KPin =
  | { pinned: true; k: number; source: 'lattice' | 'typed-sens'; logSd: number }
  | { pinned: false; reason: 'gate-closed' | 'lattice-indeterminate' | 'typed-sens-implausible' };

/**
 * k measured by comparing the arena's browser-delta count for a 360 against the exact count the
 * player's own setting implies. Returns null rather than a number whenever the comparison cannot be
 * trusted: a non-invertible sensitivity, an arena count that is not a measurement, or a k outside
 * the convention band. That last case is the realistic one: a decimal-point slip in the typed
 * sensitivity puts k a factor of ten out, and emitting it would rescale every number in the per-game
 * table by ten (pinned by 'refuses an out-of-band k instead of rescaling the table').
 */
export function kFromTypedSens(arenaCounts: Counts360, game: GameId, sens: number): number | null {
  if (!Number.isFinite(arenaCounts) || !(arenaCounts > 0)) return null;
  if (!Number.isFinite(sens) || !(sens > 0)) return null;
  const trueCounts = countsForSens(sens, yawFor(game));
  if (!Number.isFinite(trueCounts) || !(trueCounts > 0)) return null;
  const k = arenaCounts / trueCounts;
  if (!Number.isFinite(k) || k < CONVENTION_K_MIN || k > CONVENTION_K_MAX) return null;
  return k;
}

/** The typed route as a pin, or null when the route cannot carry one. Kept separate so the anchor
 *  spread check sits next to the k check and neither can be forgotten. */
function typedPin(typed: TypedSensRoute): KPin | null {
  const k = kFromTypedSens(typed.arenaCounts, typed.game, typed.sens);
  if (k === null) return null;
  if (!Number.isFinite(typed.anchorLogSd) || typed.anchorLogSd < 0) return null;
  return { pinned: true, k, source: 'typed-sens', logSd: typed.anchorLogSd };
}

/**
 * Pin k from the two routes, or refuse with the reason the caller can act on.
 *
 * The typed route wins when both are available. It is exact arithmetic on a number the player read
 * off the game they came here to change, where the lattice is an inference about how a browser
 * chose to report deltas, and the spec records the typed route as currently the only reliable one.
 * When the two disagree, that is a signal about the browser and not a tie to average away.
 *
 * `lattice` is `null` when the acceleration gate was closed and the estimator never ran, which is a
 * different refusal from an estimator that ran and refused, so it gets its own reason.
 */
export function pinConvention(lattice: Convention | null, typed: TypedSensRoute | null): KPin {
  if (typed !== null) {
    const pin = typedPin(typed);
    if (pin !== null) return pin;
  }
  if (lattice !== null && lattice.state === 'scaled') {
    // k's spread on this route is the purity shortfall, not zero. `latticeSpacing` accepts a
    // candidate at LATTICE_PURITY_MIN (0.98) rather than at 1.0, and its candidate set is seed / n
    // for n up to 12, so a stream that leaves part of the phase unaccounted for could also be a
    // harmonic mis-pick. Claiming logSd 0 there is a zero-width uncertainty the evidence has not
    // earned. The Math.max floors float noise above one at zero rather than emitting a negative sd
    // (pinned by 'carries an impure lattice shortfall as k spread rather than claiming zero').
    return {
      pinned: true,
      k: lattice.k,
      source: 'lattice',
      logSd: Math.max(0, 1 - lattice.purity),
    };
  }
  // A typed offer we could not use is the most actionable refusal: the player can correct a number.
  // It also covers an anchor with no honest spread, because pinning k off an unknown uncertainty
  // would emit a table carrying a zero-width claim it has not earned.
  if (typed !== null) return { pinned: false, reason: 'typed-sens-implausible' };
  // 'gate-closed' covers both ways the estimator can fail to speak at all: the acceleration gate
  // shut it, or no delta stream existed to read (the typed-only path never runs the turn).
  if (lattice === null) return { pinned: false, reason: 'gate-closed' };
  return { pinned: false, reason: 'lattice-indeterminate' };
}
```

`tsconfig.json` sets `noUnusedLocals: true` and `npm run build` runs `tsc --noEmit` first, so the
import block above deliberately omits `counts360`, `sensFor` and `GAME_YAW`. Task 27 adds them at the
moment they are first used.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/input/count-convention.test.ts`

Expected: PASS, `Tests  13 passed (13)` (4 in `kFromTypedSens`, 9 in `pinConvention`).

- [ ] **Step 5: Commit**

```bash
git add src/input/count-convention.ts tests/input/count-convention.test.ts
git commit -m "feat(convention): the two routes to k, with their precedence and refusals

Typed game plus sensitivity gives true counts per 360 exactly, so comparing it against the arena's
count measures k. It wins over the lattice when both exist. k from the typed route inherits the
anchor's log sd whole, because the comparison assumes the blind turn reproduced the 360 the player's
current setting produces, so an anchor with no honest spread refuses the route rather than pinning
k at zero uncertainty. The lattice route carries its purity shortfall as k's spread, because the
purity floor is 0.98 and a pin that leaves phase unaccounted for is not an exact pin."
```


### Task 27: The tier-two gate

`perGameSens`, `kSource`, the pinned `k` itself and `kLogSd` appear on the `Prescription` only when k
is pinned by one of exactly those two routes. This task builds the function that produces them, so
the gate is one branch in one tested place rather than a condition spread across the result screen.
Amendment A4 makes this the ONLY implementation of tier two: phase 1b deletes its own `PinnedK` and
`perGameFromCounts` and calls this instead, because the same arithmetic in two files is two places
for k to go missing.

**Files:**
- Modify: `src/input/count-convention.ts` (append after `pinConvention`)
- Modify: `tests/input/count-convention.test.ts` (append after the `pinConvention` describe block)

- [ ] **Step 1: Write the failing test**

In `tests/input/count-convention.test.ts`, replace the yaw-table import line with the two-symbol form
and add `tierTwoFrom` to the count-convention import:

```ts
import { GAME_YAW, yawFor } from '../../src/convert/yaw-table';
import {
  kFromTypedSens,
  pinConvention,
  tierTwoFrom,
  type TypedSensRoute,
} from '../../src/input/count-convention';
```

Append:

```ts
describe('tierTwoFrom', () => {
  const latticePin = { pinned: true, k: 1.5, source: 'lattice', logSd: 0 } as const;

  it('withholds the table entirely when k is unpinned', () => {
    // Not an empty table, not a table of dashes: absent. A per-game sensitivity with an unpinned k
    // is a number that would be wrong by exactly the factor we failed to measure.
    expect(tierTwoFrom(counts360(6000), { pinned: false, reason: 'gate-closed' })).toBeNull();
    expect(tierTwoFrom(counts360(6000), { pinned: false, reason: 'lattice-indeterminate' })).toBeNull();
    expect(tierTwoFrom(counts360(6000), { pinned: false, reason: 'typed-sens-implausible' })).toBeNull();
  });

  it('withholds the table when the optimum or the pinned k is not a usable number', () => {
    // The k guard is not unreachable defensiveness: KPin is a plain structural type, so any caller
    // assembling one by hand (phase 1b's fixtures do) can hand this a zero and would otherwise get
    // an Infinity table back.
    expect(tierTwoFrom(counts360(0), latticePin)).toBeNull();
    expect(tierTwoFrom(counts360(NaN), latticePin)).toBeNull();
    expect(tierTwoFrom(counts360(6000), { pinned: true, k: 0, source: 'lattice', logSd: 0 })).toBeNull();
    expect(tierTwoFrom(counts360(6000), { pinned: true, k: NaN, source: 'lattice', logSd: 0 })).toBeNull();
  });

  it('emits the native sensitivity for every game at the pinned convention', () => {
    const t = tierTwoFrom(counts360(6000), latticePin);
    expect(t).not.toBeNull();
    // C* = 6000 browser deltas at k = 1.5 is 4000 real counts per 360.
    // cs2 yaw 0.022: 360 / (0.022 * 4000) = 4.0909...
    expect(t!.perGameSens.cs2).toBeCloseTo(4.090909, 6);
    // valorant effective yaw 0.07: 360 / (0.07 * 4000) = 1.2857...
    expect(t!.perGameSens.valorant).toBeCloseTo(1.285714, 6);
    expect(Object.keys(t!.perGameSens).sort()).toEqual(GAME_YAW.map((g) => g.id).sort());
  });

  it('scales every emitted sensitivity exactly with k, and nothing else', () => {
    // This is the whole reach of k: it multiplies the absolute numbers in tier two and touches
    // nothing else. The arena is self-consistent in browser counts, so the ratio in tier one is
    // unaffected by k, which is why an unpinned k costs a tier rather than the answer.
    const a = tierTwoFrom(counts360(6000), { pinned: true, k: 1.5, source: 'lattice', logSd: 0 })!;
    const b = tierTwoFrom(counts360(6000), { pinned: true, k: 3, source: 'lattice', logSd: 0 })!;
    for (const g of GAME_YAW) {
      expect(b.perGameSens[g.id]!).toBeCloseTo(a.perGameSens[g.id]! * 2, 9);
    }
  });

  it('restricts the table to the requested games', () => {
    const t = tierTwoFrom(counts360(6000), latticePin, ['cs2', 'apex'])!;
    expect(Object.keys(t.perGameSens).sort()).toEqual(['apex', 'cs2']);
  });

  it('carries the pinned k, its source and its log sd, and nothing that could be mistaken for a ratio', () => {
    const typedPinned = { pinned: true, k: 1.5, source: 'typed-sens', logSd: 0.12 } as const;
    const t = tierTwoFrom(counts360(6000), typedPinned)!;
    expect(t.kSource).toBe('typed-sens');
    expect(t.kLogSd).toBe(0.12);
    expect(t.k).toBe(1.5); // tier three renders hardware counts as C* / k and must not re-derive it
    expect(Object.keys(t).sort()).toEqual(['k', 'kLogSd', 'kSource', 'perGameSens']);
    expect(tierTwoFrom(counts360(6000), latticePin)!.kSource).toBe('lattice');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/input/count-convention.test.ts -t 'withholds the table entirely when k is unpinned'`

Expected: FAIL with

```
TypeError: tierTwoFrom is not a function
```

- [ ] **Step 3: Write the minimal implementation**

First extend the import block of `src/input/count-convention.ts` to the three symbols task 26 left
out, now that they are used:

```ts
import { counts360, type Counts360, type GameId } from '../types';
import { countsForSens, sensFor } from '../convert/counts';
import { GAME_YAW, yawFor } from '../convert/yaw-table';
```

Then append:

```ts
/** The k-gated fields of the `Prescription`. Deliberately carries no ratio and no CI of its own:
 *  tier one is measured in browser counts and k cannot touch it. */
export interface TierTwo {
  perGameSens: Partial<Record<GameId, number>>;
  kSource: 'lattice' | 'typed-sens';
  /** The pinned convention itself, echoed so the caller never re-derives it. Tier three renders
   *  hardware counts as C* / k, and a `Result` reloaded from storage has no draft left to ask. */
  k: number;
  /**
   * k's relative uncertainty in ln space, from the pin. The per-game interval must widen by it,
   * never narrow: on the typed route this is the anchor's reproduction error landing whole on k, so
   * it is not small. One number covers every game, because k is a single multiplicative factor
   * common to all of them, so the RELATIVE band it implies is identical per game and a per-game
   * band would be the same number written eight times (hand-off H3 carries the arithmetic the
   * result screen renders it with).
   */
  kLogSd: number;
}

/**
 * The per-game table at the located optimum, or null when it may not be shown.
 *
 * `counts` is C*, the located optimum in BROWSER deltas, which is the unit the whole arena and the
 * whole search run in. Dividing by k converts it to real mouse counts, which is the only place in
 * the tool where k appears at all. Callers pass C* undivided: dividing before the call would apply k
 * twice.
 *
 * Returns null whenever k is unpinned. Not an empty table and not a table of dashes: absent. A
 * per-game sensitivity computed with an unpinned k is wrong by exactly the factor we failed to
 * measure, and it is the number a player types into their game (pinned by 'withholds the table
 * entirely when k is unpinned').
 */
export function tierTwoFrom(
  counts: Counts360,
  pin: KPin,
  games?: readonly GameId[],
): TierTwo | null {
  if (!pin.pinned) return null;
  if (!Number.isFinite(counts) || !(counts > 0)) return null;
  if (!Number.isFinite(pin.k) || !(pin.k > 0)) return null;
  const trueCounts = counts360(counts / pin.k);
  const ids = games ?? GAME_YAW.map((g) => g.id);
  const perGameSens: Partial<Record<GameId, number>> = {};
  for (const id of ids) perGameSens[id] = sensFor(trueCounts, yawFor(id));
  return { perGameSens, kSource: pin.source, k: pin.k, kLogSd: pin.logSd };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/input/count-convention.test.ts`

Expected: PASS, `Tests  19 passed (19)` (13 from task 26, plus 6 here).

- [ ] **Step 5: Run the whole suite and commit**

Run: `npx vitest run` then `npm run build`

Expected: PASS on both, with the suite up by the 45 tests this phase added (26 in
`tests/input/lattice.test.ts`, 19 in `tests/input/count-convention.test.ts`).

```bash
git add src/input/count-convention.ts tests/input/count-convention.test.ts
git commit -m "feat(convention): gate the per-game table on a pinned k

perGameSens and kSource exist only when k came from the lattice or from a typed in-game sensitivity.
Unpinned withholds the table rather than emitting numbers wrong by the factor we failed to measure.
k reaches only these absolute numbers, which is why an unpinned k costs a tier and not the answer.
The pin's own log sd rides along so the screen widens the table rather than borrowing tier one's
precision, and the pinned k rides along so tier three can name hardware counts."
```


## Hand-offs to other phases

One edit this phase needs in a file it does not own (H3, to phase 1b), plus two VERIFICATION NOTES.

H1 and H2 are notes, not edit lists, and that is the correction rather than a formality. Amendment
A1 gives `src/ui/calibrate/turn-view.ts` to phase 2 task 17 and `src/ui/setup.ts`,
`src/ui/calibrate-flow.ts` and `src/ui/shell.ts` to phase 2 task 18, and phase 2 has now authored
both seams in full. An earlier draft of H1 and H2 restated those edits as instructions, which was
harmless where it duplicated and actively wrong where it drifted: H2's design put the offer inline
on the intro step while phase 2's authored flow gives the offer its own step, and applying both
would have produced two offers in one file. Phase 2's authored shape wins on every point of
difference, because phase 2 owns the file. What is left below is what a reviewer should check
against phase 2's authored text, and nothing to paste.

This phase's own files, which no other phase touches, are `src/input/lattice.ts` and
`src/input/count-convention.ts`. Its exported surface for phase 2 is `conventionFromGated`,
`Convention`, `LatticeGate`, `pinConvention`, `TypedSensRoute` and `KPin`. Nothing else crosses.

### H1 to phase 2 (`src/ui/calibrate/turn-view.ts`). Verification note, nothing to apply.

Phase 2 task 17 authors this seam itself, in the file A1 gives it. Its step 3 already carries the
import `conventionFromGated, type Convention, type LatticeGate` from `../../input/lattice`, the
two-argument `onTurn: (estimate: TurnEstimate, convention: Convention | null) => void`, the capped
`latticeTap` pushed from inside the sample handler above the `paused` early return, and the
`conventionFromGated(latticeTap, { mode: pointer.mode(), accel: null })` read sequenced BEFORE
`pointer.exit()`. There is nothing here to apply, and an earlier draft of this hand-off that listed
those four edits has been deleted so no executor applies them twice.

Two properties of the tap are load bearing, and they are what a reviewer should actually check:

1. **`s.dx` and `s.dy` must be the browser's raw `movementX` / `movementY`.** At HEAD they are not:
   `flattenCoalesced` in `src/input/pointer-lock.ts:16-20` divides both by DPR through
   `normalizeByDpr`. Phase 1a removes that division (the spec lists `normalizeByDpr` under Deleted).
   If it is still in place when task 17 lands, the tap reads a stream already divided by DPR and the
   lattice reports the DPR as k, which is a true finding about a bug rather than about the mouse.
2. **Nothing may filter, round, smooth or de-duplicate the tapped values, and nothing may tap
   `s.t`.** `conventionFrom` drops zeros and non-finite values itself, so anything else removed is
   lattice evidence thrown away, and the estimator is deliberately a function of the delta multiset
   alone with no clock dependence at all.

The reason the gate is read before the lock is released is also worth checking rather than assuming:
`pointer.mode()` is nulled by the controller's `pointerlockchange` handler, and a null mode closes
the gate, so a read sequenced after `pointer.exit()` would depend on event timing to avoid reporting
`gate-closed` on every session. Phase 2 task 17 sequences it correctly and says so in its own
comment.

The tap and the gate are not unit-testable in that view, because jsdom grants no pointer lock and
delivers no samples, which is exactly why the view is a thin shell. The gate itself is covered by six
tests in `tests/input/lattice.test.ts` (task 25), and the only new logic at the seam is one call.

### H2 to phase 2 (`src/ui/setup.ts`, `src/ui/shell.ts`). Verification note, nothing to apply.

Phase 2 task 18 authors this seam, because A1 gives it `setup.ts`, `calibrate-flow.ts` and
`shell.ts`, and its authored version is complete and self-consistent: a first-class `'offer'` step in
`CalStep`, an `offerAccepted: boolean` on `CalState`, `offer-accepted` / `offer-skipped` reducer
actions, and full rewrites of both `src/ui/setup.ts` and `tests/ui/setup.test.ts`. An earlier draft
of this hand-off authored a different offer, inline on the intro step with its own field names and
its own helpers, and appended tests to a file phase 2 replaces wholesale. Applied on top of phase 2
that would have produced two offers in one screen and two `readOffer` paths. It is deleted. Nothing
here is applied.

What to verify against phase 2's authored text:

1. **`commitGuided(estimate, convention)` pins k against the arena's own count for the turn the
   player just reproduced.** Phase 2 computes `typed` as
   `{ game: ctx.draft.currentGame, sens: ctx.draft.currentSens, arenaCounts: estimate.counts,
   anchorLogSd: estimate.logSd }` when the offer was accepted and null otherwise, then
   `ctx.draft.kPin = pinConvention(convention, typed)`. Both halves are required and both are
   present: k is arena counts over true counts, so the pair alone cannot pin it and the turn alone
   cannot either. `anchorLogSd` carries the turn's spread whole rather than a share of it, because
   the comparison assumes the blind turn reproduced the 360 the player's current setting produces,
   so their reproduction error lands entirely on k.
2. **`commitManual` pins `pinConvention(null, null)`, which refuses with `gate-closed`.** Phase 2
   chose this over passing a stored `convention`, and the stricter choice is the right one: a
   lattice read taken during a turn that the commit then discards is evidence about a browser this
   run is no longer measuring. The refusal reason is honest either way, since a typed run produces
   no arena count to compare against.
3. **The `use-saved` handler clears both `kPin` and `convention`, and `rememberPrefs` writes
   neither.** `rememberPrefs` persists only the `PersistedPrefs` fields (`src/ui/shell.ts:85-96`),
   so no pin can reach storage even by accident. Leave it that way: reusing last week's pin on a new
   browser is exactly the silent unit error this phase exists to prevent. A visitor who reaches the
   session with no pin at all leaves `kPin` undefined, which the result screen reads as unpinned and
   withholds tier two, which is the honest default.
4. **`SessionDraft` gains `turn?`, `convention?` and `kPin?` in one edit to `shell.ts`**, with
   `import type { KPin } from '../input/count-convention';` and
   `import type { Convention } from '../input/lattice';` beside it.
5. **The offer opens with no answer in either half.** Phase 2 task 18 renders the game select on a
   `<option value="" selected>Pick your game</option>` and the sensitivity input on `value=""`, and
   its validation refuses a half-filled offer by name. This is the property this whole phase exists
   to protect and the one most easily lost in a rewrite: a prefilled pair that a player clicks past
   pins k off a number nobody typed, and k is then wrong by the ratio of two yaws with nothing on
   screen to show it. Storage cannot say whether a remembered `currentSens` was typed or defaulted,
   which is why it never prefills the offer either.

### H3 to phase 1b (`src/optimizer/result.ts`, `src/ui/result.ts`)

**Sequencing, load-bearing.** Phase 1b task 9 imports from `src/input/count-convention.ts`, which
tasks 26 and 27 create. Tasks 23 to 27 need only phase 1a tasks 1 and 2, and this phase imports
nothing from 1b, so the dependency is one-way and the executable order is: phase 1a, then tasks 23 to
27, then phase 1b task 9 onward. Task numbering is unchanged; only the running order is.

Amendment A4 makes phase 3 the single owner of k. In `src/optimizer/result.ts`:

1. Delete `interface PinnedK` and the private `perGameFromCounts` helper outright. Both are the
   second path to the same number, which is the second place for k to go missing.
2. Add `import { tierTwoFrom, type KPin } from '../input/count-convention';`.
3. `buildPrescription`'s k parameter becomes `k?: KPin`. `pinConvention` never produces
   `{ value, source }`, so nothing may convert at the boundary either; the `KPin` is passed through
   from `ctx.draft.kPin` verbatim.
4. Compute tier two once, after `counts` and `countsCi90`, and pass C* UNDIVIDED (`tierTwoFrom`
   divides by k itself; dividing first applies k twice). The two lines below are the whole change to
   the returned object: the `ratio` and `ratioCi90` fields keep exactly the conditional form phase 1b
   already writes for them, and no line of the anchor half moves.

```ts
import { tierTwoFrom, type KPin } from '../input/count-convention';

// one line above the return, after counts and countsCi90 are in hand:
const tier2 = k !== undefined ? tierTwoFrom(counts, k, games) : null;

// one property inside the returned object, alongside the existing conditional spreads:
  // Tier two is present ONLY when k was pinned by the lattice or by a typed in-game sensitivity.
  // Absent is the honest state: a per-game sensitivity at an unpinned k is wrong by exactly the
  // factor we failed to measure, and it is the number the player types into their game. The ratio
  // is unaffected either way, because it is a ratio of two quantities in browser counts and k
  // cancels exactly (tests/input/count-convention.test.ts 'scales every emitted sensitivity
  // exactly with k, and nothing else').
  ...(tier2 ? { perGameSens: tier2.perGameSens, kSource: tier2.kSource, k: tier2.k, kLogSd: tier2.kLogSd } : {}),
```

5. **Tier two must survive an anchor refusal.** k pinned with the anchor refused is a reachable
   state, and it is the state amendment A5 made `ratio` and `ratioCi90` optional for. If
   `buildPrescription` returns null when `anchor === null`, tier two vanishes with it and A5 buys
   nothing, so the k path has to be computed independently of the anchor and said so in the doc
   comment.
6. **One field the contract's `Prescription` does not have yet, flagged rather than smuggled.**
   `k?: number` is needed alongside `kSource` and `kLogSd`, because tier three renders
   `optimalCounts / k` as hardware counts (finding F13) and a `Result` rehydrated from storage has no
   draft left to read the pin from. Add it to `Prescription` with that reason in the comment. This is
   an addition to Decision 1 beyond amendment A5, raised here rather than made silently.
7. **The tests F9 names.** In `tests/optimizer/prescription.test.ts`, the three pinned cases pass
   `{ pinned: true, k: 2, source: 'lattice', logSd: 0 }`, and 'treats an invalid k as unpinned'
   passes `{ pinned: false, reason: 'gate-closed' }`.
8. **Rendering `kLogSd`, which is the whole reason it is measured.** On the typed route it is the
   anchor's spread landing whole on k, so it is not small, and dropping it would report tier two as
   if k were exact. One number covers every game because k is one common multiplicative factor, so
   the per-game band is:

```ts
/** 90 percent z, the same constant the anchor bands use. */
const Z90 = 1.6448536269514722;

/** Tier two's own band: the search's precision and the convention's, combined in quadrature because
 *  they are independent sources (the bootstrap over drills, and the pin). hypot is never smaller
 *  than either input, so this can only widen, never narrow. */
const halfLn = Math.hypot(Math.log(countsCi90[1] / countsCi90[0]) / 2, Z90 * kLogSd);
const band: [number, number] = [sens * Math.exp(-halfLn), sens * Math.exp(halfLn)];
```

   When `kLogSd` is 0 (an exactly pure lattice) the band is the bootstrap's alone, which is what the
   spec says tier two carries.
9. **Do not port `perGameSens` from `src/convert/schools.ts`.** Amendment A6 deletes it in phase 1a
   because it emitted native sensitivities from browser counts with k assumed to be 1. `tierTwoFrom`
   is the one place tier two exists.


### Task 29: the submovement segmenter moves into count space

**Files:**
- Modify: `src/scoring/submovement.ts` (whole file)
- Test: `tests/scoring/submovement.test.ts` (whole file)

Context the engineer needs. `segment()` is the only submovement segmenter in the repo. Amendment A2
corrects the contract and the spec on this point: the segmenter is `segment()` in
`src/scoring/submovement.ts`, and `src/scoring/fitts.ts` holds only the ISO 9241-9 throughput. Per
amendment A1 phase 4 owns `submovement.ts`, `recording.ts`, `flick.ts` and `strike.ts`, so tasks 29
to 31 are this phase's own files rather than borrowed ones. Phase 1a's mechanical unit rename lands
first; everything below is semantic change on top of it.

The current signature, read from the file:

```ts
export interface VelSample { t: Ms; speed: number }      // deg/s
export interface SegmentOptions { cueTime?: Ms; onsetThresh?: number }  // deg/s, default 30
export function segment(trace: readonly VelSample[], opts: SegmentOptions = {}): SubmovementSeg
```

Its two callers pass `{ onsetThresh: 20 }` (`src/instruments/flick.ts:199`,
`src/instruments/strike.ts:117`). Task 30 converts them. This task changes the unit only.

- [ ] **Step 1: Write the failing test**

Replace `tests/scoring/submovement.test.ts` entirely with:

```ts
import { describe, it, expect } from 'vitest';
import { segment, ONSET_COUNTS_PER_SEC, type CountSample } from '../../src/scoring/submovement';

/** Gaussian speed bumps in COUNTS PER SECOND, sampled every `step` ms over [0, end]. */
function bumps(peaks: Array<{ mu: number; sigma: number; amp: number }>, end = 700, step = 5): CountSample[] {
  const out: CountSample[] = [];
  for (let t = 0; t <= end; t += step) {
    let countsPerSec = 0;
    for (const p of peaks) countsPerSec += p.amp * Math.exp(-((t - p.mu) ** 2) / (2 * p.sigma * p.sigma));
    out.push({ t, countsPerSec });
  }
  return out;
}

describe('segment', () => {
  it('a single smooth reach has no corrective sub-movements', () => {
    const trace = bumps([{ mu: 250, sigma: 45, amp: 18000 }]);
    const s = segment(trace, { onsetThresh: 900 });
    expect(s.nCorr).toBe(0);
    expect(s.vPeak).toBeCloseTo(18000, -1);
    expect(s.tD).toBeGreaterThan(0);
    expect(s.tD).toBeLessThan(250);
    expect(s.onsetTime).toBeCloseTo(s.tD, 9);
  });

  it('counts one correction for a primary reach + one secondary bump', () => {
    const trace = bumps([
      { mu: 200, sigma: 40, amp: 18000 },
      { mu: 430, sigma: 35, amp: 6600 },
    ]);
    const s = segment(trace, { onsetThresh: 900 });
    expect(s.nCorr).toBe(1);
    expect(s.tO).toBeGreaterThan(0);
  });

  it('counts two corrections for three bumps', () => {
    const trace = bumps([
      { mu: 180, sigma: 35, amp: 18000 },
      { mu: 360, sigma: 30, amp: 7500 },
      { mu: 520, sigma: 30, amp: 4500 },
    ]);
    expect(segment(trace, { onsetThresh: 900 }).nCorr).toBe(2);
  });

  it('measures detection latency from a non-zero cue time', () => {
    const trace = bumps([{ mu: 300, sigma: 40, amp: 15000 }]);
    const s = segment(trace, { onsetThresh: 900, cueTime: 100 });
    expect(s.onsetTime).toBeGreaterThan(100);
    expect(s.tD).toBeCloseTo(s.onsetTime - 100, 9);
  });

  it('throws when movement never crosses the onset threshold', () => {
    const flat = bumps([{ mu: 300, sigma: 40, amp: 300 }]);
    expect(() => segment(flat, { onsetThresh: 900 })).toThrow(RangeError);
  });

  it('the default threshold is the count-space one, and it is not 30 of anything', () => {
    // The old default was 30 deg/s, which is 30 * counts360 / 360 counts/s - a different number at
    // every gain the optimiser renders. The default is now a property of the hand.
    expect(ONSET_COUNTS_PER_SEC).toBe(600);
    const trace = bumps([{ mu: 250, sigma: 45, amp: 18000 }]);
    expect(segment(trace).onsetTime).toBe(segment(trace, { onsetThresh: ONSET_COUNTS_PER_SEC }).onsetTime);
  });
});

describe('troughDrop: the primary orient must not be ended by one jittery frame', () => {
  // A 60 Hz unsmoothed difference trace, hand written so every branch is forced. The frame at
  // t = 48 is a single-frame dip inside the acceleration ramp: it is BOTH a strict local maximum
  // at t = 32 and a strict local minimum at t = 48.
  const jitter: CountSample[] = [
    { t: 0, countsPerSec: 0 },
    { t: 16, countsPerSec: 1200 },
    { t: 32, countsPerSec: 3000 },
    { t: 48, countsPerSec: 2800 },
    { t: 64, countsPerSec: 6000 },
    { t: 80, countsPerSec: 9000 },
    { t: 96, countsPerSec: 5000 },
    { t: 112, countsPerSec: 1500 },
    { t: 128, countsPerSec: 2500 },
    { t: 144, countsPerSec: 900 },
    { t: 160, countsPerSec: 200 },
  ];

  it('the default is byte-identical to the pre-existing rule, jitter and all', () => {
    // The scored instruments were tuned against this rule. Changing it here would move nCorr and
    // tO for flick and strike, which is a retune wearing a bug fix as a costume.
    const s = segment(jitter, { onsetThresh: 600 });
    expect(s.onsetTime).toBe(16);
    expect(s.troughTime).toBe(48);
    expect(s.tO).toBe(32);
    expect(s.vPeak).toBe(3000);
    expect(s.nCorr).toBe(2);
  });

  it('troughDrop 0.5 walks past the jitter to the real end of the primary orient', () => {
    const s = segment(jitter, { onsetThresh: 600, troughDrop: 0.5 });
    expect(s.troughTime).toBe(112);
    expect(s.tO).toBe(96);
    expect(s.nCorr).toBe(1);
    // vPeak keeps its first-local-maximum meaning so strike's diagnostic does not move.
    expect(s.vPeak).toBe(3000);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/scoring/submovement.test.ts`
Expected: FAIL, `tests/scoring/submovement.test.ts (0 test)`, with
`Error: [vite] The requested module '/src/scoring/submovement.ts' does not provide an export named 'ONSET_COUNTS_PER_SEC'`
and the summary line `Test Files  1 failed (1)`.

- [ ] **Step 3: Write the minimal implementation**

Replace `src/scoring/submovement.ts` entirely with:

```ts
import type { Ms } from '../types';

/**
 * One sample of the aim's speed in COUNT SPACE: mouse counts per second, not degrees per second.
 *
 * The unit is the whole point. The onset threshold used to be fixed in deg/s, and the variable under
 * test is exactly how many degrees one count buys. So the same hand movement crossed the threshold
 * late (or never) at the slow end of the searched band and single-frame jitter crossed it at the fast
 * end: the measured onset latency and the corrective count moved WITH the sensitivity being scored.
 * A threshold that is a function of its own axis cannot separate the player from the setting. Counts
 * are what the hand emits, so a count-space threshold is a property of the player.
 * Regression: tests/instruments/recording.test.ts ('the same hand emission reads the same count
 * trace at any rendered gain').
 */
export interface CountSample {
  t: Ms;
  countsPerSec: number;
}

/**
 * Movement-onset floor in counts per second.
 *
 * This is a unit change, not a retune: 600 counts/s is the 20 deg/s both instruments passed
 * explicitly, evaluated at about 10,700 counts per 360 - the gain the shipped seed renders. It is
 * also 10 counts inside one 60 Hz frame, which is a defensible floor for "the hand has started
 * moving" independent of any gain.
 */
export const ONSET_COUNTS_PER_SEC = 600;

export interface SubmovementSeg {
  tD: Ms; // detection latency: cueTime → movement onset
  tO: Ms; // primary orient: onset → first qualifying trough after the primary peak
  tC: Ms; // confirm: trough → end of trace. 0 means no trough closed inside the trace.
  nCorr: number; // corrective sub-movements (local maxima after the trough, above onsetThresh)
  vPeak: number; // peak speed of the primary orient, counts/s
  onsetTime: Ms; // absolute time of movement onset
  /** Absolute time of the trough that ended the primary orient. Exposed so a consumer can find the
   *  frame it names by EXACT clock equality: recomputing it as `onsetTime + tO` is a float addition
   *  and is not guaranteed to reproduce the sample's own `t`, so a frame lookup keyed on that sum
   *  can miss and silently fall back to the wrong aim. Read by src/anchor/reach-observer.ts, and
   *  pinned against a fractional clock origin by tests/anchor/clock-stamp.test.ts. */
  troughTime: Ms;
}

export interface SegmentOptions {
  cueTime?: Ms; // default 0
  /** Movement-onset threshold in COUNTS PER SECOND; also the floor for counting corrections. */
  onsetThresh?: number;
  /**
   * A strict local minimum only ends the primary orient once speed has fallen to at most this
   * FRACTION of the running maximum since onset. Default Infinity means any strict local minimum
   * ends it, which is the rule the scored instruments were tuned against and which must stay
   * byte-identical. The anchor passes 0.5, because on an unsmoothed 60 Hz difference trace a single
   * jittery frame inside the acceleration ramp IS a strict local minimum, and taking it as the end
   * of the primary orient truncates the open-loop extent and therefore biases the landed fraction,
   * and so C0, LOW. Regression: tests/scoring/submovement.test.ts ('troughDrop 0.5 walks past the
   * jitter to the real end of the primary orient').
   */
  troughDrop?: number;
}

/**
 * Segment a count-space speed trace into detect / orient / confirm stages.
 * Onset = first sample crossing `onsetThresh`. Primary peak = first strict local maximum after onset.
 * Trough = first strict local minimum after that peak that also satisfies `troughDrop`. Corrective
 * sub-movements = local maxima after the trough whose speed exceeds `onsetThresh`.
 * Throws if the trace never crosses the onset threshold (no movement to segment).
 */
export function segment(trace: readonly CountSample[], opts: SegmentOptions = {}): SubmovementSeg {
  const cueTime = opts.cueTime ?? 0;
  const onsetThresh = opts.onsetThresh ?? ONSET_COUNTS_PER_SEC;
  const troughDrop = opts.troughDrop ?? Infinity;

  let onsetIdx = -1;
  for (let i = 0; i < trace.length; i++) {
    if (trace[i]!.countsPerSec >= onsetThresh) {
      onsetIdx = i;
      break;
    }
  }
  if (onsetIdx === -1) {
    throw new RangeError('segment: trace never crosses the onset threshold');
  }
  const onsetTime = trace[onsetIdx]!.t;

  // Primary peak: first strict local maximum at or after onset.
  let peakIdx = onsetIdx;
  for (let i = onsetIdx + 1; i < trace.length - 1; i++) {
    const s = trace[i]!.countsPerSec;
    if (s > trace[i - 1]!.countsPerSec && s > trace[i + 1]!.countsPerSec) {
      peakIdx = i;
      break;
    }
  }
  const vPeak = trace[peakIdx]!.countsPerSec;

  // First strict trough after the primary peak that has dropped far enough to be believable.
  // The ceiling comes from the RUNNING maximum since onset, never from vPeak: vPeak is the FIRST
  // local maximum, and the jitter frame that fabricates a trough fabricates a peak at the same
  // time, so pinning the ceiling to vPeak would pin it to the jitter too.
  let runMax = 0;
  for (let i = onsetIdx; i <= peakIdx; i++) runMax = Math.max(runMax, trace[i]!.countsPerSec);
  let troughIdx = trace.length - 1;
  for (let i = peakIdx + 1; i < trace.length - 1; i++) {
    const s = trace[i]!.countsPerSec;
    // Infinity is spelled out rather than multiplied: with an onsetThresh of 0 a flat trace can
    // reach here with runMax 0, and 0 * Infinity is NaN, which would make every comparison false
    // and silently report "no trough" on a trace that has one.
    const ceil = Number.isFinite(troughDrop) ? runMax * troughDrop : Infinity;
    if (s < trace[i - 1]!.countsPerSec && s < trace[i + 1]!.countsPerSec && s <= ceil) {
      troughIdx = i;
      break;
    }
    runMax = Math.max(runMax, s);
  }

  // Corrective sub-movements: local maxima after the trough exceeding the onset floor.
  let nCorr = 0;
  for (let i = troughIdx + 1; i < trace.length - 1; i++) {
    const s = trace[i]!.countsPerSec;
    if (s > trace[i - 1]!.countsPerSec && s >= trace[i + 1]!.countsPerSec && s > onsetThresh) {
      nCorr += 1;
    }
  }

  const troughTime = trace[troughIdx]!.t;
  const endTime = trace[trace.length - 1]!.t;
  return {
    tD: onsetTime - cueTime,
    tO: troughTime - onsetTime,
    tC: endTime - troughTime,
    nCorr,
    vPeak,
    onsetTime,
    troughTime,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/scoring/submovement.test.ts`
Expected: PASS, 8 tests (6 in `segment`, 2 in the `troughDrop` block). `npx tsc --noEmit` still reports
errors in `src/instruments/flick.ts` and `src/instruments/strike.ts` (they pass a deg/s `VelSample[]`
that no longer exists). Task 30 fixes them, and that is the branding argument working: the compiler
enumerates every call site of the unit that changed.

- [ ] **Step 5: Commit**

```bash
git add src/scoring/submovement.ts tests/scoring/submovement.test.ts
git commit -m "refactor(scoring): segment in count space, with a threshold that is not its own axis

The onset threshold was fixed in deg/s and the variable under test is how many degrees a count
buys, so the threshold moved with the sensitivity it was helping to score. It is now counts/s.
troughDrop is added for the flick anchor: on an unsmoothed 60 Hz difference trace one jittery
frame is a strict local minimum, and ending the primary orient there biases the open-loop extent
low. The default keeps the pre-existing rule byte for byte, because the scored instruments were
tuned against it."
```

### Task 30: the count trace, and both instrument call sites

**Files:**
- Modify: `src/instruments/recording.ts` (replace `speedTrace`, lines 57-66)
- Modify: `src/instruments/flick.ts` (the `segment` call and its two imports)
- Modify: `src/instruments/strike.ts` (the `segment` call, its two imports, the `vPeak` comment)
- Test: `tests/instruments/recording.test.ts` (replace the `speedTrace` describe block, lines 26-35)

`speedTrace` today is:

```ts
/** Angular speed (deg/s) between consecutive frames. */
export function speedTrace(frames: readonly Frame[]): Array<{ t: Ms; speed: number }>
```

Grepped consumers, exhaustively: `src/instruments/strike.ts:4,113`, `src/instruments/flick.ts:21,199`,
`tests/instruments/recording.test.ts:2,26-35`. Nothing else imports it. It is deleted, not kept
alongside, so the compiler enumerates the call sites: a deg/s trace and a counts/s trace are the same
shape and a silent mix would be invisible. `degreesPerCount(counts: Counts360): Degrees` comes from
`src/convert/counts.ts`, created in phase 1a. `separation` is already imported at the top of
`recording.ts`, so `countTrace` needs no new import for it.

- [ ] **Step 1: Write the failing test**

In `tests/instruments/recording.test.ts`, replace the whole `describe('speedTrace', ...)` block
(lines 26-35) with the following, and change the import on line 2 to
`import { TrialRecorder, countTrace, timeOnTarget, missComponents, type Frame } from '../../src/instruments/recording';`
and add `import { segment, ONSET_COUNTS_PER_SEC } from '../../src/scoring/submovement';` plus
`import { counts360 } from '../../src/types';`:

```ts
describe('countTrace', () => {
  /** Counts the hand emits in each successive 16 ms frame. One primary bump, one correction. */
  const EMISSION = [0, 12, 40, 90, 60, 20, 4, 2, 18, 6] as const;

  /** The frames those counts produce when the arena renders `rendered` counts per 360. */
  function framesFor(rendered: number): Frame[] {
    const degPerCount = 360 / rendered;
    const out: Frame[] = [{ t: 0, aim: [0, 0], target: null, targetRadius: null }];
    let yaw = 0;
    for (let i = 0; i < EMISSION.length; i++) {
      yaw += EMISSION[i]! * degPerCount;
      out.push({ t: (i + 1) * 16, aim: [yaw, 0], target: null, targetRadius: null });
    }
    return out;
  }

  /** The deg/s trace the segmenter used to be handed, kept here as the teeth of the test. */
  function degSpeeds(frames: readonly Frame[]): number[] {
    const out: number[] = [];
    for (let i = 1; i < frames.length; i++) {
      out.push(Math.abs(frames[i]!.aim[0] - frames[i - 1]!.aim[0]) / ((frames[i]!.t - frames[i - 1]!.t) / 1000));
    }
    return out;
  }

  it('is the emitted counts per second, whatever the frame spacing', () => {
    const trace = countTrace(framesFor(6000), counts360(6000));
    expect(trace).toHaveLength(EMISSION.length);
    expect(trace[1]!.countsPerSec).toBeCloseTo(12 / 0.016, 6);
    expect(trace[3]!.countsPerSec).toBeCloseTo(90 / 0.016, 6);
    expect(trace[3]!.t).toBe(64);
  });

  it('the same hand emission reads the same count trace at any rendered gain', () => {
    const slow = countTrace(framesFor(6000), counts360(6000));
    const fast = countTrace(framesFor(18000), counts360(18000));
    expect(fast).toHaveLength(slow.length);
    for (let i = 0; i < slow.length; i++) {
      expect(fast[i]!.countsPerSec).toBeCloseTo(slow[i]!.countsPerSec, 6);
    }
    // Teeth: the SAME emission renders three times the angular speed at 6000 counts/360 as at
    // 18000, so a threshold fixed in deg/s provably cannot return the same onset for both.
    expect(degSpeeds(framesFor(6000))[1]!).toBeCloseTo(3 * degSpeeds(framesFor(18000))[1]!, 6);
  });

  it('and therefore segments identically at both gains', () => {
    const a = segment(countTrace(framesFor(6000), counts360(6000)), { onsetThresh: ONSET_COUNTS_PER_SEC });
    const b = segment(countTrace(framesFor(18000), counts360(18000)), { onsetThresh: ONSET_COUNTS_PER_SEC });
    // The first frame pair emits nothing, so onset is the second sample: EMISSION[1] = 12 counts in
    // 16 ms is 750 counts/s, the first sample over the 600 floor.
    expect(a.onsetTime).toBe(32);
    expect(a.nCorr).toBe(1);
    expect(b.onsetTime).toBe(a.onsetTime);
    expect(b.nCorr).toBe(a.nCorr);
    expect(b.vPeak).toBeCloseTo(a.vPeak, 6);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/instruments/recording.test.ts`
Expected: FAIL, `tests/instruments/recording.test.ts (0 test)`, with
`Error: [vite] The requested module '/src/instruments/recording.ts' does not provide an export named 'countTrace'`
and the summary line `Test Files  1 failed (1)`.

- [ ] **Step 3: Write the minimal implementation**

In `src/instruments/recording.ts`, add to the imports at the top:

```ts
import type { Counts360 } from '../types';
import type { CountSample } from '../scoring/submovement';
import { degreesPerCount } from '../convert/counts';
```

and replace `speedTrace` (lines 57-66) with:

```ts
/**
 * Frames → the aim's speed in COUNT SPACE, given the counts per 360 the trial RENDERED.
 *
 * This replaces the deg/s `speedTrace`. Angular speed is the product of what the hand did and the
 * gain under test, so every threshold applied to it was a threshold on the axis being measured. The
 * conversion is exact and known: the arena rendered `rendered`, so one count is `360 / rendered`
 * degrees and dividing it back out recovers what the hand emitted. It is not an estimate.
 * The magnitude is unsigned, matching the segmenter's contract; direction lives in the aim samples.
 */
export function countTrace(frames: readonly Frame[], rendered: Counts360): CountSample[] {
  const degPerCount = degreesPerCount(rendered);
  const out: CountSample[] = [];
  for (let i = 1; i < frames.length; i++) {
    const dtSec = (frames[i]!.t - frames[i - 1]!.t) / 1000;
    if (dtSec <= 0) continue;
    const deg = separation(frames[i - 1]!.aim, frames[i]!.aim);
    out.push({ t: frames[i]!.t, countsPerSec: deg / degPerCount / dtSec });
  }
  return out;
}
```

In `src/instruments/flick.ts` change line 20 to
`import { segment, ONSET_COUNTS_PER_SEC } from '../scoring/submovement';`, line 21 to
`import { missComponents, countTrace, type Frame } from './recording';`, and line 199 to:

```ts
          nCorr = segment(countTrace(reachFrames, ctx.counts), { onsetThresh: ONSET_COUNTS_PER_SEC }).nCorr;
```

In `src/instruments/strike.ts` change line 3 to
`import { segment, ONSET_COUNTS_PER_SEC } from '../scoring/submovement';`, line 4 to
`import { countTrace, type Frame } from './recording';`, line 14 to
`  vPeak: number; // peak speed of the primary orient, counts/s (a raw diagnostic, not scored)`,
line 113 to `        const tr = countTrace(frames, ctx.counts);`, and line 117 to:

```ts
          const seg = segment(tr, { onsetThresh: ONSET_COUNTS_PER_SEC, cueTime: presentedAt });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/instruments/recording.test.ts tests/instruments/flick.test.ts tests/instruments/strike.test.ts tests/instruments/acclimation.test.ts tests/instruments/clock-stamp.test.ts`
Expected: PASS, with `tests/instruments/recording.test.ts` at 12 tests (the 9 that were not the
`speedTrace` case, plus the 3 above). Then `npx tsc --noEmit` is clean and `npm test` is green.

If `tests/instruments/acclimation.test.ts` or `tests/instruments/strike.test.ts` moves, it will be
because onset now fires on a different frame of those fixtures' scripted two-tick reaches, which
changes `tR`/`tS` by one frame. That is a real behaviour change and the honest fix is in the fixture,
never in `ONSET_COUNTS_PER_SEC`: the constant is pinned to 20 deg/s at the seed gain by the comment
in `submovement.ts`, and moving it to make a test pass would be retuning the instrument. Widen the
fixture's scripted reach to three ticks so onset lands strictly inside the ramp.

- [ ] **Step 5: Commit**

```bash
git add src/instruments/recording.ts src/instruments/flick.ts src/instruments/strike.ts tests/instruments/recording.test.ts
git commit -m "refactor(instruments): countTrace replaces speedTrace, and both segmenter callers move

speedTrace is deleted rather than kept beside countTrace so tsc enumerates the call sites: a deg/s
trace and a counts/s trace are the same shape and a silent mix would be invisible. strike's
raw.vPeak changes unit with it, and is a diagnostic only."
```

### Task 31: acclimation publishes the lead-in budget, and records the reversal

**Files:**
- Modify: `src/instruments/acclimation.ts` (module doc, plus `leadInReaches` extracted from `planAcclimation`)
- Test: `tests/instruments/acclimation.test.ts` (one added describe block)

Today `planAcclimation` is the only thing that knows the budget, and it is called by the instrument:

```ts
export function planAcclimation(ctx: TrialContext, id: InstrumentId): AcclimationPlan {
  const s = acclimationScale(ctx);
  return {
    reaches: Math.round(LEAD_REACHES_MIN + (LEAD_REACHES_MAX - LEAD_REACHES_MIN) * s),
    ms: Math.round(LEAD_MS_MIN + (LEAD_MS_MAX - LEAD_MS_MIN) * s),
    rng: mulberry32(leadSeed(ctx, id)),
  };
}
```

The file's `ctx.cm360` / `ctx.dpi` references are renamed by phase 1a before this task runs (hand-off
item 2 below), so `acclimationScale` and `leadSeed` already read `ctx.counts` here. The test file's
`ctx` helper is `(rngSeed: number, prevCounts?: number)` after that rename, and `CM` is its own
in-file constant, so the calls below are positional and survive it.

- [ ] **Step 1: Write the failing test**

In `tests/instruments/acclimation.test.ts`, add `leadInReaches,` to the import list from
`'../../src/instruments/acclimation'` (line 8 area), and append this describe block at the end of the
file:

```ts
describe('the lead-in budget is a pure query, because the observational channel needs it', () => {
  it('leadInReaches agrees with the plan for every arrival', () => {
    for (const prev of [CM, CM * 2, CM * Math.SQRT2, CM / 4, FAR, undefined]) {
      const c = ctx(1, prev);
      expect(leadInReaches(c), `arrival ${String(prev)}`).toBe(planAcclimation(c, 'flick').reaches);
    }
    expect(leadInReaches(ctx(1, CM))).toBe(LEAD_REACHES_MIN);
    expect(leadInReaches(ctx(1))).toBe(LEAD_REACHES_MAX);
  });

  it('it does not depend on the instrument, because the reversal it serves does not', () => {
    // The observational channel labels reach ORDINALS, and the ordinal of the first reach at a new
    // gain is 0 whichever instrument is presenting it. A signature that took an InstrumentId would
    // invite a per-instrument budget that the adaptation literature does not support.
    const c = ctx(1, FAR);
    expect(leadInReaches(c)).toBe(planAcclimation(c, 'strike').reaches);
    expect(leadInReaches(c)).toBe(planAcclimation(c, 'calibrate').reaches);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/instruments/acclimation.test.ts`
Expected: FAIL, `tests/instruments/acclimation.test.ts (0 test)`, with
`Error: [vite] The requested module '/src/instruments/acclimation.ts' does not provide an export named 'leadInReaches'`
and the summary line `Test Files  1 failed (1)`.

- [ ] **Step 3: Write the minimal implementation**

In `src/instruments/acclimation.ts`, append this paragraph to the module docstring, immediately
before the `Determinism:` paragraph:

```
 * The reversal, recorded because this file was built on the opposite premise. The lead-in exists
 * because the adaptation transient is contamination. The flick anchor (src/anchor/flick-anchor.ts)
 * exists because that same transient is the only place the player's own believed gain is legible: a
 * reach launched before vision has corrected it is launched from the internal model, and belief is
 * precisely what the discarded reaches carry. So the transient is now measured and then discarded
 * from scoring, in that order, and the anchor's within-trial reach ordinal counts from the FIRST
 * lead-in reach rather than the first scored one - reading it from the scored reaches instead would
 * start the ordinal at `reaches`, and the adaptation term is geometric in the ordinal, so the
 * intercept the anchor is built on would already have decayed away before the first observation.
 * Nothing about scoring changes. The channel reads and never writes the scored Recording, pinned by
 * tests/anchor/reach-observer.test.ts ('the scored recording is byte-identical with the anchor
 * recorder attached').
```

Then replace `planAcclimation` with:

```ts
/**
 * The reach count the scorer will discard for this trial, as a pure integer query.
 *
 * Exposed separately from `planAcclimation` because the observational channel needs the number and
 * must NOT construct a plan to get it: a plan carries the private lead-in rng, and handing a second
 * generator seeded from the trial identity to the read-only side would make the observer look like a
 * source of target geometry, which is exactly the confusion the private-rng rule exists to prevent.
 * No InstrumentId parameter, because the budget has never depended on one and the shared literature
 * (fast-process reaches, not per-drill tuning) gives no basis for it to start.
 */
export function leadInReaches(ctx: TrialContext): number {
  return Math.round(LEAD_REACHES_MIN + (LEAD_REACHES_MAX - LEAD_REACHES_MIN) * acclimationScale(ctx));
}

export function planAcclimation(ctx: TrialContext, id: InstrumentId): AcclimationPlan {
  const s = acclimationScale(ctx);
  return {
    reaches: leadInReaches(ctx),
    ms: Math.round(LEAD_MS_MIN + (LEAD_MS_MAX - LEAD_MS_MIN) * s),
    rng: mulberry32(leadSeed(ctx, id)),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/instruments/acclimation.test.ts`
Expected: PASS, 11 tests (the 9 already in the file plus the 2 added here).

- [ ] **Step 5: Commit**

```bash
git add src/instruments/acclimation.ts tests/instruments/acclimation.test.ts
git commit -m "feat(acclimation): publish the lead-in budget, and record the reversal

The lead-in was built to throw the adaptation transient away as contamination. The flick anchor
needs that transient, because a reach launched before vision corrects it is launched from the
believed gain. Measured first, discarded from scoring second. The budget becomes a pure query so
the observational side never constructs a plan and its private rng."
```

### Task 32: the joint fit over belief, bias and adaptation rate

**Files:**
- Create: `src/anchor/flick-anchor.ts`
- Test: `tests/anchor/flick-anchor.test.ts`

This is the estimator, and it comes FIRST of the two anchor modules on purpose: it imports nothing
from the observer, while the observer imports `FirstReach` from here. The earlier draft had them the
other way round and offered the engineer three ways to work around the cycle, which is a placeholder
wearing a disclaimer. Findings F29 and amendment A8 swap them; task 33 is the observer.

The model, stated once so the code below is readable. Reach `j` of a trial rendering `C_r`:

```
ln f = (ln B0 - ln C_r) * rate^j + bias + noise
```

`B0` is the belief the player walked in with, `bias` is the deliberate undershoot in log units, `rate`
is the per-reach retention of the log belief error. For a FIXED rate the model is linear in
`(ln B0, bias)`, because `ln f + rate^j * ln C_r = rate^j * ln B0 + bias`. So the estimator profiles
`rate` on a grid and solves two normal equations at each one. Nothing iterative, nothing seeded,
deterministic.

Pinning `bias` from the adapted tail was measured at 9.5 percent against 4.6 for this joint fit,
because the tail is never fully adapted and a biased point estimate propagates. Do not reintroduce
it as a simplification.

- [ ] **Step 1: Write the failing test**

Create `tests/anchor/flick-anchor.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  anchorFromReaches,
  ADAPT_RATE_MAX,
  ADAPT_RATE_MIN,
  FLICK_FLOOR_LOG_SD,
  FLICK_MIN_LEVELS,
  FLICK_MIN_REACHES,
  type FirstReach,
} from '../../src/anchor/flick-anchor';
import { counts360 } from '../../src/types';
import { mulberry32 } from '../../src/stats/rng';

const TRUE_B0 = 9000;
const TRUE_BIAS = Math.log(0.94); // a 6 percent deliberate undershoot, the cheap correction
const TRUE_RATE = 0.6;
const LEVELS = [6300, 7200, 8100, 9000, 9900, 10800, 11700, 12600]; // the searched band, 2x wide
const TRIALS = 24; // past the 22-trial plateau
const PER_TRIAL = 12;

const gauss = (r: () => number): number => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

/** An adapting player with a stable belief, a persistent undershoot, and flick noise. */
function simulate(opts: { rate?: number; noise?: number; seed?: number; trials?: number; levels?: number[] } = {}): FirstReach[] {
  const rate = opts.rate ?? TRUE_RATE;
  const noise = opts.noise ?? 0.08;
  const levels = opts.levels ?? LEVELS;
  const rng = mulberry32(opts.seed ?? 0xa11c);
  const out: FirstReach[] = [];
  for (let t = 0; t < (opts.trials ?? TRIALS); t++) {
    const rendered = levels[t % levels.length]!;
    const e0 = Math.log(TRUE_B0) - Math.log(rendered);
    for (let j = 0; j < PER_TRIAL; j++) {
      const lnF = e0 * Math.pow(rate, j) + TRUE_BIAS + noise * gauss(rng);
      out.push({ rendered: counts360(rendered), landedFraction: Math.exp(lnF), index: j });
    }
  }
  return out;
}

describe('anchorFromReaches', () => {
  it('recovers a known adapting player from every reach of every trial', () => {
    const a = anchorFromReaches(simulate());
    if (a.identifiable !== true) throw new Error(`expected identifiable, got refusal: ${a.reason}`);
    expect(a.counts / TRUE_B0).toBeGreaterThan(0.94);
    expect(a.counts / TRUE_B0).toBeLessThan(1.06);
    expect(a.adaptRate).toBeGreaterThan(TRUE_RATE - 0.15);
    expect(a.adaptRate).toBeLessThan(TRUE_RATE + 0.15);
    expect(a.bias).toBeGreaterThan(TRUE_BIAS - 0.06);
    expect(a.bias).toBeLessThan(TRUE_BIAS + 0.06);
    // The interval covers the truth, and never claims better than the 4.6 percent the estimator
    // has actually demonstrated across simulated sessions.
    expect(a.logSd).toBeGreaterThanOrEqual(FLICK_FLOOR_LOG_SD);
    expect(Math.abs(Math.log(a.counts / TRUE_B0))).toBeLessThan(3 * a.logSd);
  });

  it('is deterministic: the same reaches twice give the identical object', () => {
    expect(anchorFromReaches(simulate())).toEqual(anchorFromReaches(simulate()));
  });

  it('the reach ordinal is load-bearing, and flattening it collapses the design', () => {
    // With every ordinal 0 the adaptation column is all ones, identical to the intercept, so belief
    // and bias are the same column. Two of three parameters is not the estimator; it refuses.
    const flat = simulate().map((r) => ({ ...r, index: 0 }));
    expect(anchorFromReaches(flat)).toEqual({ identifiable: false, reason: 'too-few-reaches' });
  });

  it('using only the opening reach of each trial is not enough data to speak', () => {
    // 13.7 percent MAE against 4.6 for every reach: the first-reach-only estimator was measured and
    // rejected. The refusal floor makes reintroducing it impossible by accident rather than by memo.
    const openersOnly = simulate().filter((r) => r.index === 0);
    expect(openersOnly.length).toBeLessThan(FLICK_MIN_REACHES);
    expect(anchorFromReaches(openersOnly)).toEqual({ identifiable: false, reason: 'too-few-reaches' });
  });

  it('the constants are the ones the comments justify', () => {
    expect(FLICK_MIN_REACHES).toBe(40);
    expect(FLICK_MIN_LEVELS).toBe(6);
    expect(ADAPT_RATE_MIN).toBe(0.05);
    expect(ADAPT_RATE_MAX).toBe(0.95);
    expect(FLICK_FLOOR_LOG_SD).toBeCloseTo(0.058, 12);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/anchor/flick-anchor.test.ts`
Expected: FAIL, `tests/anchor/flick-anchor.test.ts (0 test)`, with
`Error: Failed to load url ../../src/anchor/flick-anchor (resolved id: ../../src/anchor/flick-anchor) in /<repo>/tests/anchor/flick-anchor.test.ts. Does the file exist?`
and the summary line `Test Files  1 failed (1)`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/anchor/flick-anchor.ts`:

```ts
import type { Counts360 } from '../types';
import { counts360 } from '../types';

/**
 * One open-loop reach.
 *
 * The name is the contract's and it means the FIRST SUBMOVEMENT of a reach, not the first reach of a
 * trial. That distinction is the whole instrument: using one reach per trial was measured at 13.7
 * percent mean absolute error and is not worth building, and using every reach at 4.6 percent, which
 * is why this ships. `index` is the reach's ordinal WITHIN its trial, counting from the first
 * acclimation lead-in reach (src/instruments/acclimation.ts records the reversal). An index of 0 is
 * therefore also the trial boundary, which is how the fit groups reaches without a trial id.
 */
export interface FirstReach {
  rendered: Counts360;
  landedFraction: number;
  index: number;
}

export interface FlickAnchor {
  identifiable: true;
  /** The believed counts per 360 the player walked in with: B0. */
  counts: Counts360;
  /** Standard error of ln(counts) from the fit's own residuals, floored. Never narrower. */
  logSd: number;
  /** The persistent motor bias in LOG units. Negative is the expected deliberate undershoot. */
  bias: number;
  /** Per-reach retention of the log belief error. 0 is instant re-anchoring, 1 is no adaptation. */
  adaptRate: number;
}

export interface FlickRefusal {
  identifiable: false;
  reason: 'no-covariance' | 'adapt-rate-at-bound' | 'too-few-reaches';
}

/** Reaches below this cannot support three parameters and their own residual spread. */
export const FLICK_MIN_REACHES = 40;
/** Distinct rendered gains below this leave ln(rendered) with too little range to identify B0. */
export const FLICK_MIN_LEVELS = 6;
export const ADAPT_RATE_MIN = 0.05;
export const ADAPT_RATE_MAX = 0.95;
/** Grid resolution for the profiled rate: rate = k / RATE_GRID for k in 0..RATE_GRID-1. */
export const RATE_GRID = 200;
/** One-sided critical value for the covariance precondition: the 99th percentile of the normal. */
export const COVARIANCE_MIN_Z = 2.3263478740408408;
/**
 * The floor on `logSd`, in log units.
 *
 * 4.6 percent mean absolute error is the best this estimator has ever demonstrated across simulated
 * sessions. For a lognormal, relative MAE is about 0.7979 times sigma, so 0.046 / 0.7979 is 0.0577.
 * A single session's OLS standard error can come out below that by luck, and reporting it would claim
 * precision the estimator has never shown. The floor only ever widens.
 */
export const FLICK_FLOOR_LOG_SD = 0.0577 + 0.0003;

interface Fit {
  lnB0: number;
  bias: number;
  rate: number;
  sse: number;
  varLnB0: number;
}

/**
 * Least squares at a FIXED rate. `ln f + rate^j * ln C_r = rate^j * ln B0 + bias` is linear in the
 * two unknowns, so this is a 2x2 normal-equation solve and there is nothing to seed or iterate.
 * Returns null when the design is singular, which is what happens as rate approaches 1: the
 * adaptation column becomes the intercept column and belief cannot be told from bias.
 */
function fitAt(rate: number, lnF: readonly number[], lnR: readonly number[], idx: readonly number[]): Fit | null {
  const n = lnF.length;
  let s11 = 0;
  let s12 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.pow(rate, idx[i]!);
    const y = lnF[i]! + w * lnR[i]!;
    s11 += w * w;
    s12 += w;
    b1 += w * y;
    b2 += y;
  }
  const det = s11 * n - s12 * s12;
  if (!(det > 1e-9)) return null;
  const lnB0 = (b1 * n - b2 * s12) / det;
  const bias = (b2 * s11 - b1 * s12) / det;
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.pow(rate, idx[i]!);
    const r = lnF[i]! + w * lnR[i]! - (w * lnB0 + bias);
    sse += r * r;
  }
  // Three parameters: lnB0, bias, and the profiled rate. Charging the rate a degree of freedom is
  // what keeps the standard error from reading as though the rate had been known in advance.
  const dof = n - 3;
  const varLnB0 = dof > 0 ? (sse / dof) * (n / det) : Infinity;
  return { lnB0, bias, rate, sse, varLnB0 };
}

/** Pearson correlation. Returns 0 when either series has no spread. */
function correlation(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i]!;
    mb += b[i]!;
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]! - ma;
    const y = b[i]! - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  if (!(da > 0) || !(db > 0)) return 0;
  return num / Math.sqrt(da * db);
}

/**
 * The joint fit over belief, motor bias and adaptation rate, with the two guards that keep it from
 * answering when it should not.
 *
 * Why a joint fit rather than the obvious simplification. Pinning the bias from the player's adapted
 * tail and subtracting it was measured at 9.5 percent against 4.6, because the tail is never fully
 * adapted and a biased point estimate propagates into every trial's intercept. The persistent
 * undershoot is what makes this identifiable rather than what breaks it: belief washes out with
 * exposure and bias does not, so the curvature separates them.
 *
 * The conflict with the allocator, documented rather than silently absorbed. Simulation put the
 * anchor's error at 4.5 percent with a 1.3x explored band rising to 11.2 percent at 4x, so the
 * anchor wants a NARROW band. The c-optimality screen in src/optimizer/evolution.ts wants the
 * opposite, because a parabola's vertex is worst determined by points crowded around it. And the
 * covariance precondition below needs ln(rendered) to vary at all, which pulls the same way as the
 * allocator. This code resolves nothing: it refuses when the band has narrowed past identifiability,
 * and it carries the cost of a wide band in `logSd`, measured from the fit's own residuals rather
 * than assumed. Nothing here reweights the allocator, because letting the anchor steer trial
 * placement would put a measurement in charge of its own design.
 */
export function anchorFromReaches(reaches: readonly FirstReach[]): FlickAnchor | FlickRefusal {
  const usable = reaches.filter(
    (r) =>
      Number.isFinite(r.landedFraction) &&
      r.landedFraction > 0 &&
      Number.isFinite(r.rendered) &&
      r.rendered > 0 &&
      Number.isInteger(r.index) &&
      r.index >= 0,
  );
  const levels = new Set(usable.map((r) => r.rendered)).size;
  if (usable.length < FLICK_MIN_REACHES || levels < FLICK_MIN_LEVELS) {
    return { identifiable: false, reason: 'too-few-reaches' };
  }

  const lnF = usable.map((r) => Math.log(r.landedFraction));
  const lnR = usable.map((r) => Math.log(r.rendered));
  const idx = usable.map((r) => r.index);

  // Guard one: landedFraction must demonstrably covary with the RECIPROCAL of the rendered gain.
  //
  // With no signal at all this estimator returned 28 percent mean absolute error and a range of
  // minus 43 to plus 61 percent, and it returned them confidently. The model says the opening reach
  // of each trial has ln f = ln B0 - ln C_r + bias, so a slope of exactly -1 on ln(rendered), which
  // means the correlation of ln f with ln(rendered) must be strongly NEGATIVE before the fit is
  // allowed to speak. Tested on the opening reaches only, where adaptation has not yet attenuated
  // the term. One-sided on purpose: a positive covariance is not weaker evidence of belief, it is
  // evidence of something else entirely, and it must refuse rather than fit a sign flip.
  const openers = usable.map((r, i) => ({ f: lnF[i]!, r: lnR[i]!, index: r.index })).filter((o) => o.index === 0);
  const rho = -correlation(
    openers.map((o) => o.f),
    openers.map((o) => o.r),
  );
  // Fisher z, clamped so a degenerate perfect correlation is a large finite number rather than
  // Infinity, and refusing outright below five trials where the transform has no calibration.
  const clamped = Math.max(-0.999999, Math.min(0.999999, rho));
  const z = openers.length >= 5 ? Math.atanh(clamped) * Math.sqrt(openers.length - 3) : 0;
  if (!(z >= COVARIANCE_MIN_Z)) {
    return { identifiable: false, reason: 'no-covariance' };
  }

  // Profile the rate. rate = 1 is not searched: the design is exactly singular there, and the
  // refusal bound at ADAPT_RATE_MAX is what catches a player heading toward it.
  let best: Fit | null = null;
  for (let k = 0; k < RATE_GRID; k++) {
    const fit = fitAt(k / RATE_GRID, lnF, lnR, idx);
    if (fit === null || !Number.isFinite(fit.sse)) continue;
    if (best === null || fit.sse < best.sse) best = fit;
  }
  if (best === null) {
    // No rate on the grid produced a solvable design. That is a statement about the data, not a
    // numerical accident: it happens when the reach ordinals carry no variation, so the adaptation
    // column is the intercept column and two of three parameters are all the design can hold.
    return { identifiable: false, reason: 'too-few-reaches' };
  }

  // Guard two: the fitted adaptation rate pinning at a boundary.
  //
  // At the lower bound the player re-anchors on whatever gain was just rendered, so only the opening
  // reach of each trial carries belief and every later one is pure bias. Simulation put that player
  // at 12.7 percent while the estimator still answered, and the pin is its signature. At the upper
  // bound the player does not adapt within the trial at all, and then the intercept and the
  // asymptote are the same column, so the belief mismatch cannot be separated from the motor bias
  // however good the residuals look. Both are one refusal, because both mean the same thing: three
  // parameters were fitted and only two were identified.
  if (best.rate <= ADAPT_RATE_MIN || best.rate >= ADAPT_RATE_MAX) {
    return { identifiable: false, reason: 'adapt-rate-at-bound' };
  }

  const counts = Math.exp(best.lnB0);
  const sd = Math.sqrt(best.varLnB0);
  if (!Number.isFinite(counts) || !(counts > 0) || !Number.isFinite(sd)) {
    return { identifiable: false, reason: 'too-few-reaches' };
  }
  return {
    identifiable: true,
    counts: counts360(counts),
    logSd: Math.max(FLICK_FLOOR_LOG_SD, sd),
    bias: best.bias,
    adaptRate: best.rate,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/anchor/flick-anchor.test.ts`
Expected: PASS, 5 tests. `npx tsc --noEmit` is clean: this file imports nothing that does not exist
yet, which is why it lands before the observer.

If the recovery test's tolerances fail, read the numbers before touching them. The two that can
legitimately be loosened once are `adaptRate` and `bias`, because their precision was never
simulated. `a.counts / TRUE_B0` inside 0.94 to 1.06 is the 4.6 percent claim itself and must not be
loosened: if it fails, the fit is wrong, not the tolerance. Print `a` and check whether `adaptRate`
is pinned, which would mean the simulated band is too narrow for identifiability rather than the
estimator being broken.

- [ ] **Step 5: Commit**

```bash
git add src/anchor/flick-anchor.ts tests/anchor/flick-anchor.test.ts
git commit -m "feat(anchor): the joint fit over belief, motor bias and adaptation rate

Every reach of every trial, because one reach per trial was 13.7 percent and every reach is 4.6.
The bias is fitted jointly rather than pinned from the adapted tail: pinning measured 9.5 percent,
because the tail is never fully adapted and a biased point estimate propagates. The rate is
profiled on a grid and each rate is a 2x2 solve, so there is nothing to seed. The band-width
conflict with the c-optimality allocator is documented in the file rather than absorbed."
```

### Task 33: the reach observer, which reads and never writes

**Files:**
- Create: `src/anchor/reach-observer.ts`
- Test: `tests/anchor/reach-observer.test.ts`

Everything it needs already exists: `ArenaScene.onFrame(cb) => () => void`, `TargetHandle` with
`id`, `bearing()`, `radiusDeg()`, `Frame`, `missComponents(start, target, landing)` returning
`{ radial, tangential, reach }` with the ±180 seam handled, `countTrace`, `segment`. It imports
`FirstReach` from `src/anchor/flick-anchor.ts`, which task 32 created, so nothing here is forward
declared.

One disclosure, because the spec should say it and does not: `src/anchor/reach-observer.ts` is a new
module absent from the spec's "New, pure" list, and it is NOT pure. It is a stateful observer that
subscribes to a frame stream and accumulates. It writes nothing outside itself, which is the property
that matters and the one the byte-identical test below pins, but "pure" would be the wrong word and an
engineer reading the spec's module list will not find this file there.

- [ ] **Step 1: Write the failing test**

Create `tests/anchor/reach-observer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ReachObserver, PRIMARY_TROUGH_DROP } from '../../src/anchor/reach-observer';
import { TrialRecorder } from '../../src/instruments/recording';
import { counts360 } from '../../src/types';
import type { TargetHandle } from '../../src/types';
import { FakeScene } from '../instruments/fake-scene';

/**
 * The anchor's arithmetic, stated once: the arena rendered C_r counts per 360 and the player emits
 * counts from a belief of C_0, so a reach intended to cover D degrees emits D * C_0 / 360 counts and
 * therefore lands D * C_0 / C_r degrees along. The fraction of the way it lands IS C_0 / C_r, and
 * landedFraction * rendered is C_0 with the rendered gain cancelling exactly.
 */

/** Per-frame share of the primary displacement. Sums to 1.00 at index 6, then corrects. */
const FRACTIONS = [0, 0.06, 0.26, 0.44, 0.18, 0.04, 0.02, 0.12, 0.05, 0.01] as const;

function driveReach(rendered: number, believed: number, intended: number, shares: readonly number[] = FRACTIONS) {
  const scene = new FakeScene();
  let handle: TargetHandle | null = null;
  const obs = new ReachObserver(scene, () => handle);
  obs.beginTrial(counts360(rendered), 1);
  handle = scene.spawnTarget({ kind: 'static', yaw: intended, pitch: 0, distance: 20, worldRadius: 0.6 });
  const primary = intended * (believed / rendered);
  let yaw = 0;
  for (const share of shares) {
    scene.tick(16, [yaw, 0]);
    yaw += share * primary;
  }
  handle = null;
  scene.tick(16, [yaw, 0]); // the target is gone, so the observer closes the reach
  obs.stop();
  return obs;
}

describe('ReachObserver', () => {
  it('reads the open-loop reach as the ratio of rendered gain to believed gain', () => {
    const slow = driveReach(6000, 9000, 30).observed();
    expect(slow).toHaveLength(1);
    expect(slow[0]!.landedFraction).toBeCloseTo(1.5, 6);
    expect(slow[0]!.index).toBe(0);
    expect(slow[0]!.leadIn).toBe(true);
    expect(slow[0]!.rendered).toBe(6000);

    const fast = driveReach(18000, 9000, 30).observed();
    expect(fast[0]!.landedFraction).toBeCloseTo(0.5, 6);

    // The rendered gain cancels: both reaches recover the same believed gain.
    expect(slow[0]!.landedFraction * slow[0]!.rendered).toBeCloseTo(9000, 3);
    expect(fast[0]!.landedFraction * fast[0]!.rendered).toBeCloseTo(9000, 3);
  });

  it('drops a reach whose primary orient never closed, rather than squeezing it toward 1', () => {
    // A monotone ramp has no trough, so the trace cannot say where the open-loop reach ended.
    // Taking the whole recorded motion as the primary would read a landedFraction near 1 and
    // therefore a C0 near the rendered gain: a fabricated agreement, which is strictly worse than
    // no observation, because the fit would take it as evidence.
    const obs = driveReach(6000, 9000, 30, [0, 0.05, 0.1, 0.2, 0.35, 0.55]);
    expect(obs.observed()).toHaveLength(0);
    expect(obs.reaches()).toHaveLength(0);
  });

  it('numbers reaches from the first lead-in reach and resets on a new trial', () => {
    const scene = new FakeScene();
    let handle: TargetHandle | null = null;
    const obs = new ReachObserver(scene, () => handle);
    const play = (rendered: number, believed: number, count: number): void => {
      obs.beginTrial(counts360(rendered), 2);
      for (let r = 0; r < count; r++) {
        const start = scene.view()[0];
        handle = scene.spawnTarget({ kind: 'static', yaw: start + 30, pitch: 0, distance: 20, worldRadius: 0.6 });
        let yaw = start;
        for (const share of FRACTIONS) {
          scene.tick(16, [yaw, 0]);
          yaw += share * 30 * (believed / rendered);
        }
        handle = null;
        scene.tick(16, [yaw, 0]);
      }
    };
    play(6000, 9000, 4);
    play(12000, 9000, 3);
    obs.stop();
    const seen = obs.observed();
    expect(seen.map((r) => r.index)).toEqual([0, 1, 2, 3, 0, 1, 2]);
    expect(seen.map((r) => r.leadIn)).toEqual([true, true, false, false, true, true, false]);
    expect(obs.discardedByScoring()).toBe(4);
    expect(new Set(seen.map((r) => r.rendered))).toEqual(new Set([6000, 12000]));
    for (const r of seen) expect(r.landedFraction * r.rendered).toBeCloseTo(9000, 3);
  });

  it('the scored recording is byte-identical with the anchor recorder attached', () => {
    // The integrity invariant: the anchor is an observer. It subscribes to the same frame stream
    // the scorer does and it never touches the Recording, so attaching it cannot change a score.
    // Byte-identical is asserted rather than "equal within tolerance" on purpose - a tolerance
    // would hide exactly the kind of shared-state leak this is here to catch.
    const run = (attach: boolean): string => {
      const scene = new FakeScene();
      let handle: TargetHandle | null = null;
      const rec = new TrialRecorder(scene, () => handle);
      const obs = attach ? new ReachObserver(scene, () => handle) : null;
      obs?.beginTrial(counts360(9000), 1);
      for (let r = 0; r < 3; r++) {
        handle = scene.spawnTarget({ kind: 'static', yaw: 20, pitch: 0, distance: 20, worldRadius: 0.6 });
        let yaw = 0;
        for (const share of FRACTIONS) {
          scene.tick(16, [yaw, 0]);
          yaw += share * 25;
        }
        scene.fire([yaw, 0]);
        handle = null;
        scene.tick(16, [yaw, 0]);
      }
      rec.stop();
      obs?.stop();
      return JSON.stringify(rec.recording());
    };
    expect(run(true)).toBe(run(false));
  });

  it('the trough drop it passes is the one the jitter test pins', () => {
    expect(PRIMARY_TROUGH_DROP).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/anchor/reach-observer.test.ts`
Expected: FAIL, `tests/anchor/reach-observer.test.ts (0 test)`, with
`Error: Failed to load url ../../src/anchor/reach-observer (resolved id: ../../src/anchor/reach-observer) in /<repo>/tests/anchor/reach-observer.test.ts. Does the file exist?`
and the summary line `Test Files  1 failed (1)`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/anchor/reach-observer.ts`:

```ts
import type { ArenaScene, Counts360, Ms, TargetHandle } from '../types';
import { countTrace, missComponents, type Frame } from '../instruments/recording';
import { ONSET_COUNTS_PER_SEC, segment } from '../scoring/submovement';
import type { FirstReach } from './flick-anchor';

/**
 * A trough must have dropped to half the running peak before it is taken as the end of the
 * open-loop reach. See SegmentOptions.troughDrop: the default rule ends the primary orient at the
 * first strict local minimum, and on an unsmoothed 60 Hz difference trace that is routinely a
 * single jittery frame inside the acceleration ramp. Truncating there shortens the measured extent,
 * which biases landedFraction and therefore C0 LOW - a one-directional error, not noise.
 */
export const PRIMARY_TROUGH_DROP = 0.5;

/**
 * A reach as the anchor sees it, plus the label the scorer's own decision supplies.
 * `leadIn` is the disclosure, not an input to the fit: the estimator uses every reach and cares only
 * about the ordinal (see anchorFromReaches). It exists so the result screen can say how many of the
 * reaches the anchor read were reaches the scorer threw away.
 */
export interface ObservedReach extends FirstReach {
  leadIn: boolean;
}

/**
 * The observational channel. Subscribes to the arena's frame stream exactly as TrialRecorder does,
 * reconstructs every reach a trial contained, and reads the fraction of the way its OPEN-LOOP
 * submovement landed.
 *
 * Stateful by necessity and read-only by construction: it accumulates its own buffer and touches
 * nothing else. It needs no cooperation from the instruments, and that is deliberate. The lead-in
 * reaches spawn and clear real targets on the same scene, so watching target identity change is
 * enough to see them - including the ones acclimation.ts discards, which are the reaches that carry
 * the belief signal. A hook inside the instruments' lead-in branch would have put the measurement
 * inside the scoring path, and the integrity invariant is that the anchor reads and never writes the
 * scored Recording.
 * Regression: tests/anchor/reach-observer.test.ts ('the scored recording is byte-identical ...').
 *
 * Every reach it cannot read honestly is DROPPED rather than defaulted. There is no imputation here:
 * a reach with no onset, or with no trough strictly inside its trace, would read as a landedFraction
 * near 1 and therefore as a C0 near the gain we rendered, which is a fabricated agreement the fit
 * cannot tell from a real one.
 */
export class ReachObserver {
  private readonly out: ObservedReach[] = [];
  private readonly offFrame: () => void;
  private rendered: Counts360 | null = null;
  private leadIn = 0;
  private index = -1;
  private openId: string | null = null;
  private frames: Frame[] = [];

  constructor(
    private readonly scene: ArenaScene,
    private readonly currentTarget: () => TargetHandle | null,
  ) {
    this.offFrame = scene.onFrame((_dt, now) => this.onFrame(now));
  }

  /**
   * Open a trial at the gain the arena is about to render, and the lead-in reach count the scorer
   * will discard (src/instruments/acclimation.ts leadInReaches). Closes any reach still open, so a
   * trial that ended mid-reach contributes that reach to the trial it belonged to. Call it BEFORE
   * the instrument spawns its first lead-in target: until it is called `rendered` is null and every
   * reach is dropped, which is silent by design (no gain, no arithmetic) and therefore easy to get
   * wrong at the call site.
   */
  beginTrial(rendered: Counts360, leadIn: number): void {
    this.close();
    this.rendered = rendered;
    this.leadIn = leadIn;
    this.index = -1;
    this.openId = null;
  }

  stop(): void {
    this.close();
    this.offFrame();
  }

  /** Every readable reach, in order. `index` restarts at 0 on each trial. */
  observed(): readonly ObservedReach[] {
    return this.out;
  }

  /** The contract-shaped view the estimator consumes. */
  reaches(): FirstReach[] {
    return this.out.map((r) => ({ rendered: r.rendered, landedFraction: r.landedFraction, index: r.index }));
  }

  /** How many of the reaches read here were reaches the scorer discarded. A disclosure. */
  discardedByScoring(): number {
    let n = 0;
    for (const r of this.out) if (r.leadIn) n += 1;
    return n;
  }

  private onFrame(now: Ms): void {
    const tgt = this.currentTarget();
    if (tgt === null) {
      this.close();
      this.openId = null;
      return;
    }
    if (tgt.id !== this.openId) {
      this.close();
      this.openId = tgt.id;
      this.index += 1;
    }
    this.frames.push({
      t: now,
      aim: this.scene.view(),
      target: tgt.bearing(),
      targetRadius: tgt.radiusDeg(),
    });
  }

  /**
   * The clock stamp of the trough that ended the open-loop reach, or null when the trace cannot say.
   * Its own function so the segmenter's throw and the no-trough case are one control path: both mean
   * "nothing readable here" and both drop the reach, and neither leaves a possibly-unassigned local
   * behind for the caller to reason about.
   */
  private static primaryTroughTime(frames: readonly Frame[], rendered: Counts360): Ms | null {
    try {
      const seg = segment(countTrace(frames, rendered), {
        onsetThresh: ONSET_COUNTS_PER_SEC,
        troughDrop: PRIMARY_TROUGH_DROP,
      });
      // tC is the confirm stage. 0 means the segmenter fell back to the last sample because no
      // trough qualified, so the open-loop extent is unknown. Dropped, never defaulted.
      return seg.tC > 0 ? seg.troughTime : null;
    } catch {
      return null; // never crossed the onset floor: no reach here to read
    }
  }

  private close(): void {
    const frames = this.frames;
    this.frames = []; // taken first, so a second close is a no-op rather than a duplicate reach
    const rendered = this.rendered;
    if (rendered === null || frames.length < 3) return;
    const first = frames[0]!;
    const target = first.target;
    if (target === null) return;

    const troughTime = ReachObserver.primaryTroughTime(frames, rendered);
    if (troughTime === null) return;

    // EXACT clock equality on purpose: SubmovementSeg.troughTime is the sample's own stamp, and
    // recomputing it as onsetTime + tO is a float addition that can miss the stamp by one ulp and
    // then silently read the wrong aim. Pinned by tests/anchor/clock-stamp.test.ts, which runs this
    // on a fractional clock origin.
    const landed = frames.find((f) => f.t === troughTime);
    if (landed === undefined) return;

    // The intended reach is start → target; the primary submovement's along-axis extent is that
    // amplitude plus the signed radial miss at the trough. missComponents carries the ±180 seam
    // handling, so a reach across the seam is a small miss and not a fabricated ~360 outlier.
    const m = missComponents(first.aim, target, landed.aim);
    if (!(m.reach > 0)) return;
    const landedFraction = (m.reach + m.radial) / m.reach;
    // Only non-positive and non-finite fractions are rejected, because ln is undefined there. No
    // outlier trimming: the response variable IS the measurement, and trimming it would shrink the
    // residual spread the interval is built from, narrowing an interval on nothing.
    if (!Number.isFinite(landedFraction) || landedFraction <= 0) return;

    this.out.push({ rendered, landedFraction, index: this.index, leadIn: this.index < this.leadIn });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/anchor`
Expected: PASS, 10 tests across two files (5 in `flick-anchor.test.ts` from task 32, 5 here).
`npx tsc --noEmit` is clean.

- [ ] **Step 5: Commit**

```bash
git add src/anchor/reach-observer.ts tests/anchor/reach-observer.test.ts
git commit -m "feat(anchor): read every reach's open-loop extent, without touching the scored trial

landedFraction * rendered is C0 with the rendered gain cancelling exactly. The observer subscribes
to the frame stream the scorer already publishes and needs no hook inside the instruments, which is
what keeps the scored Recording byte-identical. A reach with no onset or no closed trough is
dropped: it would read as a landedFraction near 1, which is a fabricated agreement."
```

### Task 34: the two refusals, pinned as tests in their own right

**Files:**
- Modify: `src/anchor/flick-anchor.ts` (no change expected; the guards ship in task 32)
- Test: `tests/anchor/flick-anchor-refusals.test.ts`

The guards are implemented in task 32 because a guard added after the fact is a guard nobody trusts.
This task exists to pin each refusal against the player that produces it, so a future reader who
thinks the guards look paranoid finds a red test explaining what they cost.

- [ ] **Step 1: Write the failing test**

Create `tests/anchor/flick-anchor-refusals.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { anchorFromReaches, FLICK_MIN_LEVELS, FLICK_MIN_REACHES, type FirstReach } from '../../src/anchor/flick-anchor';
import { counts360 } from '../../src/types';
import { mulberry32 } from '../../src/stats/rng';

const LEVELS = [6300, 7200, 8100, 9000, 9900, 10800, 11700, 12600];
const TRUE_B0 = 9000;
const BIAS = Math.log(0.94);
const gauss = (r: () => number): number => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

/**
 * Build a session's reaches from an explicit per-reach log fraction, so each player below is stated
 * as a formula rather than as a fixture nobody can check.
 */
function session(
  lnFraction: (e0: number, j: number, rng: () => number) => number,
  opts: { trials?: number; perTrial?: number; levels?: number[]; seed?: number } = {},
): FirstReach[] {
  const levels = opts.levels ?? LEVELS;
  const rng = mulberry32(opts.seed ?? 0x5eed);
  const out: FirstReach[] = [];
  for (let t = 0; t < (opts.trials ?? 24); t++) {
    const rendered = levels[t % levels.length]!;
    const e0 = Math.log(TRUE_B0) - Math.log(rendered);
    for (let j = 0; j < (opts.perTrial ?? 12); j++) {
      out.push({ rendered: counts360(rendered), landedFraction: Math.exp(lnFraction(e0, j, rng)), index: j });
    }
  }
  return out;
}

describe('the flick anchor refuses rather than returning a plausible wrong number', () => {
  it('no signal at all: it refuses instead of answering with 28 percent error', () => {
    // The measured failure it exists to prevent: with landedFraction independent of the rendered
    // gain the estimator returned 28 percent mean absolute error and a minus 43 to plus 61 percent
    // range, confidently. The number it would produce here is not a worse estimate, it is not an
    // estimate. Do not replace this refusal with a wide interval: a wide interval on a number with
    // no signal still puts a number on the screen.
    const noSignal = session((_e0, _j, rng) => BIAS + 0.12 * gauss(rng));
    expect(anchorFromReaches(noSignal)).toEqual({ identifiable: false, reason: 'no-covariance' });
  });

  it('a covariance with the wrong sign refuses, because it is evidence of something else', () => {
    // One-sided by design. A positive slope on ln(rendered) cannot come from a belief mismatch, so
    // fitting it would produce a confident answer about a mechanism that is not the one modelled.
    const flipped = session((e0, j, rng) => -e0 * Math.pow(0.6, j) + BIAS + 0.05 * gauss(rng));
    expect(anchorFromReaches(flipped)).toEqual({ identifiable: false, reason: 'no-covariance' });
  });

  it('no stable belief: the rate pins at its lower bound and it refuses', () => {
    // This player re-anchors on whatever was just rendered, so the belief error is gone by the
    // second reach of the trial and every later reach is pure motor bias. Simulation put them at
    // 12.7 percent while the estimator STILL ANSWERED, which is why the pin is a refusal and not a
    // warning. Truth here is rate = 0, and the fit lands there.
    const unstable = session((e0, j, rng) => (j === 0 ? e0 : 0) + BIAS + 0.05 * gauss(rng));
    expect(anchorFromReaches(unstable)).toEqual({ identifiable: false, reason: 'adapt-rate-at-bound' });
  });

  it('no adaptation at all: the rate pins at its upper bound and it refuses', () => {
    // The mirror case. With the belief error constant across the trial, the intercept and the
    // asymptote are the same column: belief and bias are one number and the fit cannot say which.
    const rigid = session((e0, _j, rng) => e0 + BIAS + 0.05 * gauss(rng));
    expect(anchorFromReaches(rigid)).toEqual({ identifiable: false, reason: 'adapt-rate-at-bound' });
  });

  it('too few reaches, and too few distinct gains, are the same refusal', () => {
    const short = session((e0, j, rng) => e0 * Math.pow(0.6, j) + BIAS + 0.05 * gauss(rng), {
      trials: 3,
      perTrial: 4,
    });
    expect(short.length).toBeLessThan(FLICK_MIN_REACHES);
    expect(anchorFromReaches(short)).toEqual({ identifiable: false, reason: 'too-few-reaches' });

    const narrow = session((e0, j, rng) => e0 * Math.pow(0.6, j) + BIAS + 0.05 * gauss(rng), {
      levels: [8600, 9000, 9400],
    });
    expect(new Set(narrow.map((r) => r.rendered)).size).toBeLessThan(FLICK_MIN_LEVELS);
    expect(anchorFromReaches(narrow)).toEqual({ identifiable: false, reason: 'too-few-reaches' });
  });

  it('a reach with a non-positive landed fraction is discarded, not logged', () => {
    // ln is undefined at or below zero. A reach that travelled backwards is not a small reach.
    const ok = session((e0, j, rng) => e0 * Math.pow(0.6, j) + BIAS + 0.05 * gauss(rng));
    const poisoned = [...ok, { rendered: counts360(9000), landedFraction: 0, index: 4 }, { rendered: counts360(9000), landedFraction: -0.3, index: 5 }];
    expect(anchorFromReaches(poisoned)).toEqual(anchorFromReaches(ok));
  });

  it('an empty session refuses', () => {
    expect(anchorFromReaches([])).toEqual({ identifiable: false, reason: 'too-few-reaches' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Written after task 32 has shipped, so it cannot fail on a missing module. The failure mode that
matters here is per-guard, and each is checked by removing the guard and watching the right test go
red. Comment out the `if (!(z >= COVARIANCE_MIN_Z))` block in `src/anchor/flick-anchor.ts` and run
`npx vitest run tests/anchor/flick-anchor-refusals.test.ts`: expected FAIL on 'no signal at all' and
'a covariance with the wrong sign refuses' with
`AssertionError: expected { identifiable: true, counts: … } to deeply equal { identifiable: false, reason: 'no-covariance' }`.
Restore it, comment out the `best.rate` boundary block, rerun: expected FAIL on both 'no stable
belief' and 'no adaptation at all' with the same shape of message. Restore both before step 4.

- [ ] **Step 3: Write the minimal implementation**

None. The guards shipped in task 32 and this task adds no source change. If any test above fails
against task 32's implementation, the fix is in `src/anchor/flick-anchor.ts` and it is a real defect
in the guard, not a tolerance to relax. The two thresholds most likely to need a single considered
change are `COVARIANCE_MIN_Z` and `ADAPT_RATE_MIN`. Both trade refusals against confident wrong
answers, and the direction is fixed by the cost asymmetry: refusing costs a widened interval, which
the reconciliation absorbs, and a false accept costs 28 percent stated confidently. Move them toward
MORE refusal, never less, and record the new number's justification in the constant's comment.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/anchor`
Expected: PASS, 17 tests across three files (5 flick-anchor, 5 reach-observer, 7 here).

- [ ] **Step 5: Commit**

```bash
git add tests/anchor/flick-anchor-refusals.test.ts
git commit -m "test(anchor): pin each refusal against the player that produces it

The guards look paranoid until you read what they cost: no signal returned 28 percent error and a
minus 43 to plus 61 percent range confidently, and a player with no stable belief returned 12.7
percent while still answering. Each is a fixture here with the measurement in the comment, so the
next reader who wants to relax one finds the number first."
```

### Task 35: the reconciliation, inverse variance in log space and widen only

**Files:**
- Create: `src/anchor/reconcile.ts`
- Test: `tests/anchor/reconcile.test.ts`

Depends on phase 2 having shipped `src/anchor/reference-turn.ts` with, verbatim from the contract:

```ts
export interface TurnEstimate { counts: Counts360; spreadPct: number; logSd: number; agreed: boolean; passes: number; }
export const TURN_PRIOR_LOG_SD = 0.15;
```

**The turn's precision floor lives in ONE place, and it is not this file.** Findings F14 and F15 and
amendment A6 settle it: `turnFromPasses` applies a ONE-SIDED shrinkage,
`Math.max(sampleStd(kept), (sampleStd(kept) + TURN_PRIOR_LOG_SD) / 2)`, which can only pull an
over-confident trio UP toward the prior and can never pull a genuinely wide spread down. Reconcile
therefore drops the `Math.max(TURN_PRIOR_LOG_SD, turn.logSd)` floor an earlier draft had here. With
both in place the floor always won, because `agreed` requires a spread inside 15 percent, so the
turn's measured spread never reached the combination at all and the one parameter the blind turn
exists to remove was back on the critical path for every well-behaved session. What protects the
REPORTED interval from a lucky trio is `COMBINED_FLOOR_LOG_SD` below, which is the right place for
it: a floor belongs on what is published, not on what was measured.

Measured accuracy this is built to deliver: 3.1 to 4.2 percent combined, against 4.3 for the flick
alone and 4.8 to 15.0 for the turn alone.

- [ ] **Step 1: Write the failing test**

Create `tests/anchor/reconcile.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { reconcile, ANCHOR_Z90, COMBINED_FLOOR_LOG_SD, type Anchor } from '../../src/anchor/reconcile';
import { TURN_PRIOR_LOG_SD, type TurnEstimate } from '../../src/anchor/reference-turn';
import type { FlickAnchor, FlickRefusal } from '../../src/anchor/flick-anchor';
import { counts360 } from '../../src/types';

const turn = (counts: number, logSd: number, agreed = true): TurnEstimate => ({
  counts: counts360(counts),
  spreadPct: (Math.exp(logSd) - 1) * 100,
  logSd,
  agreed,
  passes: 3,
});
const flick = (counts: number, logSd: number): FlickAnchor => ({
  identifiable: true,
  counts: counts360(counts),
  logSd,
  bias: Math.log(0.94),
  adaptRate: 0.6,
});
const refused: FlickRefusal = { identifiable: false, reason: 'no-covariance' };
const w = (logSd: number): number => 1 / (logSd * logSd);
const halfWidth = (a: Anchor): number => Math.log(a.ci90[1] / a.ci90[0]) / 2;
/** A weight a typical agreeing trio carries out of turnFromPasses. Not a floor applied here. */
const TURN_SD = 0.15;

describe('reconcile', () => {
  it('neither route means no anchor, not a guessed one', () => {
    expect(reconcile(null, refused)).toBeNull();
  });

  it('the turn alone reports the spread the passes measured, wide or narrow', () => {
    // No second floor here, deliberately. turnFromPasses already applies the ONE-SIDED shrinkage
    // toward TURN_PRIOR_LOG_SD, so its logSd can only have been pulled UP; flooring again would
    // overwrite a measured spread with a constant and put the one parameter the blind turn exists
    // to remove back on the critical path.
    const wide = TURN_PRIOR_LOG_SD * 2; // 0.30: a visibly sloppy trio, and its spread survives
    const sloppy = reconcile(turn(9000, wide), refused);
    if (sloppy === null) throw new Error('expected an anchor from the turn alone');
    expect(sloppy.sources).toEqual(['turn']);
    expect(sloppy.counts).toBeCloseTo(9000, 6);
    expect(sloppy.disagreementPct).toBeUndefined();
    expect(sloppy.ci90[0]).toBeCloseTo(9000 * Math.exp(-ANCHOR_Z90 * wide), 6);
    expect(sloppy.ci90[1]).toBeCloseTo(9000 * Math.exp(ANCHOR_Z90 * wide), 6);
    expect(halfWidth(sloppy)).toBeGreaterThan(ANCHOR_Z90 * TURN_PRIOR_LOG_SD);

    // And the tightest turnFromPasses can emit: three passes in perfect agreement still carry
    // (0 + TURN_PRIOR_LOG_SD) / 2 out of the one-sided shrinkage, so that is what is reported.
    const tight = TURN_PRIOR_LOG_SD / 2;
    const crisp = reconcile(turn(9000, tight), refused);
    if (crisp === null) throw new Error('expected an anchor from the turn alone');
    expect(halfWidth(crisp)).toBeCloseTo(ANCHOR_Z90 * tight, 9);
  });

  it('the flick alone reports its own measured spread', () => {
    const a = reconcile(null, flick(9200, 0.07));
    if (a === null) throw new Error('expected an anchor from the flick alone');
    expect(a.sources).toEqual(['flick']);
    expect(a.counts).toBeCloseTo(9200, 6);
    expect(a.ci90[1] / a.ci90[0]).toBeCloseTo(Math.exp(2 * ANCHOR_Z90 * 0.07), 6);
  });

  it('two agreeing routes combine by inverse variance in log space', () => {
    const a = reconcile(turn(9000, TURN_SD), flick(9200, 0.06));
    if (a === null) throw new Error('expected a combined anchor');
    expect(a.sources).toEqual(['turn', 'flick']);
    const expected = Math.exp(
      (w(TURN_SD) * Math.log(9000) + w(0.06) * Math.log(9200)) / (w(TURN_SD) + w(0.06)),
    );
    expect(a.counts).toBeCloseTo(expected, 6);
    expect(a.counts).toBeGreaterThan(9100); // leans to the tighter route, as it must
    expect(a.disagreementPct).toBeCloseTo((9200 / 9000 - 1) * 100, 6);
    // Two independent measurements legitimately beat either one, down to the floor and no further.
    expect(halfWidth(a)).toBeLessThan(ANCHOR_Z90 * 0.06);
    expect(halfWidth(a)).toBeGreaterThanOrEqual(ANCHOR_Z90 * COMBINED_FLOOR_LOG_SD - 1e-12);
  });

  it('the combined floor holds even when both routes claim absurd precision', () => {
    // Neither claim is floored on the way in - each estimator owns its own claim - so this is the
    // COMBINED floor doing the whole job: 3.1 percent is the best the pair has ever demonstrated,
    // and the inverse-variance algebra below that number is claiming precision, not measuring it.
    const a = reconcile(turn(9000, 0.001), flick(9000, 0.001));
    if (a === null) throw new Error('expected a combined anchor');
    expect(halfWidth(a)).toBeCloseTo(ANCHOR_Z90 * COMBINED_FLOOR_LOG_SD, 9);
  });

  it('disagreement beyond the combined precision unions the bands, and only ever widens', () => {
    const t = turn(9000, TURN_SD);
    const f = flick(13000, 0.06);
    const a = reconcile(t, f);
    if (a === null) throw new Error('expected a combined anchor');
    const turnLo = 9000 * Math.exp(-ANCHOR_Z90 * TURN_SD);
    const flickHi = 13000 * Math.exp(ANCHOR_Z90 * 0.06);
    expect(a.ci90[0]).toBeLessThanOrEqual(turnLo + 1e-9);
    expect(a.ci90[1]).toBeGreaterThanOrEqual(flickHi - 1e-9);
    expect(a.disagreementPct).toBeCloseTo((13000 / 9000 - 1) * 100, 6);
    // The point estimate is NOT moved. Moving it would need a story about which route is wrong, and
    // the disagreement is itself the measurement of the world-rotation versus screen-offset
    // mismatch, which is the reason both routes exist.
    const expected = Math.exp(
      (w(TURN_SD) * Math.log(9000) + w(0.06) * Math.log(13000)) / (w(TURN_SD) + w(0.06)),
    );
    expect(a.counts).toBeCloseTo(expected, 6);
  });

  it('widen only, as a property across the whole disagreement range', () => {
    const t = turn(9000, 0.12);
    let previousWidth = 0;
    for (const ratio of [1, 1.02, 1.05, 1.1, 1.2, 1.4, 1.8, 2.5]) {
      const a = reconcile(t, flick(9000 * ratio, 0.06));
      if (a === null) throw new Error(`expected an anchor at ratio ${ratio}`);
      const width = Math.log(a.ci90[1] / a.ci90[0]);
      expect(width, `ratio ${ratio}`).toBeGreaterThanOrEqual(previousWidth - 1e-12);
      previousWidth = width;
      expect(a.counts).toBeGreaterThanOrEqual(a.ci90[0]);
      expect(a.counts).toBeLessThanOrEqual(a.ci90[1]);
    }
  });

  it('a systematic shared by both routes moves the number and widens nothing', () => {
    // The limit of the combination, pinned rather than left implicit. Inverse variance narrows only
    // because the two routes' errors are assumed INDEPENDENT, and the disagreement channel can only
    // ever see the differential part: a factor common to both is invisible to it. So a shared
    // systematic lands whole on the point estimate and the interval does not notice. That is why
    // the copy may report a ratio and its spread and may not claim absolute accuracy, and it is
    // also why both routes exist at all - they fail differently, which is the only defence there is.
    const clean = reconcile(turn(9000, 0.12), flick(9200, 0.06));
    const shifted = reconcile(turn(9000 * 1.2, 0.12), flick(9200 * 1.2, 0.06));
    if (clean === null || shifted === null) throw new Error('expected both anchors');
    expect(shifted.counts / clean.counts).toBeCloseTo(1.2, 9);
    expect(halfWidth(shifted)).toBeCloseTo(halfWidth(clean), 9);
    expect(shifted.disagreementPct).toBeCloseTo(clean.disagreementPct!, 9);
  });

  it('a degenerate route is dropped rather than weighted', () => {
    expect(reconcile(turn(0, 0.1), refused)).toBeNull();
    expect(reconcile(turn(9000, Number.NaN), refused)).toBeNull();
    // A spread of exactly zero is a claim of infinite precision, and infinite weight would silence
    // the other route entirely. Dropped, exactly as the flick route's zero is.
    expect(reconcile(turn(9000, 0), refused)).toBeNull();
    const a = reconcile(turn(0, 0.1), flick(9200, 0.07));
    if (a === null) throw new Error('expected the flick to survive alone');
    expect(a.sources).toEqual(['flick']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/anchor/reconcile.test.ts`
Expected: FAIL, `tests/anchor/reconcile.test.ts (0 test)`, with
`Error: Failed to load url ../../src/anchor/reconcile (resolved id: ../../src/anchor/reconcile) in /<repo>/tests/anchor/reconcile.test.ts. Does the file exist?`
and the summary line `Test Files  1 failed (1)`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/anchor/reconcile.ts`:

```ts
import type { Counts360 } from '../types';
import { counts360 } from '../types';
import type { TurnEstimate } from './reference-turn';
import type { FlickAnchor, FlickRefusal } from './flick-anchor';

/** The 95th percentile of the standard normal: half of a two-sided 90 percent band. */
export const ANCHOR_Z90 = 1.6448536269514722;

/**
 * The floor on the combined log sd.
 *
 * Two independent measurements of the same latent quantity legitimately beat either one, and
 * simulation measured the pair at 3.1 to 4.2 percent against 4.3 for the flick alone and 4.8 to 15.0
 * for the turn alone. 3.1 percent is the best the pair has demonstrated, and 0.031 / 0.7979 is
 * 0.0389 in log units. Below that the inverse-variance algebra is claiming precision the pair has
 * never shown, so the floor holds. It can only widen.
 *
 * This is also the ONLY floor in the anchor path that this file applies. Each route floors its own
 * claim where that claim is made (turnFromPasses' one-sided shrinkage, FLICK_FLOOR_LOG_SD), and a
 * second floor here would overwrite a measured spread with a constant. A floor belongs on what is
 * published, not on what was measured.
 */
export const COMBINED_FLOOR_LOG_SD = 0.0389;

/**
 * How far apart the two routes may sit before their combination stops being a combination. One
 * combined standard deviation of the difference, at the same 90 percent level the interval reports,
 * so the threshold is the routes' own measured precision rather than a taste parameter.
 */
export const DISAGREE_Z = ANCHOR_Z90;

export interface Anchor {
  counts: Counts360;
  ci90: [Counts360, Counts360];
  sources: ReadonlyArray<'turn' | 'flick'>;
  /** The measured gap between the two routes, in percent. Present only when both routes spoke. */
  disagreementPct?: number;
}

interface Route {
  lnC: number;
  logSd: number;
}

const band = (lnC: number, logSd: number): [Counts360, Counts360] => [
  counts360(Math.exp(lnC - ANCHOR_Z90 * logSd)),
  counts360(Math.exp(lnC + ANCHOR_Z90 * logSd)),
];

/**
 * The turn as a weightable route, or null when it cannot be weighted at all.
 *
 * Its log sd is taken as measured, NOT floored at TURN_PRIOR_LOG_SD. Three blind passes estimate
 * their own spread, which is what removed the one unmeasurable parameter from the critical path, and
 * `turnFromPasses` has already applied the one-sided shrinkage that stops a lucky trio claiming what
 * three samples cannot: `max(sampleStd, (sampleStd + TURN_PRIOR_LOG_SD) / 2)`, which only ever pulls
 * an over-confident trio UP. Flooring again here would have made the floor win for every session
 * whose passes agreed, so the measured spread would never have reached the combination.
 * A spread of exactly zero is still dropped: it would carry infinite weight and silence the flick.
 * Regression: tests/anchor/reconcile.test.ts ('the turn alone reports the spread the passes
 * measured, wide or narrow').
 */
function turnRoute(turn: TurnEstimate | null): Route | null {
  if (turn === null) return null;
  if (!(turn.counts > 0) || !(turn.logSd > 0) || !Number.isFinite(turn.logSd)) return null;
  return { lnC: Math.log(turn.counts), logSd: turn.logSd };
}

/** The flick as a weightable route. A refusal is absence, never a wide guess. */
function flickRoute(flick: FlickAnchor | FlickRefusal): Route | null {
  if (flick.identifiable !== true) return null;
  if (!(flick.counts > 0) || !(flick.logSd > 0) || !Number.isFinite(flick.logSd)) return null;
  return { lnC: Math.log(flick.counts), logSd: flick.logSd };
}

/**
 * Combine the two anchor routes.
 *
 * Log space, because both routes are ratios and their errors are multiplicative: an inverse-variance
 * combination of counts would weight the slow end of the range more heavily than the fast end for no
 * reason. Weights are each route's OWN measured spread, which is what made the combination match
 * oracle weighting in simulation.
 *
 * The narrowing below is legitimate only because the two routes' errors are INDEPENDENT, and that
 * assumption is worth stating because it is not free: a systematic shared by both lands whole on the
 * point estimate and widens nothing, since the disagreement channel can only see the differential
 * part. What makes the assumption defensible is that the routes fail differently - the blind turn
 * makes no visual-angle judgement and the flick does - and what makes it honest is that the shared
 * mode is pinned as a known limit rather than left for a reader to discover.
 * Regression: tests/anchor/reconcile.test.ts ('a systematic shared by both routes moves the number
 * and widens nothing').
 *
 * Beyond their combined precision the two routes are not measuring the same thing, and the honest
 * response is a widen-only union rather than an average dressed as agreement. The point estimate is
 * NOT moved, because moving it needs a story about which route is wrong and there is none: the blind
 * turn involves no visual-angle judgement and the flick does, so their disagreement measures whether
 * the player's internal model maps world rotation or screen offset to hand travel. That is a finding,
 * not an embarrassment, and it is what `disagreementPct` reports.
 */
export function reconcile(turn: TurnEstimate | null, flick: FlickAnchor | FlickRefusal): Anchor | null {
  const t = turnRoute(turn);
  const f = flickRoute(flick);
  if (t === null && f === null) return null;
  if (t === null || f === null) {
    const only = t ?? f!;
    return {
      counts: counts360(Math.exp(only.lnC)),
      ci90: band(only.lnC, only.logSd),
      sources: [t !== null ? 'turn' : 'flick'],
    };
  }

  const wT = 1 / (t.logSd * t.logSd);
  const wF = 1 / (f.logSd * f.logSd);
  const lnC = (wT * t.lnC + wF * f.lnC) / (wT + wF);
  const combined = Math.max(COMBINED_FLOOR_LOG_SD, Math.sqrt(1 / (wT + wF)));
  let ci = band(lnC, combined);

  const gap = Math.abs(t.lnC - f.lnC);
  if (gap > DISAGREE_Z * Math.hypot(t.logSd, f.logSd)) {
    const tb = band(t.lnC, t.logSd);
    const fb = band(f.lnC, f.logSd);
    ci = [
      counts360(Math.min(ci[0], tb[0], fb[0])),
      counts360(Math.max(ci[1], tb[1], fb[1])),
    ];
  }

  return {
    counts: counts360(Math.exp(lnC)),
    ci90: ci,
    sources: ['turn', 'flick'],
    disagreementPct: (Math.exp(gap) - 1) * 100,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/anchor && npm test`
Expected: PASS, 26 tests across four anchor files (5 flick-anchor, 5 reach-observer, 7 refusals, 9
here). `npm run build` is clean, which also runs `tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/anchor/reconcile.ts tests/anchor/reconcile.test.ts
git commit -m "feat(anchor): reconcile the turn and the flick, inverse variance and widen only

Log space because both routes are ratios, weighted by each route's own measured spread, which is
what matched oracle weighting in simulation at 3.1 to 4.2 percent. The turn's spread is taken as
measured: turnFromPasses already shrinks one-sidedly toward the prior, and a second floor here
would have won for every session whose passes agreed. The published interval is floored instead.
Beyond their combined precision the bands are unioned and the point is left where it is: the
disagreement measures whether the internal model maps world rotation or screen offset to hand
travel, and that is a finding."
```

### Task 37: clock-offset invariance for the anchor

**Files:**
- Create: `tests/anchor/clock-stamp.test.ts`

Task 36 is the end-to-end wiring task and it is NOT authored here: per amendment A3 and finding F11 it
belongs to the wiring part, which takes `src/optimizer/session-controller.ts` and
`src/ui/session-view.ts` for it. The hand-off below states exactly what it must call. This task is
numbered 37 so the two do not collide, and it depends only on tasks 33 and 35.

Why this task exists at all: the spec's Tests section asks for clock-offset invariance extended to the
new instruments, no part wrote one (finding F17, amendment A8), and
`tests/instruments/clock-stamp.test.ts` exists because that class of bug already shipped in this
repo once. The anchor is the new surface that consumes timestamps: the observer stamps every frame
from the arena clock and then finds the landing frame by EXACT clock equality
(`frames.find((f) => f.t === troughTime)`).

Scope note, stated rather than faked: `turnFromPasses(passCounts: readonly number[])` consumes pass
COUNTS and carries no timestamp at all, so it has no clock origin to shift and asserting invariance on
it would be a vacuous test. The turn enters below as a fixed `TurnEstimate` literal, which is exactly
what the wiring hands `reconcile`.

- [ ] **Step 1: Write the failing test**

Create `tests/anchor/clock-stamp.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ReachObserver, type ObservedReach } from '../../src/anchor/reach-observer';
import { anchorFromReaches, type FirstReach } from '../../src/anchor/flick-anchor';
import { reconcile } from '../../src/anchor/reconcile';
import type { TurnEstimate } from '../../src/anchor/reference-turn';
import { counts360 } from '../../src/types';
import type { TargetHandle } from '../../src/types';
import { FakeScene } from '../instruments/fake-scene';

/**
 * Clock-offset invariance for the anchor, following tests/instruments/clock-stamp.test.ts.
 *
 * The arena clock starts at arena construction and never resets, so by the twentieth trial it reads
 * several minutes. Three instruments once stamped their first target at 0 while measuring durations
 * against that running clock, and the damage was asymmetric: late trials scored worse than early
 * ones, which biased the located optimum toward whatever the optimiser sampled first. The suite
 * missed it because a stub scene also starts at 0.
 *
 * The anchor is the new consumer of that clock. It stamps every frame with it and then locates the
 * landing frame by EXACT equality against SubmovementSeg.troughTime. Nothing it reports may depend
 * on where the clock started. One offset is deliberately FRACTIONAL: with a non-integer origin, a
 * lookup that recomputed the trough as `onsetTime + tO` could miss the stamp by one ulp and drop the
 * reach, which is the defect the exposed troughTime exists to prevent.
 *
 * Note what is NOT asserted: countTrace divides by a frame delta, and at a fractional origin that
 * delta can differ in its last bit between runs. The assertions are on the OUTPUTS, which are built
 * from the aim samples and carry no timestamp at all.
 */

const FRACTIONS = [0, 0.06, 0.26, 0.44, 0.18, 0.04, 0.02, 0.12, 0.05, 0.01] as const;
const LEVELS = [6300, 7200, 8100, 9000, 9900, 10800, 11700, 12600];
const TRIALS = 24;
const REACHES_PER_TRIAL = 4;
const LEAD_IN = 2;
const BELIEF = 9000;
const RATE = 0.6; // per-reach retention of the log belief error, so the fit is identifiable
const AMPLITUDE = 30;

interface AnchorRun {
  observed: ObservedReach[];
  reaches: FirstReach[];
  discarded: number;
}

/** Drive a whole session's reaches on a scene whose clock already reads `startClock`. */
function runFrom(startClock: number): AnchorRun {
  const scene = new FakeScene();
  scene.now = startClock;
  let handle: TargetHandle | null = null;
  const obs = new ReachObserver(scene, () => handle);
  for (let t = 0; t < TRIALS; t++) {
    const rendered = LEVELS[t % LEVELS.length]!;
    obs.beginTrial(counts360(rendered), LEAD_IN);
    const e0 = Math.log(BELIEF / rendered);
    for (let r = 0; r < REACHES_PER_TRIAL; r++) {
      // The believed gain decays geometrically toward the rendered one, reach by reach.
      const primary = AMPLITUDE * Math.exp(e0 * Math.pow(RATE, r));
      handle = scene.spawnTarget({ kind: 'static', yaw: AMPLITUDE, pitch: 0, distance: 20, worldRadius: 0.6 });
      let yaw = 0;
      for (const share of FRACTIONS) {
        scene.tick(16, [yaw, 0]);
        yaw += share * primary;
      }
      handle = null;
      scene.tick(16, [yaw, 0]); // closes the reach
      scene.tick(16, [0, 0]); // back to the origin with no target: discarded, not a reach
    }
  }
  obs.stop();
  return { observed: [...obs.observed()], reaches: obs.reaches(), discarded: obs.discardedByScoring() };
}

const TURN: TurnEstimate = {
  counts: counts360(9200),
  spreadPct: 4.1,
  logSd: 0.09,
  agreed: true,
  passes: 3,
};

// Five minutes in; a late-session clock; and a fractional origin no frame interval divides.
const OFFSETS = [300_000, 1_234_567, 987.6543];

describe('the anchor reads the same session wherever the arena clock started', () => {
  const base = runFrom(0);

  it('the session it is built on is readable at all, so the test cannot pass vacuously', () => {
    expect(base.reaches).toHaveLength(TRIALS * REACHES_PER_TRIAL);
    expect(base.discarded).toBe(TRIALS * LEAD_IN);
    expect(base.observed.slice(0, REACHES_PER_TRIAL).map((r) => r.index)).toEqual([0, 1, 2, 3]);
    const a = anchorFromReaches(base.reaches);
    if (a.identifiable !== true) throw new Error(`expected identifiable, got refusal: ${a.reason}`);
    expect(a.counts / BELIEF).toBeGreaterThan(0.97);
    expect(a.counts / BELIEF).toBeLessThan(1.03);
  });

  for (const offset of OFFSETS) {
    it(`every reach reads identically at a clock offset of ${offset}`, () => {
      const late = runFrom(offset);
      expect(late.observed).toEqual(base.observed);
      expect(late.reaches).toEqual(base.reaches);
      expect(late.discarded).toBe(base.discarded);
      // The teeth for the exact-equality frame lookup: a missed stamp drops the reach silently, so
      // a lost reach shows up here as a length change rather than as a wrong number.
      expect(late.reaches).toHaveLength(base.reaches.length);
    });

    it(`the anchor and the reconciliation are identical at a clock offset of ${offset}`, () => {
      const late = runFrom(offset);
      expect(anchorFromReaches(late.reaches)).toEqual(anchorFromReaches(base.reaches));
      expect(reconcile(TURN, anchorFromReaches(late.reaches))).toEqual(
        reconcile(TURN, anchorFromReaches(base.reaches)),
      );
    });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

This test is written after the code it pins, so it cannot fail on a missing module and there is no
red-green theatre to stage. Confirm instead that it is load bearing, by breaking exactly the property
it protects: in `src/anchor/reach-observer.ts` change the landing lookup to
`const landed = frames.find((f) => f.t === seg.onsetTime + seg.tO);` (which needs the local `seg`
back, so make `primaryTroughTime` return the whole `SubmovementSeg`) and run
`npx vitest run tests/anchor/clock-stamp.test.ts`.
Expected: FAIL on 'every reach reads identically at a clock offset of 987.6543' with
`AssertionError: expected [] to deeply equal [ { rendered: 6300, … } ]` or a length mismatch,
because at a fractional origin the recomputed sum misses the stamp and every reach is dropped.
Revert to `f.t === troughTime` before step 4.

- [ ] **Step 3: Write the minimal implementation**

None. Tasks 33 and 35 already ship the behaviour; this task adds only the test that pins it. If the
test fails against them, the defect is real and it is in `src/anchor/reach-observer.ts`: something
there is reading an absolute clock value rather than a difference. The fix is never to relax the
assertion, because the property is the point.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/anchor/clock-stamp.test.ts`
Expected: PASS, 7 tests (the vacuity guard plus two per offset). Then `npx vitest run tests/anchor`
is PASS at 33 tests across five files, and `npm test` is green.

- [ ] **Step 5: Commit**

```bash
git add tests/anchor/clock-stamp.test.ts
git commit -m "test(anchor): pin the anchor against the arena clock's origin

The frame-stamp bug already shipped here once and the suite missed it because a stub scene also
starts at zero. The observer stamps every frame from the running arena clock and finds the landing
frame by exact equality, so one of the offsets is fractional: a lookup that recomputed the trough
as onsetTime + tO would miss by one ulp and drop the reach silently. The vacuity guard asserts the
simulated session is readable in the first place, so a test that stopped observing anything would
fail rather than pass on two empty arrays."
```

## Hand-offs to other phases

**To phase 1a (units and engine), required before task 30 can compile.**

1. `TrialContext` must expose the rendered gain as `counts: Counts360` and the arrival gain as
   `prevCounts?: Counts360`, with `dpi` gone. Tasks 30, 33 and the wiring task below are written
   against exactly those two names. If phase 1a picks different names, substitute them in the three
   `ctx.counts` references in `src/instruments/flick.ts` and `src/instruments/strike.ts`.
2. Phase 1a owns `src/types.ts`, so the mechanical rename inside `src/instruments/acclimation.ts`
   (`ctx.cm360` to `ctx.counts` in `acclimationScale` and `leadSeed`, and dropping the
   `mix(Math.round(ctx.dpi))` line from `leadSeed`) belongs to phase 1a even though phase 4 owns the
   file under amendment A1, because tsc cannot go green without it inside phase 1a's own task.
   Dropping the dpi mix changes the private lead-in rng seed and therefore lead-in target geometry,
   which is unscored, but `tests/instruments/acclimation.test.ts` asserts the private stream differs
   from the shared one and that assertion still holds.
3. `src/convert/counts.ts` must export `degreesPerCount(counts: Counts360): Degrees`, per the
   contract. `src/instruments/recording.ts` imports it in task 30.

**To the wiring part (task 36), required for the anchor to receive any reaches at all.**

Phase 4 does not author this: amendment A3 assigns the end-to-end wiring, and
`src/optimizer/session-controller.ts` and `src/ui/session-view.ts` with it, to the part that owns that
task. What follows is the exact contract those edits must satisfy, with the names as they read in the
files today.

In `src/optimizer/session-controller.ts`:

1. `SessionConfig` gains `currentTarget?: () => TargetHandle | null`. `ArenaScene` has no "which
   target is live" accessor today, so the getter comes from whatever owns the arena. Adding
   `activeTarget(): TargetHandle | null` to `ArenaScene` and implementing it in `src/engine/arena.ts`
   instead is cleaner and phase 4 has no objection; the observer takes the getter as a constructor
   argument either way.
2. After `const trials: TrialResult[] = ...` (line 246) and before the `while` loop:
   ```ts
   // The anchor's observational channel (src/anchor/reach-observer.ts). It subscribes to the same
   // frame stream the scorer does and never writes the scored Recording; the integrity property is
   // pinned by tests/anchor/reach-observer.test.ts.
   const observer = new ReachObserver(config.scene, () => config.currentTarget?.() ?? null);
   ```
   Construct it here, once, before the first trial spawns anything. Constructing it per trial would
   subscribe a second listener to the same stream and double-count every reach.
3. The trial context is currently built inline in the `run` call (line 262). Lift it to a const so the
   observer and the instrument cannot disagree about the trial, then open the trial on the observer
   immediately before the instrument runs:
   ```ts
   const trialCtx = { counts, rng, profile, ...(prev !== undefined ? { prevCounts: prev } : {}) };
   observer.beginTrial(counts, leadInReaches(trialCtx));
   const result = await config.instruments[id].run(trialCtx, config.scene);
   ```
   `leadInReaches` comes from `src/instruments/acclimation.ts` (task 31) and MUST be called with the
   same ctx the instrument receives: `planAcclimation` computes the discard count from that ctx, and
   two different ctx objects would label scored reaches as lead-in ones.
4. `observer.stop()` after the loop and before `finalizeReport`, so the last trial's final reach is
   closed and counted.
5. `SessionOutcome` gains `reaches: FirstReach[]` and `leadInDiscarded: number`, returned as
   `reaches: observer.reaches()` and `leadInDiscarded: observer.discardedByScoring()`. The second is
   a disclosure the result screen may render: how many of the reaches the anchor read were reaches the
   scorer threw away.

In `src/ui/session-view.ts` finalize(), in this order, because each argument is the previous result:

```ts
const anchor = reconcile(ctx.draft.turn ?? null, anchorFromReaches(outcome.reaches));
```

then pass `anchor` into `buildResult`'s options object alongside `bounds`, `profile` and phase 3's
`k`, spread conditionally so `exactOptionalPropertyTypes` is satisfied
(`...(anchor !== null ? { anchor } : {})`).

Two failure modes worth knowing before writing it. If `currentTarget` is left unsupplied the observer
sees null on every frame, collects nothing, `anchorFromReaches` refuses with `too-few-reaches` and
`reconcile` silently falls back to the turn alone: an honest degradation, and an invisible one, so the
wiring task's own test must assert a non-empty `outcome.reaches`. And if `beginTrial` is called after
the instrument has spawned its first lead-in target, that trial's early reaches are dropped because
`rendered` is still null.

**To phase 1b (the payoff screen).** `reconcile` returns `Anchor | null`. Null means no anchor route
spoke and tier one must not render at all; there is no fallback number. When `sources` has one entry,
say which route it was and that the other refused. When `disagreementPct` is present and the union
widened the band, the two routes disagreed and the copy must not attribute the disagreement to a
cause: the data cannot distinguish a world-rotation model from a screen-offset one. Nor may the copy
claim absolute accuracy: a systematic shared by both routes is invisible to the interval, which
task 35's test pins. And per the spec's error paths, an anchor interval spanning a ratio of 1 drops
the "change from where you are" framing entirely.

**To phase 2 (the turn).** `src/anchor/reconcile.ts` imports `TurnEstimate` from
`src/anchor/reference-turn.ts` exactly as the contract spells it, and takes `turn.logSd` AS MEASURED:
the duplicate `Math.max(TURN_PRIOR_LOG_SD, turn.logSd)` floor is gone, per findings F14 and F15 and
amendment A6. Two things are therefore load bearing in `reference-turn.ts`:

1. The shrinkage must be one-sided, `Math.max(sampleStd(kept), (sampleStd(kept) + TURN_PRIOR_LOG_SD) / 2)`.
   Two-sided, it narrows a genuinely wide spread (0.30 becomes 0.225) and reconcile no longer has a
   floor to rescue it, so a sloppy turn would be reported 25 percent tighter than it measured.
2. `turnFromPasses` must never return `logSd` of 0 or a non-finite value. Reconcile drops such a route
   entirely rather than weighting it, because zero spread carries infinite weight and would silence
   the flick. The one-sided shrinkage guarantees at least `TURN_PRIOR_LOG_SD / 2`, so this holds by
   construction; it is stated so it stays true if the shrinkage is ever revisited.

`TURN_PRIOR_LOG_SD` is still imported by `tests/anchor/reconcile.test.ts`, which uses it to state that
a measured spread of twice the prior survives the combination whole and that the tightest the
shrinkage can emit is half of it.


### Task 36: the live target, answered by the scene that owns it

**Files:**
- Modify: `src/types.ts` (`ArenaScene`, one added method)
- Modify: `src/engine/arena.ts` (one field, three touch points)
- Modify: `tests/instruments/fake-scene.ts` (the same method on the test double)
- Test: `tests/engine/arena-active-target.test.ts`

**A correction to amendment A3 and to the contract, made here rather than smuggled.** A3 says
`SessionConfig` gains `currentTarget?: () => TargetHandle | null`, supplied by "whatever owns the
arena". Read the real files and no such owner exists. `src/ui/session-view.ts` is the only
construction site of a `SessionConfig`, and the only thing it ever does to a target is
`stage.arena.clearTargets()` at line 271; it never receives a `TargetHandle`. Target lifetime belongs
entirely to the instruments, each of which holds its handle in a function local
(`src/instruments/flick.ts:142`, `calibrate.ts:73`, `strike.ts:82`, `track.ts:321`). So the getter A3
names cannot be written at the call site A3 names.

Phase 4 anticipated this and blessed the alternative in its own hand-off: "Adding
`activeTarget(): TargetHandle | null` to `ArenaScene` and implementing it in `src/engine/arena.ts`
instead is cleaner and phase 4 has no objection". This task takes it, and drops
`SessionConfig.currentTarget` entirely rather than keeping it as an override nobody would pass.
Dropping it is the safer half of the decision: phase 4 flagged that an unsupplied `currentTarget`
makes the observer collect nothing, `anchorFromReaches` refuse, and `reconcile` fall back to the turn
alone, which is "an honest degradation, and an invisible one". An optional field whose omission
silently costs tier one is a footgun with exactly one caller. Derived from the scene it cannot be
forgotten.

`src/types.ts` and `src/engine/arena.ts` belong to phase 1a under amendment A1. This is the one reach
into them that the integration part authors, it is additive, and it changes no existing behaviour.

- [ ] **Step 1: Write the failing test**

Create `tests/engine/arena-active-target.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Arena, type RendererLike } from '../../src/engine/arena';
import { counts360 } from '../../src/types';

const renderer: RendererLike = { render() {}, setSize() {}, dispose() {} };
const input = { onSample: () => () => {}, onFire: () => () => {} };
const makeArena = (): Arena =>
  new Arena({ renderer, input, size: () => [800, 600], counts: counts360(9000) });

const SPEC = { kind: 'static' as const, yaw: 0, pitch: 0, distance: 20, worldRadius: 0.6 };

describe('Arena.activeTarget', () => {
  it('is null before anything is presented, so absence is never a stale handle', () => {
    const arena = makeArena();
    expect(arena.activeTarget()).toBeNull();
    arena.dispose();
  });

  it('reports the target currently presented, and the newest one when several are up', () => {
    // The scored instruments present exactly one at a time; the range presents several. The
    // observational channel only ever reads the scored case, and the newest-wins rule is what makes
    // the one-at-a-time case exact rather than approximately right.
    const arena = makeArena();
    const a = arena.spawnTarget(SPEC);
    expect(arena.activeTarget()!.id).toBe(a.id);
    const b = arena.spawnTarget({ ...SPEC, yaw: 20 });
    expect(arena.activeTarget()!.id).toBe(b.id);
    arena.dispose();
  });

  it('goes null on clearTargets, which is how a reach ends', () => {
    // src/anchor/reach-observer.ts closes the open reach on the frame it first sees null. If a
    // cleared target kept reporting, the observer would keep buffering frames from the gap between
    // presentations into the previous reach, and the extent it measured would be the gap plus the
    // reach: a landedFraction biased HIGH by an amount nothing in the trace can bound.
    const arena = makeArena();
    arena.spawnTarget(SPEC);
    arena.clearTargets();
    expect(arena.activeTarget()).toBeNull();
    arena.dispose();
  });

  it('goes null when the presented target is removed by id, and survives removing another', () => {
    const arena = makeArena();
    const a = arena.spawnTarget(SPEC);
    const b = arena.spawnTarget({ ...SPEC, yaw: 20 });
    arena.removeTarget(a.id);
    expect(arena.activeTarget()!.id).toBe(b.id); // removing a retired one leaves the live one alone
    arena.removeTarget(b.id);
    expect(arena.activeTarget()).toBeNull();
    arena.dispose();
  });

  it('reads with no side effects: reading it twice does not change what the arena holds', () => {
    // It sits on the read-only side of the integrity invariant, so it must be safe to call from a
    // frame callback on every frame of a scored trial.
    const arena = makeArena();
    const a = arena.spawnTarget(SPEC);
    expect(arena.activeTarget()).toBe(arena.activeTarget());
    expect(arena.activeTarget()!.id).toBe(a.id);
    arena.dispose();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/engine/arena-active-target.test.ts`
Expected: FAIL, all 5 tests, the first with
`TypeError: arena.activeTarget is not a function`
and the summary line `Test Files  1 failed (1)`.

- [ ] **Step 3: Write the minimal implementation**

In `src/types.ts`, inside `export interface ArenaScene`, immediately after `clearTargets(): void;`:

```ts
  /** The target being presented right now, or null between presentations.
   *
   *  Target lifetime belongs to the instruments: each one spawns a target, clears it, and spawns the
   *  next, holding the handle in a local nobody else sees. So nothing outside an instrument could
   *  answer this question, which is why the anchor's observational channel
   *  (src/anchor/reach-observer.ts) asks the scene rather than the session config: it is the only
   *  place the answer exists. Newest wins when several are up, which is the free-play range's case
   *  and never the scored one. Read-only, and safe to call on every frame.
   *  Regression: tests/engine/arena-active-target.test.ts. */
  activeTarget(): TargetHandle | null;
```

In `src/engine/arena.ts`, add the field beside the other target state (next to `private moving`):

```ts
  /** The most recently spawned target that has not been cleared or removed. Tracked rather than
   *  derived from `targets`, because a Map preserves insertion order and "newest" would then mean
   *  "last inserted", which stops being true the moment a middle target is removed and re-added. */
  private live: TargetHandle | null = null;
```

In `spawnTarget`, replace the final `return target;` with:

```ts
    this.live = target;
    return target;
```

In `clearTargets`, after `this.moving.clear();`:

```ts
    this.live = null;
```

In `removeTarget`, after `this.targets.delete(id);`:

```ts
    if (this.live?.id === id) this.live = null;
```

and add the accessor next to `clearTargets`:

```ts
  activeTarget(): TargetHandle | null {
    return this.live;
  }
```

In `tests/instruments/fake-scene.ts`, add the same accessor to `FakeScene`, after `clearTargets`:

```ts
  /** Newest spawned, cleared by clearTargets: the same rule Arena implements, so a test double and
   *  the real arena cannot disagree about when a reach ended. */
  activeTarget(): TargetHandle | null {
    return this.targets[this.targets.length - 1] ?? null;
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/engine tests/instruments && npx tsc --noEmit`
Expected: PASS on both. `tsc` is the load-bearing half here: `ArenaScene` gained a member, so every
implementation of it must now provide one, and the only two in the repo are `Arena` and `FakeScene`
(`grep -rn "implements ArenaScene" --include="*.ts" src tests`). The structural stand-ins in
`tests/ui/range.test.ts:22` and `tests/ui/session-view.test.ts:75` both go through
`as unknown as`, so they are unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/engine/arena.ts tests/instruments/fake-scene.ts tests/engine/arena-active-target.test.ts
git commit -m "feat(arena): the scene reports which target is presented

The anchor's observational channel has to tell one reach from the next, and target lifetime belongs
to the instruments: each holds its handle in a local. Amendment A3 put the getter on SessionConfig,
supplied by whatever owns the arena, but session-view never receives a handle, so that getter cannot
be written at the site it names. Asking the scene is the only place the answer exists, and it also
removes the failure mode phase 4 flagged: an optional getter nobody passes collects no reaches, and
the anchor then refuses invisibly."
```

### Task 38: the observational channel runs for the whole session, and its reaches come out

**Files:**
- Modify: `src/optimizer/session-controller.ts` (imports, `SessionOutcome`, `runSession`)
- Modify: `tests/optimizer/session-controller.test.ts` (one added describe block, and its imports)

Task 37 is phase 4's clock-offset test, so the numbering skips it. Everything this task calls exists
after phase 1a task 4, phase 4 task 31 (`leadInReaches`), phase 4 task 32 (`FirstReach`), phase 4
task 33 (`ReachObserver`) and task 36 above.

- [ ] **Step 1: Write the failing test**

In `tests/optimizer/session-controller.test.ts`, extend the two existing import lines to:

```ts
import { finalizeReport, runSession } from '../../src/optimizer/session-controller';
import { anchorFromReaches, FLICK_MIN_LEVELS, FLICK_MIN_REACHES } from '../../src/anchor/flick-anchor';
import { leadInReaches } from '../../src/instruments/acclimation';
import { counts360, type Counts360, type Instrument, type InstrumentId, type Observation, type Profile, type SearchEngine, type TrialContext, type TrialResult } from '../../src/types';
```

(the existing `import { makeBo } ...`, `import { mulberry32 } from '../../src/stats/bootstrap'` and
`import { FakeScene } ...` lines are unchanged; the type import above replaces the file's single
existing `import type { ... } from '../../src/types';` line, which phase 1a already rewrote onto
`Counts360`.)

Append at the end of the file:

```ts
/**
 * Per-frame share of a reach's primary displacement. The same trace phase 4's reach-observer test
 * drives, and it is chosen rather than smooth on purpose: the shares sum to exactly 1.00 at index 6
 * and then correct, so segment() finds a strict local minimum at precisely the sample whose aim is
 * the primary submovement's full extent. A monotone ramp has no trough and the observer would drop
 * the reach, which is the correct behaviour and would make this fixture measure nothing.
 */
const FRACTIONS = [0, 0.06, 0.26, 0.44, 0.18, 0.04, 0.02, 0.12, 0.05, 0.01] as const;

/**
 * A scripted player that presents targets on the scene exactly as the discrete instruments do
 * (spawn one, reach, clear it, spawn the next) and whose OPEN-LOOP reach lands the fraction of the
 * way its belief implies, adapting within the trial.
 *
 * ln f = (ln B0 - ln C_r) * rate^j + bias, which is the model src/anchor/flick-anchor.ts fits. The
 * target sits 30 degrees away, so the along-axis miss at the trough is 30 * (f - 1) and the reach
 * amplitude is 30: landedFraction is f exactly, with no tolerance to tune. Direction alternates so
 * the scene's yaw does not walk away across hundreds of reaches.
 *
 * It is NOT one of the shipped drills. It exercises the scene protocol the drills use and nothing
 * about their scoring, which is covered by their own suites.
 */
function reachingPlayer(opts: {
  scene: FakeScene;
  id: InstrumentId;
  believed: number;
  peak: number;
  perTrial: number;
  rate?: number;
  bias?: number;
  noise?: number;
  seed?: number;
}): Instrument {
  const rate = opts.rate ?? 0.6;
  const bias = opts.bias ?? Math.log(0.94); // the cheap correction: a persistent 6 percent undershoot
  const noise = opts.noise ?? 0;
  const rng = mulberry32(opts.seed ?? 0xb01d);
  const gauss = (): number => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
  return {
    id: opts.id,
    run(ctx) {
      const scene = opts.scene;
      const e0 = Math.log(opts.believed) - Math.log(ctx.counts);
      for (let j = 0; j < opts.perTrial; j++) {
        const dir = j % 2 === 0 ? 1 : -1;
        const start = scene.view()[0];
        scene.spawnTarget({ kind: 'static', yaw: start + dir * 30, pitch: 0, distance: 20, worldRadius: 0.6 });
        const f = Math.exp(e0 * Math.pow(rate, j) + bias + noise * gauss());
        let yaw = start;
        for (const share of FRACTIONS) {
          scene.tick(16, [yaw, 0]);
          yaw += share * dir * 30 * f;
        }
        scene.clearTargets();
        scene.tick(16, [yaw, 0]); // the target is gone, so the observer closes the reach
      }
      const d = Math.log(ctx.counts) - Math.log(opts.peak);
      return Promise.resolve<TrialResult>({
        instrument: opts.id,
        counts: ctx.counts,
        score: -d * d + (ctx.rng() * 2 - 1) * 0.02,
        raw: {},
        at: 0,
      });
    },
  };
}

const COUNT_BOUNDS: [Counts360, Counts360] = [counts360(3000), counts360(12000)];

describe('runSession - the anchor observational channel', () => {
  const B0 = 9000; // the counts per 360 the scripted player's hands believe in
  const PEAK = 6000; // where its score peaks, which is not where its belief sits
  const PER_TRIAL = 12;
  const MAX_TRIALS = 24;

  /** One session against the scripted player, plus the ctx each trial actually received. */
  const play = async (): Promise<{
    outcome: Awaited<ReturnType<typeof runSession>>;
    ctxs: TrialContext[];
  }> => {
    const scene = new FakeScene();
    const player = reachingPlayer({ scene, id: 'flick', believed: B0, peak: PEAK, perTrial: PER_TRIAL, noise: 0.03 });
    const ctxs: TrialContext[] = [];
    const spy: Instrument = {
      id: 'flick',
      run: (c, s) => {
        ctxs.push(c);
        return player.run(c, s);
      },
    };
    const outcome = await runSession({
      profile: profile({ flick: 1 }),
      bounds: COUNT_BOUNDS,
      engine: makeBo({ gp: { signalVar: 1, lengthScale: 0.6, noiseVar: 0.05 }, acquisition: 'ei' }),
      instruments: instruments({ flick: spy }),
      scene,
      schedule: ['flick'],
      maxTrials: MAX_TRIALS,
      coldStart: 8,
      rng: mulberry32(4242),
      bootstrapIters: 200,
    });
    return { outcome, ctxs };
  };

  it('reads every reach of every trial exactly once', async () => {
    const { outcome } = await play();
    // Exactly once is also the assertion that ONE observer was constructed for the run. Building it
    // inside the loop would subscribe a second listener to the same frame stream and double this.
    expect(outcome.reaches).toHaveLength(MAX_TRIALS * PER_TRIAL);
    expect(outcome.reaches.every((r) => Number.isFinite(r.landedFraction) && r.landedFraction > 0)).toBe(true);
  });

  it('numbers reaches from 0 within each trial, which is what carries the adaptation term', async () => {
    const { outcome } = await play();
    const expected = Array.from({ length: PER_TRIAL }, (_, j) => j);
    expect(outcome.reaches.slice(0, PER_TRIAL).map((r) => r.index)).toEqual(expected);
    expect(outcome.reaches.slice(PER_TRIAL, PER_TRIAL * 2).map((r) => r.index)).toEqual(expected);
  });

  it('opens the trial before the instrument spawns, so the FIRST trial is not silently lost', async () => {
    // beginTrial sequenced after run() would leave `rendered` null for the whole first trial and
    // drop its reaches with no error anywhere. The first trial's gain appearing among the rendered
    // gains is the only external evidence the call is ordered right.
    const { outcome, ctxs } = await play();
    const rendered = new Set(outcome.reaches.map((r) => r.rendered));
    expect(rendered.has(ctxs[0]!.counts)).toBe(true);
    expect(rendered.size).toBeGreaterThanOrEqual(FLICK_MIN_LEVELS);
  });

  it('discloses how many of the reaches it read were reaches the scorer discarded', async () => {
    const { outcome, ctxs } = await play();
    // Computed from the same pure query the controller hands the observer, over the same ctx
    // objects the instruments received, and capped by how many reaches the trial actually contained.
    const expected = ctxs.reduce((n, c) => n + Math.min(leadInReaches(c), PER_TRIAL), 0);
    expect(outcome.leadInDiscarded).toBe(expected);
    expect(outcome.leadInDiscarded).toBeGreaterThan(0);
    expect(outcome.leadInDiscarded).toBeLessThan(outcome.reaches.length);
  });

  it('the reaches it carries out recover the belief the player was scripted with', async () => {
    const { outcome } = await play();
    expect(outcome.reaches.length).toBeGreaterThanOrEqual(FLICK_MIN_REACHES);
    const a = anchorFromReaches(outcome.reaches);
    if (a.identifiable !== true) throw new Error(`expected identifiable, got refusal: ${a.reason}`);
    // 8 percent, against the 4.6 percent mean absolute error the estimator demonstrated across
    // simulated sessions. This is one session, so the window is wider than the claim; it is not a
    // licence to loosen it further. If this fails, print `a` and check adaptRate first: a rate
    // pinned at a bound means the searched band collapsed, not that the estimator broke.
    expect(Math.abs(a.counts / B0 - 1)).toBeLessThan(0.08);
    // And the belief is NOT the optimum. If these two were the same number the whole test would
    // pass on an estimator that just echoed the located counts back.
    expect(Math.abs(a.counts / outcome.report.optimalCounts - 1)).toBeGreaterThan(0.2);
  });

  it('a scene that presents nothing yields no reaches and an honest refusal, never a guess', async () => {
    // The synthetic instruments above never touch the scene. That is a real deployment state (a
    // headless or scripted run), and the whole point of carrying reaches out rather than an anchor
    // is that the caller sees the emptiness and the estimator refuses on it.
    const outcome = await runSession({
      profile: profile({ flick: 1 }),
      bounds: COUNT_BOUNDS,
      engine: makeBo({ gp: { signalVar: 1, lengthScale: 0.6, noiseVar: 0.05 }, acquisition: 'ei' }),
      instruments: instruments({ flick: synthetic('flick', PEAK) }),
      scene: new FakeScene(),
      schedule: ['flick'],
      maxTrials: 10,
      rng: mulberry32(5),
      bootstrapIters: 80,
    });
    expect(outcome.reaches).toEqual([]);
    expect(outcome.leadInDiscarded).toBe(0);
    expect(anchorFromReaches(outcome.reaches)).toEqual({ identifiable: false, reason: 'too-few-reaches' });
  });

  it('is deterministic: the same seeds twice give the identical reaches', async () => {
    const a = await play();
    const b = await play();
    expect(b.outcome.reaches).toEqual(a.outcome.reaches);
    expect(b.outcome.trials.map((t) => t.counts)).toEqual(a.outcome.trials.map((t) => t.counts));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/optimizer/session-controller.test.ts -t 'reads every reach of every trial exactly once'`
Expected: FAIL with
`AssertionError: Target cannot be null or undefined.`
at the `expect(outcome.reaches).toHaveLength(288)` line, because `SessionOutcome` carries no
`reaches` yet. `npx tsc --noEmit` fails first and more usefully, with
`tests/optimizer/session-controller.test.ts(NNN,NN): error TS2339: Property 'reaches' does not exist on type 'SessionOutcome'.`

- [ ] **Step 3: Write the minimal implementation**

In `src/optimizer/session-controller.ts`, add `TrialContext` to the existing type import from
`'../types'`, and add three imports below it:

```ts
import type { FirstReach } from '../anchor/flick-anchor';
import { ReachObserver } from '../anchor/reach-observer';
import { leadInReaches } from '../instruments/acclimation';
```

Replace `SessionOutcome` with:

```ts
export interface SessionOutcome {
  report: Report;
  trials: TrialResult[];
  /** Every reach the anchor's observational channel could read, across every trial of this run, in
   *  order. Empty is a legitimate outcome (a scene that presents no targets, or a run whose reaches
   *  had no readable trough), which is exactly why the reaches come out rather than an anchor:
   *  `anchorFromReaches` refuses on too few, and a refusal must cost tier one rather than produce a
   *  factor built on three observations. Pinned by tests/optimizer/session-controller.test.ts
   *  ('a scene that presents nothing yields no reaches and an honest refusal, never a guess'). */
  reaches: FirstReach[];
  /** How many of those reaches were reaches the scorer discarded as acclimation lead-in. A
   *  disclosure the result screen may render. Never an input to the fit: the estimator uses every
   *  reach and cares only about the ordinal. */
  leadInDiscarded: number;
}
```

Replace `runSession` with (the loop body is unchanged apart from the two lines the comments name,
plus the `try`/`finally` that guarantees the unsubscribe):

```ts
export async function runSession(config: SessionConfig): Promise<SessionOutcome> {
  const { engine, schedule, bounds, profile, rng } = config;
  if (schedule.length === 0) throw new Error('runSession: schedule must list at least one instrument');
  const [lo, hi] = bounds;
  const loX = Math.log(lo);
  const hiX = Math.log(hi);
  const coldStart = config.coldStart ?? Math.max(4, 2 * schedule.length);
  const minTrials = config.minTrials ?? 8;
  const iters = config.bootstrapIters ?? 400;
  const levelAt = (k: number): Counts360 =>
    counts360(Math.exp(loX + ((k + 0.5) / coldStart) * (hiX - loX)));
  const orderedLevel = coldStartOrder(coldStart);
  const seedAt = (k: number): Counts360 => levelAt(orderedLevel[k] ?? k);

  const trials: TrialResult[] = config.initialTrials ? [...config.initialTrials] : [];

  // The anchor's observational channel (src/anchor/reach-observer.ts). ONE observer for the whole
  // run, constructed before the first trial spawns anything: building it per trial would subscribe
  // a second listener to the same frame stream and count every reach twice. It reads the live target
  // off the scene, because target lifetime belongs to the instruments and nothing outside them knows
  // which target is up (src/types.ts ArenaScene.activeTarget, task 36). It writes nothing: the scored
  // Recording is byte-identical with it attached, pinned by tests/anchor/reach-observer.test.ts.
  const observer = new ReachObserver(config.scene, () => config.scene.activeTarget());
  try {
    while (trials.length < config.maxTrials) {
      if (config.shouldStop?.()) break;
      const obs = trialsToObservations(trials, profile);
      const counts =
        trials.length < coldStart
          ? seedAt(trials.length)
          : counts360(clamp(engine.suggest(obs, bounds), lo, hi));
      const id = schedule[trials.length % schedule.length];
      config.onTrialStart?.(id, trials.length, counts);
      // The gain the player arrives at this trial holding. The acclimation lead-in sizes itself
      // from |ln(counts) - ln(prevCounts)|, because the cost of adapting scales with how far the
      // gain moved. Without this every trial spends the full worst-case budget, which is safe
      // (over-acclimating cannot bias a score) but charges the player time it does not need. On
      // the first trial there is no previous trial, so the honest answer is unknown and the
      // planner spends the full budget.
      const prev = trials.length > 0 ? trials[trials.length - 1]!.counts : undefined;
      // Lifted out of the run() call so the observer and the instrument cannot disagree about the
      // trial. leadInReaches MUST see this exact ctx: planAcclimation derives the discard count
      // from it, and a second ctx object would label scored reaches as lead-in ones.
      const trialCtx: TrialContext = {
        counts,
        rng,
        profile,
        ...(prev !== undefined ? { prevCounts: prev } : {}),
      };
      // Opened BEFORE the instrument spawns its first lead-in target. Until beginTrial runs the
      // observer has no rendered gain and drops every reach, with no error anywhere, so a call
      // sequenced after run() would silently lose the trial that carries the strongest belief
      // signal. Pinned by 'opens the trial before the instrument spawns'.
      observer.beginTrial(counts, leadInReaches(trialCtx));
      const result = await config.instruments[id].run(trialCtx, config.scene);
      trials.push(result);

      if (config.onTrial) {
        const interim = finalizeReport(
          trialsToObservations(trials, profile),
          bounds,
          mulberry32(0x5eed ^ trials.length), // own stream - does NOT touch the instrument RNG
          { bootstrapIters: config.interimBootstrapIters ?? 120 },
        );
        config.onTrial(result, trials, interim);
      }

      if (config.ciStopWidth !== undefined && trials.length >= minTrials) {
        try {
          // Its own stream, like the interim report above. Passing the shared instrument RNG
          // here meant every stop check burned a few hundred draws, so the target geometry a
          // player saw later in the session depended on how many stop checks had run.
          const ci = bootstrapCi(
            [...trialsToObservations(trials, profile)],
            iters,
            mulberry32(0x570b ^ trials.length),
          );
          if (Math.abs(ci[1] - ci[0]) <= config.ciStopWidth) break;
        } catch {
          // not yet concave-fittable → keep gathering
        }
      }
    }
  } finally {
    // Unsubscribe even when an instrument throws: a live frame listener on a scene the session no
    // longer drives is a leak with no owner. stop() also closes the last trial's still-open reach,
    // so the final reach of the run is counted rather than dropped, and it is idempotent.
    observer.stop();
  }

  // Final report: cross-check the parabola peak against the surrogate's posterior-mean argmax so the
  // CI widens honestly when the global quadratic and the flexible GP disagree (spec §5.3). At FINALIZE
  // ONLY (never inside evolution.suggest, which would desync the stateful lineage) we first sharpen
  // the GP hyperparameters by exact marginal likelihood (P1-2). The fit only ever sharpens this
  // cross-check peak; it never rescales y and never replaces the conservative CI, so it can only
  // WIDEN the honest CI. When the engine exposes no GP params we keep the unfitted posteriorPeak.
  const finalObs = trialsToObservations(trials, profile);
  let gpPeak: Counts360 | undefined;
  if (engine.gpParams !== undefined && engine.posteriorPeakWith !== undefined) {
    const fitted = fitGpParams(finalObs, engine.gpParams, bounds);
    gpPeak = engine.posteriorPeakWith(finalObs, bounds, fitted);
  } else {
    gpPeak = engine.posteriorPeak?.(finalObs, bounds);
  }
  const report = finalizeReport(finalObs, bounds, rng, {
    bootstrapIters: iters,
    // A4: detrend within-session drift (practice or fatigue) at FINALIZE ONLY - interim/early-stop
    // reports above never set this, so the deterministic mid-session RNG stream is untouched and the
    // trial sequence is byte-identical with or without the drift feature.
    detrendDrift: true,
    ...(gpPeak !== undefined ? { gpPeakCounts: gpPeak } : {}),
  });
  return {
    report,
    trials,
    reaches: observer.reaches(),
    leadInDiscarded: observer.discardedByScoring(),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/optimizer/session-controller.test.ts`
Expected: PASS, with 7 more tests in the file than before this task (the describe block above).
Then `npx tsc --noEmit` is clean.

If `the reaches it carries out recover the belief` fails, read the refusal before touching a number.
`too-few-reaches` means the fixture's reaches were dropped, and the first thing to check is that
`FRACTIONS` still produces a strict trough under `PRIMARY_TROUGH_DROP`. `no-covariance` means the
cold-start levels collapsed, which would show up as `rendered.size` below `FLICK_MIN_LEVELS` in the
test above it. `adapt-rate-at-bound` means the scripted `rate` reached the grid edge, and the fixture
sets it to 0.6, well inside `[0.05, 0.95]`.

- [ ] **Step 5: Commit**

```bash
git add src/optimizer/session-controller.ts tests/optimizer/session-controller.test.ts
git commit -m "feat(session): the anchor reads every trial, and its reaches leave with the report

One ReachObserver for the run, opened on each trial at the gain about to be rendered and the lead-in
count the scorer will discard, both taken from the same ctx the instrument receives. The reaches come
out of runSession rather than an anchor, because emptiness is a real outcome and the estimator has to
be the one that refuses on it. The unsubscribe is in a finally, so an instrument that throws does not
leave a frame listener on a scene nobody drives."
```

### Task 39: the pinned convention is declared, not smuggled

**Files:**
- Modify: `src/optimizer/result.ts` (`Prescription`, and the local `tierTwo` annotation)
- Modify: `tests/optimizer/prescription.test.ts` (one added describe block)

**This settles ROUND 2 open item 1, and both halves of it were wrong in different directions.**

Phase 3's hand-off H3 item 6 asks phase 1b to add `k?: number` to `Prescription` because "tier three
renders `optimalCounts / k` as hardware counts". Read `src/ui/result.ts` as phase 1b task 11 authors
it: tier three renders `p.hardwareCounts`, and `hardwareCounts` is computed once, in
`buildPrescription`, as `counts360(cStar / k.k)`. The screen never divides by k and must not start:
one k, applied in one commit of arithmetic, is the whole point of A4. So phase 3's stated REASON does
not hold, and phase 1b was right to answer A6 with `hardwareCounts` instead.

But the field arrives anyway. `tierTwoFrom` returns `{ perGameSens, kSource, k, kLogSd }` (phase 3
task 27 step 3, and its test pins that exact key set), and `buildPrescription` writes
`tierTwo = { ...t, hardwareCounts: counts360(cStar / k.k) }`. TypeScript does not excess-property-check
through a spread. Verified against this repo's compiler, tsc 5.9.3, with strict mode and
`exactOptionalPropertyTypes` both on: assigning `{ ...t, extra }` to a type that omits one of `t`'s
members compiles clean and exits 0. So `k` lands on every pinned `Prescription`, and one is
persisted to localStorage by `saveResult` and written into the export bundle by
`buildExportBundle`. A field that ships in a player's exported JSON and appears in no type is a field
nobody maintains.

So: the field is declared here, as a disclosure rather than as an input, and the local annotation
inside `buildPrescription` is widened to state it so the spread stops being the thing that decides.
Authored in this part rather than handed to a sixth owner.

- [ ] **Step 1: Write the test the type has to earn**

Append to `tests/optimizer/prescription.test.ts`:

```ts
describe('the pinned convention, declared rather than smuggled', () => {
  it('rides exactly when the table does, and is absent when k is unpinned', () => {
    const pinned = buildPrescription(report, anchor, LATTICE_2)!;
    expect(pinned.k).toBe(2);
    expect('k' in pinned).toBe(true);
    const typed = buildPrescription(report, anchor, TYPED_125)!;
    expect(typed.k).toBe(1.25);
    const unpinned = buildPrescription(report, anchor)!;
    expect('k' in unpinned).toBe(false);
    expect(buildPrescription(report, anchor, UNPINNED)!.k).toBeUndefined();
  });

  it('is a disclosure, never the divisor: tier three reads hardwareCounts, which was divided once', () => {
    // Re-deriving C*/k at render time would be a second place for the division to live, and the
    // two would drift the first time either side changed. hardwareCounts is that division, done
    // once in buildPrescription; k rides so a Result rehydrated from storage can still SAY which
    // factor was pinned, with no draft left to ask.
    const p = buildPrescription(report, anchor, TYPED_125)!;
    expect(p.hardwareCounts).toBe(p.counts / p.k!);
    expect(p.hardwareCounts).toBe(8000 / 1.25);
  });

  it('every field the object carries is a field the interface declares', () => {
    // The guard, and the reason this task exists. TypeScript does not excess-property-check through
    // a spread, so `{ ...tierTwoFrom(...) }` can put a member on the shipped Prescription that no
    // type mentions, and the Prescription is persisted and exported. This list is the declared
    // shape: a spread that grows a new member fails here before it reaches a player's JSON.
    const p = buildPrescription(report, anchor, TYPED_125)!;
    expect(Object.keys(p).sort()).toEqual([
      'counts', 'countsCi90', 'hardwareCounts', 'k', 'kLogSd', 'kSource', 'perGameSens',
      'ratio', 'ratioCi90',
    ]);
  });
});
```

- [ ] **Step 2: Run the check that fails, and note the one that does not**

Run: `npx tsc --noEmit`
Expected: FAIL with
`tests/optimizer/prescription.test.ts(NNN,NN): error TS2339: Property 'k' does not exist on type 'Prescription'.`
repeated for each `p.k` / `pinned.k` / `typed.k` reference.

Run: `npx vitest run tests/optimizer/prescription.test.ts`
Expected: PASS. Stated plainly because it is the finding, not an oversight: vitest strips types and
never typechecks, so at runtime `k` is already there and every assertion above already holds. The
defect is invisible to the test runner and visible only to the compiler, which is precisely how a
field spread past its declaration survives a repair pass. The third test is green in both directions
and stays as the guard.

- [ ] **Step 3: Write the minimal implementation**

In `src/optimizer/result.ts`, add to the `Prescription` interface, directly after `kSource`:

```ts
  /** The pinned convention itself: browser deltas per real mouse count. A DISCLOSURE, and never a
   *  divisor at render time. `hardwareCounts` below is C* / k with the division already done once
   *  in this module, and tier three renders that; re-deriving it at the screen would put the same
   *  arithmetic in two files, which is the duplication amendment A4 exists to prevent. It rides
   *  because a Result rehydrated from localStorage has no draft left to ask which factor was pinned,
   *  and because it is already on the object: tierTwoFrom returns it and the spread that builds this
   *  shape carries it whether or not a type mentions it (tsc does not excess-property-check through
   *  a spread). Declared, so the field a player finds in their exported JSON is a field this
   *  interface owns. Present exactly when `perGameSens` is.
   *  Regression: tests/optimizer/prescription.test.ts ('every field the object carries is a field
   *  the interface declares'). */
  k?: number;
```

and in `buildPrescription`, widen the local annotation so the shape is stated rather than inferred
from a spread:

```ts
  let tierTwo:
    | {
        perGameSens: Partial<Record<GameId, number>>;
        kSource: 'lattice' | 'typed-sens';
        k: number;
        kLogSd: number;
        hardwareCounts: Counts360;
      }
    | null = null;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsc --noEmit && npx vitest run tests/optimizer tests/ui/result.test.ts`
Expected: PASS on both, with 3 more tests in `tests/optimizer/prescription.test.ts` than before.
No render behaviour changes: `src/ui/result.ts` reads `hardwareCounts` and never `k`, which the
second test above pins by reading both.

- [ ] **Step 5: Commit**

```bash
git add src/optimizer/result.ts tests/optimizer/prescription.test.ts
git commit -m "fix(prescription): declare the pinned k that the spread was already shipping

tierTwoFrom returns k and buildPrescription spreads it, and tsc does not excess-property-check
through a spread, so k has been landing on every pinned Prescription with no type mentioning it. A
Prescription is persisted and exported, so that is a field in a player's JSON that nothing owns.
Declared as a disclosure. Tier three still renders hardwareCounts, which is the one place the
division by k happens; phase 3's hand-off asked for k so the screen could divide, and it must not."
```

### Task 40: finalize reconciles the two routes and the prescription reaches the Result

**Files:**
- Modify: `src/ui/session-view.ts` (imports, `runSegment`'s outcome handling, `finalize`)
- Modify: `tests/ui/session-view.test.ts` (the deferred segment type, its three resolutions, and one added describe block)

This is the seam amendment A3 named: four owners each documented it as a hand-off and none of them
authored it, so tier one has never rendered. Everything it calls exists after task 38, phase 2 task
18 (`SessionDraft.turn`), phase 3's hand-off H2 (`SessionDraft.kPin`), phase 4 tasks 32 and 35, and
phase 1b tasks 9 and 11 (`BuildResultOpts.anchor` and `.k`).

- [ ] **Step 1: Write the failing test**

In `tests/ui/session-view.test.ts`, replace the deferred-segment block inside
`mountWithRunningSegment` (lines 91 to 95 at HEAD) with the full `SessionOutcome` shape, and add the
imports the new tests need:

```ts
import { counts360, type Counts360, type InstrumentId, type Report, type TrialResult } from '../../src/types';
import type { SessionOutcome } from '../../src/optimizer/session-controller';
import type { FirstReach } from '../../src/anchor/flick-anchor';
import { turnFromPasses } from '../../src/anchor/reference-turn';
```

(the first line replaces the file's existing `import type { InstrumentId, Report, TrialResult }`
line; the other three are new.)

```ts
  let resolveSegment: ((v: SessionOutcome) => void) | null = null;
  let rejectSegment: ((e: unknown) => void) | null = null;
  const runSegment = vi.fn(() => new Promise<SessionOutcome>((res, rej) => {
    resolveSegment = res; rejectSegment = rej;
  }));
```

The three existing `getResolve()!({ report: ..., trials: ... })` calls (at lines 497, 515 and 528 at
HEAD) each gain the two new members, because a `SessionOutcome` without them is no longer one:

```ts
    getResolve()!({ report: REPORT, trials: TRIALS, reaches: [], leadInDiscarded: 0 });
```

```ts
    getResolve()!({ report: { ...REPORT, ci90: [NaN, NaN] as [number, number] }, trials: TRIALS, reaches: [], leadInDiscarded: 0 });
```

```ts
    getResolve()!({ report: REPORT, trials: TRIALS, reaches: [], leadInDiscarded: 0 });
```

Then append this describe block at the end of the file:

```ts
describe('session-view: finalize reconciles the anchor and prescribes', () => {
  const c = counts360;
  const ci = (lo: number, hi: number): [Counts360, Counts360] => [c(lo), c(hi)];
  const REPORT: Report = {
    optimalCounts: c(6000),
    ci90: ci(5600, 6500),
    curve: [{ x: Math.log(5000), mean: 0.1 }, { x: Math.log(6000), mean: 0.4 }],
  } as Report;
  const TRIALS: TrialResult[] = [
    { instrument: 'flick', counts: c(5200), score: 0.4, raw: {}, at: 0 },
    { instrument: 'track', counts: c(6800), score: 0.5, raw: {}, at: 0 },
  ];
  /** A believed gain the reaches agree on, well away from the located optimum, so a factor of 1
   *  cannot pass by accident. */
  const B0 = 9000;
  const LEVELS = [4200, 4800, 5400, 6000, 6600, 7200, 7800, 8400];

  /** Reaches from an adapting player who believes B0, in the shape anchorFromReaches consumes. */
  const reaches = (trials: number, perTrial: number, from = 0): FirstReach[] => {
    const out: FirstReach[] = [];
    for (let t = from; t < from + trials; t++) {
      const rendered = LEVELS[t % LEVELS.length]!;
      const e0 = Math.log(B0) - Math.log(rendered);
      for (let j = 0; j < perTrial; j++) {
        out.push({
          rendered: c(rendered),
          landedFraction: Math.exp(e0 * Math.pow(0.6, j) + Math.log(0.94)),
          index: j,
        });
      }
    }
    return out;
  };

  const lockIn = async (
    outcome: SessionOutcome,
    prepare?: (ctx: AppContext) => void,
  ): Promise<AppContext> => {
    const h = mountWithRunningSegment();
    prepare?.(h.ctx);
    (h.root.querySelector('[data-prelock="begin"]') as HTMLButtonElement).click();
    await flush();
    h.getResolve()!(outcome);
    await flush();
    await flush();
    (h.root.querySelector('[data-dialed="lock"]') as HTMLButtonElement).click();
    h.screen.unmount();
    return h.ctx;
  };

  it('turns the reaches and the turn into a rendered factor, which is the whole change', async () => {
    const ctx = await lockIn(
      { report: REPORT, trials: TRIALS, reaches: reaches(6, 8), leadInDiscarded: 12 },
      (c2) => { c2.draft.turn = turnFromPasses([8900, 9050, 9000])!; },
    );
    const p = ctx.lastResult!.result.prescription;
    expect(p).toBeDefined();
    // The factor is the anchor over the located optimum, both counted in browser deltas. Around
    // 9000 / 6000, and the assertion is that it is a real quotient of two measured numbers rather
    // than 1.00, which is what an unwired seam would have produced by never rendering at all.
    expect(p!.ratio).toBeGreaterThan(1.3);
    expect(p!.ratio).toBeLessThan(1.7);
    expect(p!.ratioCi90![0]).toBeLessThan(p!.ratio!);
    expect(p!.ratioCi90![1]).toBeGreaterThan(p!.ratio!);
    expect(p!.counts).toBe(REPORT.optimalCounts);
  });

  it('the turn alone still anchors when the reaches refuse: the flick is a route, not a gate', async () => {
    const ctx = await lockIn(
      { report: REPORT, trials: TRIALS, reaches: [], leadInDiscarded: 0 },
      (c2) => { c2.draft.turn = turnFromPasses([8900, 9050, 9000])!; },
    );
    expect(ctx.lastResult!.result.prescription!.ratio).toBeGreaterThan(1.3);
  });

  it('neither route means no factor at all, never a padded one', async () => {
    // The honest degradation. reconcile returns null, buildPrescription is handed null, and with no
    // pinned k either there is nothing to prescribe: the screen leads with the located counts and
    // says the factor is withheld.
    const ctx = await lockIn({ report: REPORT, trials: TRIALS, reaches: [], leadInDiscarded: 0 });
    expect('prescription' in ctx.lastResult!.result).toBe(false);
    expect(ctx.lastResult!.result.optimalCounts).toBe(REPORT.optimalCounts);
  });

  it('accumulates reaches across segments, because refining runs a second observer', async () => {
    // "Keep refining" calls runSession again, with its own ReachObserver, so its outcome carries
    // only the reaches of the trials it ran. Overwriting would hand the estimator a fraction of the
    // session's data, and the estimator would answer that with a REFUSAL rather than an error: the
    // loss would be silent and would look like a player who simply did not produce a clean read.
    // The two halves below are each below FLICK_MIN_REACHES and together are above it.
    // No turn on this draft: fakeContext() writes none, and exactOptionalPropertyTypes would reject
    // an explicit `= undefined` anyway, so absence is expressed by not writing the field.
    const h = mountWithRunningSegment();
    (h.root.querySelector('[data-prelock="begin"]') as HTMLButtonElement).click();
    await flush();
    h.getResolve()!({ report: REPORT, trials: TRIALS, reaches: reaches(4, 6), leadInDiscarded: 8 });
    await flush();
    await flush();
    (h.root.querySelector('[data-dialed="refine"]') as HTMLButtonElement).click();
    await flush();
    h.getResolve()!({ report: REPORT, trials: TRIALS, reaches: reaches(4, 6, 4), leadInDiscarded: 8 });
    await flush();
    await flush();
    (h.root.querySelector('[data-dialed="lock"]') as HTMLButtonElement).click();
    expect(h.ctx.lastResult!.result.prescription!.ratio).toBeGreaterThan(1.3);
    h.screen.unmount();
  });

  it('a single segment of the same size cannot anchor, so the test above is measuring the join', async () => {
    // The control for the accumulation test: 24 reaches is under FLICK_MIN_REACHES, so one half
    // alone refuses. Without this, the test above would pass on an implementation that simply kept
    // the LAST segment's reaches, and the whole assertion would be vacuous.
    const ctx = await lockIn({ report: REPORT, trials: TRIALS, reaches: reaches(4, 6), leadInDiscarded: 8 });
    expect('prescription' in ctx.lastResult!.result).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/ui/session-view.test.ts -t 'turns the reaches and the turn into a rendered factor'`
Expected: FAIL with
`AssertionError: expected undefined to be defined`
at `expect(p).toBeDefined()`, because `finalize` still calls `buildResult` with only `bounds` and
`profile` and no anchor ever reaches it.

- [ ] **Step 3: Write the implementation**

In `src/ui/session-view.ts`, add to the imports:

```ts
import { anchorFromReaches, type FirstReach } from '../anchor/flick-anchor';
import { reconcile } from '../anchor/reconcile';
```

Add the two accumulators beside `allTrials` (which is declared at line 190 at HEAD):

```ts
      let allTrials: TrialResult[] = [];
      // Every reach the anchor read, across every segment of this visit. Accumulated rather than
      // replaced: "keep refining" runs a second runSession with its own ReachObserver, so its
      // outcome carries only its own trials' reaches, and overwriting would hand the estimator a
      // fraction of the session. It would then REFUSE rather than error, which is a silent loss
      // wearing an honest refusal (pinned by 'accumulates reaches across segments').
      let allReaches: FirstReach[] = [];
      let leadInDiscarded = 0;
```

Replace `runSegment` entirely. Only the `const { report, trials } = await` destructuring and the two
assignments that followed it change; everything else is what phase 1a left, reproduced so the whole
function is here rather than described:

```ts
      const runSegment = async (maxTrials: number, ciStopWidth: number | undefined): Promise<void> => {
        if (running) return; // re-entry guard at the source: a second concurrent launch (a stacked
        // begin double-click inside the async lock window, or any future caller) must never interleave
        // the SHARED stateful (1+lambda)-ES engine + allTrials buffer. `running` is set synchronously
        // below before the first await, so the second microtask sees it true and bails. The gain is never
        // at risk (the gold sphere owns it); this protects the search lineage + live plot consistency.
        running = true;
        // try/finally, so a throw anywhere under here releases `running`. Without it one failure
        // leaves the flag stuck true forever: the abort scrim's gate stays armed, "keep refining"
        // is dead behind its own guard, and the session freezes with nothing on screen to say so.
        try {
          const outcome = await runSession({
            profile: ctx.draft.profile, bounds: ctx.draft.bounds,
            engine, instruments: INSTRUMENTS, scene: stage.arena, schedule: SCHEDULE,
            maxTrials, coldStart: COLD_START, rng: mulberry32(2026), minTrials: MIN_TRIALS,
            ...(ciStopWidth !== undefined ? { ciStopWidth } : {}),
            bootstrapIters: 300, initialTrials: allTrials, shouldStop: () => lockedIn,
            onTrialStart: (id, i, counts) => {
              hudInstruction.textContent = instructionFor(id);
              hudProgress.textContent = searchLabel(i, counts, COLD_START, maxTrials);
              // Announce ONLY when the instrument changes (a segment-meaningful moment), not every trial.
              if (id !== announcedInstrument) { announcedInstrument = id; hudEstimate.textContent = instructionFor(id); }
              // First encounter of an environment: a one-time title-card beat naming the probe.
              if (!seenEnvs.has(id)) {
                seenEnvs.add(id);
                showBeat(ENV_BEATS[id].title, ENV_BEATS[id].sub);
              }
              // The seed curtain: fires exactly once, on the first trial PAST Generation 0. Written
              // after the instrument announce so it wins the live region on a tie (rarer beat wins).
              if (i === COLD_START && !curtainDropped) {
                curtainDropped = true;
                hudEstimate.textContent = CURTAIN_LINE;
                showBeat('Evolution begins', 'The gene pool is seeded · each round now tests one mutated sensitivity');
              }
              stage.setEnemyEnvironment(id); // skin this trial's targets with the environment's prey
              stage.arena.clearTargets();
            },
            onTrial: (_t, trials2, interim) => { lastReport = interim; drawPlot(interim, trials2); },
          });
          allTrials = outcome.trials;
          lastReport = outcome.report;
          // Concatenated, never assigned. See the declaration of allReaches above: a second segment
          // ran a second observer over its own trials only.
          allReaches = [...allReaches, ...outcome.reaches];
          leadInDiscarded += outcome.leadInDiscarded;
        } finally {
          running = false;
        }
      };
```

Replace `finalize` entirely:

```ts
      const finalize = (): void => {
        if (!alive || !lastReport) return;
        const report = lastReport;
        // Identity is the clock, not the outcome: a content-derived id made two runs that matched
        // on trial count and optimum overwrite each other in both stores, and a hardcoded
        // createdAt: 0 left every record unsortable and unprunable.
        const now = Date.now();
        const sessionId = `s-${now}-${allTrials.length}`;
        // The two anchor routes meet here and nowhere else, because this is the only place both
        // exist: the blind turn was written to the draft at setup, and the reaches came out of the
        // segments above. reconcile returns null when neither route spoke, and null is passed
        // through as ABSENCE rather than widened into a guess: buildPrescription then withholds the
        // factor and the screen says so. Order is load bearing only in that each argument is the
        // previous result; nothing here refits anything.
        const anchor = reconcile(ctx.draft.turn ?? null, anchorFromReaches(allReaches));
        const result = buildResult(report, allTrials, {
          bounds: ctx.draft.bounds,
          profile: ctx.draft.profile,
          // Spread conditionally, not passed as undefined: exactOptionalPropertyTypes draws a
          // distinction between an absent option and one present with the value undefined, and the
          // absent one is what "no anchor this session" means.
          ...(anchor !== null ? { anchor } : {}),
          // Phase 3's pin, straight off the draft. Absent or unpinned costs tier two and never the
          // factor, because the factor is a ratio of two counts in the same browser units.
          ...(ctx.draft.kPin !== undefined ? { k: ctx.draft.kPin } : {}),
        });
        ctx.storage.saveSession({ id: sessionId, profile: ctx.draft.profile, trials: [...allTrials], status: 'complete', createdAt: now });
        ctx.storage.saveResult(sessionId, result);
        ctx.lastResult = { sessionId, result };
        rememberPrefs(ctx, sessionId); // point the returning-visitor restore at this result
        ctx.navigate('result');
      };
```

`leadInDiscarded` is accumulated and not yet read by any screen. That is deliberate and it is a
disclosure the result screen may render later; `noUnusedLocals` does not fire on an assigned local,
and removing it would mean re-deriving it from a `SessionOutcome` that no longer exists by then.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/ui/session-view.test.ts && npx tsc --noEmit`
Expected: PASS on both, with 5 more tests in the file than before this task.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, zero failures.

- [ ] **Step 6: Commit**

```bash
git add src/ui/session-view.ts tests/ui/session-view.test.ts
git commit -m "feat(result): wire the anchor into the payoff, so tier one finally renders

The seam amendment A3 named: four parts documented this hand-off and none of them authored it, so
the multiply-your-sensitivity-by factor that is the point of the change has never reached a screen.
finalize reconciles the blind turn against the flick reaches and hands the anchor and the pin to
buildResult. Reaches accumulate across segments, because keep-refining runs a second observer and
overwriting would hand the estimator a third of the session, which it answers with a refusal rather
than an error: a silent loss dressed as an honest one."
```

### Task 41: end to end, a simulated session renders the right factor with the right interval

**Files:**
- Create: `tests/integration/tier-one.test.ts`

Nothing in this plan is done until this passes.

**What this test does and does not exercise, stated up front rather than discovered later.** It runs
the real `runSession` with a real `ReachObserver` against a real scene, takes the real
`SessionOutcome` that produces, hands it through `sessionView`'s one injection seam, locks the run
in, and mounts the real result screen on the real `Result`. Every estimator, the reconciliation, the
prescription and the rendering are the shipped code.

Two things are not the shipped code, and both are forced:

1. **The instrument is scripted, not one of the four drills.** `sessionView` hardcodes
   `instruments: INSTRUMENTS` and `schedule: SCHEDULE` (lines 13 and 249 at HEAD), so `deps.runSession`
   is the only seam it exposes; and driving a real drill would require scripting a player whose
   `mt`, hit rate and correction count produce a known optimum, which is inventing a performance
   model and then testing the model. The scripted player drives the scene through exactly the
   protocol the drills use (spawn one target, reach, clear, spawn the next) and returns a score that
   is a parabola in ln counts. What the drills add on top is their scoring, which their own suites
   cover.
2. **The transport between the controller and the view is the injected `runSession`.** The object it
   hands over is the genuine outcome of the run in step one, not a literal, so the seam under test
   (`finalize`) receives real reaches from a real observer.

Neither can be closed without a browser: the shipped path needs pointer lock, WebGL and a human hand.
That is stated in the test file itself so the next reader does not mistake the scoping for laziness.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/tier-one.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { runSession, type SessionOutcome } from '../../src/optimizer/session-controller';
import { makeBo } from '../../src/optimizer/bayesopt';
import { mulberry32 } from '../../src/stats/rng';
import { FakeScene } from '../instruments/fake-scene';
import { anchorFromReaches, FLICK_MIN_LEVELS, FLICK_MIN_REACHES } from '../../src/anchor/flick-anchor';
import { reconcile } from '../../src/anchor/reconcile';
import { turnFromPasses } from '../../src/anchor/reference-turn';
import { ratioFraming } from '../../src/optimizer/result';
import { sessionView, type SessionViewDeps } from '../../src/ui/session-view';
import { result } from '../../src/ui/result';
import type { AppContext } from '../../src/ui/shell';
import type { ArenaStage } from '../../src/ui/arena-stage';
import {
  counts360,
  type Counts360,
  type Instrument,
  type Profile,
  type Result,
  type Session,
  type TrialResult,
} from '../../src/types';

/**
 * The one test that carries the change: a session with a KNOWN anchor and a KNOWN optimum, driven
 * through the shipped estimators, the shipped reconciliation and the shipped screen, asserting that
 * the factor a player is told to multiply by is the quotient of those two numbers and that its
 * interval is the conservative endpoint quotient of their two intervals.
 *
 * The scripted player believes B0 counts per 360 and aims best at PEAK, so the honest instruction is
 * to multiply by B0 / PEAK = 1.5. Those two numbers are deliberately far apart: a seam that never
 * wired the anchor in would report a factor of 1.00 or no factor at all, and both would pass a test
 * whose truth sat near 1.
 *
 * What is NOT exercised here, so nobody reads more into it than it says. The instrument is scripted
 * rather than one of the four drills, because sessionView hardcodes INSTRUMENTS and SCHEDULE and its
 * only injection seam is deps.runSession, and because scripting a real drill means scripting a
 * performance model and then testing the model. The scripted player drives the scene through exactly
 * the protocol the drills use. And the transport into the view is that same seam, carrying the real
 * outcome of the real run below rather than a literal. Closing either would need pointer lock, WebGL
 * and a hand on a mouse, which no unit test has.
 */

const B0 = 9000; // what the player's hands believe a full turn costs
const PEAK = 6000; // where the player actually aims best
const PER_TRIAL = 12;
const MAX_TRIALS = 24;
const BOUNDS: [Counts360, Counts360] = [counts360(3000), counts360(12000)];
const PROFILE: Profile = {
  speedAccuracy: 0.5,
  instrumentWeights: { track: 0, flick: 1, calibrate: 0, strike: 0 },
};

/** Per-frame share of the reach's primary displacement: sums to 1.00 at index 6, then corrects, so
 *  the segmenter finds a strict trough at exactly the sample whose aim is the primary's extent. */
const FRACTIONS = [0, 0.06, 0.26, 0.44, 0.18, 0.04, 0.02, 0.12, 0.05, 0.01] as const;

/** The scripted player. ln f = (ln B0 - ln C_r) * rate^j + bias, the model flick-anchor.ts fits. */
function scriptedPlayer(scene: FakeScene): Instrument {
  const rng = mulberry32(0x1e57);
  const gauss = (): number => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
  return {
    id: 'flick',
    run(ctx) {
      const e0 = Math.log(B0) - Math.log(ctx.counts);
      for (let j = 0; j < PER_TRIAL; j++) {
        const dir = j % 2 === 0 ? 1 : -1;
        const start = scene.view()[0];
        scene.spawnTarget({ kind: 'static', yaw: start + dir * 30, pitch: 0, distance: 20, worldRadius: 0.6 });
        const f = Math.exp(e0 * Math.pow(0.6, j) + Math.log(0.94) + 0.03 * gauss());
        let yaw = start;
        for (const share of FRACTIONS) {
          scene.tick(16, [yaw, 0]);
          yaw += share * dir * 30 * f;
        }
        scene.clearTargets();
        scene.tick(16, [yaw, 0]);
      }
      const d = Math.log(ctx.counts) - Math.log(PEAK);
      return Promise.resolve<TrialResult>({
        instrument: 'flick',
        counts: ctx.counts,
        score: -d * d + (ctx.rng() * 2 - 1) * 0.02,
        raw: { throughput: 4, hitRate: 0.86, mtMean: 480 },
        at: 0,
      });
    },
  };
}

/** The real controller, the real observer, a real scene. Memoized rather than run at module load:
 *  a rejection from an eager module-scope promise surfaces as an unhandled rejection with no test
 *  attached to it, which is a worse failure report than the same throw inside the first `it`. */
let cached: Promise<SessionOutcome> | null = null;
const session = (): Promise<SessionOutcome> => {
  if (cached === null) {
    const scene = new FakeScene();
    const player = scriptedPlayer(scene);
    cached = runSession({
      profile: PROFILE,
      bounds: BOUNDS,
      engine: makeBo({ gp: { signalVar: 1, lengthScale: 0.6, noiseVar: 0.05 }, acquisition: 'ei' }),
      instruments: { track: player, flick: player, calibrate: player, strike: player },
      scene,
      schedule: ['flick'],
      maxTrials: MAX_TRIALS,
      coldStart: 8,
      rng: mulberry32(4242),
      bootstrapIters: 200,
    });
  }
  return cached;
};

/** An in-memory Storage, so the result screen can find the session its plot marks come from. */
function memoryStorage(): AppContext['storage'] {
  const sessions: Session[] = [];
  const results: Record<string, Result> = {};
  return {
    saveSession: (s) => void sessions.push(s),
    loadSessions: () => sessions,
    saveResult: (id, r) => void (results[id] = r),
    loadResults: () => results,
    exportJson: () => '',
  };
}

function fakeStage(scene: FakeScene): ArenaStage {
  return {
    arena: scene as unknown as ArenaStage['arena'],
    requestLock: vi.fn(() => Promise.resolve('raw')),
    exitLock: vi.fn(),
    isLocked: () => false,
    setCounts: vi.fn(),
    setEnemyEnvironment: vi.fn(),
    ready: Promise.resolve(),
    dispose: vi.fn(),
  } as unknown as ArenaStage;
}

const flush = (): Promise<void> => Promise.resolve().then(() => undefined);

/** Drive the shipped view from the shipped outcome, lock the run in, and return the live context. */
async function lockInThroughTheView(outcome: SessionOutcome): Promise<AppContext> {
  const ctx = {
    navigate: vi.fn(),
    route: 'session',
    storage: memoryStorage(),
    draft: {
      currentGame: 'cs2',
      currentSens: 1,
      profile: PROFILE,
      bounds: BOUNDS,
      // The other anchor route: three blind passes around the same belief, through the shipped
      // estimator rather than a hand-built TurnEstimate, so its one-sided shrinkage is in the loop.
      turn: turnFromPasses([8900, 9050, 9000])!,
    },
  } as unknown as AppContext;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const deps: SessionViewDeps = {
    createStage: () => fakeStage(new FakeScene()),
    runSession: () => Promise.resolve(outcome),
  };
  const screen = sessionView(host, ctx, deps);
  screen.mount();
  const root = host.querySelector('.session') as HTMLElement;
  (root.querySelector('[data-prelock="begin"]') as HTMLButtonElement).click();
  // Four ticks, one per await in the chain requestLock → begin → runSegment → runSession, plus one
  // spare. Flushing more than the chain needs is inert; flushing fewer would click lock before
  // lastReport is set and finalize would return at its own guard with nothing saved.
  for (let i = 0; i < 4; i++) await flush();
  (root.querySelector('[data-dialed="lock"]') as HTMLButtonElement).click();
  screen.unmount();
  host.remove();
  return ctx;
}

describe('end to end: a known anchor and a known optimum reach the screen as one factor', () => {
  it('the session produces enough readable reaches for the anchor to speak at all', async () => {
    const outcome = await session();
    expect(outcome.reaches.length).toBeGreaterThanOrEqual(FLICK_MIN_REACHES);
    expect(new Set(outcome.reaches.map((r) => r.rendered)).size).toBeGreaterThanOrEqual(FLICK_MIN_LEVELS);
    // The located optimum has to be interior, or buildPrescription refuses on the clamp and this
    // whole file measures the refusal path instead of the one it is here for.
    expect(outcome.report.peakAtBound).toBeUndefined();
    expect(Math.abs(outcome.report.optimalCounts / PEAK - 1)).toBeLessThan(0.12);
  });

  it('the two routes recover the belief and their combination brackets it', async () => {
    const outcome = await session();
    const flick = anchorFromReaches(outcome.reaches);
    if (flick.identifiable !== true) throw new Error(`flick anchor refused: ${flick.reason}`);
    expect(Math.abs(flick.counts / B0 - 1)).toBeLessThan(0.08);
    const anchor = reconcile(turnFromPasses([8900, 9050, 9000])!, flick);
    if (anchor === null) throw new Error('expected a combined anchor');
    expect(anchor.sources).toEqual(['turn', 'flick']);
    expect(anchor.ci90[0]).toBeLessThan(B0);
    expect(anchor.ci90[1]).toBeGreaterThan(B0);
  });

  it('the Result carries the factor, and it is the quotient of the two measured numbers', async () => {
    const outcome = await session();
    const ctx = await lockInThroughTheView(outcome);
    const r = ctx.lastResult!.result;
    const p = r.prescription;
    expect(p).toBeDefined();
    // Rebuild the anchor from the same inputs the view had. Exact equality, not a tolerance: the
    // screen must be showing the quotient of the reconciliation and the report, not something
    // recomputed, rounded or smoothed on the way through.
    const anchor = reconcile(ctx.draft.turn!, anchorFromReaches(outcome.reaches))!;
    expect(p!.ratio).toBe(anchor.counts / r.optimalCounts);
    expect(p!.ratioCi90).toEqual([anchor.ci90[0] / r.ci90[1], anchor.ci90[1] / r.ci90[0]]);
    // And it is the right number: B0 / PEAK is 1.5, and the window carries the anchor's own error
    // plus the search's. A factor near 1.00 here would mean the anchor never reached the payoff.
    expect(p!.ratio).toBeGreaterThan(1.3);
    expect(p!.ratio).toBeLessThan(1.7);
    // The interval brackets the point estimate and never claims a change it cannot distinguish.
    expect(p!.ratioCi90![0]).toBeLessThanOrEqual(p!.ratio!);
    expect(p!.ratioCi90![1]).toBeGreaterThanOrEqual(p!.ratio!);
    expect(ratioFraming(p!.ratioCi90!)).toBe('directional');
  });

  it('the screen renders that factor and that interval, to the resolution the copy quotes', async () => {
    const outcome = await session();
    const ctx = await lockInThroughTheView(outcome);
    const p = ctx.lastResult!.result.prescription!;
    const host = document.createElement('div');
    document.body.appendChild(host);
    result(host, ctx).mount();

    const tierOne = host.querySelector('[data-tier="one"]') as HTMLElement;
    expect(tierOne.dataset.hero).toBe('ratio');
    // Two decimals is the factor's honest resolution (the anchor floor is about 4 percent), and the
    // screen must print the number it was handed rather than one it re-derived.
    expect(host.querySelector('[data-result="ratio"]')!.textContent).toBe(p.ratio!.toFixed(2));
    expect(host.querySelector('[data-result="ratio-ci"]')!.textContent)
      .toBe(`${p.ratioCi90![0].toFixed(2)} to ${p.ratioCi90![1].toFixed(2)}`);
    // The lead is the instruction, and the located counts are still on the page as tier three.
    expect(host.querySelector('.result__lead')!.textContent).toBe('Multiply your in-game sensitivity by');
    expect(host.querySelector('[data-result="tier-three-counts"]')!.textContent)
      .toBe(Math.round(ctx.lastResult!.result.optimalCounts).toLocaleString('en-US'));
    // No pin this session, so tier two is withheld and tier three keeps browser counts and names
    // the second unmeasured factor rather than converting past it.
    expect((host.querySelector('[data-result="tier-three-counts"]') as HTMLElement).dataset.countsKind)
      .toBe('browser');
    expect(host.querySelector('[data-result="tier-two-withheld"]')).not.toBeNull();
    host.remove();
  });

  it('the spoken summary carries the same factor and the same interval as the visible one', async () => {
    // The screen-reader line is not a paraphrase: a player using it gets the same instruction, with
    // the range spelled " to " so no en-dash glyph is ever voiced.
    const outcome = await session();
    const ctx = await lockInThroughTheView(outcome);
    const p = ctx.lastResult!.result.prescription!;
    const host = document.createElement('div');
    document.body.appendChild(host);
    result(host, ctx).mount();
    const sr = host.querySelector('.result__sr-summary')!.textContent!;
    expect(sr).toContain(`Multiply your in-game sensitivity by ${p.ratio!.toFixed(2)}`);
    expect(sr).toContain(`${p.ratioCi90![0].toFixed(2)} to ${p.ratioCi90![1].toFixed(2)}`);
    expect(sr).not.toContain('–');
    host.remove();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/tier-one.test.ts`
Expected: FAIL. Which assertion fails depends on how much of this part has landed, which is the point
of running it now:

- Before task 38: `AssertionError: Target cannot be null or undefined.` at
  `expect(outcome.reaches.length).toBeGreaterThanOrEqual(40)`, because `SessionOutcome` has no
  `reaches`.
- After task 38 and before task 40: the first two tests PASS and the third fails with
  `AssertionError: expected undefined to be defined` at `expect(p).toBeDefined()`, because nothing
  hands the anchor to `buildResult`.
- After task 40: all five pass.

Run it before task 38 and record the first message; the point of this step is that the file is red
for a reason that moves as the wiring lands, rather than red for a missing import.

- [ ] **Step 3: There is no implementation step**

This task adds no source. Tasks 36, 38, 39 and 40 are its implementation, which is why it is last: a
test written after its own subject is a test that was fitted to it.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/tier-one.test.ts`
Expected: PASS, 5 tests.

If `the two routes recover the belief and their combination brackets it` fails, read the refusal
reason before touching a tolerance. `too-few-reaches` means the reaches were dropped rather than
read, and the fixture's trough is the thing to check. `no-covariance` means the cold-start levels
collapsed. `adapt-rate-at-bound` means the scripted rate reached the grid edge, and it is 0.6.
The window on `flick.counts / B0` is 8 percent against a demonstrated 4.6 percent mean absolute
error, so a failure there is the pipeline, not the tolerance.

If `the session produces enough readable reaches` fails on `peakAtBound`, the search clamped and the
prescription correctly refused; widen `BOUNDS` around `PEAK` rather than removing the assertion,
because a clamped vertex genuinely has no factor to report.

- [ ] **Step 5: Run the whole suite and the build**

Run: `npm test && npm run build`
Expected: PASS on both. `npm run build` runs `tsc --noEmit` first, so this is also the type check over
everything the five tasks touched.

- [ ] **Step 6: Commit**

```bash
git add tests/integration/tier-one.test.ts
git commit -m "test(integration): a known anchor and a known optimum render as one factor

The test that says the change works. A scripted player who believes 9000 counts per 360 and aims
best at 6000 is driven through the real controller, the real reach observer, the real joint fit, the
real reconciliation and the real result screen, and the screen has to print 1.5 with an interval that
is the endpoint quotient of the two measured bands. The two numbers are deliberately far apart: an
unwired seam reports 1.00 or nothing, and both would pass a test whose truth sat near 1. What is
scripted rather than shipped, and why neither can be closed without a browser, is written into the
file."
```

## Hand-offs to other phases

**H1, to phase 1a (`src/types.ts`, `src/engine/arena.ts`), and to the contract.** Task 36 adds
`activeTarget(): TargetHandle | null` to `ArenaScene` and drops
`SessionConfig.currentTarget?: () => TargetHandle | null` from amendment A3 entirely. The getter A3
specifies cannot be written at the site A3 names: `src/ui/session-view.ts` is the only construction
site of a `SessionConfig` and never receives a `TargetHandle`, because target lifetime lives inside
the instruments. Phase 4's hand-off already blessed this alternative. If phase 1a would rather own
the two edits inside its own commit, they are three lines in `arena.ts` and one member on
`ArenaScene`, and this part will drop task 36 and depend on them instead. Either way the member has
to exist before task 38 compiles.

**H2, to phase 3 (`src/input/count-convention.ts`), a correction and not an edit.** Hand-off H3 item 6
says `Prescription` needs `k?: number` because "tier three renders `optimalCounts / k` as hardware
counts". It does not: phase 1b's screen renders `p.hardwareCounts`, which `buildPrescription`
computes once. The field is nonetheless required, for a different reason, and task 39 authors it:
`tierTwoFrom` returns `k`, `buildPrescription` spreads the result, and tsc does not
excess-property-check through a spread (verified against this repo's tsc 5.9.3 with strict mode and
`exactOptionalPropertyTypes` on), so `k` has been landing on every pinned `Prescription` and therefore
in localStorage and the export bundle with no type mentioning it. Nothing in phase 3 changes.
`tierTwoFrom` keeps returning `k` and its key-set test stays as written.

**H3, to phase 1b (`src/ui/result.ts`), the disclosure it may now render.** `SessionOutcome` carries
`leadInDiscarded`, and `src/ui/session-view.ts` accumulates it across segments. Nothing renders it
yet. If the payoff screen wants to say how many of the reaches the anchor read were reaches the
scorer threw away, the number has to ride on the `Result` to survive a reload, which means one more
optional field on `Result` and one line in `finalize`. Raised rather than added: a disclosure with no
copy written for it is a field with no owner, which is the defect task 39 exists to fix.

**H4, to the re-checkers, on what task 41 does not cover.** The four shipped drills never run through
`runSession` in any test in this repo, before or after this part: every existing session-controller
test uses a `synthetic` instrument that does not touch the scene. Task 38 and task 41 add a scripted
player that drives the scene through the drills' own protocol, which is strictly more coverage than
existed, and it is still not the drills. The gap that remains is whether the real `flick`, `track`,
`calibrate` and `strike` present targets in a pattern the observer reads cleanly at the rates a
person actually moves. Phase 4 task 33 pins the observer against that protocol directly and phase 4
task 30 pins both segmenter call sites, so the pieces are covered individually; the composition is
not, and closing it needs pointer lock, WebGL and a hand on a mouse.

**H5, to phase 2 (`src/ui/setup.ts`), a sequencing note only.** Task 40 reads `ctx.draft.turn` and
`ctx.draft.kPin`. Both are written by phase 2's `commitGuided` and cleared by `commitManual` and the
saved-prefs path, which is exactly what task 40's third test depends on: a visit that produced
neither route must reach `finalize` with `turn` undefined, so `reconcile(null, refusal)` returns null
and the screen renders the withheld sentence rather than a factor of 1.00.

