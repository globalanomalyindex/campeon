# Deagle Recoil + Free-Play Range - Design

**Goal:** Give the Desert Eagle an impactful (cosmetic) fire recoil, and add a free-play "range" at the end of a session where the player can roam, shoot, and feel out their cm/360 - nudging it live by feel and optionally adopting a new number.

**Architecture:** Two related additions on the existing PSX arena stack. (1) A new pure recoil spring channel summed into the viewmodel draw alongside the existing sway. (2) A new `range` route/screen that reuses the arena/cosmetic stack - extracted from `session-view` into a shared `arena-stage` helper - driven by a pure "range director" instead of the instrument loop. No scoring, no optimizer re-run.

**Tech Stack:** TypeScript + Vite + Three.js, vitest (+ jsdom for screen tests). Same pure-core / thin-shell seam as the rest of the app.

---

## Confirmed decisions (from brainstorming)

- **Recoil is cosmetic everywhere** - the gun *sprite* punches; the camera/aim never moves. No view-kick in the range either. This keeps the cm/360 measurement exact in scored drills and makes the range feel identical to them.
- **"Refining" = free-play + live manual nudge** - no optimizer re-run, no `runSession` resume. The player nudges cm/360 by feel and can adopt it.
- **Range targets = a mix** - persistent reference dummies (near/mid/far) *plus* roaming pop-and-respawn mercs.

---

## §1 - Fire recoil (cosmetic, measurement-safe)

**New file `src/ui/viewmodel/recoil.ts` (pure).** A second damped-spring channel, deliberately separate from `sway.ts`: sway is slow, camera-driven parallax; recoil is a sharp, fire-driven snap. Keeping them as two channels (each a small, testable spring) is clearer than overloading one and lets them be tuned independently. Both are summed as cosmetic draw offsets.

```ts
export interface RecoilState { y: number; vy: number; back: number; vback: number; }
export interface RecoilParams {
  stiffness: number;   // snappier than sway → faster settle (~150–220ms)
  damping: number;     // near-critical, no wobble
  kickUp: number;      // vertical impulse (up) per shot, normalized
  kickBack: number;    // backward/scale impulse per shot, normalized
  max: number;         // clamp on |y| and back
}
export const DEFAULT_RECOIL: RecoilParams; // tuned in Chromium, like the sway pass
export function restRecoil(): RecoilState;
export function punch(s: RecoilState, p?: RecoilParams): RecoilState;     // one shot → impulse
export function stepRecoil(s: RecoilState, dt: number, p?: RecoilParams): RecoilState; // settle toward rest
```

**Viewmodel integration (`viewmodel.ts`).**
- Add a `recoil: RecoilState` alongside `sway`, stepped each `tick` (`stepRecoil`), and a new method `fire(nowMs)` = `play('fire','idleReady')` + `recoil = punch(recoil)`.
- In `draw`, sum recoil into the existing transform: vertical kick up (`-recoil.y * el.height`), a slight backward scale-up (muzzle lunges toward the viewer, scale by `1 + recoil.back * k`), and a small extra roll - composed *with* the current sway offset/roll, not replacing it.
- Reduced motion: `tick` already early-returns under `reduced`; `fire()` still swaps to the static fire frame but applies no recoil (consistent with the existing static-frame behavior).

**Call site.** `session-view`'s fire wiring changes from `pointer.onFire(() => viewmodel?.play('fire','idleReady'))` to `viewmodel?.fire(...)`. The range uses the same path. The camera (`CameraRig`) is never touched on fire → `view()` / `bearing()` / cm/360 unchanged. (Integrity: recoil is a pure offset on the overlay; it reads nothing from and writes nothing to the scored stream.)

---

## §2 - Shared `arena-stage` (extraction)

Today `session-view.mount()` inlines the whole cosmetic+arena stack (lines ~70–115: renderer, PSX pass, pointer-lock, `Arena`, async viewmodel, async enemy layer, sway wiring, rAF loop, resize, dispose). The range needs the same stack. **Extract it into `src/ui/arena-stage.ts`** so both screens share one hardened lifecycle (and both get recoil).

```ts
export interface ArenaStage {
  arena: Arena;
  canvas: HTMLCanvasElement;
  requestLock(): Promise<void>;        // wire to a user click (pointer lock)
  setCm360(cm360: number): void;       // live sensitivity (range nudge) → arena.setSensitivity
  ready: Promise<void>;                // resolves once async viewmodel + enemy layers attach
  dispose(): void;
}
export function createArenaStage(host: HTMLElement, opts: {
  canvas: HTMLCanvasElement;           // the screen owns its own DOM; passes its canvas in
  cm360: number; dpi: number;
  reducedMotion: boolean;
  rngSeed?: number;                    // default mirrors session (mulberry32(7))
}): ArenaStage;
```

The stage owns: `WebGLRenderer`, `createPsxPass`, `createPointerLock`, the `Arena`, the async `createViewmodel` + `createEnemyLayer` (with the same `alive`-guard pattern), the `onAim → viewmodel.look` sway feed, the `pointer.onFire → viewmodel.fire` recoil feed, the `createShotFeedback` miss-tick, the rAF loop (`arena.tick`/`render` + `viewmodel.tick`), resize, and full dispose.

`session-view` keeps its HUD/plot DOM, the `runSession` instrument loop, `drawPlot`, and the click→lock→`start()` UX - but builds the arena via `createArenaStage` instead of inline. **The extraction must preserve session-view's observable DOM and its existing tests; it is a refactor, re-verified in Chromium, not a behavior change.**

*Alternative considered:* a standalone range that copies the bootstrap (zero risk to session-view, but duplicates ~40 lines of subtle async/alive-guard/dispose logic). Rejected in favor of the shared helper - single source of truth, and recoil lands in both screens at once.

---

## §3 - Range screen, route, entry

- **Route.** Add `'range'` to `Route` in `shell.ts` and register `range` in `main.ts`'s screen map. Guard it like `result`: if `ctx.lastResult` is absent, redirect to `hero`.
- **Screen `src/ui/range.ts`** (`range(host, ctx): Screen`). On `mount`: build its own DOM (canvas + minimal HUD + nudge controls + "exit" / "adopt" buttons), create the `ArenaStage`, wire a click→`requestLock()`→`startFreePlay()`, and instantiate the **range director** (§4). On `unmount`: dispose the stage and director, `host.replaceChildren()`. Uses `ctx.draft.dpi`, `ctx.draft.bounds` (nudge clamp), and `ctx.lastResult.result.optimalCm360` (starting sensitivity).
- **Entry CTA.** `result.ts` gains a primary `data-action="range"` button ("step into the range") in `result__actions`, navigating to `'range'`; "run again"/"export" remain. The range's "exit" returns to `'result'`.

---

## §4 - Range director (pure, no scoring)

**New file `src/ui/range-director.ts`** - a pure state machine that decides target population over time; a thin adapter in `range.ts` applies its decisions to the arena. **Unified slot model:** every range target is a "respawner"; slots differ only in *where* they respawn.

```ts
type SlotKind = 'fixed' | 'roam';
interface Slot { kind: SlotKind; placement?: { yaw; pitch; distance; worldRadius }; }
interface RangeDirectorState { /* slots + each slot's live target id | pending-respawn-at-ms */ }

export function initRange(slots: Slot[], nowMs): RangeDirectorState;       // spawn all slots
// On each arena fire: classify with the SAME pure classifyHit(view, bearing, radiusDeg) used cosmetically.
export function onFire(state, view, liveTargets, nowMs): { kill?: string };
// Per frame: returns spawn/retire actions for slots whose respawn delay elapsed.
export function tick(state, nowMs): { spawn: Array<{slot; spec: TargetSpec}>; }
```

- **Fixed slots (3 - near/mid/far,** e.g. ~8 m / ~18 m / ~32 m): reference dummies at set bearings/distances. A clean hit retires the struck target (its cosmetic death persists via the layer's existing fade-out set) and respawns **in the same slot** after a short delay (~600 ms) → a persistent "rack" to line up spacing/scale.
- **Roam slots (3):** respawn at a **fresh view-relative random bearing** within FOV (reusing the spawn convention from the instruments) after a short delay, poppers randomized across the four merc sheets for variety.
- **Hit detection** reuses the pure `classifyHit` (`ui/enemy/hit.ts`) so the director's "kill" agrees with the cosmetic pop. The arena's existing `handleFire` already plays the cosmetic death (`enemies.fire`); the director independently decides retire/respawn from the same geometry. Infinite ammo, no recording, no `TrialResult`, no optimizer. Misses surface the existing ember tick (owned by the stage).

---

## §5 - Live nudge + adopt (with an honesty guard)

- **HUD (minimal, mono/brutalist).** Shows the current cm/360 and its delta from the measured number ("+1.5 from your sweet spot"). Nudge via keys (`[` / `]` coarse ±0.5, `Shift+[`/`]` fine ±0.1) and on-screen `−/+`. Each change calls `stage.setCm360(next)` → `arena.setSensitivity(next, dpi)` (live, immediate feel). A pure `nudgeCm360(current, step, bounds): Cm360` clamps to `ctx.draft.bounds` (never ≤ 0).
- **Adopt.** "Adopt this number" recomputes per-game sens with the existing `perGameSens(adopted, dpi)` (`convert/schools`), updates `ctx.lastResult.result.optimalCm360` + `perGameSens`, and marks the result **tuned by feel**.
- **Honesty guard (🎓 measurement-honesty).** A hand-picked number is *not* the measured optimum, so a measured 90% CI must not be shown for it. The result wrapper gains an optional `tuned?: boolean`; when set, `result.ts` replaces the CI line with "tuned by feel - not a measured optimum" and labels the breakdown as characterizing the *measured* run (the breakdown is left at the measured optimum; it describes the measurement, not the hand-picked value). "Reset to measured" clears `tuned` and restores the measured `optimalCm360` + `perGameSens` (reloaded from storage, which still holds the measured result). The export reflects whichever is current, with the `tuned` flag included so the JSON is self-describing.

---

## §6 - Accessibility, reduced motion, navigation

- **Reduced motion** (`matchMedia('(prefers-reduced-motion: reduce)')`, queried once at mount, as elsewhere): static gun (no recoil, no idle/sway), enemy static frames, no decorative motion - passed into `createArenaStage` → `createViewmodel`/`createEnemyLayer` exactly as session-view does today. The range is still fully playable (aim + fire + nudge work; only motion is stilled).
- **Pointer lock & exit.** Click to enter (lock); Esc releases lock; a visible "exit range" control returns to `result`. The crosshair and decorative HUD chrome are `aria-hidden`; the nudge/adopt/exit controls are real, focusable buttons with labels.
- **Teardown.** `unmount` disposes the stage (which disposes renderer/arena/psx/pointer/viewmodel/enemy/feedback and cancels rAF) and the director, then clears the host - same discipline as session-view, with the `alive`-guard preserved inside the stage for the async layers.

---

## §7 - File structure

**New**
- `src/ui/viewmodel/recoil.ts` - pure recoil spring (§1).
- `src/ui/arena-stage.ts` - shared arena/cosmetic stack + lifecycle (§2).
- `src/ui/range.ts` - the range screen (§3).
- `src/ui/range-director.ts` - pure target-population state machine (§4).
- `src/ui/range-nudge.ts` - pure `nudgeCm360` clamp helper (§5) (or co-locate in range-director; one small pure module).

**Modified**
- `src/ui/viewmodel/viewmodel.ts` - add `fire()`, recoil channel in `tick`/`draw`.
- `src/ui/session-view.ts` - build the arena via `createArenaStage`; call `viewmodel.fire()`. Behavior-preserving.
- `src/ui/shell.ts` - add `'range'` route + the `tuned?` flag on `lastResult`.
- `src/ui/result.ts` - "step into the range" CTA; tuned-by-feel CI swap.
- `src/main.ts` - register the `range` screen factory.
- `src/engine/camera-rig.ts` / `src/engine/arena.ts` - **no change** (`setSensitivity` already exists on both).

---

## §8 - Testing

**Pure unit tests (vitest):**
- `recoil.test.ts` - rest stays at rest; a `punch` displaces then `stepRecoil` settles back to ~0 (bounded by `max`, finite); reduced path is the viewmodel's concern.
- `range-director.test.ts` - `initRange` spawns every slot; a classified kill retires that slot and schedules a respawn; `tick` emits the respawn after the delay; fixed slots respawn in place, roam slots at a fresh bearing; a miss spawns nothing. Driven by an injected clock (no real time).
- `range-nudge.test.ts` - clamps to bounds at both ends, never inverts, honors coarse/fine steps.
- `result`/adopt - adopting recomputes `perGameSens` for the new number and sets `tuned`; reset restores the measured values; tuned hides the CI. (jsdom screen test, like existing `result`/`session-view` tests.)

**Runtime verification (Chromium, via the preview/eval pattern):** recoil reads punchy on fire and recovers; the range stands up from the result CTA with dummies + poppers; shooting pops + (for roam slots) respawns elsewhere; the nudge changes feel live and the HUD delta tracks; adopt round-trips to the result screen showing "tuned by feel" with no CI; reduced-motion stills the gun but keeps play working; clean unmount (no leaked rAF/renderer). The session screen still runs a full measured session unchanged after the `arena-stage` extraction.

---

## §9 - Non-goals / YAGNI / honest residuals

- **No optimizer re-run / `runSession` resume.** "Refining" is feel-based nudging only (per decision). Re-measuring to tighten the CI is explicitly out of scope.
- **No scoring/telemetry in the range.** It is a sandbox; nothing is recorded or saved except an explicit "adopt".
- **No view-kick.** Recoil never moves the camera, anywhere - the measurement integrity line.
- **Residual honesty:** an adopted number's breakdown still reflects the measured run (interpolating a fresh breakdown for an arbitrary hand-picked point would over-imply measurement); this is labeled, not hidden.
