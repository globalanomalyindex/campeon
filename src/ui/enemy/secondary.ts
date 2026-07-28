import type { Group, Object3D } from 'three';
import type { InstrumentId } from '../../types';
import { partRest } from './meshes';

/**
 * PURE per-part secondary-motion module for the cosmetic quarry.
 *
 * This is a cosmetic-only READ of the quarry's rest pose: it never reads view()/bearing()/
 * radiusDeg()/counts(), never writes a sample/score/Observation, and never touches the scored
 * stream in any way. It is a pure function of (id, partName, tSec, phase) plus a pose-application
 * helper that writes ONLY position/rotation on already-built cosmetic Object3Ds - it never creates
 * geometry, never mutates userData.rest, and never reads/writes anything outside the quarry group.
 *
 * Every oscillator is a bounded sinusoid inside `SECONDARY_MAX_POS` / `SECONDARY_MAX_ROT`, giving
 * each strategy its idle CHARACTER (darting / coiled-still / bench-rest / heavy-armor) without ever
 * touching the target's actual angular position - purely cosmetic idle motion layered on top of the
 * pose the enemy-layer already computed.
 */

/** A part's per-frame cosmetic offset from its rest transform, in the group's unit space. */
export interface PartOffset {
  pos: [number, number, number];
  rot: [number, number, number];
}

/** Hard bound on any position offset component (unit-space metres). */
export const SECONDARY_MAX_POS = 0.05;
/** Hard bound on any rotation offset component (radians). */
export const SECONDARY_MAX_ROT = 0.35;

const TAU = Math.PI * 2;

const ZERO_OFFSET: PartOffset = { pos: [0, 0, 0], rot: [0, 0, 0] };

/** A single bounded sinusoid: amplitude * sin(2*pi*hz*t + phase-shifted offset). */
function osc(hz: number, amplitude: number, tSec: number, phase: number, phaseShift: number): number {
  return amplitude * Math.sin(TAU * hz * tSec + phase + phaseShift);
}

/**
 * Pure bounded-sinusoid offset for a named part of instrument `id` at time `tSec` and `phase`
 * (a per-instance phase shift so coexisting quarry never move in lockstep). Unknown part names -
 * including unnamed/legs/feet parts that deliberately have no secondary motion - return zero.
 */
export function secondaryOffset(id: InstrumentId, partName: string, tSec: number, phase: number): PartOffset {
  switch (id) {
    case 'track': {
      // Darting, quick + light: wings flap antiphase, tail waggles, body rolls lightly.
      switch (partName) {
        case 'part-wing-l':
          return { pos: [0, 0, 0], rot: [0, 0, osc(2.2, 0.28, tSec, phase, 0)] };
        case 'part-wing-r':
          // Antiphase to the left wing (+ pi shift), same amplitude/frequency.
          return { pos: [0, 0, 0], rot: [0, 0, osc(2.2, 0.28, tSec, phase, Math.PI)] };
        case 'part-tail':
          return { pos: [0, 0, 0], rot: [0, osc(3, 0.12, tSec, phase, 0.7), 0] };
        case 'part-body':
          return { pos: [0, 0, 0], rot: [osc(2.2, 0.04, tSec, phase, 1.3), 0, 0] };
        default:
          return ZERO_OFFSET;
      }
    }
    case 'flick': {
      // Coiled ambush, tense stillness: hood/neck sway + share a fast micro-tremor. Fang/coil still.
      switch (partName) {
        case 'part-hood':
          return {
            pos: [0, 0, 0],
            rot: [0, 0, osc(0.5, 0.08, tSec, phase, 0) + osc(4, 0.015, tSec, phase, 2.1)],
          };
        case 'part-neck':
          return {
            pos: [0, 0, 0],
            rot: [0, 0, osc(0.5, 0.08, tSec, phase, 0) + osc(4, 0.015, tSec, phase, 2.1)],
          };
        case 'part-fang':
        case 'part-coil':
          return ZERO_OFFSET;
        default:
          return ZERO_OFFSET;
      }
    }
    case 'calibrate': {
      // Bench-rest, steady: head scans slowly, ridge breathes. Back (and legs) stay still.
      switch (partName) {
        case 'part-head':
          return { pos: [0, 0, 0], rot: [0, osc(0.18, 0.1, tSec, phase, 0), 0] };
        case 'part-ridge':
          return { pos: [0, osc(0.35, 0.008, tSec, phase, 0.5), 0], rot: [0, 0, 0] };
        case 'part-back':
          return ZERO_OFFSET;
        default:
          return ZERO_OFFSET;
      }
    }
    case 'strike': {
      // Heavy armor, ponderous: plate heaves, shoulders counter-roll opposite signs. Core still.
      switch (partName) {
        case 'part-plate':
          return { pos: [0, osc(0.4, 0.012, tSec, phase, 0), 0], rot: [0, 0, 0] };
        case 'part-shoulder-l':
          return { pos: [0, 0, 0], rot: [osc(0.4, 0.06, tSec, phase, 0), 0, 0] };
        case 'part-shoulder-r':
          // Counter-roll: opposite sign to the left shoulder (+ pi shift).
          return { pos: [0, 0, 0], rot: [osc(0.4, 0.06, tSec, phase, Math.PI), 0, 0] };
        case 'part-core':
          return ZERO_OFFSET;
        default:
          return ZERO_OFFSET;
      }
    }
    default:
      return ZERO_OFFSET;
  }
}

/**
 * Apply secondary motion to every named part of `group` at time `tSec` with per-instance `phase`.
 * IDEMPOTENT: for every child carrying a captured `userData.rest`, this always sets
 * position/rotation = rest + offset(t) - it never reads the current (possibly already-offset)
 * transform, so repeated calls at the same `tSec` are stable and calling it at a new `tSec` always
 * starts back from rest (no drift, no accumulation). Children with no rest (the weak-spot, the
 * group itself, deliberately-unnamed legs/feet) are left untouched.
 */
export function applySecondary(group: Group, id: InstrumentId, tSec: number, phase: number): void {
  group.traverse((o: Object3D) => {
    const rest = partRest(o);
    if (!rest) return;
    const offset = secondaryOffset(id, o.name, tSec, phase);
    o.position.set(rest.px + offset.pos[0], rest.py + offset.pos[1], rest.pz + offset.pos[2]);
    o.rotation.set(rest.rx + offset.rot[0], rest.ry + offset.rot[1], rest.rz + offset.rot[2]);
  });
}
