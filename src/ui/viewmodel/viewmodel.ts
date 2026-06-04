import { SHEET, type AnimName } from './atlas';
import { ViewmodelController } from './controller';
import { keyMagenta } from './key';
import { orderedDither } from './dither';

const SHEET_URL = '/sprites/deagle.png';

export interface Viewmodel {
  /** The transparent full-screen overlay canvas — append it over the arena (pointer-events: none). */
  readonly el: HTMLCanvasElement;
  /** Start an animation now; `then` (optional) plays once a one-shot completes. */
  play(name: AnimName, then?: AnimName | null): void;
  /** Blit the live frame; call from the host's rAF loop with its timestamp. No-op under reduced motion. */
  tick(nowMs: number): void;
  dispose(): void;
}

/**
 * Thin canvas shell for the Desert Eagle viewmodel — a cosmetic overlay above the WebGL arena. Loads
 * the sprite sheet, knocks out its magenta key to alpha and bakes in the same ordered-dither + posterize
 * as the arena's PSX pass (the GLSL shader can't reach a 2D overlay), then blits the controller's frame
 * crisply (no smoothing → PSX pixels), anchored lower-right (CS:Source style). Purely decorative: it
 * never touches the pointer stream or the cm/360 math, and is `pointer-events: none` so clicks pass
 * through to the arena. Under reduced motion it shows a single static frame.
 *
 * Runtime-only (image decode + canvas); the frame/animation/key logic it depends on is unit-tested in
 * atlas.ts / controller.ts / key.ts.
 */
export async function createViewmodel(opts: { reducedMotion?: boolean; initial?: AnimName } = {}): Promise<Viewmodel> {
  const reduced = opts.reducedMotion ?? false;
  const ctrl = new ViewmodelController(opts.initial ?? 'smoking', 0);

  // Load the sheet and key its magenta background to transparency, once, into an offscreen source.
  const img = new Image();
  img.src = SHEET_URL;
  await img.decode();
  const off = document.createElement('canvas');
  off.width = SHEET.w;
  off.height = SHEET.h;
  const octx = off.getContext('2d');
  if (!octx) throw new Error('viewmodel: 2D context unavailable');
  octx.drawImage(img, 0, 0);
  const data = octx.getImageData(0, 0, SHEET.w, SHEET.h);
  keyMagenta(data.data);
  orderedDither(data.data, SHEET.w, SHEET.h); // bake the PS1 dither+posterize so the gun matches the arena
  octx.putImageData(data, 0, 0);

  const el = document.createElement('canvas');
  el.className = 'viewmodel';
  el.setAttribute('aria-hidden', 'true');
  const ctx = el.getContext('2d');
  if (!ctx) throw new Error('viewmodel: 2D context unavailable');

  const resize = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.width = Math.floor(window.innerWidth * dpr);
    el.height = Math.floor(window.innerHeight * dpr);
    el.style.width = `${window.innerWidth}px`;
    el.style.height = `${window.innerHeight}px`;
    ctx.imageSmoothingEnabled = false; // crisp PSX scaling; reset whenever the canvas resizes
  };
  resize();
  window.addEventListener('resize', resize);

  const draw = (nowMs: number): void => {
    const { rect } = ctrl.frameAt(nowMs);
    ctx.clearRect(0, 0, el.width, el.height);
    // Anchor lower-right (CS:Source): the gun's cell sits with its centre biased right, flush to bottom.
    const destH = el.height * 0.66;
    const destW = destH * (rect.sw / rect.sh);
    const cx = el.width * 0.72; // horizontal centre of the viewmodel — right of screen centre
    const dx = cx - destW / 2;
    const dy = el.height - destH;
    ctx.drawImage(off, rect.sx, rect.sy, rect.sw, rect.sh, dx, dy, destW, destH);
  };

  if (reduced) draw(0);

  return {
    el,
    play(name, then = null) {
      ctrl.play(name, performance.now(), then);
      if (reduced) draw(0);
    },
    tick(nowMs) {
      if (!reduced) draw(nowMs);
    },
    dispose() {
      window.removeEventListener('resize', resize);
      el.remove();
    },
  };
}
