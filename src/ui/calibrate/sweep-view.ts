// src/ui/calibrate/sweep-view.ts
// Thin shell: the locked mousepad sweep. Slow pass measures DPI; fast pass cross-checks for
// acceleration. Marking uses onFire (a locked primary-button press), so no cursor is needed.
import { createPointerLock } from '../../input/pointer-lock';
import { accelVerdict } from '../../input/accel-check';
import { SweepAccumulator, dpiFromSweep, isPlausibleSweepDpi } from '../../input/dpi-sweep';

export interface SweepResult { dpi: number; accelerated: boolean; }
export interface SweepView { dispose(): void; }

type Phase = 'idle-slow' | 'running-slow' | 'idle-fast' | 'running-fast';

export function createSweepView(
  host: HTMLElement,
  opts: { padWidthCm: number; onResult: (r: SweepResult) => void; onInvalid: () => void },
): SweepView {
  host.innerHTML = `
    <section class="screen screen--arena fade-in">
      <div class="wrap stack">
        <h2 class="display">+ the sweep</h2>
        <p class="gate__lead" data-sweep="lead">click to lock, set your mouse at the <b>left edge</b> of your pad.</p>
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
    if (phase === 'idle-slow') { acc.reset(); phase = 'running-slow'; setLead('sweep SLOW to the right edge, then click'); }
    else if (phase === 'running-slow') { slowCounts = acc.total(); phase = 'idle-fast'; $('pass').textContent = 'fast';
      setLead('back to the left edge, click, then sweep FAST to the right'); }
    else if (phase === 'idle-fast') { acc.reset(); phase = 'running-fast'; setLead('sweep FAST to the right edge, then click'); }
    else if (phase === 'running-fast') { finish(acc.total()); }
  });

  function setLead(t: string): void { $('lead').textContent = t; }

  function finish(fastCounts: number): void {
    const dpi = dpiFromSweep(slowCounts, opts.padWidthCm);
    $('dpi').textContent = isPlausibleSweepDpi(dpi) ? Math.round(dpi).toString() : 'invalid';
    if (!isPlausibleSweepDpi(dpi)) { pointer.exit(); opts.onInvalid(); return; }
    const { accelerated } = accelVerdict(slowCounts, fastCounts);
    pointer.exit();
    opts.onResult({ dpi: Math.round(dpi), accelerated });
  }

  const onLock = (): void => { $('hint').style.display = pointer.isLocked() ? 'none' : 'flex'; };
  const onCanvasClick = (): void => { if (!pointer.isLocked()) void pointer.request().catch(() => opts.onInvalid()); };
  document.addEventListener('pointerlockchange', onLock);
  canvas.addEventListener('click', onCanvasClick);

  return { dispose() { off(); offFire(); document.removeEventListener('pointerlockchange', onLock); canvas.removeEventListener('click', onCanvasClick); pointer.dispose(); } };
}
