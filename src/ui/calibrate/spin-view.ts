// src/ui/calibrate/spin-view.ts
// Thin shell: a click-only full-turn spin, guided ONE action at a time. Swipe sideways to fill a
// radial dial; a quick TAP completes (seed = total swept counts treated as one 360); a HOLD (press,
// lift/reset, release) suspends counting so the player can reposition when they run out of pad. Cues:
// a "home" label, a sideways ghost arrow (not a circular motion), a green near-done glow + a finish
// pulse that appears only when valid, a freeze visual while holding, and a proactive out-of-room
// helper. Runtime-verified, not unit-tested.
import { createPointerLock } from '../../input/pointer-lock';
import { degPerCountFor, cm360FromTurnCounts } from '../../convert/turn-rate';
import type { Cm360 } from '../../types';

export interface SpinView { dispose(): void; }

const PROVISIONAL_CM360 = 30; // visual dial rate only; NOT the measured seed
const TAP_MS = 220;           // press shorter than this (with little movement) = a tap (done)
const TAP_MOVE_MAX = 40;      // counts of movement during a press still considered "still" (a tap)
const MIN_DONE_DEG = 270;     // must have swept >= this (at the provisional rate) for a tap to complete

export function createSpinView(host: HTMLElement, opts: { dpi: number; onSeed: (cm360: Cm360) => void }): SpinView {
  host.innerHTML = `
    <section class="screen screen--arena fade-in">
      <div class="wrap stack">
        <span class="cal-step" data-spin="step">step 2 of 2 - the spin</span>
        <h2 class="display">+ the spin</h2>
        <p class="gate__lead" data-spin="lead">we'll measure one full turn. click the box to begin.</p>
        <p class="cal-sub" data-spin="sub"></p>
        <div class="calibrate__stage">
          <canvas class="calibrate__canvas" data-spin="canvas"></canvas>
          <div class="calibrate__hint" data-spin="hint"><span class="cal-pulse"><span class="cal-pulse__dot"></span></span></div>
        </div>
        <div class="cal-helper"><span><b>out of room?</b> press and HOLD the button, slide your mouse back to the middle, then let go - the ring won't move while you hold.</span></div>
      </div>
    </section>`;

  const $ = (s: string): HTMLElement => host.querySelector(`[data-spin="${s}"]`) as HTMLElement;
  const canvas = $('canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  const pointer = createPointerLock(canvas);
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const degPerCount = degPerCountFor(PROVISIONAL_CM360, opts.dpi);

  let swept = 0;             // signed accumulated horizontal counts (magnitude = total travel)
  let paused = false;        // counting suspended (set on mousedown until classified)
  let repositioning = false; // UI: showing the reposition prompt (set by the hold timer)
  let nearDone = false;      // swept >= MIN_DONE_DEG (drives the lead swap)
  let flashUntil = 0;        // ts until which the "almost - keep turning" flash shows
  let W = 0, H = 0;
  let downAt = 0, pressMoved = 0; // pressMoved = travel during the current press (tap-vs-hold)
  let holdTimer: number | null = null;
  let raf = 0;

  const progressDeg = (): number => Math.abs(swept) * degPerCount;

  function sizeCanvas(): void {
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
    ctx.strokeStyle = 'rgba(234,231,220,0.14)';
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.stroke();
    const frac = Math.min(1, deg / 360);
    ctx.strokeStyle = repositioning ? '#ffb020' : (near ? '#39d98a' : '#FFC400');
    ctx.beginPath(); ctx.arc(cx, cy, rad, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); ctx.stroke();

    // home marker + label (glows green once a full turn is reached)
    const glow = near && !repositioning;
    if (glow) { ctx.shadowColor = '#39d98a'; ctx.shadowBlur = 14; }
    ctx.fillStyle = glow ? '#39d98a' : '#ff3b30';
    ctx.beginPath(); ctx.arc(cx, cy - rad, 6, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(234,231,220,.7)'; ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'center'; ctx.fillText('home', cx, cy - rad - 12);

    // center readout
    ctx.globalAlpha = 1; ctx.textBaseline = 'middle';
    if (flashing) { ctx.fillStyle = '#ffb020'; ctx.font = '600 16px ui-monospace, monospace'; ctx.fillText('almost - keep turning', cx, cy); }
    else if (repositioning) { ctx.fillStyle = '#ffb020'; ctx.font = '600 20px ui-monospace, monospace'; ctx.fillText('paused', cx, cy); }
    else { ctx.fillStyle = 'rgba(234,231,220,.92)'; ctx.font = '600 26px ui-monospace, monospace'; ctx.fillText(Math.round(Math.min(360, deg)) + '°', cx, cy); }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

    // cues
    if (!repositioning && !near && !flashing) drawSideArrow(ctx, ts, cx, cy + rad + 26, Math.min(W * 0.4, 150));
    if (near && !repositioning) drawFinishPulse(ctx, ts, cx, cy, rad * 0.6);
  }

  const off = pointer.onSample((s) => {
    if (!pointer.isLocked()) return;
    if (paused) { pressMoved += Math.abs(s.dx); return; } // movement during a press classifies tap vs hold; never counts
    swept += s.dx;
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
      opts.onSeed(cm360FromTurnCounts(Math.abs(swept), opts.dpi));
      return;
    }
    if (isTap) flashUntil = ev.timeStamp + 900; // a too-early tap: explain the no-op instead of staying silent
    paused = false; repositioning = false;
    updateUi();
  };

  function updateUi(): void {
    const locked = pointer.isLocked();
    $('hint').style.display = locked ? 'none' : 'flex';
    if (!locked) { $('lead').textContent = "we'll measure one full turn. click the box to begin."; $('sub').textContent = ''; return; }
    if (repositioning) {
      $('lead').textContent = 'slide your mouse back to the middle of your pad, then let go.';
      $('sub').textContent = 'the ring is paused while you hold.'; return;
    }
    if (progressDeg() >= MIN_DONE_DEG) {
      $('lead').textContent = 'facing forward again? quick-click to finish.';
      $('sub').textContent = "just a quick click - don't move the mouse."; return;
    }
    $('lead').textContent = "drag your mouse sideways to turn - keep going until you're facing forward again.";
    $('sub').textContent = '';
  }

  const onLock = (): void => updateUi();
  const onCanvasClick = (): void => { if (!pointer.isLocked()) void pointer.request().catch(() => {}); };
  document.addEventListener('pointerlockchange', onLock);
  document.addEventListener('mousedown', onDown);
  document.addEventListener('mouseup', onUp);
  window.addEventListener('resize', sizeCanvas);
  canvas.addEventListener('click', onCanvasClick);
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
    pointer.dispose();
  } };
}

/** A horizontal double-arrow that slides side to side - cues a SIDEWAYS drag (not a circular motion). */
function drawSideArrow(ctx: CanvasRenderingContext2D, ts: number, cx: number, y: number, half: number): void {
  const t = (Math.sin((ts % 1600) / 1600 * Math.PI * 2) + 1) / 2; // 0..1 ease
  const x = cx - half + t * half * 2;
  ctx.strokeStyle = 'rgba(255,196,0,.8)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx - half, y); ctx.lineTo(cx + half, y); ctx.stroke();
  // moving chevron showing the drag head
  ctx.beginPath();
  ctx.moveTo(x - 6, y - 6); ctx.lineTo(x + 6, y); ctx.lineTo(x - 6, y + 6); ctx.stroke();
}

/** A pulsing green ring at the dial center, inviting the quick-click to finish (only when valid). */
function drawFinishPulse(ctx: CanvasRenderingContext2D, ts: number, cx: number, cy: number, base: number): void {
  const t = (ts % 1400) / 1400;
  ctx.strokeStyle = `rgba(57,217,138,${0.7 * (1 - t)})`;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, base * (0.7 + t * 0.6), 0, Math.PI * 2); ctx.stroke();
}
