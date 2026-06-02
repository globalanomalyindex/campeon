/** cm/360 conversion. yaw = degrees turned per mouse count at in-game sens 1. */
export const TURN_CM = 360 * 2.54; // 914.4

/** Physical cm of mouse travel for one 360° turn. */
export function cmPer360(dpi: number, sens: number, yaw: number): number {
  return TURN_CM / (dpi * sens * yaw);
}

/** In-game sensitivity that yields the target cm/360 at this DPI and game yaw. */
export function sensFor(cm360: number, dpi: number, yaw: number): number {
  return TURN_CM / (dpi * yaw * cm360);
}

/** Convert a sens between games preserving cm/360 (360-distance match). */
export function crossGame(
  sens: number, dpiFrom: number, yawFrom: number, dpiTo: number, yawTo: number,
): number {
  return (sens * (yawFrom * dpiFrom)) / (yawTo * dpiTo);
}
