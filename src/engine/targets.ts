import { Color, Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from 'three';
import type { Degrees, TargetHandle } from '../types';

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

/** Angular half-angle (degrees) subtended by a sphere of world radius `r` at distance `d`. */
export function angularRadius(r: number, d: number): Degrees {
  return Math.atan2(r, d) * RAD2DEG;
}

/**
 * Logical bearing [yaw, pitch] (degrees) of a world position from the origin.
 * yaw = atan2(x, −z) (+yaw = right); pitch = atan2(y, hypot(x, z)) (+pitch = up).
 */
export function bearingOf(p: Vector3): [Degrees, Degrees] {
  return [Math.atan2(p.x, -p.z) * RAD2DEG, Math.atan2(p.y, Math.hypot(p.x, p.z)) * RAD2DEG];
}

/** World position at a bearing + distance (exact inverse of bearingOf). */
export function positionAt(yaw: Degrees, pitch: Degrees, distance: number): Vector3 {
  const y = yaw * DEG2RAD;
  const p = pitch * DEG2RAD;
  return new Vector3(
    Math.cos(p) * Math.sin(y),
    Math.sin(p),
    -Math.cos(p) * Math.cos(y),
  ).multiplyScalar(distance);
}

export interface Placement {
  yaw: Degrees;
  pitch: Degrees;
  distance: number;
  worldRadius: number;
}

export interface PlaceOptions {
  yawSpread?: Degrees;
  pitchSpread?: Degrees;
  distance?: number;
  worldRadius?: number;
}

/** A static target inside a forward cone (±yawSpread, ±pitchSpread). */
export function placeStatic(rng: () => number, opt: PlaceOptions = {}): Placement {
  const yawSpread = opt.yawSpread ?? 25;
  const pitchSpread = opt.pitchSpread ?? 12;
  return {
    yaw: (rng() * 2 - 1) * yawSpread,
    pitch: (rng() * 2 - 1) * pitchSpread,
    distance: opt.distance ?? 20,
    worldRadius: opt.worldRadius ?? 0.6,
  };
}

/** A spawned arena target. Owns its mesh; reports bearing/angular radius for scoring. */
export class Target implements TargetHandle {
  readonly id: string;
  readonly mesh: Mesh;
  private readonly placement: Placement;

  constructor(id: string, placement: Placement) {
    this.id = id;
    this.placement = placement;
    const geometry = new SphereGeometry(placement.worldRadius, 24, 16);
    const material = new MeshStandardMaterial({
      color: new Color('#FFC400'),
      emissive: new Color('#3a2a00'),
      roughness: 0.4,
      metalness: 0,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.position.copy(positionAt(placement.yaw, placement.pitch, placement.distance));
  }

  bearing(): [Degrees, Degrees] {
    return bearingOf(this.mesh.position);
  }

  radiusDeg(): Degrees {
    return angularRadius(this.placement.worldRadius, this.placement.distance);
  }

  /** Release GPU resources. Safe to call once the target is removed from the scene. */
  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshStandardMaterial).dispose();
  }
}
