import { describe, it, expect } from 'vitest';
import { ReachObserver, PRIMARY_TROUGH_DROP } from '../../src/anchor/reach-observer';
import { TrialRecorder } from '../../src/instruments/recording';
import { counts360 } from '../../src/types';
import type { TargetHandle } from '../../src/types';
import { FakeScene } from '../instruments/fake-scene';

/**
 * The anchor's arithmetic, stated once: the arena rendered C_r counts per 360 and the player emits
 * counts from a belief of C_0, so a reach intended to cover D degrees emits D * C_0 / 360 counts and
 * therefore lands D * C_0 / C_r degrees along. The fraction of the way it lands IS C_0 / C_r, and
 * landedFraction * rendered is C_0 with the rendered gain cancelling exactly.
 */

/** Per-frame share of the primary displacement. Sums to 1.00 at index 6, then corrects. */
const FRACTIONS = [0, 0.06, 0.26, 0.44, 0.18, 0.04, 0.02, 0.12, 0.05, 0.01] as const;

function driveReach(rendered: number, believed: number, intended: number, shares: readonly number[] = FRACTIONS) {
  const scene = new FakeScene();
  let handle: TargetHandle | null = null;
  const obs = new ReachObserver(scene, () => handle);
  obs.beginTrial(counts360(rendered), 1);
  handle = scene.spawnTarget({ kind: 'static', yaw: intended, pitch: 0, distance: 20, worldRadius: 0.6 });
  const primary = intended * (believed / rendered);
  let yaw = 0;
  for (const share of shares) {
    scene.tick(16, [yaw, 0]);
    yaw += share * primary;
  }
  handle = null;
  scene.tick(16, [yaw, 0]); // the target is gone, so the observer closes the reach
  obs.stop();
  return obs;
}

describe('ReachObserver', () => {
  it('reads the open-loop reach as the ratio of rendered gain to believed gain', () => {
    const slow = driveReach(6000, 9000, 30).observed();
    expect(slow).toHaveLength(1);
    expect(slow[0]!.landedFraction).toBeCloseTo(1.5, 6);
    expect(slow[0]!.index).toBe(0);
    expect(slow[0]!.leadIn).toBe(true);
    expect(slow[0]!.rendered).toBe(6000);

    const fast = driveReach(18000, 9000, 30).observed();
    expect(fast[0]!.landedFraction).toBeCloseTo(0.5, 6);

    // The rendered gain cancels: both reaches recover the same believed gain.
    expect(slow[0]!.landedFraction * slow[0]!.rendered).toBeCloseTo(9000, 3);
    expect(fast[0]!.landedFraction * fast[0]!.rendered).toBeCloseTo(9000, 3);
  });

  it('drops a reach whose primary orient never closed, rather than squeezing it toward 1', () => {
    // A monotone ramp has no trough, so the trace cannot say where the open-loop reach ended.
    // Taking the whole recorded motion as the primary would read a landedFraction near 1 and
    // therefore a C0 near the rendered gain: a fabricated agreement, which is strictly worse than
    // no observation, because the fit would take it as evidence.
    const obs = driveReach(6000, 9000, 30, [0, 0.05, 0.1, 0.2, 0.35, 0.55]);
    expect(obs.observed()).toHaveLength(0);
    expect(obs.reaches()).toHaveLength(0);
  });

  it('numbers reaches from the first lead-in reach and resets on a new trial', () => {
    const scene = new FakeScene();
    let handle: TargetHandle | null = null;
    const obs = new ReachObserver(scene, () => handle);
    const play = (rendered: number, believed: number, count: number): void => {
      obs.beginTrial(counts360(rendered), 2);
      for (let r = 0; r < count; r++) {
        const start = scene.view()[0];
        handle = scene.spawnTarget({ kind: 'static', yaw: start + 30, pitch: 0, distance: 20, worldRadius: 0.6 });
        let yaw = start;
        for (const share of FRACTIONS) {
          scene.tick(16, [yaw, 0]);
          yaw += share * 30 * (believed / rendered);
        }
        handle = null;
        scene.tick(16, [yaw, 0]);
      }
    };
    play(6000, 9000, 4);
    play(12000, 9000, 3);
    obs.stop();
    const seen = obs.observed();
    expect(seen.map((r) => r.index)).toEqual([0, 1, 2, 3, 0, 1, 2]);
    expect(seen.map((r) => r.leadIn)).toEqual([true, true, false, false, true, true, false]);
    expect(obs.discardedByScoring()).toBe(4);
    expect(new Set(seen.map((r) => r.rendered))).toEqual(new Set([6000, 12000]));
    for (const r of seen) expect(r.landedFraction * r.rendered).toBeCloseTo(9000, 3);
  });

  it('the scored recording is byte-identical with the anchor recorder attached', () => {
    // The integrity invariant: the anchor is an observer. It subscribes to the same frame stream
    // the scorer does and it never touches the Recording, so attaching it cannot change a score.
    // Byte-identical is asserted rather than "equal within tolerance" on purpose - a tolerance
    // would hide exactly the kind of shared-state leak this is here to catch.
    const run = (attach: boolean): string => {
      const scene = new FakeScene();
      let handle: TargetHandle | null = null;
      const rec = new TrialRecorder(scene, () => handle);
      const obs = attach ? new ReachObserver(scene, () => handle) : null;
      obs?.beginTrial(counts360(9000), 1);
      for (let r = 0; r < 3; r++) {
        handle = scene.spawnTarget({ kind: 'static', yaw: 20, pitch: 0, distance: 20, worldRadius: 0.6 });
        let yaw = 0;
        for (const share of FRACTIONS) {
          scene.tick(16, [yaw, 0]);
          yaw += share * 25;
        }
        scene.fire([yaw, 0]);
        handle = null;
        scene.tick(16, [yaw, 0]);
      }
      rec.stop();
      obs?.stop();
      return JSON.stringify(rec.recording());
    };
    expect(run(true)).toBe(run(false));
  });

  it('the trough drop it passes is the one the jitter test pins', () => {
    expect(PRIMARY_TROUGH_DROP).toBe(0.5);
  });
});
