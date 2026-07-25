// src/ui/calibrate/spin-view.ts
// Thin shell: a click-only full-turn spin, guided ONE action at a time. Swipe sideways to fill a
// radial dial; a quick TAP completes (seed = total swept counts treated as one 360); a HOLD (press,
// lift/reset, release) suspends counting so the player can reposition when they run out of pad. Cues:
// a "home" label, a sideways ghost arrow (not a circular motion), a green near-done glow + a finish
// pulse that appears only when valid, a freeze visual while holding, and a proactive out-of-room
// helper. Runtime-verified, not unit-tested.
import { createPointerLock } from '../../input/pointer-lock';
import { SpinSeedAccumulator } from '../../input/dpi-sweep';
import { degPerCountFor, cm360FromTurnCounts } from '../../convert/turn-rate';
import { hex, rgba } from '../../palette';
import type { Cm360 } from '../../types';

export interface SpinView { dispose(): void; }

const PROVISIONAL_CM360 = 30; // visual dial rate only; NOT the measured seed
const TAP_MS = 220;           // press shorter than this (with little movement) = a tap (done)
const TAP_MOVE_MAX = 40;      // counts of movement during a press still considered "still" (a tap)
const MIN_DONE_DEG = 270;     // must have swept >= this (at the provisional rate) for a tap to complete

const LEAD_START = 'This step measures one full turn. Click the box to begin.';

export function createSpinView(
  host: HTMLElement,
  opts: {
    dpi: number;
    reducedMotion: boolean;
    onSeed: (cm360: Cm360) => void;
    /** The typed fallback, chosen deliberately. */
    onManual: () => void;
    /** Leave the guided flow entirely. Every step owes the visitor a way out. */
    onBack: () => void;
  },
): SpinView {
  host.innerHTML = `
    <section class="screen screen--shell fade-in">
      <div class="wrap stack">
        <span class="cal-step" data-spin="step">Step 2 of 2 · the spin</span>
        <h1 class="display">The spin</h1>
        <p class="gate__lead" data-spin="lead" aria-live="polite" aria-atomic="true">${LEAD_START}</p>
        <p class="cal-sub" data-spin="sub"></p>
        <div class="calibrate__stage">
          <canvas class="calibrate__canvas" data-spin="canvas"></canvas>
          <div class="calibrate__hint" data-spin="hint"><span class="cal-pulse"><span class="cal-pulse__dot"></span></span></div>
        </div>
        <div class="cal-helper"><span><b>Out of room?</b> Hold the button, slide your mouse back, then let go.</span></div>
        <p class="cal-method mono" data-spin="seed">The spin gives a starting guess for the search.</p>
        <div class="cal-exit">
          <button type="button" class="action action--ghost" data-spin="back">Back</button>
          <button type="button" class="action action--ghost" data-spin="manual">Type the numbers instead</button>
        </div>
      </div>
    </section>`;

  const $ = (s: string): HTMLElement => host.querySelector(`[data-spin="${s}"]`) as HTMLElement;
  const canvas = $('canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  const pointer = createPointerLock(canvas);
  const degPerCount = degPerCountFor(PROVISIONAL_CM360, opts.dpi);

  const acc = new SpinSeedAccumulator(); // path-length seed + signed swept (dial visual only)
  let paused = false;        // counting suspended (set on mousedown until classified)
  let repositioning = false; // UI: showing the reposition prompt (set by the hold timer)
  let nearDone = false;      // swept >= MIN_DONE_DEG (drives the lead swap)
  let flashUntil = 0;        // ts until which the "almost - keep turning" flash shows
  let W = 0, H = 0;
  let downAt = 0, pressMoved = 0; // pressMoved = travel during the current press (tap-vs-hold)
  let holdTimer: number | null = null;
  let raf = 0;

  // Dial VISUAL uses the SIGNED swept value (so wobble back un-fills the ring, matching the felt
  // direction). The measured SEED uses path length (acc.pathLength()) - see onUp.
  const progressDeg = (): number => Math.abs(acc.swept()) * degPerCount;

  function sizeCanvas(): void {
    // Read the ratio per resize: a move to a different-density monitor fires a resize with a new
    // devicePixelRatio, and a captured one would rescale the dial to the old density.
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const r = canvas.getBoundingClientRect(); W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw(ts: number): void {
    raf = requestAnimationFrame(draw);
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2, rad = Math.max(20, Math.min(W, H) * 0.30);
    const deg = progressDeg();
    const near = deg >= MIN_DONE_DEG;
    const flashing = ts < flashUntil;

    ctx.globalAlpha = repositioning ? 0.4 : 1;
    ctx.lineWidth = 10; ctx.lineCap = 'round';
    ctx.strokeStyle = rgba('paper', 0.14);
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.stroke();
    const frac = Math.min(1, deg / 360);
    ctx.strokeStyle = repositioning ? hex.warn : (near ? hex.ok : hex.calibrate);
    ctx.beginPath(); ctx.arc(cx, cy, rad, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); ctx.stroke();

    // home marker + label. A full turn is marked by a hairline ring around the dot, not by a glow:
    // nothing in this system glows.
    const reached = near && !repositioning;
    ctx.fillStyle = reached ? hex.ok : hex.danger;
    ctx.beginPath(); ctx.arc(cx, cy - rad, 6, 0, Math.PI * 2); ctx.fill();
    if (reached) {
      ctx.strokeStyle = hex.ok; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy - rad, 11, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = rgba('paper', 0.7); ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'center'; ctx.fillText('Home', cx, cy - rad - 12);

    // center readout (Regular weight only, per the type rules)
    ctx.globalAlpha = 1; ctx.textBaseline = 'middle';
    if (flashing) { ctx.fillStyle = hex.warn; ctx.font = '16px ui-monospace, monospace'; ctx.fillText('Almost, keep turning', cx, cy); }
    else if (repositioning) { ctx.fillStyle = hex.warn; ctx.font = '20px ui-monospace, monospace'; ctx.fillText('Paused', cx, cy); }
    else { ctx.fillStyle = rgba('paper', 0.92); ctx.font = '26px ui-monospace, monospace'; ctx.fillText(Math.round(Math.min(360, deg)) + '°', cx, cy); }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

    // cues
    if (!repositioning && !near && !flashing) drawSideArrow(ctx, ts, cx, cy + rad + 26, Math.min(W * 0.4, 150), opts.reducedMotion);
    if (near && !repositioning) drawFinishPulse(ctx, ts, cx, cy, rad * 0.6, opts.reducedMotion);
  }

  const off = pointer.onSample((s) => {
    if (!pointer.isLocked()) return;
    if (paused) { pressMoved += Math.abs(s.dx); return; } // movement during a press classifies tap vs hold; never counts
    acc.add(s);
    const near = progressDeg() >= MIN_DONE_DEG;
    if (near !== nearDone) { nearDone = near; updateUi(); }
  });

  const onDown = (ev: MouseEvent): void => {
    if (!pointer.isLocked() || ev.button !== 0) return;
    downAt = ev.timeStamp; pressMoved = 0; paused = true; // suspend counting until classified
    holdTimer = window.setTimeout(() => { repositioning = true; updateUi(); }, TAP_MS);
  };
  const onUp = (ev: MouseEvent): void => {
    if (ev.button !== 0 || downAt === 0) return;
    if (holdTimer !== null) { clearTimeout(holdTimer); holdTimer = null; }
    const dt = ev.timeStamp - downAt;
    downAt = 0;
    const isTap = dt < TAP_MS && pressMoved < TAP_MOVE_MAX; // quick AND still = a tap (done); else a reposition
    if (isTap && progressDeg() >= MIN_DONE_DEG) {
      pointer.exit();
      // Seed from horizontal PATH-LENGTH (sum of |dx|), not the signed sum: unheld wobble cancels in
      // a signed sum and under-counts the turn, biasing the seed fast. The seed flows ONLY into
      // boundsFromSeed (a guess to search around, not the answer).
      const seed = cm360FromTurnCounts(acc.pathLength(), opts.dpi);
      // Prescribe-not-readout: name the seed as a starting point, never a measured result.
      $('seed').textContent = `The search starts near ${seed.toFixed(1)} cm/360 and hunts from there.`;
      opts.onSeed(seed);
      return;
    }
    if (isTap) flashUntil = ev.timeStamp + 900; // a too-early tap: explain the no-op instead of staying silent
    paused = false; repositioning = false;
    updateUi();
  };

  function updateUi(): void {
    const locked = pointer.isLocked();
    $('hint').style.display = locked ? 'none' : 'flex';
    if (!locked) { $('lead').textContent = LEAD_START; $('sub').textContent = ''; return; }
    if (repositioning) {
      $('lead').textContent = 'Slide your mouse back to the middle of your pad.';
      $('sub').textContent = "Let go when you're set. The ring stays put while you hold."; return;
    }
    if (progressDeg() >= MIN_DONE_DEG) {
      $('lead').textContent = 'Facing forward again? Quick-click to finish.';
      $('sub').textContent = 'Just a quick click, keeping the mouse still.'; return;
    }
    $('lead').textContent = "Drag your mouse sideways to turn, and keep going until you're facing forward again.";
    $('sub').textContent = '';
  }

  const onLock = (): void => updateUi();
  // A denied lock used to be a silent no-op, which left the spin unusable with nothing said. Say it,
  // in the live region, and point at the typed route rather than discarding the measured dpi.
  const onCanvasClick = (): void => {
    if (pointer.isLocked()) return;
    void pointer.request().catch(() => {
      $('lead').textContent = 'Your browser blocked the pointer lock, so the spin cannot read your mouse. Use "Type the numbers instead" below.';
    });
  };
  // The two ways out, reachable by Tab even mid-turn. Both release the lock before leaving.
  const leave = (fn: () => void) => (): void => { pointer.exit(); fn(); };
  const onBackClick = leave(() => opts.onBack());
  const onManualClick = leave(() => opts.onManual());
  document.addEventListener('pointerlockchange', onLock);
  document.addEventListener('mousedown', onDown);
  document.addEventListener('mouseup', onUp);
  window.addEventListener('resize', sizeCanvas);
  canvas.addEventListener('click', onCanvasClick);
  $('back').addEventListener('click', onBackClick);
  $('manual').addEventListener('click', onManualClick);
  sizeCanvas();
  updateUi();
  raf = requestAnimationFrame(draw);

  return { dispose() {
    off();
    if (holdTimer !== null) clearTimeout(holdTimer);
    cancelAnimationFrame(raf);
    document.removeEventListener('pointerlockchange', onLock);
    document.removeEventListener('mousedown', onDown);
    document.removeEventListener('mouseup', onUp);
    window.removeEventListener('resize', sizeCanvas);
    canvas.removeEventListener('click', onCanvasClick);
    $('back').removeEventListener('click', onBackClick);
    $('manual').removeEventListener('click', onManualClick);
    pointer.dispose();
  } };
}

/** A horizontal double-arrow that slides side to side - cues a SIDEWAYS drag (not a circular motion).
 *  Under reduced motion the chevron rests at the mid-point: the axis is the cue, not the travel. */
function drawSideArrow(ctx: CanvasRenderingContext2D, ts: number, cx: number, y: number, half: number, reduced: boolean): void {
  const t = reduced ? 0.5 : (Math.sin((ts % 1600) / 1600 * Math.PI * 2) + 1) / 2; // 0..1 ease
  const x = cx - half + t * half * 2;
  ctx.strokeStyle = rgba('calibrate', 0.8); ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx - half, y); ctx.lineTo(cx + half, y); ctx.stroke();
  // moving chevron showing the drag head
  ctx.beginPath();
  ctx.moveTo(x - 6, y - 6); ctx.lineTo(x + 6, y); ctx.lineTo(x - 6, y + 6); ctx.stroke();
}

/** A pulsing green ring at the dial center, inviting the quick-click to finish (only when valid).
 *  Under reduced motion it holds still at its mid radius, so "you can finish now" still reads. */
function drawFinishPulse(ctx: CanvasRenderingContext2D, ts: number, cx: number, cy: number, base: number, reduced: boolean): void {
  const t = reduced ? 0.5 : (ts % 1400) / 1400;
  ctx.strokeStyle = rgba('ok', 0.7 * (1 - t));
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, base * (0.7 + t * 0.6), 0, Math.PI * 2); ctx.stroke();
}
