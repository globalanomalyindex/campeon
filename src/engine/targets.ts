import { Color, Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from 'three';
import type { Degrees, TargetHandle, TargetMotion } from '../types';
import { mulberry32 } from '../stats/bootstrap';

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

/**
 * Angular half-angle (degrees) a sphere of world radius `r` subtends at distance `d`:
 * the angle to its tangent ray, asin(r/d). This is the exact angular radius for hit-testing
 * a sphere and for the Fitts target width (Phase 3) — not the disc approximation atan(r/d)
 * (they agree to <0.01° at game scale but diverge at close range). Clamped for r ≥ d.
 */
export function angularRadius(r: number, d: number): Degrees {
  return Math.asin(Math.min(1, r / d)) * RAD2DEG;
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

/** Build the standard gold target mesh (shared by static + moving targets). */
export function createTargetMesh(worldRadius: number): Mesh {
  const geometry = new SphereGeometry(worldRadius, 24, 16);
  const material = new MeshStandardMaterial({
    color: new Color('#FFC400'),
    emissive: new Color('#3a2a00'),
    roughness: 0.4,
    metalness: 0,
  });
  return new Mesh(geometry, material);
}

/** Great-circle angular distance (degrees) between two bearings. */
export function separation(a: [Degrees, Degrees], b: [Degrees, Degrees]): Degrees {
  const ua = positionAt(a[0], a[1], 1);
  const ub = positionAt(b[0], b[1], 1);
  // atan2(|cross|, dot) is numerically stable near 0° and 180°, unlike acos(dot).
  const cross = new Vector3().crossVectors(ua, ub);
  const sinA = cross.length();
  const cosA = ua.dot(ub);
  return Math.atan2(sinA, cosA) * RAD2DEG;
}

/** Deterministic band-limited (two-sine) offset [Δyaw, Δpitch] in degrees at time `tSec`. */
export function motionOffset(motion: TargetMotion, tSec: number): [Degrees, Degrees] {
  const yawAmp = motion.yawAmp ?? 10;
  const pitchAmp = motion.pitchAmp ?? 4;
  const f = motion.baseFreq ?? 0.5;
  const rng = mulberry32((motion.seed ?? 1) >>> 0);
  const phiY1 = rng() * Math.PI * 2;
  const phiY2 = rng() * Math.PI * 2;
  const phiP1 = rng() * Math.PI * 2;
  const TAU = Math.PI * 2;
  const dy = (yawAmp / 1.5) * (Math.sin(TAU * f * tSec + phiY1) + 0.5 * Math.sin(TAU * f * 1.7 * tSec + phiY2));
  const dp = pitchAmp * Math.sin(TAU * f * 0.8 * tSec + phiP1);
  return [dy, dp];
}

/** A spawned arena target. Owns its mesh; reports bearing/angular radius for scoring. */
export class Target implements TargetHandle {
  readonly id: string;
  /** Read-only by convention — only the owning Arena should add/remove it from the scene. */
  readonly mesh: Mesh;
  private readonly placement: Placement;

  constructor(id: string, placement: Placement) {
    this.id = id;
    this.placement = placement;
    this.mesh = createTargetMesh(placement.worldRadius);
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

/** A target that orbits a base placement along a deterministic band-limited path. */
export class MovingTarget implements TargetHandle {
  readonly id: string;
  readonly mesh: Mesh;
  private readonly base: Placement;
  private readonly motion: TargetMotion;
  private readonly spawnMs: number;

  constructor(id: string, base: Placement, motion: TargetMotion, spawnMs: number) {
    this.id = id;
    this.base = base;
    this.motion = motion;
    this.spawnMs = spawnMs;
    this.mesh = createTargetMesh(base.worldRadius);
    this.update(spawnMs);
  }

  /** Reposition for the arena clock `nowMs`. */
  update(nowMs: number): void {
    const [dy, dp] = motionOffset(this.motion, (nowMs - this.spawnMs) / 1000);
    this.mesh.position.copy(positionAt(this.base.yaw + dy, this.base.pitch + dp, this.base.distance));
  }

  bearing(): [Degrees, Degrees] {
    return bearingOf(this.mesh.position);
  }

  radiusDeg(): Degrees {
    return angularRadius(this.base.worldRadius, this.base.distance);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshStandardMaterial).dispose();
  }
}
