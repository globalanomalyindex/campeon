import type { Degrees, Ms } from '../types';

export interface SlotPlacement { yaw: Degrees; pitch: Degrees; distance: number; worldRadius: number; }
export interface RangeSlot { kind: 'fixed' | 'roam'; placement?: SlotPlacement; }

interface SlotState {
  slot: RangeSlot;
  liveId: string | null; // arena target id occupying this slot, or null when empty/pending
  respawnAt: Ms | null; // when an empty slot should (re)spawn; null once claimed by dueSpawns
}
export interface RangeState { slots: SlotState[]; respawnDelayMs: Ms; }

export const DEFAULT_RESPAWN_MS = 600;

/** Initial state: every slot empty + due at t=0, so the first `dueSpawns` populates the range. */
export function initRange(slots: RangeSlot[], respawnDelayMs: Ms = DEFAULT_RESPAWN_MS): RangeState {
  return { slots: slots.map((slot) => ({ slot, liveId: null, respawnAt: 0 })), respawnDelayMs };
}

/** A kill of `targetId` empties its slot and schedules a respawn `respawnDelayMs` later. Returns the slot
 *  index, or -1 if the id isn't one of ours. Mutates state. */
export function onKill(state: RangeState, targetId: string, nowMs: Ms): number {
  const i = state.slots.findIndex((s) => s.liveId === targetId);
  if (i < 0) return -1;
  state.slots[i]!.liveId = null;
  state.slots[i]!.respawnAt = nowMs + state.respawnDelayMs;
  return i;
}

export interface SpawnRequest { slotIndex: number; kind: 'fixed' | 'roam'; placement?: SlotPlacement; }

/** Slots whose respawn time has arrived → spawn requests. Marks each claimed (respawnAt=null) so it isn't
 *  requested again before `bindSpawn` records the new target id. Mutates state. */
export function dueSpawns(state: RangeState, nowMs: Ms): SpawnRequest[] {
  const out: SpawnRequest[] = [];
  state.slots.forEach((s, slotIndex) => {
    if (s.liveId === null && s.respawnAt !== null && nowMs >= s.respawnAt) {
      s.respawnAt = null; // claimed; bindSpawn will set liveId
      out.push(s.slot.placement ? { slotIndex, kind: s.slot.kind, placement: s.slot.placement } : { slotIndex, kind: s.slot.kind });
    }
  });
  return out;
}

/** Record the arena target id that fulfilled a slot's spawn request. */
export function bindSpawn(state: RangeState, slotIndex: number, targetId: string): void {
  state.slots[slotIndex]!.liveId = targetId;
}
