import { describe, it, expect } from 'vitest';
import { Vector3, PerspectiveCamera } from 'three';

describe('three.js (headless, Node)', () => {
  it('constructs core math objects without a GL context', () => {
    const v = new Vector3(1, 2, 3);
    expect(v.length()).toBeCloseTo(Math.sqrt(14), 6);

    const cam = new PerspectiveCamera(90, 16 / 9, 0.1, 100);
    expect(cam.isPerspectiveCamera).toBe(true);
  });
});
