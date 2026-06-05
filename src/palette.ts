// Canvas / WebGL mirror of the cinematic palette in styles/tokens.css.
// The DOM reads its colors from CSS custom properties; the <canvas> and three.js
// draw layers cannot, so they read them here instead. Keep these in lockstep with
// the matching tokens so the rendered instruments never drift off the film palette.
export const hex = {
  ink: '#0c0b09',    // --cinema-ink (warm near-black film stock)
  cream: '#efe7d6',  // --cinema-cream (aged-cream ink)
  blood: '#c4251f',  // --blood (western identity red)
  gold: '#FFC400',   // --gold (value / action)
  ok: '#6fc28a',     // --ok (warmed status green)
  warn: '#e0a23a',   // --warn (warmed status amber)
} as const;

const RGB: Record<keyof typeof hex, readonly [number, number, number]> = {
  ink: [12, 11, 9],
  cream: [239, 231, 214],
  blood: [196, 37, 31],
  gold: [255, 196, 0],
  ok: [111, 194, 138],
  warn: [224, 162, 58],
};

/** Translucent draw color: rgba(color, alpha) sourced from the locked palette. */
export const rgba = (c: keyof typeof hex, alpha: number): string => {
  const [r, g, b] = RGB[c];
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};
