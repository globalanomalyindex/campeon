import { describe, it, expect } from 'vitest';
import { restRecoil, punch, stepRecoil, DEFAULT_RECOIL, type RecoilState } from '../../../src/ui/viewmodel/recoil';

const mag = (s: RecoilState): number => Math.max(Math.abs(s.y), Math.abs(s.back));

describe('fire recoil spring', () => {
  it('stays exactly at rest with no fire', () => {
    let s = restRecoil();
    for (let i = 0; i < 40; i++) s = stepRecoil(s, 1 / 60);
    expect(s).toEqual(restRecoil());
  });

  it('a punch injects upward + backward velocity', () => {
    const s = punch(restRecoil());
    expect(s.vy).toBeGreaterThan(0);
    expect(s.vback).toBeGreaterThan(0);
    expect(mag(s)).toBe(0); // impulse is in velocity; offset only grows once stepped
  });

  it('kicks then settles back to rest (bounded, finite)', () => {
    let s = punch(restRecoil());
    let peak = 0;
    for (let i = 0; i < 60; i++) {
      s = stepRecoil(s, 1 / 60);
      peak = Math.max(peak, mag(s));
      expect(Number.isFinite(s.y) && Number.isFinite(s.back)).toBe(true);
      expect(mag(s)).toBeLessThanOrEqual(DEFAULT_RECOIL.max + 1e-9);
    }
    expect(peak).toBeGreaterThan(0);
    expect(mag(s)).toBeLessThan(1e-2);
  });

  it('clamps under rapid repeated fire', () => {
    let s = restRecoil();
    for (let i = 0; i < 30; i++) {
      s = punch(s);
      s = stepRecoil(s, 1 / 60);
      expect(Math.abs(s.y)).toBeLessThanOrEqual(DEFAULT_RECOIL.max + 1e-9);
      expect(Math.abs(s.back)).toBeLessThanOrEqual(DEFAULT_RECOIL.max + 1e-9);
    }
  });
});
