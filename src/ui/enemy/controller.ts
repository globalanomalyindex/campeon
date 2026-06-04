import { ANIMATIONS, frameUV, isComplete, staticFrameUV, type EnemyState, type UVRect } from './atlas';

export interface EnemyFrame {
  state: EnemyState;
  uv: UVRect;
}

/**
 * Pure animation state machine for one enemy. Mirrors the viewmodel controller: tracks the current
 * state + its start time and auto-advances a one-shot to its queued follow-up the instant it
 * completes (spawn → idle, flinch → idle). Terminal states (death, escape) carry no follow-up;
 * `isFinished` reports when their one-shot has played out so the shell can retire the sprite.
 *
 * No THREE, no DOM - the WebGL shell calls `frameAt(now)` each tick and applies the UV to the sprite.
 */
export class EnemyController {
  private state: EnemyState;
  private startMs: number;
  private next: EnemyState | null;

  constructor(initial: EnemyState = 'spawn', startMs = 0, then: EnemyState | null = 'idle') {
    this.state = initial;
    this.startMs = startMs;
    this.next = then;
  }

  /** Start `state` at `nowMs`; when it finishes (one-shots only), auto-advance to `then` if given. */
  play(state: EnemyState, nowMs: number, then: EnemyState | null = null): void {
    this.state = state;
    this.startMs = nowMs;
    this.next = then;
  }

  current(): EnemyState {
    return this.state;
  }

  /** The frame to draw at `nowMs`, advancing to the queued follow-up if the current one-shot ended. */
  frameAt(nowMs: number): EnemyFrame {
    let elapsed = nowMs - this.startMs;
    if (this.next !== null && isComplete(this.state, elapsed)) {
      this.state = this.next;
      this.next = null;
      this.startMs = nowMs;
      elapsed = 0;
    }
    return { state: this.state, uv: frameUV(this.state, elapsed) };
  }

  /** Reduced-motion still for the current state (no time advance, no follow-up). */
  staticFrame(): EnemyFrame {
    return { state: this.state, uv: staticFrameUV(this.state) };
  }

  /** True once a terminal one-shot (no queued follow-up) has finished - the sprite can be retired. */
  isFinished(nowMs: number): boolean {
    return this.next === null && !ANIMATIONS[this.state].loop && isComplete(this.state, nowMs - this.startMs);
  }
}
