// Effective DPI measured from a horizontal sweep across a known pad width. The pointer-lock
// samples are already DPR-normalized counts, so this is true mouse DPI (and catches a mouse
// whose labeled DPI is wrong). Net horizontal travel is the pad width, so we sum signed dx.
import { isValidDpi } from './dpi';
import type { AimSample, Dpi } from '../types';

/** Standard wallet-card width: ISO/IEC 7810 ID-1 long edge (85.60 mm). Used as the sweep anchor. */
export const CARD_WIDTH_CM = 8.56;

/** Effective DPI from `horizontalCounts` (DPR-normalized) swept across `referenceWidthCm`. NaN if width <= 0. */
export function dpiFromSweep(horizontalCounts: number, referenceWidthCm: number): Dpi {
  if (!(referenceWidthCm > 0)) return NaN;
  return horizontalCounts / (referenceWidthCm / 2.54); // counts per inch
}

/** Accumulates one sweep pass: net horizontal counts (signed dx sum, reported as magnitude). */
export class SweepAccumulator {
  private sum = 0;
  add(sample: AimSample): void { this.sum += sample.dx; }
  total(): number { return Math.abs(this.sum); }
  reset(): void { this.sum = 0; }
}

/** True when a measured DPI is plausible (delegates to the shared DPI bounds). */
export function isPlausibleSweepDpi(dpi: number): boolean { return isValidDpi(dpi); }
