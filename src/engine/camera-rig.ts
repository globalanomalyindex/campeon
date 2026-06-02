import { MathUtils, PerspectiveCamera } from 'three';
import type { AimSample, Cm360, Degrees, Dpi } from '../types';
import { TURN_CM } from '../convert/cm360';

/** Max look-up/down angle (degrees) so the view cannot flip over the pole. */
export const PITCH_LIMIT: Degrees = 89;

/**
 * View rotation (degrees) per one normalized mouse count, so that a full 360°
 * turn equals `cm360` of physical mouse travel at `dpi`.
 *   deg/count = 914.4 / (cm360 · dpi)
 * Independent of any internal yaw constant — this is the measured observable.
 */
export function degreesPerCount(cm360: Cm360, dpi: Dpi): Degrees {
  return TURN_CM / (cm360 * dpi);
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

  constructor(cm360: Cm360, dpi: Dpi, aspect = 1) {
    this.camera = new PerspectiveCamera(90, aspect, 0.1, 1000);
    this.camera.rotation.order = 'YXZ';
    this.degPerCount = degreesPerCount(cm360, dpi);
    this.sync();
  }

  setSensitivity(cm360: Cm360, dpi: Dpi): void {
    this.degPerCount = degreesPerCount(cm360, dpi);
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
