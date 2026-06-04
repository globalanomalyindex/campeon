import { describe, it, expect } from 'vitest';
import { EnemyController } from '../../../src/ui/enemy/controller';
import { ANIMATIONS, type EnemyState } from '../../../src/ui/enemy/atlas';

/** One-shot duration in ms, derived independently from the atlas frame count + fps. */
const durMs = (state: EnemyState): number => {
  const a = ANIMATIONS[state];
  return ((a.to - a.from + 1) / a.fps) * 1000;
};

describe('EnemyController — state machine', () => {
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

  it('flinch returns to idle — a graze does not kill', () => {
    const c = new EnemyController('idle', 0, null);
    c.play('flinch', 100, 'idle');
    expect(c.current()).toBe('flinch');
    c.frameAt(100 + durMs('flinch') + 16);
    expect(c.current()).toBe('idle');
    expect(c.isFinished(1e7)).toBe(false);
  });

  it('death is terminal — isFinished true once it plays out, with no auto-advance', () => {
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

  it('staticFrame gives a still for the current state without advancing (reduced motion)', () => {
    const c = new EnemyController('idle', 0, null);
    expect(c.staticFrame().state).toBe('idle');
    expect(c.current()).toBe('idle'); // staticFrame never mutates state
  });
});
