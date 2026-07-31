import { describe, it, expect } from 'vitest';
import * as dpiModule from '../../src/input/dpi';
import { parseDpi, isValidDpi, MIN_DPI, MAX_DPI } from '../../src/input/dpi';

describe('dpi parsing + validation', () => {
  it('parses numeric strings and passes through numbers', () => {
    expect(parseDpi('800')).toBe(800);
    expect(parseDpi(' 1600 ')).toBe(1600);
    expect(parseDpi(1.6e3)).toBe(1600);
    expect(Number.isNaN(parseDpi('abc'))).toBe(true);
  });
  it('accepts sane DPI and rejects the rest', () => {
    expect(isValidDpi(800)).toBe(true);
    expect(isValidDpi(MIN_DPI)).toBe(true);
    expect(isValidDpi(MAX_DPI)).toBe(true);
    expect(isValidDpi(MIN_DPI - 1)).toBe(false);
    expect(isValidDpi(MAX_DPI + 1)).toBe(false);
    expect(isValidDpi(0)).toBe(false);
    expect(isValidDpi(Number.NaN)).toBe(false);
  });
});

describe('what the card sweep did NOT bring back', () => {
  it('exports no DPR normalizer, so nothing can divide the deltas by devicePixelRatio again', () => {
    // The restored module is the DPI band and the parse in front of it, and nothing else. The
    // deleted `normalizeByDpr` claimed that dividing by DPR reconciled Chrome's device pixels with
    // Firefox's CSS pixels; dividing two streams that differ by a factor by that same factor makes
    // one right and leaves the other wrong by DPR, and it halved every delta on a DPR 2 display,
    // destroying the integer lattice the count convention probe reads. Asserted on the module
    // namespace rather than on a name, so a differently-spelled revival is caught too.
    expect(Object.keys(dpiModule).sort()).toEqual(['MAX_DPI', 'MIN_DPI', 'isValidDpi', 'parseDpi']);
  });
});
