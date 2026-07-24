# Figma file copy

Every string below is final. Place it verbatim. It is written in my voice, first person,
sentence case, no em dashes, no rhetorical flips, no hype.

---

## PAGE 00 · Read me

### Title (display, outlined)
campeón

### Standfirst
A tool that measures the mouse sensitivity you actually aim best at, and the design system
I built it on.

### Body
campeón runs four short drills. Each one scores a different facet of aim, and a search
converges on the one cm/360 where all four agree. It reports that number with a 90%
confidence interval, and it refuses to report one when the data cannot support it.

This file is the design side of that work. It has the foundations, the screens, the
decisions I made and why, and an honest log of how I ran the AI agents that helped.

### How to move through this
- 01 Foundations. Colour, type, spacing, and the rules I hold myself to.
- 02 Components. The small pieces every screen is assembled from.
- 03 Screens. The real product, annotated.
- 04 Flow. What happens in what order, and where people used to fall out.
- 05 Decisions. The calls I made, including the ones I got wrong first.
- 06 How I used AI. What I delegated, what I kept, and what it caught that I missed.

### Constraint note (small, muted)
Figma cannot load either of my brand faces in this environment. So every display specimen
in this file is a real outlined vector of the actual font, drawn from the font binary. The
small annotation text is Archivo, standing in for Karrik. Where you see outlined type, the
shapes are exact. Where you see annotation text, read the letterforms as a placeholder.

---

## PAGE 05 · Decisions

### 01 · I took the front door down
The hero used to be a title sequence. Four lines of an epigraph faded in one at a time,
then a flash, then the menu. It was 18.7 seconds before anything on screen could be
clicked.

I liked it. I built it. It still had to go. The first thing a portfolio piece communicates
should not be a wait, and the interesting part of this project is the measurement, not the
atmosphere. The hero is now a specimen card: the wordmark, one sentence about what the
tool does, and the primary action live at first paint. The four instruments sit beside it
as a drawer, so you can see what gets measured before you commit to anything.

If atmosphere earns a place, it is on the way into the arena, not charged at the door.

### 02 · Paper everywhere, ink only where it is doing work
My system is warm paper. A first-person shooter is dark. I did not want to resolve that by
picking a side.

So the whole product sits on paper, and exactly one surface goes dark: the arena. It earns
it for a reason I can state. A precision aiming task depends on target contrast and on the
eye staying adapted for the length of a drill, and a bright field would change what I am
measuring. The dark surface is a measurement decision that happens to look good, rather
than a style I applied and then justified.

In code this is one attribute. `data-surface="chamber"` re-points the same semantic token
names at the inverse end of the stone ramp, so every component works on both surfaces
without knowing which one it is on. I did not fork a second token set.

### 03 · The four instruments are four minerals
I keep Lapis for interactive meaning only, so blue always means you can act on this and
never names an instrument. The four drills take Amethyst, Citrine, Turquoise and Carnelian,
chosen for the widest hue separation I could get inside one value band. They read as a set
of specimens rather than a rainbow.

The colour is not decoration here. Every facet on the result screen, every mark on the
convergence plot and every dot in the drawer uses the same four, so you can follow one
instrument through the whole product by colour alone.

### 04 · The number is ink, not gold
The old result screen put the answer in a big glowing gold number. I made it warm ink on
paper at 128px, with the confidence interval on a hairline underneath and the four facets
as a small mineral-coded rail.

A number that has to glow to feel like an answer does not trust itself. This one is the
largest thing on the page and the quietest, and the composition carries it.

### 05 · Regular weight only, which is a constraint I chose to keep
Both of my faces ship one weight. That means I cannot reach for bold when a hierarchy is
not working, and I have to fix it with size, case, colour or tracking instead. It made the
type harder and the result better. There is a test in the repo that fails the build if
anyone requests a weight above 400.

### 06 · The tests hold the design, not a document
Rules that live only in a document drift. So the canon is enforced mechanically:
`tests/tokens.test.ts` fails if a frame gains a radius, if a weight above 400 appears, if a
decorative gradient or a coloured glow shows up, if a motion curve overshoots, or if the
CSS palette and the WebGL palette drift apart. It caught me twice while I was building
this, once for a crosshair ring I had written as a box-shadow.

---

## PAGE 06 · How I used AI

### Standfirst
I ran this like a team, not like a chat window. Here is exactly what I delegated, what I
kept, and what it found that I would not have.

### How I set it up
I wrote the design canon first, by hand, before any agent ran. One document that states the
system, the decisions it left open, the hard invariants, and what is out of scope. Every
agent had to read it before doing anything. Without that, parallel agents diverge and you
spend longer reconciling their work than you saved.

Then I split the work by lens, not by file. Six independent auditors each looked at the
whole product through one discipline: design system adherence, product flow, copy and
voice, accessibility, engineering correctness, and the case study as a portfolio artifact.
Each one only had to be good at one thing.

### The part that mattered most: I made them argue
Every finding went to a second agent whose instructions were to refute it. Default stance
was that the finding is wrong. It only survived if the verifier opened the file, read the
line, and confirmed it personally.

That pass killed 11 of 84 findings. Several were confidently written and completely wrong:
a cited line that said something else, a defect already handled elsewhere, a fix that would
have broken an invariant. One verifier caught that I had rewritten the token files while
the audit was running and correctly threw out seven findings that described code no longer
on disk. Without the adversarial pass I would have spent an afternoon implementing fixes
for problems that did not exist.

### What it caught that I did not
The one that justifies the whole exercise was not a design finding.

Three of the four instruments stamped their first target with a timestamp of zero while
measuring every duration against a clock that starts when the arena is built and never
resets. So the opening tap of every trial absorbed the entire elapsed session. On a real
run, flick recorded a mean movement time of 20,048 ms where the truth was 48 ms, and strike
recorded a time to kill of 30,048 ms where the truth was 48 ms.

The error grew as the session went on, which is what makes it serious. It did not add
noise, it added a slope. Trials run late scored worse than trials run early for no reason
connected to sensitivity, which pulled the reported optimum toward whatever the search
happened to sample first. The tool was confidently reporting a biased number.

My own test suite missed it for the same reason it is easy to miss: a stub scene also
starts its clock at zero, so the bug was invisible in every test and only appeared in a
real session.

I fixed it by presenting on the first frame so the stamp carries the real clock, and I
wrote the regression as a property rather than a value: a trial has to score the same
wherever it lands in the session. That test fails on the old code.

### What I did not delegate
I wrote the canon, the type system, the colour mapping, the hero, the result screen, and
every honesty-critical decision myself. I reviewed every agent diff before it landed. When
four agents implemented in parallel I partitioned them by file ownership so they could not
collide, and I gave each one the same non-negotiable list: no fabricated signal, confidence
intervals widen only, a hand-tuned value carries no measured interval, and the scored data
stream stays byte-identical whether the cosmetic layers are on or off.

I also overrode them. One auditor wanted the arena brought onto paper for contrast
consistency. That would have been correct for the design system and wrong for the
measurement, so I kept the dark surface and wrote down why.

### The numbers
- 6 audit lenses, each verified by an independent refuter
- 84 findings raised, 73 confirmed, 11 refuted
- 4 implementation agents, partitioned by file ownership, plus a verification pass
- 1 measurement defect that was biasing the product's central output

### What I would tell someone starting this
Write the standard down before you fan out. Make something argue with the output. And keep
the judgement calls, because the agents are good at finding things and much less good at
knowing which of them matter.
