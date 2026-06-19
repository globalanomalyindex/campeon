import {
  BoxGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
} from 'three';
import { hex } from '../../palette';
import type { InstrumentId } from '../../types';

/**
 * PURE procedural-geometry factory for the cosmetic "quarry" that skins each arena target.
 *
 * It builds a `THREE.Group` of low-poly primitives per `InstrumentId` - an ABSTRACT designed-quarry
 * silhouette evoking the strategy of the organism each evolution-tuned probe is modeled on:
 *   - track     → a slender airborne DARTING form (swept body + thin wings)
 *   - flick     → a coiled AMBUSH form, poised-to-snap (drawn-back hood over a low coil)
 *   - calibrate → a low, steady BENCH-REST form (broad planted stance, level back)
 *   - strike    → a heavy ARMORED form (blocky plated mass, low center)
 *
 * Every group is centered on its EMISSIVE weak-spot at LOCAL ORIGIN (0,0,0), coincident with the
 * hidden gold sphere center the instruments score against. The layer pins the group at the sphere
 * position and scales it uniformly, so the weak-spot lands exactly on the angular hitbox center.
 *
 * Materials are shared `MeshStandardMaterial`s tuned from `src/palette.ts` hex ONLY (no hardcoded
 * color). This module has NO scored API: it never reads view()/bearing()/radiusDeg() and never
 * writes a sample/score/Observation. It is pure THREE - safe to unit-test without a WebGL context.
 */

/** Name of the emissive weak-spot child, so the layer/tests can find + tween it. */
export const WEAKSPOT_NAME = 'quarry-weakspot';

/** Name of a pooled dust-puff group (the kick-up that punctuates a clean kill). */
export const DUST_NAME = 'quarry-dust';

/** Quarry height = K × the hitbox diameter, so the visible quarry ≈ the hittable disc. */
export const ENEMY_SIZE_K = 1.7;
/** Floor on quarry height (metres) so tiny-width targets stay visible. */
export const MIN_ENEMY_HEIGHT = 0.6;

/** Branded group so call sites / tests can name the cosmetic quarry without a structural type. */
export type QuarryMesh = Group;

/**
 * World height for a quarry at angular `radiusDeg`, `dist` metres away - the SAME formula the sprite
 * billboard used: height = K × the hitbox diameter, floored at MIN. The layer scales the unit-tall
 * group by this. `dist` of 0 falls back to 20 (mirrors `object.position.length() || 20`).
 */
export function quarryWorldHeight(dist: number, radiusDeg: number): number {
  const d = dist || 20;
  const worldRadius = d * Math.tan((radiusDeg * Math.PI) / 180);
  return Math.max(MIN_ENEMY_HEIGHT, ENEMY_SIZE_K * 2 * worldRadius);
}

// ── Palette materials (one SET per layer instance, shared across that layer's spawns) ─────────
// MeshStandardMaterial color/emissive come ONLY from palette.ts hex. Flat-ish low-poly read:
// low metalness, high roughness, faceted flat shading. The set is created per layer (not a module
// singleton) so a layer can dispose its own materials on teardown without poisoning a later layer.

/** The four shared materials a quarry is built from. The layer owns one set and tweens WEAKSPOT. */
export interface QuarryMaterials {
  /** The dark hide / mass of the quarry. */
  hide: MeshStandardMaterial;
  /** The lighter accent (chitin / underbelly / horn) that catches the rim light. */
  accent: MeshStandardMaterial;
  /** The blood-red warning markings (poise / threat). */
  mark: MeshStandardMaterial;
  /** The emissive GOLD weak-spot - the crosshair-legible kill point at the hitbox center. */
  weakspot: MeshStandardMaterial;
}

const mkBody = (color: number, roughness = 0.85): MeshStandardMaterial =>
  new MeshStandardMaterial({ color, roughness, metalness: 0.05, flatShading: true });

function parseHex(h: string): number {
  return parseInt(h.replace('#', ''), 16);
}

/** Build a fresh, layer-owned set of palette materials. Dispose all via `materialList()`. */
export function createQuarryMaterials(): QuarryMaterials {
  return {
    hide: mkBody(parseHex(hex.ink)),
    accent: mkBody(parseHex(hex.cream), 0.7),
    mark: mkBody(parseHex(hex.blood), 0.6),
    weakspot: new MeshStandardMaterial({
      color: parseHex(hex.gold),
      emissive: parseHex(hex.gold),
      emissiveIntensity: 1.0,
      roughness: 0.4,
      metalness: 0.0,
      flatShading: true,
    }),
  };
}

/**
 * Clone a material set so each spawned quarry tweens its OWN opacity/emissive without stomping a
 * sibling that shares the layer's template. Geometries are already per-group; this makes the
 * animated channels per-instance too. The clone is owned by the record and disposed on release.
 */
export function cloneQuarryMaterials(m: QuarryMaterials): QuarryMaterials {
  return {
    hide: m.hide.clone(),
    accent: m.accent.clone(),
    mark: m.mark.clone(),
    weakspot: m.weakspot.clone(),
  };
}

/** Every material in a set, for disposal. */
export function materialList(m: QuarryMaterials): readonly MeshStandardMaterial[] {
  return [m.hide, m.accent, m.mark, m.weakspot];
}

/** A small emissive gold polyhedron at LOCAL ORIGIN - the weak-spot anchor on every quarry. */
function weakspot(mat: MeshStandardMaterial): Mesh {
  const m = new Mesh(new IcosahedronGeometry(0.12, 0), mat);
  m.name = WEAKSPOT_NAME;
  m.position.set(0, 0, 0);
  return m;
}

function part(geom: ConstructorParameters<typeof Mesh>[0], mat: MeshStandardMaterial, place: (m: Mesh) => void): Mesh {
  const m = new Mesh(geom, mat);
  place(m);
  return m;
}

/** Assemble a group from a weak-spot at origin + the strategy-specific body parts. */
function assemble(m: QuarryMaterials, parts: Object3D[]): QuarryMesh {
  const g = new Group();
  g.name = 'quarry';
  g.position.set(0, 0, 0);
  g.add(weakspot(m.weakspot));
  for (const p of parts) g.add(p);
  return g;
}

// ── Per-strategy silhouettes ─────────────────────────────────────────────────
// First-pass FUNCTIONAL geometry: correct strategy reads, on-palette, origin-anchored.
// The human iterates the aesthetics in Chromium afterward. Dimensions are in the group's
// unit space (~1.0 tall overall); the layer scales the whole group to the hitbox.

/** track → slender airborne DARTING form: swept fuselage body + thin back-swept wings. */
function buildTrack(m: QuarryMaterials): QuarryMesh {
  const body = part(new CapsuleGeometry(0.16, 0.5, 4, 8), m.hide, (o) => {
    o.rotation.z = Math.PI / 2; // lie along X - a darting horizontal streak
  });
  const wingL = part(new ConeGeometry(0.1, 0.55, 4), m.accent, (o) => {
    o.rotation.z = Math.PI / 2;
    o.rotation.y = -0.5;
    o.position.set(-0.05, 0.02, 0.28);
  });
  const wingR = part(new ConeGeometry(0.1, 0.55, 4), m.accent, (o) => {
    o.rotation.z = Math.PI / 2;
    o.rotation.y = 0.5;
    o.position.set(-0.05, 0.02, -0.28);
  });
  const tail = part(new ConeGeometry(0.08, 0.3, 4), m.mark, (o) => {
    o.rotation.z = -Math.PI / 2;
    o.position.set(-0.42, 0, 0);
  });
  return assemble(m, [body, wingL, wingR, tail]);
}

/** flick → coiled AMBUSH form, poised-to-snap: a drawn-back hood reared over a low coil. */
function buildFlick(m: QuarryMaterials): QuarryMesh {
  const coil = part(new CylinderGeometry(0.26, 0.3, 0.22, 10), m.hide, (o) => {
    o.position.set(0, -0.18, 0);
  });
  const neck = part(new CapsuleGeometry(0.09, 0.34, 4, 8), m.hide, (o) => {
    o.rotation.x = -0.35; // reared back, ready to strike forward
    o.position.set(0.04, 0.18, 0);
  });
  const hood = part(new ConeGeometry(0.22, 0.18, 5), m.mark, (o) => {
    o.rotation.x = Math.PI; // flared hood crowning the strike point
    o.position.set(0.06, 0.36, 0);
  });
  const fang = part(new ConeGeometry(0.05, 0.16, 4), m.accent, (o) => {
    o.position.set(0.12, 0.22, 0);
    o.rotation.z = -0.4;
  });
  return assemble(m, [coil, neck, hood, fang]);
}

/** calibrate → low, steady BENCH-REST form: a broad planted stance under a level back. */
function buildCalibrate(m: QuarryMaterials): QuarryMesh {
  const back = part(new BoxGeometry(0.62, 0.2, 0.32), m.hide, (o) => {
    o.position.set(0, 0.04, 0);
  });
  const head = part(new BoxGeometry(0.2, 0.16, 0.22), m.accent, (o) => {
    o.position.set(0.36, 0.02, 0);
  });
  const legFL = part(new CylinderGeometry(0.05, 0.05, 0.34, 6), m.hide, (o) => o.position.set(0.22, -0.2, 0.13));
  const legFR = part(new CylinderGeometry(0.05, 0.05, 0.34, 6), m.hide, (o) => o.position.set(0.22, -0.2, -0.13));
  const legBL = part(new CylinderGeometry(0.05, 0.05, 0.34, 6), m.hide, (o) => o.position.set(-0.22, -0.2, 0.13));
  const legBR = part(new CylinderGeometry(0.05, 0.05, 0.34, 6), m.hide, (o) => o.position.set(-0.22, -0.2, -0.13));
  const ridge = part(new BoxGeometry(0.5, 0.06, 0.06), m.mark, (o) => o.position.set(0, 0.17, 0));
  return assemble(m, [back, head, legFL, legFR, legBL, legBR, ridge]);
}

/** strike → heavy ARMORED form: a blocky plated mass riding low, broad shoulders. */
function buildStrike(m: QuarryMaterials): QuarryMesh {
  const core = part(new BoxGeometry(0.46, 0.46, 0.5), m.hide, (o) => {
    o.position.set(0, -0.02, 0);
  });
  const shoulderL = part(new BoxGeometry(0.18, 0.34, 0.2), m.accent, (o) => o.position.set(0.05, 0.18, 0.32));
  const shoulderR = part(new BoxGeometry(0.18, 0.34, 0.2), m.accent, (o) => o.position.set(0.05, 0.18, -0.32));
  const plate = part(new BoxGeometry(0.5, 0.14, 0.54), m.mark, (o) => o.position.set(0, 0.24, 0));
  const footL = part(new BoxGeometry(0.18, 0.16, 0.2), m.hide, (o) => o.position.set(0, -0.3, 0.18));
  const footR = part(new BoxGeometry(0.18, 0.16, 0.2), m.hide, (o) => o.position.set(0, -0.3, -0.18));
  return assemble(m, [core, shoulderL, shoulderR, plate, footL, footR]);
}

const BUILDERS: Record<InstrumentId, (m: QuarryMaterials) => QuarryMesh> = {
  track: buildTrack,
  flick: buildFlick,
  calibrate: buildCalibrate,
  strike: buildStrike,
};

/**
 * Build a fresh cosmetic quarry group for `id`, centered on its emissive weak-spot at the origin.
 * Pass a layer-owned `materials` set (so the layer can tween + dispose them); omit it to get a
 * standalone set (convenient for pure tests - the caller owns disposal).
 */
export function quarryMesh(id: InstrumentId, materials: QuarryMaterials = createQuarryMaterials()): QuarryMesh {
  return BUILDERS[id](materials);
}

/** Number of motes in one pooled dust-puff. Small + fixed - the puff is a punctuation, not a cloud. */
const DUST_MOTES = 5;

/**
 * Build ONE pooled dust-puff group: a small cluster of faceted cream motes around the local origin.
 * It carries its OWN material (so its opacity tween never stomps a quarry) and is reused across kills
 * by the layer's pool - call this only `pool size` times, never per kill. Cosmetic only: no scored API,
 * pure THREE, safe to unit-test. The layer positions it at the fallen quarry's feet and fades it out.
 */
export function dustPuff(): Group {
  const mat = new MeshStandardMaterial({
    color: parseHex(hex.cream),
    roughness: 0.95,
    metalness: 0,
    flatShading: true,
    transparent: true,
    opacity: 0,
  });
  const g = new Group();
  g.name = DUST_NAME;
  for (let i = 0; i < DUST_MOTES; i++) {
    const a = (i / DUST_MOTES) * Math.PI * 2;
    const r = 0.12 + 0.05 * (i % 2);
    const mote = new Mesh(new IcosahedronGeometry(0.06 + 0.02 * (i % 3), 0), mat);
    mote.position.set(Math.cos(a) * r, -0.05 + 0.02 * i, Math.sin(a) * r);
    g.add(mote);
  }
  g.visible = false;
  return g;
}

/** The single shared material of a dust-puff group (for opacity tweens + disposal). */
export function dustMaterial(g: Group): MeshStandardMaterial {
  return ((g.children[0] as Mesh).material as MeshStandardMaterial);
}

/** Dispose a dust-puff's geometry + its shared material (called once per pooled puff on teardown). */
export function disposeDust(g: Group): void {
  g.traverse((o) => {
    const mesh = o as Mesh;
    if (mesh.isMesh) mesh.geometry.dispose();
  });
  dustMaterial(g).dispose();
}
