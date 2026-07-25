import { describe, it, expect } from 'vitest';
import { Arena, MAX_FRAME_MS, type InputSource, type RendererLike } from '../../src/engine/arena';
import { TrialRecorder, type Recording } from '../../src/instruments/recording';
import { separation } from '../../src/engine/targets';
import { mulberry32 } from '../../src/stats/bootstrap';
import type { AimSample, TargetSpec } from '../../src/types';

function harness(seed = 1) {
  let emit: (s: AimSample) => void = () => {};
  let pull: () => void = () => {};
  const input: InputSource = {
    onSample(cb) {
      emit = cb;
      return () => {};
    },
    onFire(cb) {
      pull = cb;
      return () => {};
    },
  };
  const renderer: RendererLike = { render() {}, setSize() {}, dispose() {} };
  const arena = new Arena({
    renderer, input, size: () => [1600, 900], cm360: 34, dpi: 800, rng: mulberry32(seed),
  });
  return { arena, send: (s: AimSample) => emit(s), fire: () => pull() };
}

const MOVING: TargetSpec = {
  kind: 'moving',
  yaw: 6,
  pitch: 1,
  distance: 18,
  worldRadius: 0.6,
  motion: { yawAmp: 12, pitchAmp: 4, baseFreq: 0.5, seed: 3 },
};

// ── the clock cannot be handed a frame that never happened ────────────────
//
// arena.tick accumulated raw rAF deltas with no ceiling. Background the tab mid-trial and the
// first frame back carries however long the tab slept, which lands INSIDE an in-flight trial as
// one enormous frame: the instrument's elapsed accumulator jumps, the target teleports along its
// path, and the recorded stream claims the player was shown all of it.

describe('the arena clock credits only physically possible frames', () => {
  it('one slept-tab delta advances the clock by at most one frame', () => {
    const h = harness();
    h.arena.tick(20_000); // the tab slept 20 s and rAF handed us the whole gap
    expect(h.arena.now()).toBeLessThanOrEqual(MAX_FRAME_MS);
  });

  it('subscribers are handed the credited dt, so a trial cannot be fast-forwarded to its deadline', () => {
    // An instrument ends its trial on `elapsed >= DURATION_MS` accumulated from these deltas, so the
    // property that matters is that N frames can never credit more than N possible frames of time.
    const h = harness();
    let elapsed = 0;
    let frames = 0;
    h.arena.onFrame((dt) => {
      elapsed += dt;
      frames += 1;
    });
    for (let i = 0; i < 5; i++) h.arena.tick(16);
    h.arena.tick(30_000); // a 30 s sleep in the middle of a 6 s trial
    for (let i = 0; i < 5; i++) h.arena.tick(16);
    expect(frames).toBe(11);
    expect(elapsed).toBeLessThanOrEqual(11 * MAX_FRAME_MS);
    expect(elapsed).toBeCloseTo(h.arena.now(), 9); // the clock and the trial agree
  });

  it('a slept frame moves the target exactly as far as a real long frame, never further', () => {
    // The target's path is a function of the arena clock, so an uncapped delta teleports it. Both
    // arenas are handed the same script; only the raw delta differs.
    const slept = harness(4);
    const real = harness(4);
    const a = slept.arena.spawnTarget(MOVING);
    const b = real.arena.spawnTarget(MOVING);
    slept.arena.tick(9_000);
    real.arena.tick(MAX_FRAME_MS);
    expect(separation(a.bearing(), b.bearing())).toBeCloseTo(0, 9);
  });

  it('a non-advancing delta (zero, negative, NaN) never poisons the clock', () => {
    const h = harness();
    h.arena.tick(16);
    h.arena.tick(Number.NaN);
    h.arena.tick(-500);
    h.arena.tick(0);
    expect(h.arena.now()).toBe(16);
  });
});

// ── time and input are credited only while the player is present ──────────
//
// Losing pointer lock did not stop the arena: a track trial ran its full six seconds with nobody
// aiming and was then scored at full weight. The honest handling is that the trial clock is a
// PRESENCE clock. Nothing that happens while the player is demonstrably not playing reaches the
// scored stream, and the trial resumes from exactly where it was left.

/** The scored stream of one scripted trial, optionally interrupted by an absence in the middle. */
function scriptedTrial(withAbsence: boolean): Recording {
  const h = harness(7);
  const handle = h.arena.spawnTarget(MOVING);
  const rec = new TrialRecorder(h.arena, () => handle);

  h.arena.tick(16);
  h.send({ t: 4, dx: 120, dy: -30 });
  h.arena.tick(16);
  h.fire();
  h.send({ t: 8, dx: -40, dy: 18 });

  if (withAbsence) {
    // The cursor is handed back mid-trial: 5 s of frames, stray cursor motion over the paused
    // scrim, and a click on the resume button all arrive while the player is not aiming.
    h.arena.setPresent(false);
    for (let i = 0; i < 300; i++) h.arena.tick(16);
    h.send({ t: 500, dx: 4000, dy: 2500 });
    h.fire();
    h.arena.tick(16);
    h.arena.setPresent(true);
  }

  h.arena.tick(16);
  h.send({ t: 12, dx: 75, dy: 60 });
  h.arena.tick(16);
  h.fire();
  rec.stop();
  return structuredClone(rec.recording());
}

describe('VALIDITY GATE: the scored stream is a function of the frames the player was present for', () => {
  it('an absence mid-trial leaves the recorded stream byte-identical', () => {
    const interrupted = scriptedTrial(true);
    const clean = scriptedTrial(false);
    expect(interrupted).toEqual(clean);
    // Sanity: the script actually exercised the stream (an empty deepEqual would pass vacuously).
    expect(clean.frames.length).toBeGreaterThan(0);
    expect(clean.fires.length).toBeGreaterThan(0);
  });

  it('while absent the clock is frozen and no frame is delivered', () => {
    const h = harness();
    let frames = 0;
    h.arena.onFrame(() => (frames += 1));
    h.arena.setPresent(false);
    for (let i = 0; i < 400; i++) h.arena.tick(16); // 6.4 s, a whole track trial
    expect(frames).toBe(0);
    expect(h.arena.now()).toBe(0);
  });

  it('an absent player cannot move the view, and the aim resumes from where it was left', () => {
    const h = harness();
    h.send({ t: 0, dx: 300, dy: 0 });
    const parked = h.arena.view();
    h.arena.setPresent(false);
    h.send({ t: 1, dx: 9000, dy: -9000 }); // cursor swinging across the paused scrim
    expect(h.arena.view()).toEqual(parked);
    h.arena.setPresent(true);
    h.send({ t: 2, dx: 300, dy: 0 });
    expect(h.arena.view()[0]).toBeCloseTo(2 * parked[0], 9);
  });

  it('a shot fired while absent is never recorded', () => {
    const h = harness();
    const fires: number[] = [];
    h.arena.onFire((now) => fires.push(now));
    h.arena.setPresent(false);
    h.fire();
    h.arena.setPresent(true);
    h.fire();
    expect(fires).toHaveLength(1);
  });
});
