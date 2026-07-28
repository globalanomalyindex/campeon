import { describe, it, expect } from 'vitest';
import { finalizeReport } from '../../src/optimizer/session-controller';
import { trialsToObservations } from '../../src/optimizer/objective';
import { buildPrescription } from '../../src/optimizer/result';
import { sensRatio } from '../../src/convert/counts';
import { mulberry32 } from '../../src/stats/rng';
import { counts360, countsBounds } from '../../src/types';
import type { Prescription } from '../../src/optimizer/result';
import type { InstrumentId, Profile, Report, TrialResult } from '../../src/types';

/**
 * The thesis: the tool reports a RATIO of two count measurements, so whatever factor sits between a
 * browser movement delta and a real mouse count divides out of the answer exactly. Scale every count
 * in a recorded session by k and the reported multiplier must not move.
 *
 * This runs the shipped path deliberately: recorded trials → blended observations → fitted report →
 * `buildPrescription`. An earlier draft computed the quotient in the test with `sensRatio`, which
 * pins the formula and not the pipeline: production could stop dividing two counts by the same
 * arena's counts and this file would still pass.
 *
 * On "byte-identical". It is exact at k = 1 and only there, and pretending otherwise would be the
 * same false precision this design exists to refuse. The pipeline routes counts through Math.log and
 * Math.exp and ln(k * c) is not ln k + ln c in doubles, so the deviation is around 1e-10. Even the
 * bare quotient is not bitwise invariant: (k * a) / (k * b) differs from a / b in the last ulp for
 * about a third of random count pairs at k = 1.5 and k = 7.3, and never for a power of two. So the
 * tolerance is 1e-9, and the last two cases are what make that tolerance load bearing. They inject
 * the two shapes a real unit leak takes. A search window left in a fixed unit while the stream
 * scales is caught as a REFUSAL, not as a deviation: the vertex lands a factor of three past the
 * ceiling, the Report records peakAtBound, and buildPrescription declines the whole prescription
 * rather than reporting the clamp as a factor. A surviving 2.54 or a devicePixelRatio division on
 * ONE side of the quotient stays interior and has to be caught by the tolerance instead; it moves
 * the ratio by 50 percent, eight orders of magnitude above 1e-9. Do not tighten this to toBe: that
 * would pin floating point rounding, not the invariance.
 */
const profile: Profile = {
  speedAccuracy: 0.5,
  instrumentWeights: { track: 1, flick: 1, calibrate: 0, strike: 0 },
};

/** A log-spaced sweep, in counts per 360, and the count total the simulated player peaks at. */
const LEVELS = [4800, 5800, 7000, 8400, 10100, 12200, 14700, 17700];
const PEAK = 8240;
/** The anchor: the count total this player's hands already believe in. */
const ANCHOR = 9000;

/** One recorded session, with every count scaled by `k`. The scores are a fixed concave curve in
 *  ln space plus a seeded jitter, so the recording is identical run to run and identical across k
 *  except for the counts themselves. */
function recordedSession(k: number): TrialResult[] {
  const out: TrialResult[] = [];
  const ids: InstrumentId[] = ['track', 'flick'];
  const rng = mulberry32(11);
  LEVELS.forEach((c, i) => {
    for (const id of ids) {
      const x = Math.log(c) - Math.log(PEAK);
      out.push({
        instrument: id,
        counts: counts360(c * k),
        score: 1 - x * x + (rng() * 2 - 1) * 0.01,
        raw: {},
        at: i * 1000,
      });
    }
  });
  return out;
}

/** The whole reported-number path, through the code that ships. Split in two on purpose: the raw
 *  form returns the Report as well as the Prescription, so a REFUSAL is observable rather than
 *  throwing inside an assertion, and `scaleWindow` false is the defect injection the refusal case
 *  needs. The `ratio` form is what the invariance cases call, and it asserts. */
function reportedPrescription(
  k: number,
  scaleWindow = true,
): { report: Report; p: Prescription | null } {
  const bounds = scaleWindow ? countsBounds(4000 * k, 20000 * k) : countsBounds(4000, 20000);
  const report = finalizeReport(
    trialsToObservations(recordedSession(k), profile),
    bounds,
    mulberry32(7),
    { bootstrapIters: 200 },
  );
  // The anchor is a bare AnchorReading. It must NOT carry phase 4's `sources` or `disagreementPct`:
  // a fresh object literal argument is excess-property-checked, so either one is a TS2353.
  const anchor = {
    counts: counts360(ANCHOR * k),
    ci90: countsBounds(ANCHOR * k * 0.96, ANCHOR * k * 1.04),
  };
  return { report, p: buildPrescription(report, anchor) };
}

function reportedRatio(k: number): number {
  const { p } = reportedPrescription(k);
  // buildPrescription refuses only when it has no anchor to work from or the vertex hit a bound,
  // and neither holds here. The assertions are inside the helper so a refusal reads as a refusal
  // rather than as a NaN ratio.
  expect(p, 'buildPrescription must not refuse an anchor it was handed').toBeTruthy();
  expect(p!.ratio, 'an anchor must produce a ratio').toBeDefined();
  return p!.ratio!;
}

const FACTORS = [1, 2, 1.5, 0.5, 7.3];

describe('the reported ratio is invariant to the count convention', () => {
  it('does not move when every count in a recorded session is scaled', () => {
    const base = reportedRatio(1);
    expect(base).toBeGreaterThan(1); // this player is measured faster than they believe
    for (const k of FACTORS) {
      const r = reportedRatio(k);
      expect(Math.abs(r / base - 1), `k = ${k}`).toBeLessThan(1e-9);
    }
  });

  it('is bitwise identical at k = 1, which is the only k where exactness is claimable', () => {
    expect(reportedRatio(1)).toBe(reportedRatio(1));
  });

  it('rounds to the same displayed multiplier at every k, which is what the player is told', () => {
    const shown = FACTORS.map((k) => reportedRatio(k).toFixed(2));
    expect(shown).toEqual(['1.09', '1.09', '1.09', '1.09', '1.09']);
  });

  it('sensRatio itself cancels the factor, exactly at a power of two and to one ulp otherwise', () => {
    const base = sensRatio(counts360(ANCHOR), counts360(PEAK));
    for (const k of [1, 2, 0.5]) {
      // A power of two scales a double exactly, so there is nothing left to round.
      expect(sensRatio(counts360(ANCHOR * k), counts360(PEAK * k)), `k = ${k}`).toBe(base);
    }
    for (const k of [1.5, 7.3]) {
      const r = sensRatio(counts360(ANCHOR * k), counts360(PEAK * k));
      expect(Math.abs(r / base - 1), `k = ${k}`).toBeLessThan(4 * Number.EPSILON);
    }
  });

  it('goes red when a window does NOT scale with the stream: the pipeline refuses outright', () => {
    // A search window left in a fixed unit while the count stream is scaled puts the vertex a factor
    // of three past the ceiling, so finalizeReport records peakAtBound and buildPrescription refuses
    // the whole prescription rather than reporting the clamp as a factor. An earlier draft of this
    // file asserted a deviation of 2.006582377496116 here; that number is the clamped optimum
    // (65700 / 20000 = 3.285 against a true 1.0926) and it is unreachable through the shipped path,
    // because the refusal fires first. The refusal IS the catch, and it is a stronger one.
    const leaked = reportedPrescription(7.3, false);
    expect(leaked.report.peakAtBound).toBe('high');
    expect(leaked.p).toBeNull();
  });

  it('goes red when only ONE side of the quotient is scaled, so the tolerance is load bearing', () => {
    // The leak that stays interior and therefore has to be caught by the tolerance rather than by a
    // refusal: a devicePixelRatio division applied to the anchor and not to the arena, or a
    // surviving 2.54 on one side. The session and its window are both scaled by 2, so the located
    // optimum doubles, while the anchor is left where it was. The deviation is 0.5, eight orders of
    // magnitude above 1e-9, which is what proves the first case's tolerance is not so loose it has
    // stopped looking.
    const base = reportedRatio(1);
    const report = finalizeReport(
      trialsToObservations(recordedSession(2), profile),
      countsBounds(8000, 40000),
      mulberry32(7),
      { bootstrapIters: 200 },
    );
    const halved = buildPrescription(report, {
      counts: counts360(ANCHOR), // the anchor alone left undivided by the DPR the arena applied
      ci90: countsBounds(ANCHOR * 0.96, ANCHOR * 1.04),
    })!;
    expect(halved).toBeTruthy();
    expect(Math.abs(halved.ratio! / base - 1)).toBeGreaterThan(0.4);
  });
});
