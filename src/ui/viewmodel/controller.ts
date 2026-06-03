import { type AnimName, frameRect, isComplete, type Rect } from './atlas';

export interface ViewmodelFrame {
  name: AnimName;
  rect: Rect;
}

/**
 * Pure animation state machine for the viewmodel. Tracks the current animation and its start time and
 * auto-advances a one-shot to its queued follow-up the moment it completes (e.g. flickDraw → idleReady,
 * fire → idleReady). No DOM — the canvas shell calls `frameAt(now)` each rAF tick and blits the rect.
 */
export class ViewmodelController {
  private anim: AnimName;
  private startMs: number;
  private next: AnimName | null = null;

  constructor(initial: AnimName = 'idleReady', startMs = 0) {
    this.anim = initial;
    this.startMs = startMs;
  }

  /** Start `name` at `nowMs`; when it finishes (one-shots only), auto-advance to `then` if given. */
  play(name: AnimName, nowMs: number, then: AnimName | null = null): void {
    this.anim = name;
    this.startMs = nowMs;
    this.next = then;
  }

  current(): AnimName {
    return this.anim;
  }

  /** The frame to draw at `nowMs`, advancing to the queued follow-up if the current one-shot ended. */
  frameAt(nowMs: number): ViewmodelFrame {
    let elapsed = nowMs - this.startMs;
    if (this.next !== null && isComplete(this.anim, elapsed)) {
      this.anim = this.next;
      this.next = null;
      this.startMs = nowMs;
      elapsed = 0;
    }
    return { name: this.anim, rect: frameRect(this.anim, elapsed) };
  }
}
