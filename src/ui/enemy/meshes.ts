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
 *
 * The strategy-specific moving parts (wings, hood, plate, etc.) carry a stable `mesh.name` and a
 * captured `userData.rest` transform (see `PartRest`/`partRest`), so the pure cosmetic module
 * `secondary.ts` can drive per-part idle motion purely off name + rest + time - this file never
 * animates anything itself and never reads the scored stream either.
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

/**
 * Body material with a faint SELF-emissive value floor: each surface smolders in its OWN palette
 * color at low intensity, so a quarry 20m out against the ink horizon never drops below a readable
 * value (dusk forms hold a value above true black on film) while lit faces still carry the form.
 * The emissive COLOR stays the literal palette color (the no-hardcoded-hex rule is testable);
 * intensity is the tuning knob.
 */
const mkBody = (color: number, roughness = 0.85, emissiveIntensity = 0.18): MeshStandardMaterial =>
  new MeshStandardMaterial({
    color,
    roughness,
    metalness: 0.05,
    flatShading: true,
    emissive: color,
    emissiveIntensity,
  });

function parseHex(h: string): number {
  return parseInt(h.replace('#', ''), 16);
}

/** Build a fresh, layer-owned set of palette materials. Dispose all via `materialList()`. */
export function createQuarryMaterials(): QuarryMaterials {
  return {
    hide: mkBody(parseHex(hex.hide)),
    accent: mkBody(parseHex(hex.cream), 0.7, 0.1), // cream needs less floor - it catches real light
    mark: mkBody(parseHex(hex.blood), 0.6, 0.3), // the threat mark SMOLDERS at range
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

/**
 * A part's REST transform - the pose it was placed at in `part()`, captured once so the pure
 * `secondary.ts` module (owned by a later package) can compute `rest + offset` every frame without
 * ever accumulating drift. Read-only from the cosmetic layer's perspective: this module writes it
 * once at build time and nothing here (or in secondary.ts) ever mutates it afterward.
 */
export interface PartRest {
  px: number; py: number; pz: number;
  rx: number; ry: number; rz: number;
}

/** Read a part's captured rest transform, or null if it never had one (unnamed / non-part child). */
export function partRest(o: Object3D): PartRest | null {
  const rest = (o.userData as { rest?: PartRest }).rest;
  return rest ?? null;
}

function part(geom: ConstructorParameters<typeof Mesh>[0], mat: MeshStandardMaterial, place: (m: Mesh) => void): Mesh {
  const m = new Mesh(geom, mat);
  place(m);
  m.userData.rest = {
    px: m.position.x, py: m.position.y, pz: m.position.z,
    rx: m.rotation.x, ry: m.rotation.y, rz: m.rotation.z,
  } satisfies PartRest;
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
// SCULPTED low-poly forms (still pure primitives, flat-shaded, on-palette, origin-anchored).
// Design language: every quarry FACES +x (the camera mostly sees targets in PROFILE, and a profile
// is where a silhouette is most legible), carries one continuous GESTURE line (coil-to-hood arc,
// dart streak, bench line, wedge hump), and zones its materials so the cream accent catches the
// rim light while the blood mark flags the threat. Dimensions in group-unit space (~1.0 tall);
// the layer scales the whole group to the hitbox.

/** track → slender airborne DARTING form: a swift - swept fuselage, long back-swept wings. */
function buildTrack(m: QuarryMaterials): QuarryMesh {
  const body = part(new CapsuleGeometry(0.11, 0.5, 4, 8), m.hide, (o) => {
    o.rotation.z = Math.PI / 2; // lie along X - a darting horizontal streak
    o.rotation.y = 0.06; // a hair of bank, so it never reads as a static extrusion
  });
  body.name = 'part-body';
  const nose = part(new ConeGeometry(0.09, 0.22, 6), m.accent, (o) => {
    o.rotation.z = -Math.PI / 2; // apex forward - the dart's point
    o.position.set(0.42, 0, 0);
  });
  // Wings: long, thin, swept HARD back with a slight dihedral - the swift's sickle in profile.
  // HIDE, not accent: the dart stays a dark streak with ONE bright anchor (the nose), so the
  // contrast hierarchy reads at 20m instead of washing the whole form silver.
  const wingL = part(new ConeGeometry(0.055, 0.62, 4), m.hide, (o) => {
    o.rotation.z = Math.PI / 2;
    o.rotation.y = -0.95; // swept back
    o.rotation.x = -0.12; // dihedral lift
    o.position.set(-0.02, 0.05, 0.24);
  });
  wingL.name = 'part-wing-l';
  const wingR = part(new ConeGeometry(0.055, 0.62, 4), m.hide, (o) => {
    o.rotation.z = Math.PI / 2;
    o.rotation.y = 0.95;
    o.rotation.x = 0.12;
    o.position.set(-0.02, 0.05, -0.24);
  });
  wingR.name = 'part-wing-r';
  // Forked tail: one flattened blood cone, wide and shallow - the kite silhouette that flags it.
  const tail = part(new ConeGeometry(0.11, 0.3, 3), m.mark, (o) => {
    o.rotation.z = -Math.PI / 2;
    o.rotation.x = Math.PI / 2; // flatten the 3-gon horizontal
    o.scale.set(1, 1, 0.35);
    o.position.set(-0.44, 0.01, 0);
  });
  tail.name = 'part-tail';
  return assemble(m, [body, nose, wingL, wingR, tail]);
}

/** flick → coiled AMBUSH form: a cobra - stepped coil, reared S-neck, flared hood, bared fang. */
function buildFlick(m: QuarryMaterials): QuarryMesh {
  // Stepped coil: two offset rings, wider below - the loaded spring the strike leaves from.
  const coilBase = part(new CylinderGeometry(0.3, 0.34, 0.14, 10), m.hide, (o) => {
    o.position.set(-0.02, -0.4, 0);
  });
  const coil = part(new CylinderGeometry(0.2, 0.26, 0.13, 10), m.hide, (o) => {
    o.position.set(0.03, -0.28, 0.02); // offset ring breaks the symmetry - a real coil, not a stack
  });
  coil.name = 'part-coil';
  // Reared S-neck in two segments: lower leans back (drawn), upper cranes forward (aimed).
  const neckLow = part(new CapsuleGeometry(0.075, 0.28, 4, 8), m.hide, (o) => {
    o.rotation.z = 0.35; // lean back off vertical (away from +x)
    o.position.set(-0.06, -0.08, 0);
  });
  const neck = part(new CapsuleGeometry(0.065, 0.26, 4, 8), m.hide, (o) => {
    o.rotation.z = -0.5; // crane forward over the weak-spot
    o.position.set(0.04, 0.18, 0);
  });
  neck.name = 'part-neck';
  // Flared hood: a wide shallow cone aimed along +x, mouth toward the viewer's threat axis.
  const hood = part(new ConeGeometry(0.24, 0.22, 6), m.mark, (o) => {
    o.rotation.z = -Math.PI / 2; // apex forward (+x), flare behind
    o.scale.set(1, 1, 0.55); // flatten side-to-side: a hood, not a funnel
    o.position.set(0.2, 0.34, 0);
  });
  hood.name = 'part-hood';
  // Bared fang under the hood's chin - small, cream, catching the rim.
  const fang = part(new ConeGeometry(0.035, 0.12, 4), m.accent, (o) => {
    o.rotation.z = Math.PI - 0.35; // apex down-forward
    o.position.set(0.26, 0.22, 0);
  });
  fang.name = 'part-fang';
  return assemble(m, [coilBase, coil, neckLow, neck, hood, fang]);
}

/** calibrate → low, steady BENCH-REST form: a planted quadruped, level spine, sighting head. */
function buildCalibrate(m: QuarryMaterials): QuarryMesh {
  const back = part(new BoxGeometry(0.66, 0.16, 0.3), m.hide, (o) => {
    o.position.set(0, 0.06, 0);
  });
  back.name = 'part-back';
  // Under-mass: a second, lower slab - the settled belly that says "this thing does not move".
  const belly = part(new BoxGeometry(0.46, 0.16, 0.24), m.hide, (o) => {
    o.position.set(0.02, -0.07, 0);
  });
  const head = part(new BoxGeometry(0.2, 0.14, 0.2), m.accent, (o) => {
    o.position.set(0.4, 0.08, 0);
    o.rotation.z = -0.06; // sighting down its own line, a hair below level
  });
  head.name = 'part-head';
  const muzzle = part(new BoxGeometry(0.12, 0.07, 0.12), m.accent, (o) => {
    o.position.set(0.52, 0.04, 0);
  });
  // Legs stay unnamed - the bench-rest form is deliberately planted (no secondary motion on stance).
  const legFL = part(new CylinderGeometry(0.055, 0.06, 0.36, 6), m.hide, (o) => o.position.set(0.24, -0.26, 0.15));
  const legFR = part(new CylinderGeometry(0.055, 0.06, 0.36, 6), m.hide, (o) => o.position.set(0.24, -0.26, -0.15));
  const legBL = part(new CylinderGeometry(0.055, 0.06, 0.36, 6), m.hide, (o) => o.position.set(-0.24, -0.26, 0.15));
  const legBR = part(new CylinderGeometry(0.055, 0.06, 0.36, 6), m.hide, (o) => o.position.set(-0.24, -0.26, -0.15));
  const ridge = part(new BoxGeometry(0.56, 0.05, 0.05), m.mark, (o) => o.position.set(-0.02, 0.16, 0));
  ridge.name = 'part-ridge';
  return assemble(m, [back, belly, head, muzzle, legFL, legFR, legBL, legBR, ridge]);
}

/** strike → heavy ARMORED form: a bison-tank - low wedge mass, shoulder hump, brow plate, horn. */
function buildStrike(m: QuarryMaterials): QuarryMesh {
  const core = part(new BoxGeometry(0.52, 0.36, 0.42), m.hide, (o) => {
    o.position.set(-0.06, -0.12, 0);
  });
  core.name = 'part-core';
  // The hump: the tall forward shoulder mass that makes the wedge silhouette.
  const hump = part(new BoxGeometry(0.34, 0.3, 0.36), m.hide, (o) => {
    o.position.set(0.1, 0.14, 0);
    o.rotation.z = -0.08; // wedge line falling toward the head
  });
  // Pads in HIDE: the family rule is dark mass + ONE blood mark + ONE cream anchor per quarry
  // (here: plate + horn), so no second bright surface competes with the threat read.
  const shoulderL = part(new BoxGeometry(0.2, 0.26, 0.14), m.hide, (o) => {
    o.position.set(0.06, 0.05, 0.27);
    o.rotation.x = 0.12; // pads splay outward off the hump
  });
  shoulderL.name = 'part-shoulder-l';
  const shoulderR = part(new BoxGeometry(0.2, 0.26, 0.14), m.hide, (o) => {
    o.position.set(0.06, 0.05, -0.27);
    o.rotation.x = -0.12;
  });
  shoulderR.name = 'part-shoulder-r';
  // Brow plate: blood armor slab raked over the face - the threat you aim past.
  const plate = part(new BoxGeometry(0.3, 0.1, 0.4), m.mark, (o) => {
    o.position.set(0.3, 0.16, 0);
    o.rotation.z = -0.35; // raked down over the brow
  });
  plate.name = 'part-plate';
  // Horn: a short cream spike off the brow, forward-down - catches the rim at 20m.
  const horn = part(new ConeGeometry(0.045, 0.18, 5), m.accent, (o) => {
    o.rotation.z = -Math.PI / 2 - 0.5;
    o.position.set(0.44, 0.06, 0);
  });
  // Feet stay unnamed - the heavy stance is deliberately planted (no secondary motion).
  const footL = part(new BoxGeometry(0.16, 0.14, 0.18), m.hide, (o) => o.position.set(-0.02, -0.36, 0.17));
  const footR = part(new BoxGeometry(0.16, 0.14, 0.18), m.hide, (o) => o.position.set(-0.02, -0.36, -0.17));
  return assemble(m, [core, hump, shoulderL, shoulderR, plate, horn, footL, footR]);
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
