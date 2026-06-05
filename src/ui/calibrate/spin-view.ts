// src/ui/calibrate/spin-view.ts
// Thin shell: a click-only full-turn spin that yields a personalized seed cm/360. The player swipes
// to fill a radial dial; a quick TAP completes (seed = total swept counts treated as one 360); a
// HOLD (press, lift/reset, release) suspends counting so they can reposition when they run out of
// pad. Reduced-motion users take the typed fast path instead. Runtime-verified, not unit-tested.
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
        <h2 class="display">+ the spin</h2>
        <p class="gate__lead" data-spin="lead">click to lock, then spin all the way around once - the way you'd whip around in game. tap when you're facing forward again. ran out of room? hold the button, reset your mouse, let go.</p>
        <div class="calibrate__stage">
          <canvas class="calibrate__canvas" data-spin="canvas"></canvas>
          <div class="calibrate__hint" data-spin="hint"><span>click to lock + start spinning</span></div>
        </div>
        <p class="mono" data-spin="status">spin one full turn</p>
      </div>
    </section>`;

  const $ = (s: string) => host.querySelector(`[data-spin="${s}"]`) as HTMLElement;
  const canvas = $('canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  const pointer = createPointerLock(canvas);
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const degPerCount = degPerCountFor(PROVISIONAL_CM360, opts.dpi);

  let swept = 0;             // signed accumulated horizontal counts (magnitude = total travel)
  let paused = false;        // counting suspended (set on mousedown until classified)
  let repositioning = false; // UI: showing the reposition prompt (set by the hold timer)
  let W = 0, H = 0;
  let downAt = 0, downSwept = 0;
  let holdTimer: number | null = null;

  const progressDeg = (): number => Math.abs(swept) * degPerCount;

  function size(): void {
    const r = canvas.getBoundingClientRect(); W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0); draw();
  }
  function draw(): void {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2, rad = Math.max(20, Math.min(W, H) * 0.32);
    ctx.lineWidth = 10; ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(234,231,220,0.14)';
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.stroke();
    const frac = Math.min(1, progressDeg() / 360);
    ctx.strokeStyle = repositioning ? '#ffb020' : '#FFC400';
    ctx.beginPath(); ctx.arc(cx, cy, rad, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ff3b30'; ctx.beginPath(); ctx.arc(cx, cy - rad, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(234,231,220,0.92)'; ctx.font = '600 26px ui-monospace, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(repositioning ? 'reposition' : Math.round(Math.min(360, progressDeg())) + '°', cx, cy);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }
  function setLead(t: string): void { $('lead').textContent = t; }

  const off = pointer.onSample((s) => {
    if (!pointer.isLocked() || paused) return;
    swept += s.dx; draw();
  });

  const onDown = (ev: MouseEvent): void => {
    if (!pointer.isLocked() || ev.button !== 0) return;
    downAt = ev.timeStamp; downSwept = swept; paused = true; // suspend until classified
    holdTimer = window.setTimeout(() => { repositioning = true; setLead('repositioning - reset your mouse, then let go'); draw(); }, TAP_MS);
  };
  const onUp = (ev: MouseEvent): void => {
    if (ev.button !== 0 || downAt === 0) return;
    if (holdTimer !== null) { clearTimeout(holdTimer); holdTimer = null; }
    const dt = ev.timeStamp - downAt;
    const moved = Math.abs(swept - downSwept);
    downAt = 0;
    const isTap = dt < TAP_MS && moved < TAP_MOVE_MAX;
    if (isTap && progressDeg() >= MIN_DONE_DEG) {
      pointer.exit();
      opts.onSeed(cm360FromTurnCounts(Math.abs(swept), opts.dpi));
      return;
    }
    paused = false; repositioning = false;
    setLead('keep spinning until home is back in front of you'); draw();
  };

  const onLock = (): void => { $('hint').style.display = pointer.isLocked() ? 'none' : 'flex'; };
  const onCanvasClick = (): void => { if (!pointer.isLocked()) void pointer.request().catch(() => {}); };
  document.addEventListener('pointerlockchange', onLock);
  document.addEventListener('mousedown', onDown);
  document.addEventListener('mouseup', onUp);
  window.addEventListener('resize', size);
  canvas.addEventListener('click', onCanvasClick);
  size();

  return { dispose() {
    off();
    if (holdTimer !== null) clearTimeout(holdTimer);
    document.removeEventListener('pointerlockchange', onLock);
    document.removeEventListener('mousedown', onDown);
    document.removeEventListener('mouseup', onUp);
    window.removeEventListener('resize', size);
    canvas.removeEventListener('click', onCanvasClick);
    pointer.dispose();
  } };
}
