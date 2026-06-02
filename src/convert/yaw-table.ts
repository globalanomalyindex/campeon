import type { GameId, YawEntry } from '../types';

/** Community-derived effective yaw constants (mouse-sensitivity.com / Voltaic). Overridable in options. */
export const GAME_YAW: YawEntry[] = [
  { id: 'cs2',      label: 'CS2 / CS:GO',              yaw: 0.022,    note: 'Source standard' },
  { id: 'apex',     label: 'Apex Legends',             yaw: 0.022,    note: '1:1 with CS2; ADS per-zoom multiplier' },
  { id: 'valorant', label: 'Valorant',                 yaw: 0.07,     note: 'effective (0.0066 × ~10.6 scale)' },
  { id: 'ow2',      label: 'Overwatch 2',              yaw: 0.0066,   note: 'ADS relative/legacy toggles' },
  { id: 'cod',      label: 'Call of Duty (MW/WZ/BO6)', yaw: 0.0066,   note: '1:1 with OW2; mouse smoothing off' },
  { id: 'fortnite', label: 'Fortnite',                 yaw: 0.005555, note: 'slider is ×100 (a "7" = 0.07)' },
  { id: 'r6',       label: 'Rainbow Six Siege',        yaw: 0.00573,  note: 'FOV literally changes cm/360' },
  { id: 'pubg',     label: 'PUBG',                     yaw: 0.002222, note: 'hipfire / General only' },
];

const BY_ID = new Map<GameId, YawEntry>(GAME_YAW.map(e => [e.id, e]));

export function yawFor(id: GameId): number {
  const entry = BY_ID.get(id);
  if (!entry) throw new Error(`Unknown game: ${id}`);
  return entry.yaw;
}
