import {
  Camera,
  LinearFilter,
  Mesh,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type PerspectiveCamera,
  type WebGLRenderer,
} from 'three';
import type { PostProcessor } from './psx-pass';

export interface FilmOptions {
  /** Vignette strength, 0-1 (default 0.34 - softer than the PSX pass). */
  vignette?: number;
  /** Animated grain intensity, 0-1 (default 0.06 - a fine film stock, not snow). */
  grain?: number;
  /** Mild edge chromatic offset in low-res texels at the frame corners (default 0.6; 0 disables). */
  chroma?: number;
  /** Pre-tone-map exposure multiplier (default 1.32): lifts subjects out of the near-black backdrop. */
  exposure?: number;
  /**
   * Freeze the grain clock for prefers-reduced-motion. When true the time uniform
   * never advances, so the grain renders as a single static frozen layer.
   */
  reducedMotion?: boolean;
  /**
   * Wall-clock source in milliseconds (default performance.now). Injectable so the
   * grain animation is deterministic in tests; the PostProcessor interface stays
   * byte-stable (render() takes no timestamp - the pass owns its own clock).
   */
  clock?: () => number;
}

const VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// Warm filmic / ACES-ish tone-map biased toward the cinema-ink/aged-cream/gold film stock.
// Pipeline: optional mild edge chroma offset -> ACES-ish tone-map -> warm film tint that
// PRESERVES the gold #FFC400 anchor (crosshair / weak-spot legibility) -> animated grain
// -> soft vignette. Full-res, single-sample, no downscale, no scanlines, no multi-pass blur.
const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2 uRes;
uniform float uTime;
uniform float uVig;
uniform float uGrain;
uniform float uChroma;
uniform float uExposure;
uniform vec3 uGold;

// ACES filmic approximation (Narkowicz 2015) - cheap, single-instruction-friendly.
vec3 aces(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

float hash(vec2 p) {
  // animated value noise for film grain (frame-varying via uTime)
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 q = vUv - 0.5;
  float r2 = dot(q, q);

  // mild edge chromatic offset: sample R/B slightly apart, scaled toward the corners
  vec2 off = q * (uChroma / uRes) * r2 * 4.0;
  vec3 c;
  c.r = texture2D(tDiffuse, vUv + off).r;
  c.g = texture2D(tDiffuse, vUv).g;
  c.b = texture2D(tDiffuse, vUv - off).b;

  // exposure lift then tone-map to a filmic curve - the lift pulls the low-poly subjects out of the
  // near-black backdrop while ACES keeps the highlights (and the gold anchor) from clipping.
  c = aces(c * uExposure);

  // warm film tint: lift toward the aged-cream highlights / warm-shadow stock, but blend by
  // luma so the saturated gold anchor stays legible (the crosshair/weak-spot must not crush).
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 warm = c * vec3(1.06, 1.0, 0.92);              // gentle warm bias
  float goldNear = smoothstep(0.45, 0.95, dot(normalize(c + 1e-4), normalize(uGold + 1e-4)));
  c = mix(warm, c, goldNear * 0.85);                   // protect gold-hued pixels from the tint
  c = mix(c, c * 1.04, luma);                          // slight highlight bloom-free lift

  // animated film grain (frozen when uTime is held constant under reduced-motion)
  float g = hash(vUv * uRes + uTime) - 0.5;
  c += g * uGrain;

  // soft vignette
  c *= 1.0 - uVig * r2 * 1.4;

  gl_FragColor = vec4(c, 1.0);
}
`;

/**
 * The cinematic film-grade post pass (the default arena look; PSX is kept as a selectable
 * "retro" option). Renders the scene full-resolution into a single linear-filtered target,
 * then blits it through a warm filmic / ACES-ish tone-map that preserves the gold #FFC400
 * anchor, plus animated grain, a soft vignette, and an optional mild edge chroma offset.
 *
 * It implements the SAME {@link PostProcessor} interface as createPsxPass and is byte-stable:
 * render() takes no timestamp - the pass owns its own internal clock. Under reducedMotion the
 * grain clock is frozen (a single static grain frame). Single-sample, full-res only (no
 * multi-pass blur), so it stays cheap on low-end GPUs.
 *
 * Purely visual: it never touches geometry, the camera, the pointer stream, or the cm/360 math.
 * Runtime-only (GLSL + WebGL render target); the actual look is verified in Chromium.
 */
export function createFilmPass(
  renderer: WebGLRenderer,
  size: () => [number, number],
  opts: FilmOptions = {},
): PostProcessor {
  const clock = opts.clock ?? (() => (typeof performance !== 'undefined' ? performance.now() : 0));
  const reducedMotion = opts.reducedMotion ?? false;
  const [w0, h0] = size();
  // Full-resolution, single-sample target with a smooth (linear) filter - no hard downscale.
  const rt = new WebGLRenderTarget(Math.max(1, w0), Math.max(1, h0), {
    minFilter: LinearFilter,
    magFilter: LinearFilter,
  });

  // Gold anchor (#FFC400) in linear-ish 0-1 RGB so the shader can protect it from the warm tint.
  const gold = new Vector3(255 / 255, 196 / 255, 0 / 255);

  const uniforms = {
    tDiffuse: { value: rt.texture },
    uRes: { value: new Vector2(w0, h0) },
    uTime: { value: 0 },
    uVig: { value: opts.vignette ?? 0.34 },
    uGrain: { value: opts.grain ?? 0.06 },
    uChroma: { value: opts.chroma ?? 0.6 },
    uExposure: { value: opts.exposure ?? 1.32 },
    uGold: { value: gold },
  };
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  const postScene = new Scene();
  postScene.add(quad);
  const postCamera = new Camera(); // unused by the shader, but render() requires one

  // Frozen grain frame for reduced-motion: a fixed time so the grain never animates.
  const FROZEN_TIME = 0;

  const pass: PostProcessor = {
    render(scene: Scene, camera: PerspectiveCamera): void {
      // Advance the pass-owned grain clock (or hold it frozen under reduced-motion).
      uniforms.uTime.value = reducedMotion ? FROZEN_TIME : (clock() % 1000) * 0.06;
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(postScene, postCamera);
    },
    setSize(width: number, height: number): void {
      const w = Math.max(1, width);
      const h = Math.max(1, height);
      rt.setSize(w, h);
      uniforms.uRes.value.set(w, h);
    },
    dispose(): void {
      rt.dispose();
      quad.geometry.dispose();
      material.dispose();
    },
  };
  // Expose the quad material for structural tests (read-only inspection of uniforms). Not part
  // of the PostProcessor contract - production code only ever calls render/setSize/dispose.
  (pass as unknown as { __material: ShaderMaterial }).__material = material;
  return pass;
}
