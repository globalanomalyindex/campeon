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
   * Gold-selective bloom strength, 0-1 (default 0.35). 0 keeps the quarter-res bloom
   * chain running (same render() call shape every frame) but composites nothing extra -
   * one code path regardless of strength.
   */
  bloom?: number;
  /** Luma threshold where the gold bright-pass starts lifting highlights (default 0.55). */
  bloomThreshold?: number;
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

// Bright-pass: isolate warm-gold highlights only (weak-spot / muzzle flash / crosshair anchor),
// so the bloom chain never glows the whole frame - it lifts only pixels that are BOTH bright
// enough AND close in hue to the #FFC400 gold anchor. Reuses the exact gold-proximity trick the
// final composite's tint protection uses (dot of normalized colors), so "gold" means the same
// thing in both places.
const BRIGHT_FRAG = `
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform float uThresh;
uniform vec3 uGold;
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float goldW = smoothstep(0.4, 0.9, dot(normalize(c + 1e-4), normalize(uGold + 1e-4)));
  float k = smoothstep(uThresh, uThresh + 0.25, luma) * goldW;
  gl_FragColor = vec4(c * k, 1.0);
}
`;

// Separable 9-tap gaussian blur, run twice (horizontal then vertical) at quarter-res through the
// SAME material with uDir swapped between draws - cheap because it never touches full-res pixels.
const BLUR_FRAG = `
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2 uTexel;
uniform vec2 uDir;
void main() {
  // Weights for a 9-tap gaussian (sigma ~ 2), normalized.
  float w0 = 0.227027;
  float w1 = 0.1945946;
  float w2 = 0.1216216;
  float w3 = 0.054054;
  float w4 = 0.016216;
  vec2 step = uTexel * uDir;
  vec3 sum = texture2D(tDiffuse, vUv).rgb * w0;
  sum += texture2D(tDiffuse, vUv + step * 1.0).rgb * w1;
  sum += texture2D(tDiffuse, vUv - step * 1.0).rgb * w1;
  sum += texture2D(tDiffuse, vUv + step * 2.0).rgb * w2;
  sum += texture2D(tDiffuse, vUv - step * 2.0).rgb * w2;
  sum += texture2D(tDiffuse, vUv + step * 3.0).rgb * w3;
  sum += texture2D(tDiffuse, vUv - step * 3.0).rgb * w3;
  sum += texture2D(tDiffuse, vUv + step * 4.0).rgb * w4;
  sum += texture2D(tDiffuse, vUv - step * 4.0).rgb * w4;
  gl_FragColor = vec4(sum, 1.0);
}
`;

// Warm filmic / ACES-ish tone-map biased toward the cinema-ink/aged-cream/gold film stock.
// Pipeline: optional mild edge chroma offset -> additive gold-selective bloom (composited BEFORE
// tone-map so highlights roll off filmically, never clip hard) -> ACES-ish tone-map -> warm film
// tint that PRESERVES the gold #FFC400 anchor (crosshair / weak-spot legibility) -> animated
// grain -> soft vignette. Full-res, single-sample scene; the bloom itself runs at quarter-res
// (see render()) precisely to stay cheap, so this stays a light multi-pass chain, not a heavy one.
const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tBloom;
uniform vec2 uRes;
uniform float uTime;
uniform float uVig;
uniform float uGrain;
uniform float uChroma;
uniform float uExposure;
uniform float uBloom;
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

  // additive gold-selective bloom, composited BEFORE the tone-map so the lifted highlights
  // still roll off through ACES instead of clipping - keeps the bloom filmic, not a hot patch.
  c += texture2D(tBloom, vUv).rgb * uBloom;

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
 * "retro" option). Renders the scene full-resolution into a single linear-filtered target, then
 * runs a small quarter-resolution bloom chain that lifts ONLY warm-gold highlights (the
 * weak-spot, the muzzle flash, the crosshair anchor #FFC400) - not a whole-frame glow, so the
 * film keeps its restraint - and composites that bloom additively before the tone-map. The final
 * blit then applies a warm filmic / ACES-ish tone-map that preserves the gold anchor, plus
 * animated grain, a soft vignette, and an optional mild edge chroma offset.
 *
 * It implements the SAME {@link PostProcessor} interface as createPsxPass and is byte-stable:
 * render() takes no timestamp - the pass owns its own internal clock. Under reducedMotion the
 * grain clock is frozen (a single static grain frame); the bloom chain is NOT time-driven so it
 * runs identically regardless of reducedMotion. The bloom chain always runs the same 5
 * render() calls (scene, bright-pass, blur H, blur V, final composite) even when bloom = 0 -
 * one code path, not a branch - and it stays cheap because bright-pass and blur operate at
 * quarter resolution.
 *
 * Purely visual: it never touches geometry, the camera, the pointer stream, or the cm/360 math.
 * Runtime-only (GLSL + WebGL render targets); the actual look is verified in Chromium.
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

  // Quarter-res bloom chain targets - kept small on purpose so the extra passes stay cheap.
  const bloomRes = (): [number, number] => {
    const [w, h] = size();
    return [Math.max(1, Math.floor(w / 4)), Math.max(1, Math.floor(h / 4))];
  };
  const [bw0, bh0] = bloomRes();
  const rtBright = new WebGLRenderTarget(bw0, bh0, { minFilter: LinearFilter, magFilter: LinearFilter });
  const rtBlur = new WebGLRenderTarget(bw0, bh0, { minFilter: LinearFilter, magFilter: LinearFilter });

  // Gold anchor (#FFC400) in linear-ish 0-1 RGB so the shader can protect it from the warm tint
  // and so the bright-pass can select the same gold hue for the bloom.
  const gold = new Vector3(255 / 255, 196 / 255, 0 / 255);

  const brightUniforms = {
    tDiffuse: { value: rt.texture },
    uThresh: { value: opts.bloomThreshold ?? 0.55 },
    uGold: { value: gold },
  };
  const brightMaterial = new ShaderMaterial({
    uniforms: brightUniforms,
    vertexShader: VERT,
    fragmentShader: BRIGHT_FRAG,
    depthTest: false,
    depthWrite: false,
  });
  const brightQuad = new Mesh(new PlaneGeometry(2, 2), brightMaterial);
  const brightScene = new Scene();
  brightScene.add(brightQuad);

  const blurUniforms = {
    tDiffuse: { value: rtBright.texture },
    uTexel: { value: new Vector2(1 / bw0, 1 / bh0) },
    uDir: { value: new Vector2(1, 0) },
  };
  const blurMaterial = new ShaderMaterial({
    uniforms: blurUniforms,
    vertexShader: VERT,
    fragmentShader: BLUR_FRAG,
    depthTest: false,
    depthWrite: false,
  });
  const blurQuad = new Mesh(new PlaneGeometry(2, 2), blurMaterial);
  const blurScene = new Scene();
  blurScene.add(blurQuad);

  const uniforms = {
    tDiffuse: { value: rt.texture },
    tBloom: { value: rtBright.texture },
    uRes: { value: new Vector2(w0, h0) },
    uTime: { value: 0 },
    uVig: { value: opts.vignette ?? 0.34 },
    uGrain: { value: opts.grain ?? 0.06 },
    uChroma: { value: opts.chroma ?? 0.6 },
    uExposure: { value: opts.exposure ?? 1.32 },
    uBloom: { value: opts.bloom ?? 0.35 },
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
      // Advance the pass-owned grain clock (or hold it frozen under reduced-motion). The bloom
      // chain below is not time-driven, so this freeze has no effect on it either way.
      uniforms.uTime.value = reducedMotion ? FROZEN_TIME : (clock() % 1000) * 0.06;

      // (1) scene -> full-res sceneRT.
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);

      // (2) gold bright-pass, full-res sceneRT -> quarter-res rtBright.
      renderer.setRenderTarget(rtBright);
      renderer.render(brightScene, postCamera);

      // (3) blur horizontal: rtBright -> rtBlur.
      blurUniforms.tDiffuse.value = rtBright.texture;
      blurUniforms.uDir.value.set(1, 0);
      renderer.setRenderTarget(rtBlur);
      renderer.render(blurScene, postCamera);

      // (4) blur vertical: rtBlur -> back into rtBright.
      blurUniforms.tDiffuse.value = rtBlur.texture;
      blurUniforms.uDir.value.set(0, 1);
      renderer.setRenderTarget(rtBright);
      renderer.render(blurScene, postCamera);
      // Restore the blur material's read source to rtBright for the next frame's H pass.
      blurUniforms.tDiffuse.value = rtBright.texture;

      // (5) final composite (tone-map + tint + grain + vignette, bloom folded in) -> screen.
      renderer.setRenderTarget(null);
      renderer.render(postScene, postCamera);
    },
    setSize(width: number, height: number): void {
      const w = Math.max(1, width);
      const h = Math.max(1, height);
      rt.setSize(w, h);
      uniforms.uRes.value.set(w, h);

      const bw = Math.max(1, Math.floor(w / 4));
      const bh = Math.max(1, Math.floor(h / 4));
      rtBright.setSize(bw, bh);
      rtBlur.setSize(bw, bh);
      blurUniforms.uTexel.value.set(1 / bw, 1 / bh);
    },
    dispose(): void {
      rt.dispose();
      rtBright.dispose();
      rtBlur.dispose();
      quad.geometry.dispose();
      material.dispose();
      brightQuad.geometry.dispose();
      brightMaterial.dispose();
      blurQuad.geometry.dispose();
      blurMaterial.dispose();
    },
  };
  // Expose the quad materials for structural tests (read-only inspection of uniforms). Not part
  // of the PostProcessor contract - production code only ever calls render/setSize/dispose.
  (pass as unknown as { __material: ShaderMaterial }).__material = material;
  (pass as unknown as { __brightMaterial: ShaderMaterial }).__brightMaterial = brightMaterial;
  (pass as unknown as { __blurMaterial: ShaderMaterial }).__blurMaterial = blurMaterial;
  return pass;
}
