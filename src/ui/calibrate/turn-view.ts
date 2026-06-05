// src/ui/calibrate/turn-view.ts
// Thin shell: the locked 2D-panorama turn. A 'home' marker starts dead ahead; turning until it
// comes back around is one 360 (auto-marks). Up/Down tune the comfortable cm/360. The DPI from
// the sweep makes the cm/360 readout real. Reduced-motion users take the typed fast path instead.
import { createPointerLock } from '../../input/pointer-lock';
import { degPerCountFor, cm360FromTurnCounts, turnCountsFor } from '../../convert/turn-rate';
import type { Cm360 } from '../../types';

export interface TurnView { dispose(): void; }

export function createTurnView(
  host: HTMLElement,
  opts: { dpi: number; onSeed: (cm360: Cm360) => void; seed0?: Cm360 },
): TurnView {
  host.innerHTML = `
    <section class="screen screen--arena fade-in">
      <div class="wrap stack">
        <h2 class="display">+ the turn</h2>
        <p class="gate__lead">click to lock, then turn until <b>home</b> comes back around. nudge with up/down until a full turn feels right in one swipe; <span class="mono">enter</span> accepts, <span class="mono">esc</span> releases.</p>
        <div class="calibrate__progress"><div data-turn="bar"></div></div>
        <div class="calibrate__stage">
          <canvas class="calibrate__canvas" data-turn="canvas"></canvas>
          <div class="calibrate__hint" data-turn="hint"><span>click to lock + start turning</span></div>
        </div>
        <div class="calibrate__readouts">
          <div class="calibrate__ro"><div class="k">heading</div><div class="v mono" data-turn="head">0&deg;</div></div>
          <div class="calibrate__ro"><div class="k">a full turn</div><div class="v mono" data-turn="cm">-</div></div>
          <div class="calibrate__ro"><div class="k">status</div><div class="v mono" data-turn="status">turn</div></div>
        </div>
      </div>
    </section>`;

  const $ = (s: string) => host.querySelector(`[data-turn="${s}"]`) as HTMLElement;
  const canvas = $('canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const pointer = createPointerLock(canvas);
  const FOV = 100;
  const markers = [{ d: 0, home: true, label: 'home' }, { d: 90, label: '90' }, { d: 180, label: '180' }, { d: 270, label: '270' }];
  const angleDiff = (a: number, b: number): number => ((a - b + 540) % 360) - 180;

  let cm360: Cm360 = opts.seed0 ?? 30;
  let swept = 0, pitch = 0, completed = false, W = 0, H = 0;
  const dpr = Math.max(1, window.devicePixelRatio || 1);

  function size(): void { const r = canvas.getBoundingClientRect(); W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw(); }
  function rearm(): void { swept = 0; pitch = 0; completed = false; $('bar').style.width = '0'; $('head').textContent = '0°';
    $('status').textContent = 'turn'; $('cm').textContent = cm360FromTurnCounts(turnCountsFor(cm360, opts.dpi), opts.dpi).toFixed(1) + ' cm'; draw(); }

  const off = pointer.onSample((s) => {
    if (!pointer.isLocked() || completed) return;
    swept += s.dx; pitch = Math.max(-240, Math.min(240, pitch + s.dy));
    const totalDeg = Math.abs(swept) * degPerCountFor(cm360, opts.dpi);
    $('head').textContent = Math.min(360, Math.round(totalDeg)) + '°';
    $('bar').style.width = Math.min(100, (totalDeg / 360) * 100) + '%';
    if (totalDeg >= 360) { completed = true; $('status').textContent = 'full turn'; $('status').className = 'v mono calibrate__good';
      $('cm').textContent = cm360.toFixed(1) + ' cm'; }
    draw();
  });

  function draw(): void {
    const heading = ((Math.abs(swept) * degPerCountFor(cm360, opts.dpi)) % 360 + 360) % 360;
    const hy = Math.max(70, Math.min(H - 70, H / 2 - pitch * 0.45));
    ctx.fillStyle = '#141a24'; ctx.fillRect(0, 0, W, hy);
    ctx.fillStyle = '#0c0e12'; ctx.fillRect(0, hy, W, H - hy);
    ctx.strokeStyle = 'rgba(255,255,255,.06)';
    for (let g = 0; g < 360; g += 15) { const rel = angleDiff(g, heading); if (Math.abs(rel) > FOV / 2) continue;
      const x = W / 2 + (rel / FOV) * W; ctx.beginPath(); ctx.moveTo(x, hy); ctx.lineTo(W / 2 + (rel / FOV) * W * 2.4, H); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.beginPath(); ctx.moveTo(0, hy); ctx.lineTo(W, hy); ctx.stroke();
    for (const m of markers) { const rel = angleDiff(m.d, heading); if (Math.abs(rel) > FOV / 2 + 6) continue;
      const x = W / 2 + (rel / FOV) * W, h = m.home ? 92 : 58;
      ctx.strokeStyle = m.home ? '#ff3b30' : 'rgba(255,255,255,.4)'; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = m.home ? 4 : 2;
      ctx.beginPath(); ctx.moveTo(x, hy); ctx.lineTo(x, hy - h); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, hy - h, m.home ? 6 : 4, 0, Math.PI * 2); ctx.fill();
      ctx.font = '11px monospace'; ctx.textAlign = 'center'; ctx.fillText(m.label, x, hy - h - 9); ctx.textAlign = 'left'; }
    ctx.strokeStyle = Math.abs(pitch) < 30 ? 'rgba(57,217,138,.9)' : 'rgba(255,176,32,.9)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(W / 2 - 9, hy); ctx.lineTo(W / 2 + 9, hy); ctx.moveTo(W / 2, hy - 9); ctx.lineTo(W / 2, hy + 9); ctx.stroke();
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.code === 'ArrowUp') { cm360 = Math.min(120, cm360 + 1); rearm(); e.preventDefault(); }
    else if (e.code === 'ArrowDown') { cm360 = Math.max(5, cm360 - 1); rearm(); e.preventDefault(); }
    else if (e.code === 'KeyR') { rearm(); }
    else if (e.code === 'Enter' && completed) { pointer.exit(); opts.onSeed(cm360); }
  };
  const onLock = (): void => { $('hint').style.display = pointer.isLocked() ? 'none' : 'flex'; };
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerlockchange', onLock);
  window.addEventListener('resize', size);
  canvas.addEventListener('click', () => { if (!pointer.isLocked()) void pointer.request().catch(() => {}); });
  rearm(); size();

  return { dispose() { off(); document.removeEventListener('keydown', onKey);
    document.removeEventListener('pointerlockchange', onLock); window.removeEventListener('resize', size); pointer.dispose(); } };
}
