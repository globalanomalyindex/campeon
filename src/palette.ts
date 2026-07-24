// Canvas / WebGL mirror of the design tokens in styles/tokens.css.
//
// The DOM reads colour from CSS custom properties. The <canvas> and three.js draw
// layers cannot, so they read it here instead. Every value below has a named twin
// in tokens.css and the two must move together. The arena is the ink chamber, so
// these mirror the [data-surface='chamber'] block, not the paper defaults.
//
// Values are literal hex on purpose. The chamber block in tokens.css also writes
// these instrument colours as literal hex rather than color-mix() so that the two
// sides stay byte-comparable and a drift is a visible diff, not a rounding guess.
export const hex = {
  // ── Stone ramp ────────────────────────────────────────────────────────────
  ink: '#17140F', // --stone-900, the chamber field
  paper: '#F4F0E7', // --stone-50, page + text on the chamber
  alabaster: '#FBFAF6', // --stone-0, the crosshair and the brightest marks

  // ── The four instruments, lifted for legibility on ink ────────────────────
  // Base minerals are amethyst / citrine / turquoise / carnelian. On the chamber
  // field each lifts toward alabaster so it keeps its identity at readable value.
  track: '#9B82C4', // amethyst, lifted
  flick: '#CE9126', // citrine, already legible on ink
  calibrate: '#5CB6B9', // turquoise, lifted
  strike: '#D9715A', // carnelian, lifted

  // ── Status, lifted the same way ───────────────────────────────────────────
  ok: '#3E9E77', // malachite, lifted (a hit)
  warn: '#CE9126', // citrine
  danger: '#D9715A', // carnelian, lifted (a miss)
  action: '#3363B0', // azurite, the chamber's primary (lapis is too dark on ink)

  // Hot light: the muzzle flash, impact sparks, the quarry weakspot and the sun
  // disc in the environment map. The brightest mineral in the collection, kept as
  // one token so every source of light in the scene agrees.
  sulfur: '#E0C23F',

  // ── Quarry ────────────────────────────────────────────────────────────────
  // A foreground form must never sit at the background value, so the quarry mass
  // is drawn from the middle of the stone ramp rather than an off-system brown.
  hide: '#635B4B', // --stone-600, catches the warm key light and reads against ink

  // ── Viewmodel materials ───────────────────────────────────────────────────
  // Warm neutrals from the ramp plus two minerals, so the in-scene prop is lit by
  // the same collection as everything else.
  gunmetal: '#423C31', // --stone-700, the frame and cylinder
  wood: '#6E4B44', // hematite, the grip
  brass: '#97742E', // pyrite, the small metal accents
} as const;

const RGB: Record<keyof typeof hex, readonly [number, number, number]> = {
  ink: [23, 20, 15],
  paper: [244, 240, 231],
  alabaster: [251, 250, 246],
  track: [155, 130, 196],
  flick: [206, 145, 38],
  calibrate: [92, 182, 185],
  strike: [217, 113, 90],
  ok: [62, 158, 119],
  warn: [206, 145, 38],
  danger: [217, 113, 90],
  action: [51, 99, 176],
  sulfur: [224, 194, 63],
  hide: [99, 91, 75],
  gunmetal: [66, 60, 49],
  wood: [110, 75, 68],
  brass: [151, 116, 46],
};

/** Translucent draw colour: rgba(colour, alpha) sourced from the locked palette. */
export const rgba = (c: keyof typeof hex, alpha: number): string => {
  const [r, g, b] = RGB[c];
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};
