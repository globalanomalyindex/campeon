// The card sweep: two slow passes across the long edge of a wallet card, plus a quick third pass on
// browsers that cannot hand over raw input. It is the one step in the calibration measured against a
// physical standard (ISO/IEC 7810 ID-1, 85.60 mm), which is the whole reason it exists: the turn is
// self-consistent in counts and has nothing outside the browser to be checked against, and the card
// supplies exactly that check (src/anchor/plausibility.ts).
//
// It draws the same clock-and-speed trace the turn draws, and for the same reason rather than for
// symmetry. The obvious drawing here would be a bar filling as counts accumulate, and it would be
// the retired dial again in miniature: the edge of the bar becomes a finish line, and the hand
// starts stopping at the drawing instead of at the card. What the player must stop at is the card's
// right edge, so nothing on this screen may grow with the pass.
//
// The pace meter is the one live judgement offered, and it is about SPEED, never distance: a slow
// pass that is not slow and a quick pass that is not quick make the acceleration cross-check
// meaningless. It cannot say where to stop.
//
// The pure pass machine below is unit-tested; the DOM shell around it is runtime-verified.
import { createPointerLock } from '../../input/pointer-lock';
import { accelVerdict, accelTolForWidth } from '../../input/accel-check';
import { SweepAccumulator, dpiFromPasses, isPlausibleSweepDpi } from '../../input/dpi-sweep';
import { createSpeedTrace, type TraceMode } from './turn-trace';
import { createTracePainter } from './trace-canvas';
import type { Dpi, PointerLockMode } from '../../types';

/** Why the sweep refused: 'accel' = the quick pass accumulated materially more than the slow ones;
 *  'invalid' = the reading was implausible, or the slow passes were too far apart to average. */
export type SweepBlockReason = 'accel' | 'invalid';

export interface SweepResult {
  /** The MEASURED counts per inch: the hardware DPI times the browser's unpinned count convention.
   *  Never presented as the number printed on the mouse (src/input/dpi-sweep.ts holds the algebra). */
  dpi: Dpi;
  /** True when the quick cross-check pass says OS acceleration is on. Always false on raw input,
   *  where no such pass runs, because raw input bypasses OS acceleration at the source. */
  accelerated: boolean;
}

export type SweepPhase =
  | 'idle-slow' | 'slow' | 'idle-fast' | 'fast' | 'done' | 'blocked';

export interface SweepMachine {
  phase: SweepPhase;
  /** Committed slow-pass magnitudes (net counts). The live pass accumulates outside and only lands
   *  here on its finishing tap. */
  passes: readonly number[];
  result: SweepResult | null;
  blockReason: SweepBlockReason | null;
  /** The relative spread of the committed slow passes, as a percentage: a CONSISTENCY indicator for
   *  the copy to name, never a confidence interval on the DPI. Null until they are combined. */
  spreadPct: number | null;
}

/** Slow passes combined (median + outlier reject) into the committed reading. Two, because the card
 *  is over in a second and a single pass has no way to disagree with anything. */
export const SLOW_PASSES = 2;

/** Floor below which a finishing tap is an accidental double-click rather than a pass. A card at
 *  any plausible DPI is thousands of counts wide (8.56 cm at the 100 DPI floor is 337), so this
 *  rejects a stray click without being able to steer where an honest pass ends. */
export const MIN_PASS_COUNTS = 150;

export function initialSweepMachine(): SweepMachine {
  return { phase: 'idle-slow', passes: [], result: null, blockReason: null, spreadPct: null };
}

/**
 * Advance on a click. `passCounts` is the net horizontal magnitude accumulated since the current
 * pass started, read only on a finishing tap. An ignored tap returns the SAME object, so the shell
 * can detect the refusal by identity and explain the no-op instead of going quiet.
 */
export function sweepTap(
  m: SweepMachine,
  passCounts: number,
  mode: PointerLockMode,
  refWidthCm: number,
): SweepMachine {
  switch (m.phase) {
    case 'idle-slow':
      return { ...m, phase: 'slow' };
    case 'idle-fast':
      return { ...m, phase: 'fast' };
    case 'slow': {
      if (passCounts < MIN_PASS_COUNTS) return m;
      const passes = [...m.passes, passCounts];
      if (passes.length < SLOW_PASSES) return { ...m, passes, phase: 'idle-slow' };
      const combined = dpiFromPasses([...passes], refWidthCm);
      // Two refusals, one screen: a reading outside the plausible DPI band (a sweep that covered
      // part of the card, a card that was not a card) and passes that disagree past the threshold.
      // Both mean "sweep it again", never "your hardware is wrong", so neither is fabricated into
      // a committed number.
      if (!isPlausibleSweepDpi(combined.dpi) || !combined.agreed) {
        return { ...m, passes, spreadPct: combined.spreadPct, phase: 'blocked', blockReason: 'invalid' };
      }
      // Raw pointer input bypasses OS acceleration at the source, so a quick pass would have
      // nothing to detect and asking for one would be theater (the same call the turn makes).
      return mode === 'raw'
        ? { ...m, passes, spreadPct: combined.spreadPct, phase: 'done', result: { dpi: combined.dpi, accelerated: false } }
        : { ...m, passes, spreadPct: combined.spreadPct, phase: 'idle-fast' };
    }
    case 'fast': {
      if (passCounts < MIN_PASS_COUNTS) return m;
      const combined = dpiFromPasses([...m.passes], refWidthCm);
      // Compare the quick pass against the magnitude the COMMITTED reading implies, not against one
      // stale slow pass: the reading is a combination of both slow passes, and cross-checking
      // against a single one would judge acceleration by a pass the number does not rest on.
      const slowCounts = (combined.dpi * refWidthCm) / 2.54;
      // The tolerance widens for the card, and only for the card: 8.56 cm is short enough that
      // ordinary edge-alignment slop is a large fraction of the sweep, and a fixed 10 percent
      // false-flags honest runs (tests/input/accel-check.test.ts "loosens the tolerance for a
      // short card"). The turn, three to six times longer, keeps the tight default.
      return accelVerdict(slowCounts, passCounts, accelTolForWidth(refWidthCm)).accelerated
        ? { ...m, phase: 'blocked', blockReason: 'accel' }
        : { ...m, phase: 'done', result: { dpi: combined.dpi, accelerated: false } };
    }
    case 'done':
    case 'blocked':
      return m; // terminal states absorb input: nothing after the verdict may move the number
  }
}

export interface SweepView { dispose(): void; }

// The wallet line, back close to verbatim from the first card era: it is the sentence that makes
// the instrument feel free, and it is true (ISO/IEC 7810 ID-1 covers all three). Exported so the
// sentence can be pinned without a pointer lock (the same reason setup exports cardCheckHtml).
export const LEAD_START = 'Grab any card from your wallet: bank card, gym card, hotel key. They are all exactly the same size. Lay it flat next to your mouse, then click the box to begin.';
// Esc unlocks and drops the live pass, so the honest promise is "stop and start the pass over", not
// "stop". Held in one place because it is re-set on every unlock, mid-pass ones included.
const SUB_START = 'Locking the pointer hides the cursor so the raw motion can be read. Press Esc to stop, and the pass starts over when you click back in.';
const PACE_SCALE = 6;   // counts per ms that fills the pace bar
const SLOW_MAX = 2.2;   // counts per ms at or below = a good slow pace
const FAST_MIN = 3.5;   // counts per ms at or above = a good quick pace

export function createSweepView(
  host: HTMLElement,
  opts: {
    /** The reference width the reading is computed against, in cm. Injected rather than read from
     *  the module so the caller names the standard it is holding the player to. */
    referenceWidthCm: number;
    reducedMotion: boolean;
    onResult: (r: SweepResult) => void;
    onBlocked: (reason: SweepBlockReason, spreadPct: number | null) => void;
    /** The typed fallback, chosen deliberately. */
    onManual: () => void;
    /** Leave the guided flow entirely. Every step owes the visitor a way out. */
    onBack: () => void;
  },
): SweepView {
  host.innerHTML = `
    <section class="screen screen--shell fade-in">
      <div class="wrap stack">
        <span class="cal-step" data-sweep="pass">Slow pass 1</span>
        <h1 class="display">The card</h1>
        <p class="gate__lead" data-sweep="lead" aria-live="polite" aria-atomic="true">${LEAD_START}</p>
        <p class="cal-sub" data-sweep="sub">${SUB_START}</p>
        <div class="calibrate__stage" data-surface="chamber">
          <canvas class="calibrate__trace" data-sweep="trace" hidden></canvas>
          <div class="cal-dir" data-sweep="dir">
            <span class="cal-dir__chevs" aria-hidden="true"><i></i><i></i><i></i></span>
            <span>left edge to right edge</span>
          </div>
          <div class="calibrate__hint" data-sweep="hint"><span class="cal-pulse"><span class="cal-pulse__dot"></span></span></div>
          <p class="calibrate__rec" data-sweep="rec" hidden>Recording</p>
        </div>
        <div class="cal-pace" data-sweep="pacewrap" hidden><div class="cal-pace__fill" data-sweep="pace"></div></div>
        <p class="cal-pace__label" data-sweep="pacelabel" aria-hidden="true"></p>
        <p class="cal-method mono" data-sweep="why">A card is 85.60 mm across by international standard, so it is the one ruler already in your pocket. What this reads is counts per inch through your browser, which is your mouse's setting times whatever the browser scales by. That scaling cancels against the turn, so the reading does not have to match the number on your mouse.</p>
        <div class="cal-exit">
          <button type="button" class="action action--ghost" data-sweep="back">Back</button>
          <button type="button" class="action action--ghost" data-sweep="manual">Type the numbers instead</button>
        </div>
      </div>
    </section>`;

  const $ = (s: string): HTMLElement => host.querySelector(`[data-sweep="${s}"]`) as HTMLElement;
  const stage = host.querySelector('.calibrate__stage') as HTMLElement;
  const pointer = createPointerLock(stage);

  let m = initialSweepMachine();
  const acc = new SweepAccumulator();
  let pace = 0;    // EMA pointer speed, counts per ms
  let lastT = 0;

  const recordingNow = (): boolean => m.phase === 'slow' || m.phase === 'fast';
  const quickPass = (): boolean => m.phase === 'idle-fast' || m.phase === 'fast';

  // The same trace the turn draws, in the same two modes: under reduced motion the ink holds still
  // and only the pen advances.
  const traceMode: TraceMode = opts.reducedMotion ? 'sweep' : 'scroll';
  const trace = createSpeedTrace();
  const traceCanvas = $('trace') as HTMLCanvasElement;
  const painter = createTracePainter(traceCanvas, stage);
  let traceRaf: number | null = null;

  function traceFrame(): void {
    traceRaf = null;
    if (!(pointer.isLocked() && recordingNow())) return;
    painter.paint(trace.geometry(performance.now(), traceMode));
    // The pace meter rides the frame rather than the sample. Samples arrive at up to 1000 Hz and
    // the meter is a thing the eye reads, so updating it per sample bought nothing and spent three
    // DOM writes on every delta of a stream this instrument is trying to measure cleanly.
    paintPace();
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
    if (!pointer.isLocked() || !recordingNow()) return;
    // Signed, unlike the turn's path length: the card's width is the NET distance between its two
    // edges, so a wobble out and back crossed no new card and must not add to the count.
    acc.add(s);
    if (lastT > 0) { const dt = s.t - lastT; if (dt > 0) pace = pace * 0.8 + (Math.abs(s.dx) / dt) * 0.2; }
    lastT = s.t;
    trace.add(s.t, Math.abs(s.dx));
  });

  function startPass(): void {
    acc.reset(); pace = 0; lastT = 0;
    trace.reset(performance.now()); // a fresh pass draws on a blank drum: no replayed motion
  }

  const offFire = pointer.onFire(() => {
    if (!pointer.isLocked()) return;
    const next = sweepTap(m, acc.total(), pointer.mode() ?? 'os-adjusted', opts.referenceWidthCm);
    if (next === m) { // the machine refused the tap: explain the no-op rather than ignore it
      $('lead').textContent = 'That click came too soon to be a sweep of the card, so it did not count. Keep sliding to the right edge, then click.';
      return;
    }
    const wasRecording = recordingNow();
    m = next;
    if (recordingNow() && !wasRecording) startPass();
    if (m.phase === 'done' && m.result !== null) {
      pointer.exit();
      opts.onResult(m.result);
      return;
    }
    if (m.phase === 'blocked' && m.blockReason !== null) {
      pointer.exit();
      opts.onBlocked(m.blockReason, m.spreadPct);
      return;
    }
    updateUi();
  });

  // Held rather than looked up: these three are written on every animation frame of a live pass.
  const paceWrap = $('pacewrap');
  const paceFill = $('pace');
  const paceLabel = $('pacelabel');

  function paintPace(): void {
    const live = pointer.isLocked() && recordingNow();
    paceWrap.hidden = !live;
    if (!live) { paceLabel.textContent = ''; return; }
    // scaleX, never width: a width transition is a layout animation, and the system animates
    // transform, opacity and filter only.
    paceFill.style.transform = `scaleX(${Math.min(1, pace / PACE_SCALE)})`;
    const ok = quickPass() ? pace >= FAST_MIN : pace <= SLOW_MAX;
    paceFill.dataset['ok'] = ok ? 'true' : 'false';
    const label = quickPass()
      ? (ok ? 'Good, nice and quick' : 'A little faster')
      : (ok ? 'Good, slow and steady' : 'Ease off, a little slower');
    if (paceLabel.textContent !== label) paceLabel.textContent = label;
  }

  function updateUi(): void {
    const locked = pointer.isLocked();
    $('hint').style.display = locked ? 'none' : 'flex';
    ($('rec') as HTMLElement).hidden = !(locked && recordingNow());
    $('dir').style.display = 'flex';
    $('pass').textContent = quickPass() ? 'Quick pass' : `Slow pass ${Math.min(SLOW_PASSES, m.passes.length + 1)}`;
    syncTrace();
    if (!locked) {
      // Includes the Esc mid-pass case, so the sub goes back to explaining the lock rather than
      // leaving the abandoned pass's instruction under a lead that says to click the box.
      $('lead').textContent = LEAD_START;
      $('sub').textContent = SUB_START;
      paintPace();
      return;
    }
    switch (m.phase) {
      case 'idle-slow':
        $('lead').textContent = m.passes.length === 0
          ? 'Line your mouse up at the left edge of the card, then click once to start.'
          : 'One more, so the two readings can be checked against each other. Back to the left edge, then click.';
        $('sub').textContent = m.passes.length === 0
          ? 'The card is the ruler here: its long edge is the same width the world over.'
          : 'Two passes are what makes a slip visible. One pass agrees with itself.';
        break;
      case 'slow':
        $('lead').textContent = 'Slide across the card to its right edge, slow and even, then click to finish the pass.';
        $('sub').textContent = 'Keep it flat and straight. Sideways drift is travel that crossed no card.';
        break;
      case 'idle-fast':
        $('lead').textContent = 'Bring your mouse back to the left edge, then click to start one quick pass.';
        $('sub').textContent = 'Your browser cannot hand over raw mouse input, so the operating system may be scaling speed. A quick sweep against your steady ones is how that shows up.';
        break;
      case 'fast':
        $('lead').textContent = 'Now across the card in one quick motion, as fast as feels natural, then click.';
        $('sub').textContent = '';
        break;
      case 'done':
      case 'blocked':
        break; // terminal: the view is being torn down by the orchestrator
    }
    paintPace();
  }

  // A denied lock says so in the live region and points at the typed route, rather than leaving the
  // step unusable with nothing said.
  const onStageClick = (): void => {
    if (pointer.isLocked()) return;
    void pointer.request().catch(() => {
      $('lead').textContent = 'Your browser blocked the pointer lock, so the card cannot be read. Use "Type the numbers instead" below.';
    });
  };
  const onLock = (): void => {
    if (!pointer.isLocked() && recordingNow()) {
      // Esc mid-pass: drop the live pass and re-arm its idle. Never stitch a pass across an
      // uncounted gap, which would commit a short sweep as a full card and report a high reading.
      m = { ...m, phase: m.phase === 'fast' ? 'idle-fast' : 'idle-slow' };
      acc.reset(); pace = 0; lastT = 0;
    }
    updateUi();
  };
  // The two ways out, reachable by Tab even mid-pass. Both release the lock before leaving.
  const leave = (fn: () => void) => (): void => { pointer.exit(); fn(); };
  const onBackClick = leave(() => opts.onBack());
  const onManualClick = leave(() => opts.onManual());
  document.addEventListener('pointerlockchange', onLock);
  stage.addEventListener('click', onStageClick);
  $('back').addEventListener('click', onBackClick);
  $('manual').addEventListener('click', onManualClick);
  updateUi();

  return { dispose() {
    off(); offFire();
    if (traceRaf !== null) cancelAnimationFrame(traceRaf);
    document.removeEventListener('pointerlockchange', onLock);
    stage.removeEventListener('click', onStageClick);
    $('back').removeEventListener('click', onBackClick);
    $('manual').removeEventListener('click', onManualClick);
    pointer.dispose();
  } };
}
