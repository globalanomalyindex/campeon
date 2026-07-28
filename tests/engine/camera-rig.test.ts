import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import {
  wrapYaw,
  applyLook,
  PITCH_LIMIT,
  CameraRig,
} from '../../src/engine/camera-rig';
import { degreesPerCount } from '../../src/convert/counts';
import { counts360 } from '../../src/types';

describe('counts per 360 → degrees per count', () => {
  it('makes one 360° turn equal the target count total', () => {
    // 20000 counts/360 is 50.8 cm at 1000 DPI, and 10708.66 is 34 cm at 800 DPI: the same two
    // settings the cm form was pinned at, which is why the expected degrees are unchanged.
    expect(degreesPerCount(counts360(20000))).toBeCloseTo(0.018, 6);
    expect(degreesPerCount(counts360(10708.66))).toBeCloseTo(0.033618, 6);
  });
  it('rejects a non-positive count total (fails loudly at the validity core)', () => {
    expect(() => degreesPerCount(counts360(0))).toThrow(RangeError);
    expect(() => degreesPerCount(counts360(-1))).toThrow(RangeError);
  });
});

describe('wrapYaw', () => {
  it('wraps into [-180, 180)', () => {
    expect(wrapYaw(190)).toBeCloseTo(-170, 9);
    expect(wrapYaw(-190)).toBeCloseTo(170, 9);
    expect(wrapYaw(360)).toBeCloseTo(0, 9);
    expect(wrapYaw(180)).toBeCloseTo(-180, 9);
  });
});

describe('applyLook', () => {
  const dpc = 0.018;
  it('moves +yaw on mouse-right and +pitch on mouse-up, then clamps pitch', () => {
    let st = { yaw: 0, pitch: 0 };
    st = applyLook(st, { t: 0, dx: 100, dy: 0 }, dpc); // right
    expect(st.yaw).toBeCloseTo(1.8, 6);
    st = applyLook(st, { t: 1, dx: 0, dy: -100 }, dpc); // up (dy negative)
    expect(st.pitch).toBeCloseTo(1.8, 6);
    st = applyLook(st, { t: 2, dx: 0, dy: -1_000_000 }, dpc); // slam up
    expect(st.pitch).toBe(PITCH_LIMIT);
  });
  it('a full 360° worth of counts returns to the starting yaw', () => {
    const d = degreesPerCount(counts360(10708.66));
    const counts = Math.round(360 / d);
    const st = applyLook({ yaw: 0, pitch: 0 }, { t: 0, dx: counts, dy: 0 }, d);
    expect(Math.abs(wrapYaw(st.yaw))).toBeLessThan(0.05);
  });
});

describe('CameraRig camera mapping', () => {
  const forward = (rig: CameraRig): Vector3 => rig.camera.getWorldDirection(new Vector3());
  it('looks down -Z at rest', () => {
    const d = forward(new CameraRig(counts360(10708.66)));
    expect(d.x).toBeCloseTo(0, 5);
    expect(d.y).toBeCloseTo(0, 5);
    expect(d.z).toBeCloseTo(-1, 5);
  });
  it('+yaw turns the view to the right (+X)', () => {
    const rig = new CameraRig(counts360(10708.66));
    const dpc = degreesPerCount(counts360(10708.66));
    rig.apply({ t: 0, dx: 90 / dpc, dy: 0 }); // +90° yaw
    const d = forward(rig);
    expect(d.x).toBeCloseTo(1, 4);
    expect(d.z).toBeCloseTo(0, 4);
  });
  it('mouse-up pitches the view up (+Y)', () => {
    const rig = new CameraRig(counts360(10708.66));
    const dpc = degreesPerCount(counts360(10708.66));
    rig.apply({ t: 0, dx: 0, dy: -45 / dpc }); // +45° pitch
    expect(forward(rig).y).toBeCloseTo(Math.sin(Math.PI / 4), 4);
  });
  it('setSensitivity changes how far a fixed count stream rotates the view', () => {
    const rig = new CameraRig(counts360(10708.66));
    rig.apply({ t: 0, dx: 500, dy: 0 });
    const lo = rig.view()[0];
    rig.setSensitivity(counts360(21417.32)); // double the counts is half the deg/count
    rig.apply({ t: 1, dx: 500, dy: 0 });
    const inc = rig.view()[0] - lo;
    expect(inc).toBeCloseTo(lo / 2, 4);
  });
});
