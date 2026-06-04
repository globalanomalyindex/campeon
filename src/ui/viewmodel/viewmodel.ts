import { SHEET, type AnimName } from './atlas';
import { ViewmodelController } from './controller';
import { keyMagenta } from './key';
import { orderedDither } from './dither';
import { kick, restSway, stepSway, type SwayState } from './sway';

const SHEET_URL = '/sprites/deagle.png';

export interface Viewmodel {
  /** The transparent full-screen overlay canvas — append it over the arena (pointer-events: none). */
  readonly el: HTMLCanvasElement;
  /** Start an animation now; `then` (optional) plays once a one-shot completes. */
  play(name: AnimName, then?: AnimName | null): void;
  /** Blit the live frame; call from the host's rAF loop with its timestamp. No-op under reduced motion. */
  tick(nowMs: number): void;
  /** Nudge the weapon-sway spring by a camera look delta (degrees). Cosmetic; no-op under reduced motion. */
  look(dYawDeg: number, dPitchDeg: number): void;
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
  let sway: SwayState = restSway(); // weapon-sway offset (normalized); stepped each tick, kicked on look
  let lastMs = 0;

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
    // Anchor lower-right (CS:Source), offset by the sway spring for a parallax / weight feel.
    const destH = el.height * 0.66;
    const destW = destH * (rect.sw / rect.sh);
    const cx = el.width * 0.72 + sway.x * el.width; // horizontal centre (right of screen centre) + sway
    const dx = cx - destW / 2;
    const dy = el.height - destH + sway.y * el.height;
    const roll = sway.x * 0.6; // subtle barrel tilt (rad) — sells the depth
    ctx.save();
    ctx.translate(cx, dy + destH); // pivot at the grip (bottom of the gun)
    ctx.rotate(roll);
    ctx.translate(-cx, -(dy + destH));
    ctx.drawImage(off, rect.sx, rect.sy, rect.sw, rect.sh, dx, dy, destW, destH);
    ctx.restore();
  };

  if (reduced) draw(0);

  return {
    el,
    play(name, then = null) {
      ctrl.play(name, performance.now(), then);
      if (reduced) draw(0);
    },
    tick(nowMs) {
      if (reduced) return;
      const dt = lastMs === 0 ? 1 / 60 : Math.min(0.05, (nowMs - lastMs) / 1000);
      lastMs = nowMs;
      sway = stepSway(sway, dt);
      draw(nowMs);
    },
    look(dYawDeg, dPitchDeg) {
      if (!reduced) sway = kick(sway, dYawDeg, dPitchDeg);
    },
    dispose() {
      window.removeEventListener('resize', resize);
      el.remove();
    },
  };
}
