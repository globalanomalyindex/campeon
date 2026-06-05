# Card-Anchored Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the typed "mousepad width in cm" calibration step with a sweep across a standardized wallet card, so the DPI anchor needs no measuring and no number knowledge.

**Architecture:** The sweep math (`dpiFromSweep(counts, widthCm)`) is unchanged - we only swap the source of the width from a user-typed field to a hard-coded constant (`CARD_WIDTH_CM = 8.56`, ISO/IEC 7810 ID-1). The guided step machine drops its `padWidthCm` field; the intro screen drops its number input; the sweep view references "the card" and grows a light cardiogram-style trail for system-status feedback.

**Tech Stack:** TypeScript (strict, exactOptionalPropertyTypes), Vite, Vitest, canvas 2D, Pointer Lock API.

**Reference:** Spec at `docs/superpowers/specs/2026-06-05-card-calibration-design.md`.

**Conventions:** No em dashes anywhere in the repo or commit messages (use hyphens). Commit messages end with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

---

### Task 1: Card-width constant + DPI round-trip

**Files:**
- Modify: `src/input/dpi-sweep.ts`
- Test: `tests/input/dpi-sweep.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test inside the existing `describe('dpi-sweep', ...)` block in `tests/input/dpi-sweep.test.ts`, and add `CARD_WIDTH_CM` to the import on line 2:

```ts
import { dpiFromSweep, SweepAccumulator, isPlausibleSweepDpi, CARD_WIDTH_CM } from '../../src/input/dpi-sweep';
```

```ts
  it('uses the standardized ID-1 card width as the reference anchor', () => {
    expect(CARD_WIDTH_CM).toBeCloseTo(8.56, 6); // ISO/IEC 7810 ID-1 long edge, 85.60 mm
  });

  it('recovers DPI from counts swept across a card', () => {
    // a card (8.56 cm) at 1600 dpi -> 8.56/2.54 in * 1600 = 5391.5 counts
    const dpi = 1600;
    const counts = (CARD_WIDTH_CM / 2.54) * dpi;
    expect(dpiFromSweep(counts, CARD_WIDTH_CM)).toBeCloseTo(dpi, 6);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/input/dpi-sweep.test.ts`
Expected: FAIL - `CARD_WIDTH_CM` is `undefined` (not exported).

- [ ] **Step 3: Implement the constant**

In `src/input/dpi-sweep.ts`, add the constant after the imports (above `dpiFromSweep`) and rename the second parameter of `dpiFromSweep` from `padWidthCm` to `referenceWidthCm` for honesty (callers are positional, so this is non-breaking):

```ts
/** Standard wallet-card width: ISO/IEC 7810 ID-1 long edge (85.60 mm). Used as the sweep anchor. */
export const CARD_WIDTH_CM = 8.56;

/** Effective DPI from `horizontalCounts` (DPR-normalized) swept across `referenceWidthCm`. NaN if width <= 0. */
export function dpiFromSweep(horizontalCounts: number, referenceWidthCm: number): Dpi {
  if (!(referenceWidthCm > 0)) return NaN;
  return horizontalCounts / (referenceWidthCm / 2.54); // counts per inch
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/input/dpi-sweep.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/input/dpi-sweep.ts tests/input/dpi-sweep.test.ts
git commit -m "feat(input): add CARD_WIDTH_CM anchor for the sweep

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Swap the anchor - drop typed pad width across the guided flow

This is the coordinated change. The reducer drops `padWidthCm`, the intro screen drops its number input and names the card, and the sweep view takes a `referenceWidthCm` option. All three files plus their tests change together so the build and tests stay green.

**Files:**
- Modify: `src/ui/calibrate-flow.ts` (full new contents below)
- Modify: `src/ui/setup.ts` (targeted edits below)
- Modify: `src/ui/calibrate/sweep-view.ts` (full new contents below)
- Test: `tests/ui/calibrate-flow.test.ts`, `tests/ui/setup.test.ts`

- [ ] **Step 1: Update the reducer tests (write the failing tests)**

Replace the first two tests in `tests/ui/calibrate-flow.test.ts` (the `start-guided` test and the "clean sweep" test) so they no longer reference `padWidthCm`:

```ts
  it('guided start moves to the sweep', () => {
    const s = calibrateReducer(s0, { type: 'start-guided' });
    expect(s.step).toBe('sweep');
  });

  it('a clean sweep stores DPI and advances to the turn', () => {
    const s = calibrateReducer({ ...s0, step: 'sweep' },
      { type: 'sweep-done', dpi: 1600, accelerated: false });
    expect(s.step).toBe('turn');
    expect(s.dpi).toBe(1600);
  });
```

(The other reducer tests - accelerated blocks, retry returns to sweep, retry clears dpi, turn stores seed, manual reachable - are unchanged.)

- [ ] **Step 2: Update the setup test (write the failing assertion)**

In `tests/ui/setup.test.ts`, extend the first test to assert the intro has no pad-width field:

```ts
  it('offers a guided start and a typed fast path on the intro step', () => {
    const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx).mount();
    expect(host.querySelector('[data-action="start-guided"]')).toBeTruthy();
    expect(host.querySelector('[data-action="start-manual"]')).toBeTruthy();
    expect(host.querySelector('[data-field="pad"]')).toBeNull(); // no typed mousepad width
  });
```

(The manual fast-path test is unchanged.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/ui/calibrate-flow.test.ts tests/ui/setup.test.ts`
Expected: FAIL - `start-guided` still requires `padWidthCm` (type error / runtime), and `[data-field="pad"]` still exists.

- [ ] **Step 4: Rewrite the reducer**

Replace the entire contents of `src/ui/calibrate-flow.ts` with:

```ts
// Pure step machine for the guided calibration (mirrors the gateReducer pattern: pure
// transitions, thin DOM in the screen). The screen performs navigation + draft writes.
export type CalStep = 'intro' | 'sweep' | 'turn' | 'game' | 'manual' | 'blocked';

export interface CalState {
  step: CalStep;
  dpi: number | null;
  seedCm360: number | null;
}

export type CalAction =
  | { type: 'start-guided' }
  | { type: 'start-manual' }
  | { type: 'sweep-done'; dpi: number; accelerated: boolean }
  | { type: 'turn-done'; seedCm360: number }
  | { type: 'retry' }
  | { type: 'back-to-intro' };

export function initialCalState(): CalState {
  return { step: 'intro', dpi: null, seedCm360: null };
}

export function calibrateReducer(state: CalState, action: CalAction): CalState {
  switch (action.type) {
    case 'start-guided':
      return { ...state, step: 'sweep' };
    case 'start-manual':
      return { ...state, step: 'manual' };
    case 'sweep-done':
      return { ...state, dpi: action.dpi, step: action.accelerated ? 'blocked' : 'turn' };
    case 'turn-done':
      return { ...state, seedCm360: action.seedCm360, step: 'game' };
    case 'retry':
      return { ...state, step: 'sweep', dpi: null };
    case 'back-to-intro':
      return { ...state, step: 'intro' };
  }
}
```

- [ ] **Step 5: Rewrite the sweep view (card copy + `referenceWidthCm`)**

Replace the entire contents of `src/ui/calibrate/sweep-view.ts` with:

```ts
// src/ui/calibrate/sweep-view.ts
// Thin shell: the locked card sweep. Slow pass measures DPI across a standardized wallet card
// (known width); fast pass cross-checks for acceleration. Marking uses onFire (a locked
// primary-button press), so no cursor is needed.
import { createPointerLock } from '../../input/pointer-lock';
import { accelVerdict } from '../../input/accel-check';
import { SweepAccumulator, dpiFromSweep, isPlausibleSweepDpi } from '../../input/dpi-sweep';

export interface SweepResult { dpi: number; accelerated: boolean; }
export interface SweepView { dispose(): void; }

type Phase = 'idle-slow' | 'running-slow' | 'idle-fast' | 'running-fast';

export function createSweepView(
  host: HTMLElement,
  opts: { referenceWidthCm: number; onResult: (r: SweepResult) => void; onInvalid: () => void; onLockFailed: () => void },
): SweepView {
  host.innerHTML = `
    <section class="screen screen--arena fade-in">
      <div class="wrap stack">
        <h2 class="display">+ the sweep</h2>
        <p class="gate__lead" data-sweep="lead">lay any card from your wallet flat. click to lock, then rest your mouse at the card's <b>left end</b>.</p>
        <div class="calibrate__stage">
          <canvas class="calibrate__canvas" data-sweep="canvas"></canvas>
          <div class="calibrate__hint" data-sweep="hint"><span>click to lock the pointer</span></div>
        </div>
        <div class="calibrate__readouts">
          <div class="calibrate__ro"><div class="k">pass</div><div class="v mono" data-sweep="pass">slow</div></div>
          <div class="calibrate__ro"><div class="k">counts</div><div class="v mono" data-sweep="counts">0</div></div>
          <div class="calibrate__ro"><div class="k">measured dpi</div><div class="v mono" data-sweep="dpi">-</div></div>
        </div>
        <p class="mono" data-sweep="status"></p>
      </div>
    </section>`;

  const $ = (s: string) => host.querySelector(`[data-sweep="${s}"]`) as HTMLElement;
  const canvas = $('canvas') as HTMLCanvasElement;
  const pointer = createPointerLock(canvas);

  let phase: Phase = 'idle-slow';
  let slowCounts = 0;
  const acc = new SweepAccumulator();

  const off = pointer.onSample((s) => { if (phase === 'running-slow' || phase === 'running-fast') {
    acc.add(s); $('counts').textContent = Math.round(acc.total()).toString();
  } });

  const offFire = pointer.onFire(() => {
    if (!pointer.isLocked()) return;
    if (phase === 'idle-slow') { acc.reset(); phase = 'running-slow'; setLead("slide SLOWLY across to the card's right end, then click"); }
    else if (phase === 'running-slow') { slowCounts = acc.total(); phase = 'idle-fast'; $('pass').textContent = 'fast';
      setLead("back to the card's left end, click, then slide FAST across"); }
    else if (phase === 'idle-fast') { acc.reset(); phase = 'running-fast'; setLead("slide FAST across to the card's right end, then click"); }
    else if (phase === 'running-fast') { finish(acc.total()); }
  });

  function setLead(t: string): void { $('lead').textContent = t; }

  function finish(fastCounts: number): void {
    const dpi = dpiFromSweep(slowCounts, opts.referenceWidthCm);
    $('dpi').textContent = isPlausibleSweepDpi(dpi) ? Math.round(dpi).toString() : 'invalid';
    if (!isPlausibleSweepDpi(dpi)) { pointer.exit(); opts.onInvalid(); return; }
    const { accelerated } = accelVerdict(slowCounts, fastCounts);
    pointer.exit();
    opts.onResult({ dpi: Math.round(dpi), accelerated });
  }

  const onLock = (): void => { $('hint').style.display = pointer.isLocked() ? 'none' : 'flex'; };
  const onCanvasClick = (): void => { if (!pointer.isLocked()) void pointer.request().catch(() => opts.onLockFailed()); };
  document.addEventListener('pointerlockchange', onLock);
  canvas.addEventListener('click', onCanvasClick);

  return { dispose() { off(); offFire(); document.removeEventListener('pointerlockchange', onLock); canvas.removeEventListener('click', onCanvasClick); pointer.dispose(); } };
}
```

- [ ] **Step 6: Update `setup.ts` - intro copy (remove the pad input)**

In `src/ui/setup.ts`, replace the `intro` branch of `stepHtml()` (the block that starts `if (state.step === 'intro') return`) with:

```ts
    if (state.step === 'intro') return `
      <div class="wrap stack setup__inner">
        <h2 class="display setup__title">+ calibrate</h2>
        <p class="setup__lead">we'll measure your turn by feel, not by numbers. grab any card from your wallet - bank card, gym card, hotel key. they're all the same size.</p>
        ${reduced ? `<p class="setup__lead mono">reduced-motion is on - you can skip the rendered turn with "i already know my numbers" below.</p>` : ''}
        <button class="action action--primary" data-action="start-guided">start</button>
        <button class="action action--ghost" data-action="start-manual">i already know my numbers</button>
      </div>`;
```

- [ ] **Step 7: Update `setup.ts` - blocked copy + sweep mount + dispatch**

In `src/ui/setup.ts`:

(a) Add the `CARD_WIDTH_CM` import. Change the dpi-sweep-free import line for settings to also pull the constant - add this import near the other imports at the top:

```ts
import { CARD_WIDTH_CM } from '../input/dpi-sweep';
```

(b) In `render()`, change the sweep-view mount to pass `referenceWidthCm`:

```ts
    if (state.step === 'sweep') {
      view = createSweepView(host, { referenceWidthCm: CARD_WIDTH_CM,
        onResult: (r) => dispatch({ type: 'sweep-done', dpi: r.dpi, accelerated: r.accelerated }),
        onInvalid: () => dispatch({ type: 'sweep-done', dpi: NaN, accelerated: true }),
        onLockFailed: () => dispatch({ type: 'start-manual' }) });
      return;
    }
```

(c) In the `blocked` branch of `stepHtml()`, change the first sentence so it no longer says "pad width":

```ts
    if (state.step === 'blocked') return `
      <div class="wrap stack gate__inner">
        <p class="gate__lead">mouse acceleration looks like it's on (or the card sweep was uneven) - cm/360 is undefined under acceleration.</p>
        <p>turn off OS/driver acceleration ("enhance pointer precision"), then retry.</p>
        <button class="action action--primary" data-action="retry">retry</button>
        <button class="action action--ghost" data-action="manual">type my numbers instead</button>
      </div>`;
```

(d) In `wire()`, change the `start-guided` dispatch to be payload-free:

```ts
    click('start-guided', () => dispatch({ type: 'start-guided' }));
```

- [ ] **Step 8: Verify no `padWidthCm` references remain**

Run: `grep -rn "padWidthCm" src/ tests/`
Expected: no output (zero matches).

- [ ] **Step 9: Typecheck + run the affected tests**

Run: `npx tsc --noEmit && npx vitest run tests/ui/calibrate-flow.test.ts tests/ui/setup.test.ts tests/input/dpi-sweep.test.ts`
Expected: tsc clean; tests PASS.

- [ ] **Step 10: Commit**

```bash
git add src/ui/calibrate-flow.ts src/ui/setup.ts src/ui/calibrate/sweep-view.ts tests/ui/calibrate-flow.test.ts tests/ui/setup.test.ts
git commit -m "feat(ui): sweep across a wallet card instead of typing pad width

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Cardiogram trail on the sweep canvas

Additive to `sweep-view.ts`. Purely a thin-shell canvas concern (runtime-verified, no unit test): during a running pass the trace advances rightward with horizontal movement and deflects slightly with vertical wobble, giving a novice visible proof the slide is registering. It clears between passes.

**Files:**
- Modify: `src/ui/calibrate/sweep-view.ts`

- [ ] **Step 1: Add the trail state + drawing helpers**

In `src/ui/calibrate/sweep-view.ts`, immediately after the line `const pointer = createPointerLock(canvas);`, insert:

```ts
  const ctx2d = canvas.getContext('2d');
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const COUNTS_PER_PX = 4.5; // visual scale only; true DPI is unknown mid-sweep
  const WOBBLE_GAIN = 0.5;   // px of vertical deflection per count of dy
  let W = 0, H = 0;
  let trail: Array<{ x: number; y: number }> = [];

  function sizeCanvas(): void {
    const r = canvas.getBoundingClientRect(); W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx2d?.setTransform(dpr, 0, 0, dpr, 0, 0); drawTrail();
  }
  function clearTrail(): void { trail = []; drawTrail(); }
  function pushTrail(dy: number): void {
    const mid = H / 2;
    const x = Math.min(W - 2, acc.total() / COUNTS_PER_PX);
    const prevY = trail.length ? trail[trail.length - 1]!.y : mid;
    const y = Math.max(2, Math.min(H - 2, prevY + dy * WOBBLE_GAIN));
    trail.push({ x, y });
    if (trail.length > 2000) trail.shift();
    drawTrail();
  }
  function drawTrail(): void {
    if (!ctx2d) return;
    const mid = H / 2;
    ctx2d.clearRect(0, 0, W, H);
    ctx2d.strokeStyle = 'rgba(234,231,220,0.12)'; ctx2d.lineWidth = 1;
    ctx2d.beginPath(); ctx2d.moveTo(0, mid); ctx2d.lineTo(W, mid); ctx2d.stroke();
    if (trail.length >= 2) {
      const first = trail[0]!;
      ctx2d.strokeStyle = '#FFC400'; ctx2d.lineWidth = 2;
      ctx2d.beginPath(); ctx2d.moveTo(first.x, first.y);
      for (let i = 1; i < trail.length; i++) { const p = trail[i]!; ctx2d.lineTo(p.x, p.y); }
      ctx2d.stroke();
      const head = trail[trail.length - 1]!;
      ctx2d.fillStyle = '#FFC400'; ctx2d.beginPath(); ctx2d.arc(head.x, head.y, 3, 0, Math.PI * 2); ctx2d.fill();
    }
  }
```

- [ ] **Step 2: Feed the trail from samples and clear it per pass**

(a) In the `pointer.onSample(...)` handler, add `pushTrail(s.dy);` inside the running branch:

```ts
  const off = pointer.onSample((s) => { if (phase === 'running-slow' || phase === 'running-fast') {
    acc.add(s); $('counts').textContent = Math.round(acc.total()).toString(); pushTrail(s.dy);
  } });
```

(b) In the `pointer.onFire(...)` handler, call `clearTrail()` right after each `acc.reset()` so each pass starts fresh:

```ts
  const offFire = pointer.onFire(() => {
    if (!pointer.isLocked()) return;
    if (phase === 'idle-slow') { acc.reset(); clearTrail(); phase = 'running-slow'; setLead("slide SLOWLY across to the card's right end, then click"); }
    else if (phase === 'running-slow') { slowCounts = acc.total(); phase = 'idle-fast'; $('pass').textContent = 'fast';
      setLead("back to the card's left end, click, then slide FAST across"); }
    else if (phase === 'idle-fast') { acc.reset(); clearTrail(); phase = 'running-fast'; setLead("slide FAST across to the card's right end, then click"); }
    else if (phase === 'running-fast') { finish(acc.total()); }
  });
```

- [ ] **Step 3: Size the canvas on mount + resize, and clean up**

(a) Add a resize listener and an initial size, right after the existing `canvas.addEventListener('click', onCanvasClick);` line:

```ts
  window.addEventListener('resize', sizeCanvas);
  sizeCanvas();
```

(b) In the returned `dispose()`, remove the resize listener - add `window.removeEventListener('resize', sizeCanvas);` to the cleanup chain:

```ts
  return { dispose() { off(); offFire(); document.removeEventListener('pointerlockchange', onLock); window.removeEventListener('resize', sizeCanvas); canvas.removeEventListener('click', onCanvasClick); pointer.dispose(); } };
```

- [ ] **Step 4: Typecheck + full test suite (no regressions)**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all tests PASS (no test covers the trail directly; it must not break existing tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/calibrate/sweep-view.ts
git commit -m "feat(ui): cardiogram trail on the sweep canvas for live feedback

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Plain-language copy polish (turn + game steps)

Light, low-risk string changes so the remaining steps read plainly for a novice. No logic changes.

**Files:**
- Modify: `src/ui/calibrate/turn-view.ts`
- Modify: `src/ui/setup.ts`

- [ ] **Step 1: Clarify the turn instruction**

In `src/ui/calibrate/turn-view.ts`, replace the lead paragraph (the `<p class="gate__lead">...</p>` on the line beginning `click to lock, then turn until`) with:

```html
        <p class="gate__lead">click to lock, then swipe to spin. stop when <b>home</b> is back in front of you. tap up / down until one full spin feels comfortable in a single swipe; <span class="mono">enter</span> accepts, <span class="mono">esc</span> releases.</p>
```

- [ ] **Step 2: Clarify the game-step copy**

In `src/ui/setup.ts`, in the `// step === 'game'` branch of `stepHtml()`, replace the lead paragraph with:

```ts
        <p class="setup__lead">your comfortable spin is <span class="mono">${(state.seedCm360 ?? 0).toFixed(1)}</span> cm per full turn. pick your game so we can give you the number to enter.</p>
```

- [ ] **Step 3: Typecheck + full test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/ui/calibrate/turn-view.ts src/ui/setup.ts
git commit -m "polish(ui): plainer copy for the turn and game steps

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Final verification (build + runtime)

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: all tests PASS (the dpi-sweep suite is now 6; calibrate-flow and setup suites unchanged in count).

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: build succeeds, no TypeScript errors, CSS compiles.

- [ ] **Step 3: Confirm the anchor is fully removed**

Run: `grep -rn "mousepad width" src/ ; grep -rn "padWidthCm" src/ tests/`
Expected: no output for either.

- [ ] **Step 4: Runtime note**

The sweep + turn use Pointer Lock, which cannot be automated headlessly. After merge + deploy, the live flow should be confirmed by hand: intro names the card (no number field), the sweep trail grows during a pass and resets between passes, the measured DPI reads plausibly, and the turn auto-marks at 360. This is the only step that needs human verification.

---

## Self-Review

**Spec coverage:**
- Card constant `CARD_WIDTH_CM = 8.56` -> Task 1.
- `dpiFromSweep` stays generic, source-of-width swapped -> Task 1 (rename) + Task 2 (passes constant).
- Reducer drops `padWidthCm`, `start-guided` payload-free, `initialCalState` shape -> Task 2 Step 4.
- Intro loses the number input + names the card -> Task 2 Step 6.
- Sweep view `referenceWidthCm` + card copy -> Task 2 Step 5; mount -> Task 2 Step 7b.
- Blocked copy no longer says pad width -> Task 2 Step 7c.
- Cardiogram trail (feedback, clears between passes, bounded buffer) -> Task 3.
- Turn + game copy polish -> Task 4.
- Manual fast path, optimizer, drills, accel check unchanged -> not touched by any task (verified by Task 5 Step 3 grep + full suite).

**Placeholder scan:** none - every code step has complete code.

**Type consistency:** `CalState` (no `padWidthCm`), `CalAction` `start-guided` payload-free, `initialCalState()` `{ step, dpi, seedCm360 }`, and the test edits all match. The sweep-view option is `referenceWidthCm` in both the type (Task 2 Step 5) and the mount (Task 2 Step 7b). `CARD_WIDTH_CM` is exported in Task 1 and imported in Task 2 Step 7a.
