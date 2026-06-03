/** Constant-velocity Kalman filter parameters. */
export interface KalmanCVParams {
  /** Process-noise spectral density (deg²/s³) — how much the model lets velocity drift. */
  q: number;
  /** Measurement-noise variance (deg²). */
  r: number;
}

export interface KalmanCVInit {
  pos?: number;
  vel?: number;
  /** Initial position variance. Default 1e3 — a diffuse prior for an unknown initial state. */
  posVar?: number;
  /** Initial velocity variance. Default 1e3 — a diffuse prior for an unknown initial velocity. */
  velVar?: number;
}

/**
 * 1-D constant-velocity Kalman filter on state x = [pos, vel].
 *   F(dt) = [[1, dt], [0, 1]], H = [1, 0]
 *   Q = q · [[dt³/3, dt²/2], [dt²/2, dt]]  (continuous white-noise-acceleration model)
 * Covariance P stored as the four scalars p00 p01 p10 p11.
 * `update(z)` returns the innovation ν = z − pos⁻ — the filter's one-step prediction residual for the
 * tracked signal. NB: when this filter tracks the *target* (as in the track instrument), ν is a
 * property of the target's motion and the model, NOT of the player, so it is not the player's
 * tracking score; the player-dependent metric is the lag-compensated residual in track.ts.
 */
export class KalmanCV {
  private x0: number;
  private x1: number;
  private p00: number;
  private p01 = 0;
  private p10 = 0;
  private p11: number;
  private readonly q: number;
  private readonly r: number;

  constructor(params: KalmanCVParams, init: KalmanCVInit = {}) {
    this.q = params.q;
    this.r = params.r;
    this.x0 = init.pos ?? 0;
    this.x1 = init.vel ?? 0;
    this.p00 = init.posVar ?? 1e3;
    this.p11 = init.velVar ?? 1e3;
  }

  get pos(): number {
    return this.x0;
  }
  get vel(): number {
    return this.x1;
  }

  /** Predicted position `dt` seconds further ahead at the current velocity estimate. */
  lead(leadSec: number): number {
    return this.x0 + this.x1 * leadSec;
  }

  predict(dt: number): void {
    this.x0 = this.x0 + dt * this.x1;
    const { p00, p01, p10, p11 } = this;
    const a00 = p00 + dt * p10;
    const a01 = p01 + dt * p11;
    const n00 = a00 + dt * a01;
    const n01 = a01;
    const n10 = p10 + dt * p11;
    const n11 = p11;
    const dt2 = dt * dt;
    const dt3 = dt2 * dt;
    this.p00 = n00 + this.q * (dt3 / 3);
    this.p01 = n01 + this.q * (dt2 / 2);
    this.p10 = n10 + this.q * (dt2 / 2);
    this.p11 = n11 + this.q * dt;
  }

  /** Fuse a position measurement; returns the innovation ν = z − pos⁻. */
  update(z: number): number {
    const y = z - this.x0;
    const s = this.p00 + this.r;
    const k0 = this.p00 / s;
    const k1 = this.p10 / s;
    this.x0 = this.x0 + k0 * y;
    this.x1 = this.x1 + k1 * y;
    const { p00, p01, p10, p11 } = this;
    this.p00 = (1 - k0) * p00;
    this.p01 = (1 - k0) * p01;
    this.p10 = p10 - k1 * p00;
    this.p11 = p11 - k1 * p01;
    return y;
  }
}
