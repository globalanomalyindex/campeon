import { describe, it, expect } from 'vitest';
import { ShaderMaterial } from 'three';
import { createFilmPass } from '../../src/engine/film-pass';
import type { PostProcessor } from '../../src/engine/psx-pass';

/**
 * Structural-only coverage. The film pass's actual LOOK (tone-map warmth, gold
 * legibility, grain, vignette, chroma) is a Chromium/human verification step -
 * unit tests can only construct it against a fake renderer (no GL context) and
 * pin its contract: same PostProcessor shape as createPsxPass, constructs without
 * throwing, and freezes its grain clock under reducedMotion.
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

  it('render() blits through its own scene (sets the target then clears it)', () => {
    const { renderer, calls } = fakeRenderer();
    const pass = createFilmPass(renderer, size);
    // Cast: render() only forwards these to the fake renderer, never inspects them.
    pass.render({} as never, {} as never);
    expect(calls.setRenderTarget).toBeGreaterThanOrEqual(2); // render into RT, then back to screen
    expect(calls.render).toBe(2); // scene -> RT, then full-screen quad -> screen
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
});

/** Reach into the pass's full-screen quad material to read its uniforms (structural test only). */
function passMaterial(pass: PostProcessor): ShaderMaterial {
  const mat = (pass as unknown as { __material?: ShaderMaterial }).__material;
  if (!mat) throw new Error('film pass did not expose __material for structural assertions');
  return mat;
}
