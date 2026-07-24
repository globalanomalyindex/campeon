# campeón design canon

The single source of truth for this redesign. If something here conflicts with existing
code, this file wins and the code changes. Read this before touching any file.

Source system: **Chris Robin Fiore Design System** (claude.ai design project
`d49fce01-ddfa-45ba-a19d-9e6c41d99ee5`). This document is the campeón-specific
application of it, plus the decisions that system did not already make for us.

---

## 1. The thesis

campeón measures one number, cm/360, by scoring four facets of your aim and
converging on the value where you score best across all four.

The Fiore system studies colour as composition: minerals and stones treated as
specimens, arranged and labelled so that ratio, adjacency and dominance become the
subject. Flat, warm, matte, precise. Museum specimen drawer.

Those two things are the same shape. A measurement with four facets is a specimen with
four faces. So campeón presents your aim as a study: one dominant field (the number),
four mineral-coded facets, and a museum tag that says what was measured and how well.

The previous skin was a spaghetti-western pastiche: film grain, blood red, brass gold,
a dot-matrix display face, a title sequence. It was decorative. It dressed the
instrument as something else. Everything in section 4 replaces it.

---

## 2. Hard invariants (inherited, non-negotiable)

These predate this redesign and survive it. A visual change that breaks one of these is
not a visual change, it is a bug.

1. **Measurement integrity.** The hidden gold sphere is the sole owner of cm/360.
   The scored `Recording` stream must be byte-identical with cosmetic layers on or off.
   Cosmetic layers read the scored stream and never write to it. The integrity gate in
   `tests/engine/arena-enemies.test.ts` proves this. It stays green.
2. **Measurement honesty.** No fabricated signal. CIs widen only. A value the user
   hand-tuned in the range carries no measured CI. Copy never asserts a cause the data
   cannot distinguish.
3. **Pure core, thin shell.** All maths and logic stays pure and unit tested. Only the
   WebGL and canvas shells are runtime-verified. The renderer-agnostic seam holds:
   stub renderers never touch WebGL.
4. **Conventions.** Canvas colours mirror the CSS palette through `src/palette.ts`.
   Animate `transform`, `opacity` and `filter` only. `prefers-reduced-motion` is
   plumbed everywhere.
5. Start green, stay green. 642 tests at baseline `dafc200`.

---

## 3. The Fiore rules that bind us

Copied from the source system because they are absolute. No interpretation.

**Type.** Two families, **Regular weight only**. Never faux-bold, never a synthetic
weight, never `font-weight: 700`. Hierarchy comes from size, case, colour and tracking.
- `Dessign Maison` (family name in Figma: `SLTF Dessign Maison`): display sizes,
  headings lg/md, the wordmark. Tightens at scale, `-0.02em`.
- `Karrik`: body, UI, small headings, labels.
- Body 16 to 18px at 1.55. Display down to 0.98 line-height, up to 128px.

**Colour.** Warm stone ramp holds the room. Twelve minerals are a collection to draw
from. Lapis is the one interactive primary. Ratio is the subject: a dominant field plus
a small accent, at most one or two dominant colours in a composition.

**Corners.** Zero radius. Everywhere. Frames, cards, controls, inputs, chips, dialogs
all cut square. Circles exist only as content or affordance: status dots, switch thumbs,
round swatches. Never as frame rounding.

**Layout.** 8px rhythm. Padding is inner: blocks are sized edge to edge and butt against
each other. Grids join on a 1px lattice (`gap: 1px` over `--border-hairline`) rather
than floating apart. Prose measure about 64ch.

**Backgrounds.** Flat warm paper. No gradients as decoration. No photographic washes,
no repeating textures, no noise by default.

**Shadows.** Matte, warm ink-tinted, faint. Nothing glossy. No coloured glows.

**Motion.** Calm. Fades and small translations. No bounce, no overshoot. Default
`--ease-standard: cubic-bezier(.2,0,0,1)`. Durations 120 / 200 / 360ms.
Hover is a small tonal shift. Press deepens and nudges `translateY(1px)`, a settle.

**Voice.** First person, casual, direct, plain. Sentence case for everything readable.
Tracked UPPERCASE only for small labels and captions. No emoji. **No em dashes
anywhere.** No rhetorical flips: never "it isn't X, it's Y", never "X, not Y", never
negation-then-reveal. No hype, no superlatives, no marketing register. Ratios written
`80 / 20`. Catalog numbers `No. 014`. Hex uppercase in mono.

**Mark.** There is no logo. The wordmark is the name set in Dessign Maison.

---

## 4. campeón decisions (what the source system left open)

### 4.1 Two surfaces: paper chrome, ink chamber

Everything the user reads sits on warm paper (`--surface-page`, `#F4F0E7`).
Hero, setup, result, range chrome, case study, options.

The arena keeps a dark field, on `--stone-900` warm ink `#17140F`, and only for a
functional reason worth stating: a precision aiming task depends on target contrast and
on the eye staying adapted for the length of a drill. A bright field would change what
we measure. The source system already provides for this: `--surface-inverse` is
`--stone-900`.

So the arena is the **specimen chamber**. Paper frames it, ink holds the measurement.
Stepping into a drill is a real transition and the flow should treat it as one. This is
the only place the app goes dark, and it earns it.

### 4.2 The four instruments are four minerals

Lapis is reserved for interactive meaning: primary actions, links, focus. It is never
an instrument colour, so blue always means "you can act on this".

| instrument | environment | mineral | hex |
|---|---|---|---|
| track | the open-air intercept | Amethyst | `#6A49A0` |
| flick | the ambush | Citrine | `#CE9126` |
| calibrate | shooting through the bend | Turquoise | `#2C8F93` |
| strike | the strike window | Carnelian | `#B8462C` |

Chosen for maximum hue separation across the collection (270 / 40 / 185 / 15 degrees)
while staying inside one value band, so the four read as a set of specimens rather than
a rainbow. Each carries its wash tint for fills.

Status mappings stay as the source system defines them: success Malachite, warning
Citrine, danger Carnelian, info Turquoise. Where a status and an instrument share a
mineral, the context disambiguates (a hit indicator is not a facet label).

### 4.3 The result is a specimen card

The payoff screen is the study. One dominant field, small accents:

- The number set in Dessign Maison at `--text-display-2xl`, in **warm ink on paper**.
  Not a coloured number. The composition carries the payoff.
- The 90% CI as a hairline rule beneath it, not a coloured badge.
- The four facets as a mineral-coded rail: small swatches with tracked-caps labels,
  reading as a museum tag.
- A hand-tuned value shows no measured CI. That rule is honesty, not style.

### 4.4 What gets removed

These are decorative under the source system's rules and they go:

- The film grain overlay (`.reel`) and its flicker. "No noise by default."
- The gold-selective bloom in the film pass. "No coloured glows."
- The screen-flash cuts and the `route-flash` film cut between screens.
- The blood red and brass gold accents, replaced per 4.2.
- Bartine Disco, replaced by Dessign Maison and Karrik.
- The spaghetti-western title sequence as a gate. See 4.5.

### 4.5 The front door

The current hero is a timed title sequence the visitor must sit through or find a small
skip control for. For a portfolio piece that is a funnel problem: the first thing a
reviewer meets is a wait.

The new hero is a specimen card. The wordmark in Dessign Maison, one plain first-person
sentence about what the tool does, and the primary action available immediately. Any
atmosphere is earned on the way into the chamber, not charged at the door.

---

## 5. Writing for this app

The voice is Chris, first person, observing and precise. Some concrete swaps:

- "evolution is defined as ... until it cannot be beaten" becomes a plain statement of
  what the tool measures.
- Labels are museum tags: `NO. 02 · THE AMBUSH · SPIDER, RAPTOR`.
- Numbers: `32.4 cm/360`, CI written `29.1 to 36.0`, ratios `80 / 20`.
- Say what was measured and how confident it is. Do not dramatise it.

Check every user-facing string. There are no em dashes in this codebase and there will
be none after. The double-hyphen `--` is also banned in prose (it survives in CSS
custom property names, which is fine).

---

## 6. Scope discipline

Do not change: the optimizer, the instruments' maths, the scoring, the statistics, the
recording format, or anything under `src/scoring/`, `src/stats/`, `src/optimizer/`,
`src/instruments/` unless a verified audit finding says so and the finding is about
correctness, not looks.

`src/palette.ts` is the mirror seam. Canvas and 3D colours read from it. Change the
palette there and in `tokens.css` together, never one alone.
