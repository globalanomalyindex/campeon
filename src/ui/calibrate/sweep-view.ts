// src/ui/calibrate/sweep-view.ts
// Thin shell: the locked card sweep, guided ONE action at a time. The slow pass measures DPI across a
// standardized wallet card; the fast pass cross-checks for acceleration (skipped on raw pointer input,
// which bypasses OS accel at the source). Each phase shows a single instruction plus a visual cue:
// a pulsing click target, a left-edge start marker, an animated direction arrow, a finish band, and a
// pace meter. Runtime-verified, not unit-tested.
import { createPointerLock } from '../../input/pointer-lock';
import { accelVerdict, accelTolForWidth } from '../../input/accel-check';
import { SweepAccumulator, dpiFromSweep, isPlausibleSweepDpi } from '../../input/dpi-sweep';
import { hex, rgba } from '../../palette';

export interface SweepResult { dpi: number; accelerated: boolean; }
export interface SweepView { dispose(): void; }

type Phase = 'idle-slow' | 'running-slow' | 'idle-fast' | 'running-fast';

const READY_COUNTS = 150; // a running pass must move at least this far before "finish" is offered
const IDLE_HINT_MS = 1300; // after this long resting at the edge, swap from "position" to "click" cue
const PACE_SCALE = 6;     // counts/ms that fills the pace bar
const SLOW_MAX = 2.2;     // counts/ms at or below = a good "slow" pace
const FAST_MIN = 3.5;     // counts/ms at or above = a good "fast" pace

export function createSweepView(
  host: HTMLElement,
  opts: { referenceWidthCm: number; onResult: (r: SweepResult) => void; onInvalid: () => void; onLockFailed: () => void },
): SweepView {
  host.innerHTML = `
    <section class="screen screen--arena fade-in">
      <div class="wrap stack">
        <span class="cal-step" data-sweep="step">step 1 of 2 - the sweep</span>
        <h2 class="display">+ the sweep</h2>
        <p class="gate__lead" data-sweep="lead">lay any card flat on your desk, next to your mouse.</p>
        <p class="cal-sub" data-sweep="sub">click here to begin (it hides the cursor so we can read your mouse's raw motion). press Esc anytime to stop.</p>
        <div class="calibrate__stage">
          <canvas class="calibrate__canvas" data-sweep="canvas"></canvas>
          <div class="calibrate__hint" data-sweep="hint"><span class="cal-pulse"><span class="cal-pulse__dot"></span></span></div>
        </div>
        <div class="cal-pace" data-sweep="pacewrap" hidden><div class="cal-pace__fill" data-sweep="pace"></div></div>
        <p class="cal-pace__label" data-sweep="pacelabel"></p>
        <div class="calibrate__readouts">
          <div class="calibrate__ro"><div class="k">step</div><div class="v mono" data-sweep="pass">pass 1 of 2 - slow</div></div>
          <div class="calibrate__ro"><div class="k">counts</div><div class="v mono" data-sweep="counts">0</div></div>
          <div class="calibrate__ro"><div class="k">measured dpi</div><div class="v mono" data-sweep="dpi">-</div></div>
        </div>
      </div>
    </section>`;

  const $ = (s: string): HTMLElement => host.querySelector(`[data-sweep="${s}"]`) as HTMLElement;
  const canvas = $('canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  const pointer = createPointerLock(canvas);
  const dpr = Math.max(1, window.devicePixelRatio || 1);

  let phase: Phase = 'idle-slow';
  let slowCounts = 0;
  let ready = false;          // current running pass has moved far enough to offer "finish"
  let idleClickReady = false; // an idle pass has shown "position" long enough to now cue "click"
  let idleTimer: number | null = null;
  let pace = 0;       // EMA pointer speed, counts/ms
  let lastT = 0;
  let W = 0, H = 0;
  let raf = 0;
  const acc = new SweepAccumulator();
  let trail: Array<{ x: number; y: number }> = [];
  const COUNTS_PER_PX = 4.5, WOBBLE_GAIN = 0.5;

  const running = (): boolean => phase === 'running-slow' || phase === 'running-fast';
  const fast = (): boolean => phase === 'idle-fast' || phase === 'running-fast';

  function sizeCanvas(): void {
    const r = canvas.getBoundingClientRect(); W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function clearTrail(): void { trail = []; }
  function pushTrail(dy: number): void {
    const mid = H / 2;
    const x = Math.min(W - 2, acc.total() / COUNTS_PER_PX);
    const prevY = trail.length ? trail[trail.length - 1]!.y : mid;
    const y = Math.max(2, Math.min(H - 2, prevY + dy * WOBBLE_GAIN));
    trail.push({ x, y });
    if (trail.length > 2000) trail.shift();
  }

  function draw(ts: number): void {
    raf = requestAnimationFrame(draw);
    if (!ctx) return;
    const mid = H / 2;
    ctx.clearRect(0, 0, W, H);
    // left-edge start marker (where the card's left end goes)
    ctx.strokeStyle = rgba('gold', 0.55); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(6, H * 0.18); ctx.lineTo(6, H * 0.82); ctx.stroke();
    // right-edge finish band during a running pass
    if (running()) { ctx.fillStyle = rgba('gold', 0.08); ctx.fillRect(W - W * 0.16, 0, W * 0.16, H); }
    // animated direction arrow: rightward while sweeping, leftward to cue "go back" before the fast pass
    const dir = phase === 'idle-fast' ? -1 : 1;
    if (running() || phase === 'idle-fast') drawArrow(ctx, ts, dir, W, mid, ready && running());
    // cardiogram trail
    ctx.strokeStyle = rgba('cream', 0.12); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke();
    if (trail.length >= 2) {
      const first = trail[0]!;
      ctx.strokeStyle = hex.gold; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(first.x, first.y);
      for (let i = 1; i < trail.length; i++) { const p = trail[i]!; ctx.lineTo(p.x, p.y); }
      ctx.stroke();
      const head = trail[trail.length - 1]!;
      ctx.fillStyle = hex.gold; ctx.beginPath(); ctx.arc(head.x, head.y, 3, 0, Math.PI * 2); ctx.fill();
    }
  }

  const off = pointer.onSample((s) => {
    if (!pointer.isLocked() || !running()) return;
    acc.add(s);
    if (lastT > 0) { const dt = s.t - lastT; if (dt > 0) pace = pace * 0.8 + (Math.abs(s.dx) / dt) * 0.2; }
    lastT = s.t;
    pushTrail(s.dy);
    $('counts').textContent = Math.round(acc.total()).toString();
    if (!ready && acc.total() >= READY_COUNTS) { ready = true; updateUi(); }
    updatePace();
  });

  const offFire = pointer.onFire(() => {
    if (!pointer.isLocked()) return;
    if (phase === 'idle-slow') { startPass('running-slow'); }
    else if (phase === 'running-slow') { if (!ready) return nudge(); slowCounts = acc.total(); phase = 'idle-fast'; ready = false; updateUi(); }
    else if (phase === 'idle-fast') { startPass('running-fast'); }
    else if (phase === 'running-fast') { if (!ready) return nudge(); finish(acc.total()); }
  });

  function startPass(next: Phase): void {
    acc.reset(); clearTrail(); pace = 0; lastT = 0; ready = false;
    if (idleTimer !== null) { clearTimeout(idleTimer); idleTimer = null; }
    phase = next; updateUi();
  }
  function nudge(): void { $('lead').textContent = 'keep going, all the way to your card\'s RIGHT edge.'; }
  // One action at a time on an idle pass: show "position your mouse" first, then swap to "click" once
  // they have had a beat to settle (clicking works the whole time - this only paces the guidance).
  function armIdleHint(): void {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleClickReady = false; updateUi();
    idleTimer = window.setTimeout(() => { idleClickReady = true; updateUi(); }, IDLE_HINT_MS);
  }

  function updatePace(): void {
    if (!running()) { $('pacewrap').hidden = true; $('pacelabel').textContent = ''; return; }
    $('pacewrap').hidden = false;
    const fillEl = $('pace');
    fillEl.style.width = Math.min(100, (pace / PACE_SCALE) * 100) + '%';
    const ok = fast() ? pace >= FAST_MIN : pace <= SLOW_MAX;
    fillEl.dataset['ok'] = ok ? 'true' : 'false';
    $('pacelabel').textContent = fast()
      ? (ok ? 'good - nice and quick' : 'a bit faster')
      : (ok ? 'good - slow and steady' : 'ease off, a little slower');
  }

  function updateUi(): void {
    const locked = pointer.isLocked();
    $('hint').style.display = locked ? 'none' : 'flex';
    $('pass').textContent = fast() ? 'pass 2 of 2 - fast' : 'pass 1 of 2 - slow';
    $('step').textContent = fast() ? 'step 1 of 2 - the sweep (checking acceleration)' : 'step 1 of 2 - the sweep';
    if (!locked) {
      $('lead').textContent = 'lay any card flat on your desk, next to your mouse.';
      $('sub').textContent = 'click here to begin (it hides the cursor so we can read your mouse\'s raw motion). press Esc anytime to stop.';
    } else if (phase === 'idle-slow') {
      $('lead').textContent = idleClickReady ? 'lined up? click once to start sliding.' : 'now line your mouse up with the LEFT edge of your card.';
      $('sub').textContent = '';
    } else if (phase === 'running-slow') {
      $('lead').textContent = ready ? 'reached the right edge? click to finish pass 1.' : 'slowly slide your mouse across the card to its RIGHT edge.';
      $('sub').textContent = '';
    } else if (phase === 'idle-fast') {
      $('lead').textContent = idleClickReady ? 'click to start a quick second pass.' : 'bring your mouse back to the card\'s LEFT edge.';
      $('sub').textContent = idleClickReady ? 'this one just checks your mouse moves steadily.' : '';
    } else if (phase === 'running-fast') {
      $('lead').textContent = ready ? 'click to finish.' : 'now slide FAST to the card\'s RIGHT edge, one quick motion.';
      $('sub').textContent = '';
    }
    updatePace();
  }

  function finish(fastCounts: number): void {
    const dpi = dpiFromSweep(slowCounts, opts.referenceWidthCm);
    $('dpi').textContent = isPlausibleSweepDpi(dpi) ? Math.round(dpi).toString() : 'invalid';
    if (!isPlausibleSweepDpi(dpi)) { pointer.exit(); opts.onInvalid(); return; }
    // Raw pointer input (Chromium unadjustedMovement) bypasses OS acceleration at the source, so the
    // slow/fast cross-check has nothing to detect there - skip it. On os-adjusted browsers run it
    // with a tolerance scaled to the short card width (a fixed 10% false-positives on an 8.56cm card).
    const accelerated = pointer.mode() === 'raw'
      ? false
      : accelVerdict(slowCounts, fastCounts, accelTolForWidth(opts.referenceWidthCm)).accelerated;
    pointer.exit();
    opts.onResult({ dpi: Math.round(dpi), accelerated });
  }

  const onLock = (): void => {
    const locked = pointer.isLocked();
    if (!locked && running()) {
      // Esc mid-pass: reset to the matching idle so a re-lock starts a clean pass (never finalize a
      // partial sweep joined by an uncounted gap, which would yield a wrong DPI).
      phase = phase === 'running-fast' ? 'idle-fast' : 'idle-slow';
      acc.reset(); clearTrail(); ready = false; pace = 0; lastT = 0; $('counts').textContent = '0';
    }
    if (locked && (phase === 'idle-slow' || phase === 'idle-fast')) armIdleHint();
    else updateUi();
  };
  const onCanvasClick = (): void => { if (!pointer.isLocked()) void pointer.request().catch(() => opts.onLockFailed()); };
  document.addEventListener('pointerlockchange', onLock);
  canvas.addEventListener('click', onCanvasClick);
  window.addEventListener('resize', sizeCanvas);
  sizeCanvas();
  updateUi();
  raf = requestAnimationFrame(draw);

  return { dispose() {
    off(); offFire();
    cancelAnimationFrame(raf);
    if (idleTimer !== null) clearTimeout(idleTimer);
    document.removeEventListener('pointerlockchange', onLock);
    canvas.removeEventListener('click', onCanvasClick);
    window.removeEventListener('resize', sizeCanvas);
    pointer.dispose();
  } };
}

/** A trio of chevrons sliding in `dir` (+1 right, -1 left) along the mid-line - a looping demo of the
 *  sweep direction. Turns green once the pass is far enough to finish. */
function drawArrow(ctx: CanvasRenderingContext2D, ts: number, dir: number, W: number, y: number, done: boolean): void {
  const period = 1400, span = W * 0.5, x0 = W * 0.25;
  const t = (ts % period) / period;
  ctx.strokeStyle = done ? rgba('ok', 0.9) : rgba('gold', 0.8);
  ctx.lineWidth = 3; ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const f = (t + i * 0.18) % 1;
    const x = dir > 0 ? x0 + f * span : x0 + span - f * span;
    const a = Math.sin(f * Math.PI); // fade in/out across the travel
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.moveTo(x - dir * 7, y - 7); ctx.lineTo(x + dir * 7, y); ctx.lineTo(x - dir * 7, y + 7);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
