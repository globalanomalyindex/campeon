import { describe, it, expect } from 'vitest';
import { parseDpi, isValidDpi, normalizeByDpr, MIN_DPI, MAX_DPI } from '../../src/input/dpi';

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

describe('DPR normalization', () => {
  it('divides movement by devicePixelRatio so browsers agree', () => {
    expect(normalizeByDpr(10, 2)).toBe(5);
    expect(normalizeByDpr(10, 1)).toBe(10);
    expect(normalizeByDpr(-8, 2)).toBe(-4);
  });
  it('guards a zero/negative ratio (treats as 1)', () => {
    expect(normalizeByDpr(10, 0)).toBe(10);
    expect(normalizeByDpr(10, -2)).toBe(10);
  });
});
