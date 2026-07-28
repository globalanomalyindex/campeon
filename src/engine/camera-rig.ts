import { MathUtils, PerspectiveCamera } from 'three';
import type { AimSample, Counts360, Degrees } from '../types';
import { degreesPerCount } from '../convert/counts';

/** Max look-up/down angle (degrees) so the view cannot flip over the pole. */
export const PITCH_LIMIT: Degrees = 89;

/**
 * The arena's field of view, fixed HORIZONTALLY at 103°.
 *
 * Why horizontal, and why fixed. A target's angular size and bearing are properties of the world,
 * but what the player aims at is where that bearing lands ACROSS THE WINDOW, and that mapping is
 * set by the horizontal half-field: screenFraction = tan(yaw) / tan(hfov / 2). The rig used to set
 * a fixed 90° VERTICAL fov, which makes the horizontal field a function of the window's aspect
 * ratio (106° at 4:3, 121° at 16:9, 134° at 21:9). Two visitors on differently shaped windows
 * were then aiming at different-sized targets placed at different fractions of their screens, while
 * the scorer treated both as the same angular task - so Fitts throughput, which divides by angular
 * width, was comparing across tasks. Fixing the horizontal field makes the on-screen geometry of a
 * drill a function of bearing alone, which is the invariant the measurement assumes.
 *
 * 103° is the horizontal field the audience actually aims in: it is Valorant's fixed value at 16:9
 * and within a few degrees of CS2's default there, and it is the number the FOV converter in options
 * offers as its source default. A tall window widens the VERTICAL field instead (the drills' motion
 * is mostly yaw: ±25° of placement spread against ±12° of pitch), so the axis under test holds.
 */
export const HORIZONTAL_FOV: Degrees = 103;

/**
 * The vertical fov (what THREE's PerspectiveCamera takes) that yields HORIZONTAL_FOV at `aspect`.
 * A non-finite or non-positive aspect (a zero-sized or not-yet-laid-out canvas) falls back to a
 * square field: nothing is visible at that size, so this must not propagate NaN into the projection.
 */
export function verticalFovFor(aspect: number): Degrees {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const halfWidth = Math.tan(MathUtils.degToRad(HORIZONTAL_FOV) / 2); // focal units
  return MathUtils.radToDeg(2 * Math.atan(halfWidth / a));
}

/** Wrap a yaw angle into [-180, 180). */
export function wrapYaw(deg: Degrees): Degrees {
  return (((deg + 180) % 360) + 360) % 360 - 180;
}

export interface LookState {
  yaw: Degrees;
  pitch: Degrees;
}

/**
 * Integrate one sample into the look state.
 * +dx (mouse-right) → +yaw (turn right); +dy (mouse-down) → −pitch (look down).
 * Pitch clamps to ±PITCH_LIMIT; yaw wraps to [-180, 180).
 */
export function applyLook(state: LookState, sample: AimSample, degPerCount: Degrees): LookState {
  const yaw = wrapYaw(state.yaw + sample.dx * degPerCount);
  const raw = state.pitch - sample.dy * degPerCount;
  const pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, raw));
  return { yaw, pitch };
}

/**
 * Owns a PerspectiveCamera and maps the logical look state onto it.
 * Logical frame: yaw 0 = forward (−Z), +yaw = right (+X); pitch 0 = level, +pitch = up (+Y).
 * Mapped via Euler order YXZ with rotation.y = −yawRad, rotation.x = +pitchRad.
 */
export class CameraRig {
  readonly camera: PerspectiveCamera;
  private state: LookState = { yaw: 0, pitch: 0 };
  private degPerCount: Degrees;

  constructor(counts: Counts360, aspect = 1) {
    this.camera = new PerspectiveCamera(verticalFovFor(aspect), aspect, 0.1, 1000);
    this.camera.rotation.order = 'YXZ';
    this.degPerCount = degreesPerCount(counts);
    this.sync();
  }

  setSensitivity(counts: Counts360): void {
    this.degPerCount = degreesPerCount(counts);
  }

  /**
   * Reshape the view for a new window aspect. The vertical fov moves WITH the aspect so the
   * horizontal field stays HORIZONTAL_FOV: a resize mid-session must not change the task. Setting
   * `aspect` alone (what the arena used to do) is what let window shape leak into the measurement.
   */
  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.fov = verticalFovFor(aspect);
    this.camera.updateProjectionMatrix();
  }

  apply(sample: AimSample): void {
    this.state = applyLook(this.state, sample, this.degPerCount);
    this.sync();
  }

  view(): [Degrees, Degrees] {
    return [this.state.yaw, this.state.pitch];
  }

  private sync(): void {
    this.camera.rotation.y = -MathUtils.degToRad(this.state.yaw);
    this.camera.rotation.x = MathUtils.degToRad(this.state.pitch);
  }
}
