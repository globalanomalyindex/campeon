import { describe, it, expect } from 'vitest';
import { ShaderMaterial } from 'three';
import { createFilmPass } from '../../src/engine/film-pass';
import type { PostProcessor } from '../../src/engine/psx-pass';

/**
 * Structural-only coverage. The film pass's actual LOOK (tone-map warmth, gold
 * legibility, grain, vignette, chroma, bloom) is a Chromium/human verification step -
 * unit tests can only construct it against a fake renderer (no GL context) and
 * pin its contract: same PostProcessor shape as createPsxPass, constructs without
 * throwing, freezes its grain clock under reducedMotion, and always drives the
 * 5-stage render pipeline (scene, bright-pass, blur H, blur V, final composite)
 * regardless of the bloom strength.
 */

/** A minimal stand-in for WebGLRenderer that records calls but needs no GL context. */
function fakeRenderer() {
  const calls = { setRenderTarget: 0, render: 0 };
  return {
    renderer: {
      setRenderTarget() {
        calls.setRenderTarget += 1;
      },
      render() {
        calls.render += 1;
      },
    } as unknown as import('three').WebGLRenderer,
    calls,
  };
}

const size = (): [number, number] => [800, 600];

describe('createFilmPass (structural)', () => {
  it('implements the PostProcessor interface', () => {
    const { renderer } = fakeRenderer();
    const pass: PostProcessor = createFilmPass(renderer, size);
    expect(typeof pass.render).toBe('function');
    expect(typeof pass.setSize).toBe('function');
    expect(typeof pass.dispose).toBe('function');
    pass.dispose();
  });

  it('constructs without throwing against a fake renderer/size', () => {
    const { renderer } = fakeRenderer();
    expect(() => {
      const pass = createFilmPass(renderer, size, { vignette: 0.3 });
      pass.setSize(1024, 768);
      pass.dispose();
    }).not.toThrow();
  });

  it('render() drives all 5 pipeline stages (sets targets then clears to screen)', () => {
    const { renderer, calls } = fakeRenderer();
    const pass = createFilmPass(renderer, size);
    // Cast: render() only forwards these to the fake renderer, never inspects them.
    pass.render({} as never, {} as never);
    expect(calls.setRenderTarget).toBeGreaterThanOrEqual(4); // sceneRT, rtBright, rtBlur, rtBright, screen
    // 5 stages: (1) scene -> sceneRT, (2) bright quad -> rtBright, (3) blur H -> rtBlur,
    // (4) blur V -> rtBright, (5) final quad -> screen.
    expect(calls.render).toBe(5);
    pass.dispose();
  });

  it('bloom = 0 still renders all 5 stages (one code path, composites nothing)', () => {
    const { renderer, calls } = fakeRenderer();
    const pass = createFilmPass(renderer, size, { bloom: 0 });
    pass.render({} as never, {} as never);
    expect(calls.render).toBe(5);
    const mat = passMaterial(pass);
    expect(mat.uniforms.uBloom.value).toBe(0);
    pass.dispose();
  });

  it('advances its own grain clock between frames when motion is allowed', () => {
    const { renderer } = fakeRenderer();
    let now = 1000;
    const pass = createFilmPass(renderer, size, { reducedMotion: false, clock: () => now });
    const mat = passMaterial(pass);
    pass.render({} as never, {} as never);
    const t0 = mat.uniforms.uTime.value as number;
    now = 1500;
    pass.render({} as never, {} as never);
    const t1 = mat.uniforms.uTime.value as number;
    expect(t1).not.toBe(t0); // grain animates
    pass.dispose();
  });

  it('freezes its grain clock under reducedMotion', () => {
    const { renderer } = fakeRenderer();
    let now = 1000;
    const pass = createFilmPass(renderer, size, { reducedMotion: true, clock: () => now });
    const mat = passMaterial(pass);
    pass.render({} as never, {} as never);
    const t0 = mat.uniforms.uTime.value as number;
    now = 99999; // even as wall-clock time marches on...
    pass.render({} as never, {} as never);
    const t1 = mat.uniforms.uTime.value as number;
    expect(t1).toBe(t0); // ...the grain time uniform never moves
    pass.dispose();
  });

  it('uBloom/uThresh uniforms reflect options and their defaults', () => {
    const { renderer } = fakeRenderer();
    const defaults = createFilmPass(renderer, size);
    const defMat = passMaterial(defaults);
    const defBright = (defaults as unknown as { __brightMaterial: ShaderMaterial }).__brightMaterial;
    expect(defMat.uniforms.uBloom.value).toBeCloseTo(0.35);
    expect(defBright.uniforms.uThresh.value).toBeCloseTo(0.55);
    defaults.dispose();

    const custom = createFilmPass(renderer, size, { bloom: 0.7, bloomThreshold: 0.2 });
    const customMat = passMaterial(custom);
    const customBright = (custom as unknown as { __brightMaterial: ShaderMaterial }).__brightMaterial;
    expect(customMat.uniforms.uBloom.value).toBeCloseTo(0.7);
    expect(customBright.uniforms.uThresh.value).toBeCloseTo(0.2);
    custom.dispose();
  });

  it('exposes __brightMaterial and __blurMaterial for structural tests', () => {
    const { renderer } = fakeRenderer();
    const pass = createFilmPass(renderer, size);
    const bright = (pass as unknown as { __brightMaterial?: ShaderMaterial }).__brightMaterial;
    const blur = (pass as unknown as { __blurMaterial?: ShaderMaterial }).__blurMaterial;
    expect(bright).toBeInstanceOf(ShaderMaterial);
    expect(blur).toBeInstanceOf(ShaderMaterial);
    expect(bright?.uniforms.uThresh).toBeDefined();
    expect(blur?.uniforms.uDir).toBeDefined();
    pass.dispose();
  });

  it('setSize(1024, 768) resizes without throwing and updates the blur texel step', () => {
    const { renderer } = fakeRenderer();
    const pass = createFilmPass(renderer, size);
    const blur = (pass as unknown as { __blurMaterial?: ShaderMaterial }).__blurMaterial;
    expect(() => pass.setSize(1024, 768)).not.toThrow();
    // Quarter-res blur target: texel step should track the resized bright/blur RT, not the full-res frame.
    const step = blur?.uniforms.uTexel.value as { x: number; y: number };
    expect(step.x).toBeCloseTo(1 / Math.max(1, Math.floor(1024 / 4)));
    expect(step.y).toBeCloseTo(1 / Math.max(1, Math.floor(768 / 4)));
    pass.dispose();
  });
});

/** Reach into the pass's full-screen quad material to read its uniforms (structural test only). */
function passMaterial(pass: PostProcessor): ShaderMaterial {
  const mat = (pass as unknown as { __material?: ShaderMaterial }).__material;
  if (!mat) throw new Error('film pass did not expose __material for structural assertions');
  return mat;
}
