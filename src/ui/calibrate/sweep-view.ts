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

  let phase: Phase = 'idle-slow';
  let slowCounts = 0;
  const acc = new SweepAccumulator();

  const off = pointer.onSample((s) => { if (phase === 'running-slow' || phase === 'running-fast') {
    acc.add(s); $('counts').textContent = Math.round(acc.total()).toString(); pushTrail(s.dy);
  } });

  const offFire = pointer.onFire(() => {
    if (!pointer.isLocked()) return;
    if (phase === 'idle-slow') { acc.reset(); clearTrail(); phase = 'running-slow'; setLead("slide SLOWLY across to the card's right end, then click"); }
    else if (phase === 'running-slow') { slowCounts = acc.total(); phase = 'idle-fast'; $('pass').textContent = 'fast';
      setLead("back to the card's left end, click, then slide FAST across"); }
    else if (phase === 'idle-fast') { acc.reset(); clearTrail(); phase = 'running-fast'; setLead("slide FAST across to the card's right end, then click"); }
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
  window.addEventListener('resize', sizeCanvas);
  sizeCanvas();

  return { dispose() { off(); offFire(); document.removeEventListener('pointerlockchange', onLock); window.removeEventListener('resize', sizeCanvas); canvas.removeEventListener('click', onCanvasClick); pointer.dispose(); } };
}
