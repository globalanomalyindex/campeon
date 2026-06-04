import {
  CanvasTexture,
  Group,
  NearestFilter,
  type Object3D,
  type Scene,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  type Texture,
} from 'three';
import type { EnemyLayer } from '../../engine/arena';
import type { Degrees, InstrumentId, Ms, TargetHandle } from '../../types';
import { SHEET } from './atlas';
import { EnemyController } from './controller';
import { classifyHit, type HitClass } from './hit';
import { keyMagenta } from '../viewmodel/key';

const SHEETS: Record<InstrumentId, string> = {
  track: '/sprites/track.png',
  flick: '/sprites/flick.png',
  calibrate: '/sprites/calibrate.png',
  strike: '/sprites/strike.png',
};

/** Merc billboard height = K × the hitbox diameter, so the visible merc ≈ the hittable disc. */
const ENEMY_SIZE_K = 1.7;
/** Floor on billboard height (metres) so tiny-width targets stay visible. */
const MIN_ENEMY_HEIGHT = 0.6;
/** Cell aspect (w/h) from the uniform grid — keeps the billboard from stretching. */
const ASPECT = SHEET.w / SHEET.cols / (SHEET.h / SHEET.rows);
/** Vertical pivot: the gold weak-spot sits ~0.7 up the cell — anchor it to the true hitbox centre. */
const WEAKSPOT_V = 0.7;

interface EnemyRecord {
  sprite: Sprite;
  tex: Texture;
  mat: SpriteMaterial;
  ctrl: EnemyController;
  object: Object3D;
}

export interface EnemyLayerHandle extends EnemyLayer {
  /** Choose which environment sheet subsequent spawns use (the active instrument's prey). */
  setEnvironment(id: InstrumentId): void;
}

/**
 * COSMETIC enemy billboard layer — the over-the-top "merc-prey" that skins each arena target. It is a
 * pure decoration over the true target: the arena keeps every target's gold sphere as the owner of
 * `bearing()` / `radiusDeg()` (the angular truth the instruments score against) and merely hides it,
 * pinning a camera-facing `THREE.Sprite` at the same world position. Hits drive only animation via the
 * read-only `classifyHit`; nothing here ever writes a sample or a score, so the cm/360 stays exact.
 *
 * Runtime-only (image decode + canvas chroma-key + WebGL sprites). The frame / state / hit logic it
 * depends on is unit-tested in atlas.ts / controller.ts / hit.ts.
 *
 * Loads + keys all four environment sheets up front, then resolves; the arena attaches it once ready.
 */
export async function createEnemyLayer(
  opts: { reducedMotion?: boolean; onShot?: (result: HitClass) => void } = {},
): Promise<EnemyLayerHandle> {
  const reduced = opts.reducedMotion ?? false;
  const onShot = opts.onShot;

  // Load + magenta-key each sheet once into its own base texture (NearestFilter → crisp PSX pixels).
  const bases = new Map<InstrumentId, Texture>();
  await Promise.all(
    (Object.keys(SHEETS) as InstrumentId[]).map(async (id) => {
      const img = new Image();
      img.src = SHEETS[id];
      await img.decode();
      const off = document.createElement('canvas');
      off.width = SHEET.w;
      off.height = SHEET.h;
      const octx = off.getContext('2d');
      if (!octx) throw new Error('enemy-layer: 2D context unavailable');
      octx.drawImage(img, 0, 0);
      const data = octx.getImageData(0, 0, SHEET.w, SHEET.h);
      keyMagenta(data.data);
      octx.putImageData(data, 0, 0);
      const tex = new CanvasTexture(off);
      tex.colorSpace = SRGBColorSpace;
      tex.magFilter = NearestFilter;
      tex.minFilter = NearestFilter;
      tex.generateMipmaps = false;
      tex.needsUpdate = true;
      bases.set(id, tex);
    }),
  );

  const group = new Group();
  group.name = 'enemy-layer';
  const enemies = new Map<string, EnemyRecord>();
  const fadeouts: EnemyRecord[] = []; // dying mercs handed off here so a new spawn/clear can't cut them short
  let activeEnv: InstrumentId = 'flick';
  let scene: Scene | null = null;

  const applyUV = (rec: EnemyRecord, nowMs: Ms): void => {
    const frame = reduced ? rec.ctrl.staticFrame() : rec.ctrl.frameAt(nowMs);
    rec.tex.offset.set(frame.uv.offsetX, frame.uv.offsetY);
    rec.tex.repeat.set(frame.uv.repeatX, frame.uv.repeatY);
  };

  const release = (rec: EnemyRecord): void => {
    group.remove(rec.sprite);
    rec.mat.dispose();
    rec.tex.dispose();
  };
  const retire = (id: string, rec: EnemyRecord): void => {
    release(rec);
    enemies.delete(id);
  };

  return {
    setEnvironment(id: InstrumentId): void {
      activeEnv = id;
    },

    attach(s: Scene): void {
      scene = s;
      s.add(group);
    },

    spawn(id: string, object: Object3D, radiusDeg: number, nowMs: Ms): void {
      const base = bases.get(activeEnv);
      if (!base) return;
      const tex = base.clone();
      tex.needsUpdate = true;
      const mat = new SpriteMaterial({ map: tex, transparent: true, alphaTest: 0.5, depthWrite: false });
      const sprite = new Sprite(mat);
      sprite.center.set(0.5, WEAKSPOT_V);
      // Size to the hitbox: world height = K × the hitbox diameter (worldRadius = dist·tan(radiusDeg)),
      // so aiming at the merc lands in the hitbox and a small-width flick target gets a small merc.
      const dist = object.position.length() || 20;
      const worldRadius = dist * Math.tan((radiusDeg * Math.PI) / 180);
      const h = Math.max(MIN_ENEMY_HEIGHT, ENEMY_SIZE_K * 2 * worldRadius);
      sprite.scale.set(h * ASPECT, h, 1);
      sprite.position.copy(object.position);
      // Reduced motion: a static cocky idle, no spawn burst, no follow-up.
      const ctrl = new EnemyController(reduced ? 'idle' : 'spawn', nowMs, reduced ? null : 'idle');
      const rec: EnemyRecord = { sprite, tex, mat, ctrl, object };
      applyUV(rec, nowMs);
      group.add(sprite);
      enemies.set(id, rec);
    },

    update(nowMs: Ms): void {
      for (const [id, rec] of enemies) {
        rec.sprite.position.copy(rec.object.position); // follow the (possibly weaving) target
        if (!reduced && rec.ctrl.isFinished(nowMs)) {
          retire(id, rec);
          continue;
        }
        applyUV(rec, nowMs);
      }
      // Dying mercs play out where they fell — independent of the live target's spawn/clear.
      for (let i = fadeouts.length - 1; i >= 0; i--) {
        const rec = fadeouts[i]!;
        if (rec.ctrl.isFinished(nowMs)) {
          release(rec);
          fadeouts.splice(i, 1);
        } else {
          applyUV(rec, nowMs);
        }
      }
    },

    fire(nowMs: Ms, view: [Degrees, Degrees], targets: ReadonlyArray<TargetHandle>): void {
      if (reduced) return; // no hit reactions (or miss tick) under reduced motion
      let best: HitClass = 'miss';
      for (const t of targets) {
        const cls = classifyHit(view, t.bearing(), t.radiusDeg());
        if (cls === 'kill') best = 'kill';
        else if (cls === 'graze' && best !== 'kill') best = 'graze';
        const rec = enemies.get(t.id);
        if (!rec) continue;
        const cur = rec.ctrl.current();
        if (cur === 'death' || cur === 'escape') continue; // already retiring
        if (cls === 'kill') {
          rec.ctrl.play('death', nowMs, null);
          // Hand off to fadeouts: the instrument is about to clear + spawn, but the death plays on.
          enemies.delete(t.id);
          fadeouts.push(rec);
        } else if (cls === 'graze') {
          rec.ctrl.play('flinch', nowMs, 'idle');
        }
      }
      onShot?.(best); // 'miss' → the HUD flashes a miss tick; 'graze'/'kill' → the merc itself reacts
    },

    remove(id: string): void {
      const rec = enemies.get(id);
      if (rec) retire(id, rec); // a still-live record (e.g. reduced motion, where fire() never fades it out)
    },

    clear(): void {
      for (const [id, rec] of enemies) retire(id, rec);
      enemies.clear();
    },

    dispose(): void {
      for (const [id, rec] of enemies) retire(id, rec);
      enemies.clear();
      for (const rec of fadeouts) release(rec);
      fadeouts.length = 0;
      if (scene) scene.remove(group);
      for (const tex of bases.values()) tex.dispose();
      bases.clear();
    },
  };
}
