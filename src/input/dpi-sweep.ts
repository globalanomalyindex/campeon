// Effective DPI measured from a horizontal sweep across a known pad width. The pointer-lock
// samples are already DPR-normalized counts, so this is true mouse DPI (and catches a mouse
// whose labeled DPI is wrong). Net horizontal travel is the pad width, so we sum signed dx.
import { isValidDpi } from './dpi';
import type { AimSample, Dpi } from '../types';

/** Effective DPI from `horizontalCounts` (DPR-normalized) swept across `padWidthCm`. NaN if width <= 0. */
export function dpiFromSweep(horizontalCounts: number, padWidthCm: number): Dpi {
  if (!(padWidthCm > 0)) return NaN;
  return horizontalCounts / (padWidthCm / 2.54); // counts per inch
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
