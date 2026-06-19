import { describe, it, expect } from 'vitest';
import { EnemyController } from '../../../src/ui/enemy/controller';
import { ANIMATIONS, type EnemyState } from '../../../src/ui/enemy/atlas';

/** One-shot duration in ms, derived independently from the atlas frame count + fps. */
const durMs = (state: EnemyState): number => {
  const a = ANIMATIONS[state];
  return ((a.to - a.from + 1) / a.fps) * 1000;
};

describe('EnemyController - state machine', () => {
  it('starts on spawn and auto-advances to idle when spawn completes', () => {
    const c = new EnemyController('spawn', 0, 'idle');
    expect(c.current()).toBe('spawn');
    c.frameAt(1); // mid-spawn
    expect(c.current()).toBe('spawn');
    c.frameAt(durMs('spawn') + 16); // past the last spawn frame
    expect(c.current()).toBe('idle');
  });

  it('idle loops forever and never finishes', () => {
    const c = new EnemyController('idle', 0, null);
    expect(c.isFinished(1e6)).toBe(false);
    expect(c.frameAt(1e6).state).toBe('idle');
  });

  it('flinch returns to idle - a graze does not kill', () => {
    const c = new EnemyController('idle', 0, null);
    c.play('flinch', 100, 'idle');
    expect(c.current()).toBe('flinch');
    c.frameAt(100 + durMs('flinch') + 16);
    expect(c.current()).toBe('idle');
    expect(c.isFinished(1e7)).toBe(false);
  });

  it('death is terminal - isFinished true once it plays out, with no auto-advance', () => {
    const c = new EnemyController('idle', 0, null);
    c.play('death', 200, null);
    expect(c.isFinished(200)).toBe(false);
    expect(c.isFinished(200 + durMs('death') + 16)).toBe(true);
    c.frameAt(200 + durMs('death') + 16);
    expect(c.current()).toBe('death'); // never advances away from death
  });

  it('escape is terminal too', () => {
    const c = new EnemyController('idle', 0, null);
    c.play('escape', 0, null);
    expect(c.isFinished(durMs('escape') + 16)).toBe(true);
  });

  // P3-4: escape (a live quarry cleared WITHOUT a kill) is reached ONLY by an explicit lifecycle
  // play() - it is never an auto-advance follow-up of any other state, and the controller takes no
  // instrument/TTK/score input that could trigger it. This pins HARD INVARIANT 2: death/escape come
  // strictly from the lifecycle (clear/remove) + classifyHit, never from an instrument-derived signal.
  it('never auto-advances to escape from spawn/idle/flinch (escape comes only from an explicit play)', () => {
    // spawn → idle (its only follow-up), idle loops, flinch → idle. None ever lands on escape.
    const spawn = new EnemyController('spawn', 0, 'idle');
    expect(spawn.frameAt(1e6).state).toBe('idle');
    expect(spawn.frameAt(2e6).state).not.toBe('escape');

    const idle = new EnemyController('idle', 0, null);
    expect(idle.frameAt(1e6).state).toBe('idle');

    const flinch = new EnemyController('idle', 0, null);
    flinch.play('flinch', 0, 'idle');
    expect(flinch.frameAt(durMs('flinch') + 32).state).toBe('idle');
    expect(flinch.frameAt(1e6).state).not.toBe('escape');
  });

  it('the controller exposes no instrument/score/TTK input - state changes only via play()/frameAt()', () => {
    const c = new EnemyController('idle', 0, null) as unknown as Record<string, unknown>;
    for (const banned of ['ttk', 'score', 'observation', 'sample', 'instrument', 'view', 'bearing']) {
      expect(c[banned], `controller must expose no ${banned} input`).toBeUndefined();
    }
  });

  it('staticFrame gives a still for the current state without advancing (reduced motion)', () => {
    const c = new EnemyController('idle', 0, null);
    expect(c.staticFrame().state).toBe('idle');
    expect(c.current()).toBe('idle'); // staticFrame never mutates state
  });
});
