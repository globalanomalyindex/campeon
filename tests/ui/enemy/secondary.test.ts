import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import {
  secondaryOffset,
  applySecondary,
  SECONDARY_MAX_POS,
  SECONDARY_MAX_ROT,
} from '../../../src/ui/enemy/secondary';
import { quarryMesh, WEAKSPOT_NAME, partRest } from '../../../src/ui/enemy/meshes';
import type { InstrumentId } from '../../../src/types';

const ALL: InstrumentId[] = ['track', 'flick', 'calibrate', 'strike'];

/** Named moving parts per id, mirroring meshes.ts (legs/feet deliberately excluded). */
const NAMED_PARTS: Record<InstrumentId, string[]> = {
  track: ['part-wing-l', 'part-wing-r', 'part-tail', 'part-body'],
  flick: ['part-hood', 'part-neck', 'part-fang', 'part-coil'],
  calibrate: ['part-head', 'part-ridge', 'part-back'],
  strike: ['part-plate', 'part-shoulder-l', 'part-shoulder-r', 'part-core'],
};

const T_STEPS = 60;
const T_MAX = 10;

describe('secondaryOffset - boundedness', () => {
  it('every offset component stays within the hard bounds over a 10s sweep', () => {
    for (const id of ALL) {
      for (const partName of NAMED_PARTS[id]) {
        for (let i = 0; i <= T_STEPS; i++) {
          const tSec = (i / T_STEPS) * T_MAX;
          const off = secondaryOffset(id, partName, tSec, 0);
          for (const p of off.pos) {
            expect(Math.abs(p), `${id}.${partName} pos @ t=${tSec}`).toBeLessThanOrEqual(SECONDARY_MAX_POS);
          }
          for (const r of off.rot) {
            expect(Math.abs(r), `${id}.${partName} rot @ t=${tSec}`).toBeLessThanOrEqual(SECONDARY_MAX_ROT);
          }
        }
      }
    }
  });
});

describe('secondaryOffset - determinism', () => {
  it('the same args always give the identical offset', () => {
    for (const id of ALL) {
      for (const partName of NAMED_PARTS[id]) {
        const a = secondaryOffset(id, partName, 3.14, 1.2);
        const b = secondaryOffset(id, partName, 3.14, 1.2);
        expect(b).toEqual(a);
      }
    }
  });
});

describe('secondaryOffset - phase decorrelates', () => {
  it('offsets at phase 0 vs phase 2 differ for a moving part', () => {
    // track wings are always moving (non-zero amplitude at any t away from a node), pick a t
    // that is not a shared zero-crossing for both phases.
    const a = secondaryOffset('track', 'part-wing-l', 1.0, 0);
    const b = secondaryOffset('track', 'part-wing-l', 1.0, 2);
    expect(a).not.toEqual(b);
  });

  it('holds for at least one part in every instrument that has motion', () => {
    const movingPartByI: Record<InstrumentId, string> = {
      track: 'part-tail',
      flick: 'part-hood',
      calibrate: 'part-head',
      strike: 'part-plate',
    };
    for (const id of ALL) {
      const partName = movingPartByI[id];
      const a = secondaryOffset(id, partName, 1.7, 0);
      const b = secondaryOffset(id, partName, 1.7, 2);
      expect(a, `${id}.${partName} phase 0 vs 2`).not.toEqual(b);
    }
  });
});

describe('secondaryOffset - unknown part', () => {
  it('returns zero offset for an unknown/unnamed part name', () => {
    for (const id of ALL) {
      const off = secondaryOffset(id, 'not-a-real-part', 5, 1);
      expect(off).toEqual({ pos: [0, 0, 0], rot: [0, 0, 0] });
    }
  });

  it('legs/feet (deliberately unnamed) are not part of the named-part motion set', () => {
    // calibrate legs and strike feet carry no name at all in meshes.ts, so any lookup by an
    // empty-string name (what an unnamed Object3D.name resolves to) must be zero too.
    expect(secondaryOffset('calibrate', '', 5, 1)).toEqual({ pos: [0, 0, 0], rot: [0, 0, 0] });
    expect(secondaryOffset('strike', '', 5, 1)).toEqual({ pos: [0, 0, 0], rot: [0, 0, 0] });
  });
});

describe('applySecondary - idempotence + no drift', () => {
  it('applying twice at the same t gives the same pose as applying once', () => {
    for (const id of ALL) {
      const g = quarryMesh(id);
      applySecondary(g, id, 2.5, 0.4);
      const once = new Map<string, { p: Vector3; r: [number, number, number] }>();
      g.traverse((o) => {
        if (!partRest(o)) return;
        once.set(o.uuid, { p: o.position.clone(), r: [o.rotation.x, o.rotation.y, o.rotation.z] });
      });
      applySecondary(g, id, 2.5, 0.4);
      g.traverse((o) => {
        if (!partRest(o)) return;
        const before = once.get(o.uuid)!;
        expect(o.position.x).toBeCloseTo(before.p.x, 12);
        expect(o.position.y).toBeCloseTo(before.p.y, 12);
        expect(o.position.z).toBeCloseTo(before.p.z, 12);
        expect(o.rotation.x).toBeCloseTo(before.r[0], 12);
        expect(o.rotation.y).toBeCloseTo(before.r[1], 12);
        expect(o.rotation.z).toBeCloseTo(before.r[2], 12);
      });
    }
  });

  it('applying at t then a different t starts from rest, not from the previous pose', () => {
    for (const id of ALL) {
      const g = quarryMesh(id);
      // Capture rest transforms up front.
      const rests = new Map<string, { px: number; py: number; pz: number; rx: number; ry: number; rz: number }>();
      g.traverse((o) => {
        const rest = partRest(o);
        if (rest) rests.set(o.uuid, rest);
      });

      applySecondary(g, id, 2.5, 0.4);
      applySecondary(g, id, 7.9, 0.4); // a different t

      g.traverse((o) => {
        const rest = rests.get(o.uuid);
        if (!rest) return;
        const off = secondaryOffset(id, o.name, 7.9, 0.4);
        expect(o.position.x).toBeCloseTo(rest.px + off.pos[0], 12);
        expect(o.position.y).toBeCloseTo(rest.py + off.pos[1], 12);
        expect(o.position.z).toBeCloseTo(rest.pz + off.pos[2], 12);
        expect(o.rotation.x).toBeCloseTo(rest.rx + off.rot[0], 12);
        expect(o.rotation.y).toBeCloseTo(rest.ry + off.rot[1], 12);
        expect(o.rotation.z).toBeCloseTo(rest.rz + off.rot[2], 12);
      });
    }
  });
});

describe('applySecondary - the weak-spot and group origin never move', () => {
  it('weak-spot world position stays (0,0,0) for all ids and several t', () => {
    const ts = [0, 1.1, 2.5, 5.0, 7.9, 10];
    for (const id of ALL) {
      const g = quarryMesh(id);
      for (const tSec of ts) {
        applySecondary(g, id, tSec, 0.6);
        const ws = g.getObjectByName(WEAKSPOT_NAME)!;
        const p = new Vector3();
        ws.getWorldPosition(p);
        expect(p.x).toBe(0);
        expect(p.y).toBe(0);
        expect(p.z).toBe(0);
        // The group itself never moves either - the layer alone controls its world placement.
        expect(g.position.x).toBe(0);
        expect(g.position.y).toBe(0);
        expect(g.position.z).toBe(0);
      }
    }
  });
});
