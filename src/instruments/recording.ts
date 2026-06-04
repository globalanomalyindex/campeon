import type { ArenaScene, Degrees, Ms, TargetHandle } from '../types';
import { separation } from '../engine/targets';

export interface Frame {
  t: Ms;
  aim: [Degrees, Degrees];
  target: [Degrees, Degrees] | null;
  targetRadius: Degrees | null;
}
export interface FireSnap {
  t: Ms;
  aim: [Degrees, Degrees];
  target: [Degrees, Degrees] | null;
  targetRadius: Degrees | null;
}
export interface Recording {
  frames: Frame[];
  fires: FireSnap[];
}

/** Subscribes to a scene's frames + fires, buffering each with the active target's geometry. */
export class TrialRecorder {
  private readonly frames: Frame[] = [];
  private readonly fires: FireSnap[] = [];
  private readonly offFrame: () => void;
  private readonly offFire: () => void;

  constructor(scene: ArenaScene, currentTarget: () => TargetHandle | null) {
    const snap = (t: Ms): Frame => {
      const tgt = currentTarget();
      return {
        t,
        aim: scene.view(),
        target: tgt ? tgt.bearing() : null,
        targetRadius: tgt ? tgt.radiusDeg() : null,
      };
    };
    this.offFrame = scene.onFrame((_dt, now) => this.frames.push(snap(now)));
    this.offFire = scene.onFire((now) => this.fires.push(snap(now)));
  }

  stop(): void {
    this.offFrame();
    this.offFire();
  }

  /**
   * The recorded buffers. Returns references to the live arrays, not copies - they keep
   * growing until `stop()` is called, so call `stop()` first when you need a fixed snapshot.
   */
  recording(): Recording {
    return { frames: this.frames, fires: this.fires };
  }
}

/** Angular speed (deg/s) between consecutive frames. */
export function speedTrace(frames: readonly Frame[]): Array<{ t: Ms; speed: number }> {
  const out: Array<{ t: Ms; speed: number }> = [];
  for (let i = 1; i < frames.length; i++) {
    const dtSec = (frames[i]!.t - frames[i - 1]!.t) / 1000;
    if (dtSec <= 0) continue;
    out.push({ t: frames[i]!.t, speed: separation(frames[i - 1]!.aim, frames[i]!.aim) / dtSec });
  }
  return out;
}

/**
 * Decompose a landing error into task-local axes about the intended reach.
 * The approach is `start → target`; the miss is `landing − target` in the local (yaw,pitch)
 * plane, split into radial (along the approach, + = overshoot) and signed tangential
 * (perpendicular). `reach` is the planar approach amplitude. Planar approximation - valid
 * at aim-drill angles; the systematic-bias signal it feeds is dominated by the mean.
 */
export function missComponents(
  start: [Degrees, Degrees],
  target: [Degrees, Degrees],
  landing: [Degrees, Degrees],
): { radial: Degrees; tangential: Degrees; reach: Degrees } {
  const dy = target[0] - start[0];
  const dp = target[1] - start[1];
  const reach = Math.hypot(dy, dp);
  if (reach === 0) return { radial: 0, tangential: 0, reach: 0 };
  const uy = dy / reach;
  const up = dp / reach;
  const my = landing[0] - target[0];
  const mp = landing[1] - target[1];
  return {
    radial: my * uy + mp * up,
    tangential: my * -up + mp * uy,
    reach,
  };
}

/** Fraction of frames whose aim lies within the target's angular radius. */
export function timeOnTarget(frames: readonly Frame[]): number {
  let on = 0;
  let total = 0;
  for (const f of frames) {
    if (f.target === null || f.targetRadius === null) continue;
    total += 1;
    if (separation(f.aim, f.target) <= f.targetRadius) on += 1;
  }
  return total === 0 ? 0 : on / total;
}
