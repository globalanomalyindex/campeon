import { describe, it, expect } from 'vitest';
import { initRange, onKill, dueSpawns, bindSpawn, DEFAULT_RESPAWN_MS, type RangeSlot } from '../../src/ui/range-director';

const SLOTS: RangeSlot[] = [
  { kind: 'fixed', placement: { yaw: -12, pitch: 0, distance: 8, worldRadius: 0.6 } },
  { kind: 'roam' },
];

describe('range director', () => {
  it('requests a spawn for every slot at start, then not again once bound', () => {
    const s = initRange(SLOTS);
    const first = dueSpawns(s, 0);
    expect(first.map((r) => r.slotIndex).sort()).toEqual([0, 1]);
    expect(first[0]!.kind).toBe('fixed');
    expect(first[0]!.placement).toEqual(SLOTS[0]!.placement);
    expect(first[1]!.kind).toBe('roam');
    first.forEach((r, i) => bindSpawn(s, r.slotIndex, `t${i}`));
    expect(dueSpawns(s, 16)).toEqual([]);
  });

  it('a kill retires the slot and schedules a respawn after the delay', () => {
    const s = initRange(SLOTS);
    dueSpawns(s, 0).forEach((r) => bindSpawn(s, r.slotIndex, `id${r.slotIndex}`));
    const slot = onKill(s, 'id1', 1000);
    expect(slot).toBe(1);
    expect(dueSpawns(s, 1000 + DEFAULT_RESPAWN_MS - 1)).toEqual([]);
    const due = dueSpawns(s, 1000 + DEFAULT_RESPAWN_MS);
    expect(due.map((r) => r.slotIndex)).toEqual([1]);
    expect(due[0]!.kind).toBe('roam');
  });

  it('onKill with an unknown id is a no-op returning -1', () => {
    const s = initRange(SLOTS);
    dueSpawns(s, 0).forEach((r) => bindSpawn(s, r.slotIndex, `id${r.slotIndex}`));
    expect(onKill(s, 'nope', 500)).toBe(-1);
    expect(dueSpawns(s, 100000)).toEqual([]);
  });

  it('does not request the same slot twice between due and bind', () => {
    const s = initRange(SLOTS);
    expect(dueSpawns(s, 0).length).toBe(2);
    expect(dueSpawns(s, 0)).toEqual([]);
  });
});
