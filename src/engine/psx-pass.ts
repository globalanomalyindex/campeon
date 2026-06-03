import {
  Camera,
  Mesh,
  NearestFilter,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type PerspectiveCamera,
  type WebGLRenderer,
} from 'three';

/** What the arena needs from a post-processor: take over the final draw, resize, and clean up. */
export interface PostProcessor {
  render(scene: Scene, camera: PerspectiveCamera): void;
  setSize(width: number, height: number): void;
  dispose(): void;
}

export interface PsxOptions {
  /** Internal-resolution divisor — the scene renders at 1/scale then upscales hard (default 3). */
  scale?: number;
  /** Colour-quantization steps per channel (default 6 → a limited PS1 palette). */
  levels?: number;
  /** Scanline darkening on alternate low-res rows, 0–1 (default 0.10). */
  scanline?: number;
  /** Vignette strength, 0–1 (default 0.45). */
  vignette?: number;
}

const VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// Low-res sample (hard upscale) → ordered Bayer dither → posterize → scanlines → vignette.
const FRAG = `
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2 uRes;
uniform float uLevels;
uniform float uScan;
uniform float uVig;
float bayer(vec2 p) {
  int x = int(mod(p.x, 4.0));
  int y = int(mod(p.y, 4.0));
  int idx = x + y * 4;
  float m[16];
  m[0]=0.0;  m[1]=8.0;  m[2]=2.0;  m[3]=10.0;
  m[4]=12.0; m[5]=4.0;  m[6]=14.0; m[7]=6.0;
  m[8]=3.0;  m[9]=11.0; m[10]=1.0; m[11]=9.0;
  m[12]=15.0;m[13]=7.0; m[14]=13.0;m[15]=5.0;
  float v = 0.0;
  for (int k = 0; k < 16; k++) { if (k == idx) v = m[k]; }
  return v / 16.0 - 0.5;
}
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  c += bayer(vUv * uRes) / uLevels;           // dither before quantizing → smoother banding
  c = floor(c * uLevels + 0.5) / uLevels;      // posterize to a limited palette
  c *= 1.0 - uScan * step(1.0, mod(vUv.y * uRes.y, 2.0)); // scanlines on alternate low-res rows
  vec2 q = vUv - 0.5;
  c *= 1.0 - uVig * dot(q, q) * 2.0;           // vignette
  gl_FragColor = vec4(c, 1.0);
}
`;

/**
 * A hand-rolled PS1-style post pass (no three/examples addons): render the scene into a low-resolution
 * target, then blit it full-screen through a shader that hard-upscales (chunky pixels), ordered-dithers,
 * posterizes to a limited palette, and adds faint scanlines + a vignette. Purely visual — it never
 * touches geometry, the camera, the pointer stream, or the cm/360 math; targets stay angularly exact.
 *
 * Runtime-only (GLSL + WebGL render targets); verified in the #arena harness.
 */
export function createPsxPass(
  renderer: WebGLRenderer,
  size: () => [number, number],
  opts: PsxOptions = {},
): PostProcessor {
  const scale = opts.scale ?? 3;
  const lowRes = (): [number, number] => {
    const [w, h] = size();
    return [Math.max(1, Math.floor(w / scale)), Math.max(1, Math.floor(h / scale))];
  };
  const [lw, lh] = lowRes();
  const rt = new WebGLRenderTarget(lw, lh, { minFilter: NearestFilter, magFilter: NearestFilter });

  const uniforms = {
    tDiffuse: { value: rt.texture },
    uRes: { value: new Vector2(lw, lh) },
    uLevels: { value: opts.levels ?? 6 },
    uScan: { value: opts.scanline ?? 0.1 },
    uVig: { value: opts.vignette ?? 0.45 },
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

  return {
    render(scene: Scene, camera: PerspectiveCamera): void {
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(postScene, postCamera);
    },
    setSize(): void {
      const [w, h] = lowRes();
      rt.setSize(w, h);
      uniforms.uRes.value.set(w, h);
    },
    dispose(): void {
      rt.dispose();
      quad.geometry.dispose();
      material.dispose();
    },
  };
}
