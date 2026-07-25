import { describe, it, expect } from 'vitest';
import { PerspectiveCamera, type Scene } from 'three';
import { CameraRig, HORIZONTAL_FOV, verticalFovFor } from '../../src/engine/camera-rig';
import { Arena, type InputSource, type RendererLike, type ViewmodelLayer } from '../../src/engine/arena';
import { positionAt } from '../../src/engine/targets';
import { mulberry32 } from '../../src/stats/bootstrap';
import type { Degrees } from '../../src/types';

const DEG = Math.PI / 180;

/** Window shapes a visitor actually has: square, 4:3, 16:10, 16:9, 21:9, and a tall window. */
const ASPECTS = [1, 4 / 3, 16 / 10, 16 / 9, 21 / 9, 3 / 4];

/**
 * Horizontal half-field in tangent (focal) units: what a THREE PerspectiveCamera's vertical fov +
 * aspect actually produce. The measured invariant is stated on THIS, because it is what maps a
 * world bearing onto a fraction of the window's width.
 */
function horizontalFovOf(camera: PerspectiveCamera): Degrees {
  return 2 * Math.atan(camera.aspect * Math.tan((camera.fov / 2) * DEG)) / DEG;
}

/** Where a target at [yaw, pitch] lands across the window: NDC x in [-1, 1] (−1 = left edge). */
function screenX(camera: PerspectiveCamera, yaw: Degrees, pitch: Degrees, distance = 20): number {
  camera.updateMatrixWorld(true);
  return positionAt(yaw, pitch, distance).project(camera).x;
}

describe('the arena field of view is a fixed HORIZONTAL fov (window shape cannot change the task)', () => {
  it('verticalFovFor produces the same horizontal fov at every window shape', () => {
    for (const aspect of ASPECTS) {
      const camera = new PerspectiveCamera(verticalFovFor(aspect), aspect, 0.1, 1000);
      expect(horizontalFovOf(camera)).toBeCloseTo(HORIZONTAL_FOV, 6);
    }
  });

  it('a target at a fixed bearing lands at the same fraction of the window width at every shape', () => {
    // The property: the on-screen geometry of the aiming task is a function of the target's
    // bearing alone. Two visitors on differently shaped windows must be aiming at the same thing.
    const at = (aspect: number): number => screenX(new CameraRig(34, 800, aspect).camera, 20, 0);
    const reference = at(ASPECTS[0]!);
    for (const aspect of ASPECTS) expect(at(aspect)).toBeCloseTo(reference, 9);
  });

  it("a target's on-screen WIDTH is the same fraction of the window at every shape", () => {
    // Fitts throughput is computed from angular width, so the width the player sees has to be a
    // function of that angular width and nothing else. Measured across the target's own edges.
    const width = (aspect: number): number => {
      const { camera } = new CameraRig(34, 800, aspect);
      return screenX(camera, 21.7, 0) - screenX(camera, 18.3, 0);
    };
    const reference = width(ASPECTS[0]!);
    for (const aspect of ASPECTS) expect(width(aspect)).toBeCloseTo(reference, 9);
  });

  it('setAspect keeps the horizontal fov fixed when the window is reshaped', () => {
    const rig = new CameraRig(34, 800, 4 / 3);
    const before = screenX(rig.camera, 20, 0);
    rig.setAspect(21 / 9);
    expect(horizontalFovOf(rig.camera)).toBeCloseTo(HORIZONTAL_FOV, 6);
    expect(rig.camera.aspect).toBeCloseTo(21 / 9, 9);
    expect(screenX(rig.camera, 20, 0)).toBeCloseTo(before, 9);
  });

  it('a degenerate window (zero width or height) falls back to a square field, never NaN', () => {
    expect(verticalFovFor(0)).toBeCloseTo(verticalFovFor(1), 9);
    expect(Number.isFinite(verticalFovFor(Number.NaN))).toBe(true);
  });
});

describe('Arena.resize holds the fov invariant', () => {
  /** Capture the rig camera through the sanctioned viewmodel seam - no reach-in cast. */
  function cameraOf(arena: Arena): PerspectiveCamera {
    let captured: PerspectiveCamera | null = null;
    const probe: ViewmodelLayer = {
      attach(_scene: Scene, camera: PerspectiveCamera) {
        captured = camera;
      },
      tick() {},
      look() {},
      fire() {},
      dispose() {},
    };
    arena.attachViewmodel(probe);
    if (!captured) throw new Error('attachViewmodel never handed the layer the camera');
    return captured;
  }

  it('the same target bearing keeps its screen position across a window resize', () => {
    let size: [number, number] = [1024, 768];
    const input: InputSource = { onSample: () => () => {}, onFire: () => () => {} };
    const renderer: RendererLike = { render() {}, setSize() {}, dispose() {} };
    const arena = new Arena({
      renderer, input, size: () => size, cm360: 34, dpi: 800, rng: mulberry32(1),
    });
    const camera = cameraOf(arena);
    expect(horizontalFovOf(camera)).toBeCloseTo(HORIZONTAL_FOV, 6);
    const before = screenX(camera, 20, 0);

    size = [2560, 1080]; // drag the window out to 21:9
    arena.resize();
    expect(horizontalFovOf(camera)).toBeCloseTo(HORIZONTAL_FOV, 6);
    expect(screenX(camera, 20, 0)).toBeCloseTo(before, 9);
    arena.dispose();
  });
});
