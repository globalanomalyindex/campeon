// The blind reference turn: three reproductions of a full 360 by feel, right then left then
// right. Deliberately shows NO dial, NO degree readout and NO arc that completes. The spin this
// replaces computed its dial from a fixed provisional turn distance (30 cm at 800 DPI, 9450
// counts), filled, turned green and invited the finishing click at exactly the counts matching
// that constant, whoever the player was, with overshoot hidden by Math.min(360, deg) - the
// instrument measured its own constant. The machine below cannot: no state in it knows a target
// count. What the screen may show is which pass is up, which way it goes, and that the
// instrument is reading: a trace scrolled by the clock and drawn from instantaneous speed
// (turn-trace.ts), whose geometry provably cannot encode how far around the player is. Under
// prefers-reduced-motion the drum holds still and only the pen advances, same two axes.
import { turnFromPasses, type TurnEstimate } from '../../anchor/reference-turn';
import { accelVerdict } from '../../input/accel-check';
import type { PointerLockMode } from '../../types';
import { createPointerLock } from '../../input/pointer-lock';
import { conventionFromGated, type Convention } from '../../input/lattice';
import { createSpeedTrace, type TraceMode } from './turn-trace';
import { createTracePainter } from './trace-canvas';

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
      // 3 to 6 times the 8.56 cm card that forces the tolerance to widen, so edge slop is a
      // proportionally small fraction of the pass. `accelTolForWidth` exists and is called by the
      // card sweep, which needs it; passing it here would loosen a check that has no reason to be
      // loose, and hide a real acceleration verdict behind the card's slop budget.
      return accelVerdict(m.estimate.counts, pathCounts).accelerated
        ? { ...m, phase: 'blocked', blockReason: 'accel' }
        : { ...m, phase: 'done' };
    }
    case 'done':
    case 'blocked':
      return m; // terminal states absorb input: nothing after the verdict may move the number
  }
}

export interface TurnView { dispose(): void; }

const TAP_MS = 220;       // press shorter than this (with little movement) = a tap
const TAP_MOVE_MAX = 40;  // counts of movement during a press still considered "still" (a tap)
const TOO_SOON_MS = 1800; // how long the too-soon explanation holds the lead before reverting

const LEAD_START = 'This step measures the full turn you show me, three times over. Click the box to begin.';

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
        <div class="calibrate__stage" data-surface="chamber">
          <canvas class="calibrate__trace" data-turn="trace" hidden></canvas>
          <div class="cal-dir" data-turn="dir">
            <span class="cal-dir__chevs" aria-hidden="true"><i></i><i></i><i></i></span>
            <span data-turn="dirlabel">to the right</span>
          </div>
          <div class="calibrate__hint" data-turn="hint"><span class="cal-pulse"><span class="cal-pulse__dot"></span></span></div>
          <p class="calibrate__rec" data-turn="rec" hidden>Recording</p>
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

  // The live trace. Sweep mode under reduced motion: the ink holds still and only the pen
  // advances, so liveness survives without a scrolling field. Its geometry is pure and lives in
  // turn-trace.ts; the invariant that it cannot encode accumulated path is pinned there, in
  // tests/ui/turn-trace.test.ts "identical clocks and speeds draw identical traces".
  const traceMode: TraceMode =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'sweep' : 'scroll';
  const trace = createSpeedTrace();
  const traceCanvas = $('trace') as HTMLCanvasElement;
  // One painter, shared with the card sweep (trace-canvas.ts), so the two instruments cannot drift
  // into drawing the same claim two different ways.
  const painter = createTracePainter(traceCanvas, stage);
  let traceRaf: number | null = null;

  function traceFrame(): void {
    traceRaf = null;
    if (!(pointer.isLocked() && recordingNow())) return;
    painter.paint(trace.geometry(performance.now(), traceMode));
    traceRaf = requestAnimationFrame(traceFrame);
  }

  function syncTrace(): void {
    const live = pointer.isLocked() && recordingNow();
    traceCanvas.hidden = !live;
    if (live && traceRaf === null && typeof requestAnimationFrame === 'function') {
      if (!painter.ready()) return; // jsdom has no 2D context, and mounting must not depend on one
      traceRaf = requestAnimationFrame(traceFrame);
    }
    if (!live && traceRaf !== null) { cancelAnimationFrame(traceRaf); traceRaf = null; }
  }

  const off = pointer.onSample((s) => {
    if (!pointer.isLocked()) return;
    if (latticeTap.length < LATTICE_TAP_CAP) latticeTap.push(s.dx, s.dy);
    if (paused) { pressMoved += Math.abs(s.dx); return; } // press movement classifies tap vs hold; never counts
    // Path length, not the signed sum: unheld wobble cancels in a signed sum and under-counts the
    // turn, which biased the old spin's seed fast (same fix SpinSeedAccumulator carried).
    // The trace is fed the same quantity, so it draws counted motion and nothing else.
    if (recordingNow()) { path += Math.abs(s.dx); trace.add(s.t, Math.abs(s.dx)); }
  });

  function flashTooSoon(): void {
    if (tooSoonTimer !== null) clearTimeout(tooSoonTimer);
    $('lead').textContent = 'That click came too soon to be a full turn, so it did not count. Keep turning until your hand says the circle is closed, then click.';
    tooSoonTimer = window.setTimeout(() => { tooSoonTimer = null; updateUi(); }, TOO_SOON_MS);
  }

  function advance(tapCounts: number): void {
    const next = turnTap(m, tapCounts, pointer.mode() ?? 'os-adjusted');
    if (next === m) { flashTooSoon(); return; } // the machine refused the tap: explain the no-op
    const wasRecording = recordingNow();
    m = next;
    if (recordingNow() && !wasRecording) {
      path = 0; // a fresh pass counts from zero
      trace.reset(performance.now()); // and draws on a blank drum: no replayed motion
    }
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
    syncTrace();
    const fastPhase = m.phase === 'fast-idle' || m.phase === 'fast-recording';
    const dir = turnDirection(m.passes.length);
    // The direction cue is static on purpose: a cue that moved would pace the turn. It hides
    // for the fast pass, whose direction is the player's to choose.
    const leftward = dir === 'left'; // hoisted: a 'left' literal inside toggle() reads as a class to tests/styles.test.ts
    $('dir').style.display = fastPhase ? 'none' : 'flex';
    $('dirlabel').textContent = `to the ${dir}`;
    $('dir').classList.toggle('cal-dir--left', leftward);
    if (fastPhase) {
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
    switch (m.phase) {
      case 'idle':
        $('lead').textContent = m.passes.length === 0
          ? `Click once to start pass 1, then show me a full circle to the ${dir}, at whatever travel feels right for your hand.`
          : `Pass ${m.passes.length} is in. Click once to start pass ${m.passes.length + 1}, turning to the ${dir} this time.`;
        $('sub').textContent = m.passes.length === 0
          ? 'A comfortable full circle is the answer I need, and if you already play, the turn you make in your game is that answer. Click again to finish the pass.'
          : 'Alternating direction cancels a one-way drift instead of averaging it in.';
        break;
      case 'recording':
        $('lead').textContent = `Turning to the ${dir}. Give it the travel a full circle takes for you, then click to finish the pass.`;
        $('sub').textContent = 'The line draws your speed against the clock. It carries no measure of how far around you are.';
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
    if (traceRaf !== null) cancelAnimationFrame(traceRaf);
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
