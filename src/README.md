# The House

A procedurally generated maze that up to six people try to leave together before
the thing inside stops them. Proximity voice, shared loot, and you all walk out
of the same door or nobody does.

## Run it

ES modules need a real HTTP server:

```
python3 -m http.server 8000
```

Then `http://localhost:8000`.

## On a phone

Touch is detected from `(pointer: coarse)` and changes four things:

- **Graphics default to Potato**, and field of view opens up a little. A default
  only — anything you have saved wins.
- **Pixel ratio is capped at 1.0** regardless of preset. Phones report a device
  ratio of 3 or 4; honouring that renders nine to sixteen times the pixels of
  the CSS size for no visible gain and a great deal of heat.
- **A virtual stick, a look zone and six buttons**, laid out as a right-thumb
  arc with the one you press most in the middle of it. The stick re-centres
  under your thumb wherever it lands, has a 14% dead zone, and stays analogue —
  easing it over gives a slow quiet walk, which matters when the thing hunting
  you goes by noise.
- **No pointer lock and no click-to-look prompt**, since there is nothing to
  capture.
- **Landscape is requested on entering a house** and released on leaving. Every
  browser that can lock orientation requires fullscreen first, and iOS Safari
  cannot lock at all, so a failure falls back to a "turn your phone" screen
  rather than pretending it worked. Switchable off in the customiser.

### Moving the controls

Settings → Controls → *Move the on-screen controls*. Drag any button anywhere;
tap one to resize just it; sliders for overall scale, transparency and stick
size; Reset puts it all back.

Positions are stored as **fractions of the viewport**, not pixels, so a layout
survives a rotation or a move to a different phone. Buttons are clamped so the
whole button stays on screen however far you drag, and a non-finite position is
refused outright — writing a `NaN` into saved settings would make that button
vanish on every future run, which is a bug you would never connect back to
having dragged something.

Everything is pointer-event based with explicit `pointerId` tracking, because
the stick, the look drag and a button press all happen at once. Verified:
walking and turning simultaneously, a stray pointer id ignored, a button
released by the wrong finger staying held, and momentary buttons not sticking.

Touch writes an analogue vector and a set of held actions onto the player, which
reads them through exactly the same `held()` the keyboard uses, so every
ability, binding and cooldown works untouched.

## Controls

Every key is rebindable under Controls, including mouse buttons (useful for
push to talk). Defaults:

| | |
|---|---|
| W A S D | move · **Shift** run |
| F | flashlight |
| Ctrl | crouch |
| Q | your character's ability |
| E | hold to pick a downed teammate up |
| V | push to talk |
| F2 | frame stats, seed and net role |
| Esc | release the mouse |

Pressing Escape gives you a Settings button without pausing. Nothing pauses in
multiplayer, because a pause the other five do not share is just a way to get
killed while reading a slider.

## Characters

Every ability hooks a system that already exists rather than adding a parallel
one, which is why none of them needed new simulation code:

| | Passive | Ability |
|---|---|---|
| **The Lamplighter** | Torch reaches 50% further | Drops a flare that lights a room for 20 s and *lures the ghost to it* |
| **The Runner** | 15% faster, quieter footsteps | Four seconds of speed nothing can match |
| **The Nurse** | Revives twice as fast, bleeds out slower | Gets herself up off the floor — once per run |
| **The Scavenger** | Loot glows through walls within 18 m | Every item and the exit light up for 8 s |
| **The Quiet One** | Running does not make you loud | Six seconds completely absent from the ghost's senses |
| **The Warden** | First knife each run is absorbed | Shoves the ghost down for five seconds |

The Lamplighter's flare is a second dynamic light in the house shader. Two is
the ceiling — any more and the point of baking is lost.

## Settings

Audio is three buses under one master (effects, ambience, voices), so each
slider means what it says instead of ducking everything.

Graphics is four presets driving pixel ratio, sight distance, bake tessellation
and antialiasing. **Higher quality does not cost frame rate here.** The lighting
is baked once at load, so quality buys finer light for load time, not for
milliseconds per frame:

| Preset | Sight | Bake scale |
|---|---|---|
| Potato | 20 m | ×1.55 |
| Low | 26 m | ×1.28 |
| Balanced | 34 m | ×1.0 |
| High | 42 m | ×0.85 |

The bake step also scales with plot count, so 2.5× more rooms does not mean
2.5× the vertices. The largest house lands at 435k vertices and about 220 ms.

Culling is unaffected by the extra rooms, which is the point of it:

| Difficulty | Meshes | Drawn (avg) | Drawn (max) |
|---|---|---|---|
| Quiet | 131 | 16.3 | 23 |
| Restless | 238 | 15.6 | 23 |
| Hunted | 353 | 18.6 | 23 |
| Starving | 518 | 16.7 | 23 |

Four times the meshes, same frame cost.

Antialiasing cannot be toggled on a live WebGL context, so changing it swaps in
a fresh canvas — only ever from a menu, never mid-run.

Walk into the green light to escape. Pick up what glows on the way. If it knocks
you down and no one revives you, you lose everything you were carrying.

## The four difficulties

| | Rooms | Lit | Ghost speed | Knife cooldown | Pays |
|---|---|---|---|---|---|
| | Rooms | Total spaces | Lit | Ghost speed | Knife cooldown | Pays |
|---|---|---|---|---|---|---|
| Quiet | 48 | 109 | 62% | 2.0 m/s | 7.5 s | ×1.0 |
| Restless | 88 | 201 | 50% | 2.4 m/s | 6.0 s | ×1.7 |
| Hunted | 130 | 310 | 40% | 2.8 m/s | 4.4 s | ×2.6 |
| Starving | 187 | 453 | 30% | 3.2 m/s | 3.2 s | ×4.0 |

Rooms are their original size — 57–59 m² on average, 136 m² at the largest —
and there are **about 2.5× more of them**. "Total spaces" counts passages and
crawl tunnels alongside rooms, which is what the culler actually switches.

## The way out

The door has four holders and stays shut until all four are full. Four objects
are scattered through the house, each sitting beside a screen you have to beat
to release it — then carry it back and set it in the door.

**The screens are the cost.** Every three seconds one is running, it calls every
ghost within 45 m towards it, and every 1.5 seconds it makes an audible racket so
you can hear what you are doing to yourself. You cannot move while a panel is
open — it takes both hands. Walk away at any moment with Escape or by clicking
off it; you lose only your progress on that puzzle.

Three of them, chosen per terminal:

- **Reset the panel** — 4×4, a switch throws its neighbours too. Generated by
  walking backwards from solved, so it is always solvable and never starts
  solved. Verified over 300 boards.
- **Clear the ledger** — five sums. Addition and subtraction use two two-digit
  numbers; multiplication uses two-digit against single-digit, because 47 × 83
  in your head while something walks towards you is not a puzzle, it is a
  formality you fail. Never produces a negative answer.
- **Match the plate** — swap blocks until the row matches the plate above it.

## Shop

Characters cost shards. The Lamplighter is free forever — there has to be
someone to play as before anyone has earned anything.

Clicking a card **previews** it on the same turntable the character screen uses;
buying is a separate button, and only that button spends. Nobody should have to
pay 2,200 shards for a silhouette they have only seen as a coloured dot.

## The menu

The screens behind the menu are not a picture of the game — they are a room in
it. A narrow 19 m corridor with a lit doorway at the far end, built out of the
same boxes, lit by the same vertex-colour bake, drawn with the same shader.
13k vertices, three meshes, 900 dust motes in one more draw call, 0.018 ms per
frame to animate.

**The figure is the ghost**, using the material the hunters use in game — your
own `ghost.glb` if you have supplied one. It stands on the floor between you and
the only real light, so it reads as a hole in the doorway rather than an exhibit
under a spotlight. It sways, drifts a couple of metres closer over about half a
minute, then eases back. There is no plinth: it is not on display, it is in the
way.

Almost all the light comes through the doorway. Everything nearer the camera is
a dying lamp, which keeps the timber legible without the corridor ever being
comfortable. The camera drifts on two out-of-phase sines per axis so the motion
never visibly loops.

It shares the texture load with the first house, so it costs nothing extra and
appears a moment after the menu rather than holding it up.

## Blackboards

About one per eleven rooms. Walk up, press the use key, write. They are the only
way to leave something for the people you have been separated from.

**They sync as strokes, not as images.** A stroke is a colour, a width and a run
of normalised points — 166 bytes on average, 280 at most, and a completely
covered board is about 4 KB. The same data as a PNG would be around 200 KB per
update. They go on the reliable channel because a lost stroke leaves a
permanent gap in someone's handwriting, and they replay in arrival order, so
nobody ever has to send a whole board.

Verified by feeding 25 strokes to two independently created boards and comparing
every one of the 539 resulting canvas operations: identical.

## The notice by the front door

The rules, printed on the wall of the room you start in, so somebody who has
never opened the menu still knows the house wants four things and that the
screens are loud.

## Closets

One per ten rooms, one person each. Inside you are invisible to every sense
they have and you watch through the peephole; your view is a slit and you cannot
turn far. From outside, a lit peephole means it is already taken.

Stepping out puts you at the first clear spot in front of the closet, searched
outward and sideways. Previously you were left standing on the closet's own
position — inside its collider and usually inches from a wall — and the push-out
had to resolve a deep overlap against two surfaces at once, which could eject
you through the wall. Measured across 230 generated closets, the old exit point
was inside geometry **230 times out of 230**; the new search finds a clear spot
in all 230 with no fallbacks.

## The ghosts

**One per seven rooms** (`ghostShare: 0.15`), so 7 on the smallest house and 28
on the largest — about one per 1,500 m². A fixed
three barely registered once houses got big — you could walk for minutes without
meeting anything. Twenty-eight of them cost 0.14 ms per frame to
simulate, after the A* open list was moved to a binary heap. Their meshes
bypass frustum culling so the shader wobble is never clipped, so they are
distance-culled instead — typically none are drawn at all.

They spawn far from the entrance, far from the exit, and far from *each other* — spacing them from each other matters as much as from
you, because three ghosts in one wing is one ghost with extra steps and leaves
two thirds of the house empty.

They stay spread. Wandering picks the nearest of five sampled destinations to
each ghost's own territory anchor, which drifts when a chase legitimately takes
it somewhere new. Measured over seven minutes of idle patrol, the closest pair
stayed between 123 m and 159 m apart the whole time.

Per-ghost knife cooldowns are longer than they were for a single hunter. Three
converging on one player was never the intent; being found by one while avoiding
another is. Trap frequency is divided by the ghost count, so three of them do
not carpet the house three times faster than one did — 24 snares in seven
minutes against a predicted 25.

Set `ghostShare` in `src/difficulty.js` to change the density per house.

On Hunted and Starving they can **hear your microphone**. Shouting reaches 2.4×
the hearing radius — further than sprinting does. The channel that keeps you
coordinated is the same one that gives you away. Mic input gain is under
Settings → Audio.

Every ghost speed sits below your sprint (5.0 m/s) and near your walk (3.1 m/s),
so you can always outrun it down a straight line and never while navigating.
That gap is the game.

## Crawl tunnels

Extra connections laid on top of the maze, with a 1.35 m opening. **Nothing
special-cases the ghost out of them** — the lintel above the hole is an ordinary
collider whose base sits at 1.35 m, and collision now asks how tall you
currently are. A crouching player (1.05 m) fits. A standing one (1.9 m) and a
2.2 m ghost do not. Verified across every generated tunnel: standing blocked
7/7, crouching passes 7/7, ghost blocked 7/7, and normal passages block nobody
(0/41).

Ghost pathfinding also refuses crawl edges, not to enforce the rule but so it
never plans a route it would then stand and grind against. 172 sampled ghost
routes produced zero waypoints inside a crawlspace.

Harder houses get *more* tunnels, not fewer. A faster ghost in a bigger house
without an escape valve is unfair rather than frightening.

## Traps

Only on Hunted and Starving. A snare is left behind every 17–26 seconds
(divided across the three ghosts) while they are *searching*, never while
chasing — so they accumulate along
the routes it patrols and the danger sits where it has already been.

Stepping in one does not knock you down. It pins you for 2.6 seconds and makes
enough noise to bring **every** ghost, which is worse, because now you are the
one standing still.

## Textures and light

### Models

`assets/models/` takes `.glb` files for the player, ghost, closet, terminal,
relic and door, plus nine kinds of furniture: chair, table, bed, shelf, cabinet,
crate, lamp, rug and painting.

The generator gives every piece its own dimensions — a chair is 0.48–0.62 m
across, a bed 1.35–1.75 by 1.95–2.20 — and scales your model to whatever it
rolled, uniformly, so the collider always matches what you see. Beds, shelves,
cabinets and paintings are set **against a wall facing into the room**; rugs and
paintings have no collision at all, so you walk over one and under the other.

Furniture with a model cannot take the vertex bake, so it becomes its own object
inside the room's group and rides the same portal culling. Furniture without one
stays a baked box, which means a half-filled `assets/models` folder is a
perfectly normal state. Every slot is optional and falls back to the primitive
the game already draws.

**You do not need to match a scale or an origin.** Each model is measured, scaled
so its bounding box hits a target height, recentred on X/Z and dropped so its
feet sit on the floor. It does need to face −Z. Draco compression is supported
and the decoder is only fetched if a model uses it. Full notes in
`assets/models/README.md`.

### Supplying your own textures

Drop images into `assets/textures/` as `wall.jpg`, `floor.jpg` and
`ceiling.jpg`. Each surface falls back independently to a generated tile if its
file is missing, so you can replace one at a time and an empty folder still
runs. Paths, per-surface tiling scale, and an off switch are in
`src/assets.js`; full requirements are in `assets/textures/README.md`.

The loader measures each supplied image and warns in the console if its average
brightness is outside 0.32–0.68, because the shader doubles whatever it samples
and a dark image silently shifts the whole house away from what the lighting
bake computed.

### The generated fallback

Three 512 px tiles drawn on canvas at load, all of them dark aged timber: vertical
wall panelling with knots that pull the grain around them, warped floor planks,
and ceiling boards crossed by heavier beams. No image files, about 60 ms. They
are deliberately plain — they exist so the game runs with an empty assets folder,
not to compete with real textures.

**No UV attributes exist.** Every surface is axis-aligned, so the shader
projects world coordinates onto whichever axis the face points down. Exact, no
seams, and a 30 m wall tiles correctly with nothing authored.

### Telling a wall from a floor

Three timber textures on their own read as one continuous wooden box, so the
shader adds a **skirting board and a picture rail** from world height, on wall
surfaces only. Two smoothsteps, no geometry, and they do more to separate wall
from floor and wall from ceiling than any amount of texture work. Ceilings also
get a cold, darker tint so a glance upward is never mistaken for a glance along.

### Telling one room from another

**Three genuinely different materials per surface**, giving 27 combinations
before colour or grain direction is considered:

| | | | |
|---|---|---|---|
| **Wall** | panelling | damp plaster | coursed stone |
| **Floor** | warped planks | cracked tile | rough boards |
| **Ceiling** | boards and beams | stained plaster | sagging lath |

Nine textures would mean nine samplers and nine fetches per fragment. A 2×2
atlas would need `textureGrad` to keep its mip levels honest, which means GLSL3
and a much larger change. So every pattern is generated **greyscale and three
are packed into the R, G and B channels of one tile**: the shader samples once
per surface type and dots the result with a one-hot weight. Choosing a variant
costs a dot product, and the fetch count is unchanged at three.

Colour therefore comes entirely from the per-room albedo — texture supplies the
pattern, albedo supplies whether it reads as wood, damp or stone. That split is
also what lets a supplied colour image still work: `uPacked` tells the shader to
leave its RGB alone.

On top of the material, each room gets an offset and an optional quarter turn,
hashed from its id so it survives regeneration from a seed. The rotation is
applied first, so floorboards genuinely run a different way from one room to the
next rather than merely starting at a different phase.

All nine patterns are verified distinct (pairwise correlation below 0.25),
exposure-matched to within 0.02, and seamless — the wrap-around pixel pair is
compared against **every** internal pair in the tile, which is the only
period-agnostic way to ask the question. That caught a real one: with only four
planks, `rough boards` had a first-to-last tone step larger than anything
inside the tile. Plank tones are now built from sine harmonics, so the sequence
is periodic by construction and the wrap step can never be the worst one.

Two things measurement caught that hand-tuning would not have:

*The tiles averaged 0.365–0.413 luminance.* The shader doubles them, so that
would have darkened the entire house by ~20% below what the lighting bake
computed. They are now normalised to 0.52 at generation.

*Vertical wrap deltas of 20–28.* Noise only wraps when its coordinate advances
a whole multiple of the tile, and I had used scale factors of `0.45` and `0.25`.
Every noise scale is now an integer.

Seams are checked against an *equivalent internal plank boundary* rather than
against smooth mid-board pixels, because the tile edge falls on a plank gap by
construction and comparing it to flat timber flags a deliberate feature as a
defect. That check caught a real one: the ceiling beams started at x = 0, so
every tile repeat put a beam edge exactly on the seam and advertised the repeat.
Offsetting them half a period dropped that seam from 9.9 to 0.5.

### Flickering

Baked light cannot flicker — that is the trade for having no runtime lighting
cost. So lights marked as failing are kept out of `aLit` and accumulated into
two separate vertex channels, which the shader adds back scaled by a live
uniform. A dying bulb costs one multiply per fragment and still casts a correct
baked shadow. Two channels, not one, so a corridor of failing lamps does not
blink in unison like a stage cue.

The torch is also much stronger (30 m, 37° outer cone, soft spill) and stutters
when the ghost is within 14 m. That is atmosphere, but it is also the only
warning you get when it is behind you.

## How generation works

`src/generate.js`. A lattice of plots, one room per plot, connected by straight
corridors. Corridors are just narrow rooms, so walls, floors, doors, collision
and lighting all fall out of the existing pipeline with no special cases.

The invariant that makes it work: **every room must contain the spine band
through its plot centre.** Two horizontally adjacent plots share a centre Z, so
both rooms straddle the same Z band and a corridor can always run between them
in a straight line. That single rule removes L-shaped corridors, junction
overlaps, and every geometry bug that comes with them.

Connectivity is a recursive backtracker plus a per-difficulty chance of extra
edges. A perfect maze is all dead ends, which is atmospheric and deeply unfair
once something is chasing you, so the loops matter.

Props never block the cross through a room's centre, which is what every doorway
opens onto. That guarantees traversability without ever running a solver.

Room categories: closet, small, medium, large, great hall — each with its own
size range, prop count and light weighting.

## How the ghost works

`src/enemy.js`. A* over the nav graph the generator emits, so no navmesh bake:
nodes are rooms and corridors, edges are doorways, ~160 nodes solves in well
under a millisecond.

It cannot see through walls. Detection is a 2D segment test against the same
colliders you collide with, so breaking line of sight genuinely breaks it. There
is no fallback that magically restores your position. What it does instead is
remember — it walks to where it last saw or heard you, finds nothing, and goes
back to wandering.

Sound matters: sprinting makes you 1.7× as audible as walking, and standing
still drops you to 0.3×.

Knife cooldown is **1 second per ghost**. Measured against the simulator, from a
clear line of sight at about 10 m:

| What you do | Hit | Time to knockdown |
|---|---|---|
| Stand still | 25/25 | 0.7 s |
| Walk in a straight line | 25/25 | 0.6 s |
| Strafe at sprint speed | 25/25 | 2.5 s |

**Dodging no longer works.** At a 6-second cooldown, strafing beat the knife
outright (0/40 hits). At 1 second the next blade is already in the air before a
sidestep completes, so line of sight is simply fatal and breaking it is the only
counterplay. That is a deliberate choice, but it is a large one: with one ghost
per seven rooms there is no longer a safe way to cross an open room that can see
you.

If that reads as too punishing in play, `cooldown` in `src/difficulty.js` is the
single number — around 2.5 s restores the dodge without going back to the old
leisurely pace.

## How it stays fast

Two things, both measured on the largest maze (190 meshes, 258k vertices):

**The bake is spatially hashed.** Lighting is precomputed into vertex colours
once at load, so there are no lights in the scene at runtime — no shadow maps,
no per-frame lighting cost, real hard shadows. The naive version is
O(vertices × lights × occluders), which is six billion slab tests at this scale.
Bucketing lights into every cell they can reach, and testing shadow rays only
against occluders in the cells the ray crosses, brings that to **86 ms**. It is
also stepped against a frame budget, so you get a progress bar instead of a
frozen tab.

**Visibility is two-hop portal culling plus a distance cutoff.** One hop is not
enough because corridors are nav nodes, so a room seen through a doorway is
room → corridor → room away and would pop out of existence while you stared at
it. The distance cutoff matches the fog, past which nothing is visible anyway.
Result: the maze grows 3.7× and the drawn set grows 1.3×.

Walls are chunked on a coarse grid rather than portal-culled, because assigning
wall segments to rooms leaves holes wherever two rects share a plane without
sharing a door.

## Money

Escaping pays a base plus the value of what you carried out plus a bonus for
every second under par. Par is measured from the actual maze — shortest route
walked at full speed, times three for getting lost, plus a detour allowance per
item — rather than guessed per difficulty. Getting knocked out pays nothing at
all, and your loot stays in the house.

The bank persists in `localStorage`, wrapped in try/catch because private-mode
Safari throws on write.

Loot table is in `generate.js`: six tiers from a tarnished candlestick at 14 up
to a sealed reliquary at 320, weighted so the good things are rare.

## Audio

`src/audio.js`. Entirely synthesised, no files: a three-oscillator drone whose
gain and filter cutoff track ghost proximity, plus filtered-noise bursts for
knives, pickups and impacts.

**You make no sound when you walk.** Every creak in the house is something else,
which is the entire reason the cue works. A ghost's step is three layers — a low
thud as the board takes the weight, a rising narrow squeal from the nail, and a
short splintery scrape — with per-step pitch jitter so a corridor never sounds
like a metronome. It gets shorter and harsher while hunting.

Only the three nearest ghosts within 16 m are audible. With up to 28 of them a
distance check alone would produce a constant wall of creaking.

## Multiplayer

Open a house, share the five-character code, up to six people.

**Level sync is by seed, not by geometry.** The host sends `{difficultyId, seed}`
and everyone regenerates the identical maze locally. Shipping 258k baked vertices
over WebRTC would be absurd. This is only safe because generation is
deterministic — verified across every difficulty and seed, including with
unrelated generations interleaved to prove no shared mutable state leaks.

**Movement is client-authoritative; everything else is not.** The ghost, knives,
loot ownership, downs, revives and the escape check all live on the host. Each
player simulates their own walking locally and reports position. Full server
reconciliation is the right answer for a competitive game; here it buys a lot of
complexity to defend against someone who can only grief their own friends, and
local movement feels perfect this way.

**The room locks when the host goes in.** Everyone spawns together in the
entrance, nobody can join a run in progress, and only the host can commit. Joins
are refused *before* the connection is wired up, so a rejected peer never enters
the roster or receives a snapshot, and it is told why — full, already started,
already joined, or a protocol mismatch.

That last one matters more than it sounds: `PROTOCOL` in `net.js` is bumped
whenever the wire format changes, because a player on a stale cached build
otherwise joins successfully and then behaves inexplicably, which is far harder
to diagnose than being told to refresh. Names arriving over the wire are
stripped of control characters and capped at 14 characters.

**Everyone spawns in the same room.** The entrance plot is forced to the `large`
category, because six people cannot spawn in a 3.5 × 3.0 m closet, and spawn
positions sit on a ring sized from that room and then collision-tested, walking
inward before ever giving up. Measured over 192 spawns across 32 houses: 0
outside the entrance, 0 inside geometry, and 0 of 12 test parties split across
rooms. The old code added a flat 3.2 m to the room centre with neither a bounds
check nor a collision pass, which is what put a joining player outside the room.

**Two data connections per peer.** PeerJS sets reliability per connection, not
per message. Mixing 15 Hz position spam with door-unlock events on one ordered
channel means a single dropped packet stalls every event queued behind it. So
`rel` carries lobby, pickups, downs, revives and endings; `unrel` carries
snapshots, which are worthless the moment a newer one exists.

**Remote players render 120 ms in the past.** Snapshots are buffered against
local arrival time — no clock synchronisation needed — and interpolated.
Measured against a known path:

| Conditions | Mean error | Worst |
|---|---|---|
| clean | 0.001 m | 0.002 m |
| 25 ms jitter | 0.044 m | 0.089 m |
| 10% loss + jitter | 0.045 m | 0.228 m |
| 30% loss + 40 ms jitter | 0.082 m | 0.708 m |
| 50% loss + 60 ms jitter | 0.169 m | 1.186 m |

**Voice is a full mesh, unlike game state.** Routing audio through the host
would double every packet's latency and put five upstream audio flows on one
player's connection. Each incoming stream runs through a `PannerNode` at that
player's avatar, so you can hear someone shouting two rooms away, faintly, and
not at all across the maze.

One non-obvious requirement in `voice.js`: Chrome will not pump a WebRTC
MediaStream into Web Audio unless the stream is *also* attached to a media
element. A muted `<audio>` element is created purely to start the flow. Without
it the PannerNode receives silence. This is a long-standing browser bug, not
superstition.

**Escaping together.** Every player still standing must be in the exit room and
nobody may be down. A knocked-out teammate has to be revived or written off
before the door opens. Downed players bleed out in 26 seconds; revive is holding
**E** within 2.2 m for 3.2 seconds, and the host validates the distance rather
than trusting the claim.

### Before you ship this publicly

It uses PeerJS's free public signalling server, which is rate-limited and makes
no availability promises. Run your own PeerServer for anything real. Signalling
is only used to introduce peers — all gameplay traffic is direct.

## Not built yet

- **The shop.** All six characters are free right now. Money accumulates and
  persists; nothing spends it yet.
- **Late joiners get an empty board.** Everyone is in the lobby before a house
  is generated, so it has not mattered yet. If you ever add joining mid-run,
  the host already holds the ordered stroke list to replay.
- **Binary snapshots.** JSON at 15 Hz for six players is about 26 KB/s from the
  host, which is fine, but a typed-array encoding would cut it by roughly 4×.
- **GLB props.** Placeholder boxes stand in. Real models cannot use the vertex
  bake, so give them a small material that samples the two or three nearest
  baked lights per object.
- Gravity, stairs, vaulting. The floor is flat.

---

# Tuning the lighting

Every knob below, what it does, and what it costs. Lighting is **baked once at
load**, so almost everything here is free at runtime — you pay in load time and
memory, never in frame rate. The exceptions are marked.

Change a value, reload, and press **F2** in game to see vertices and bake time.

## Start here: the three that matter most

| Knob | Where | Now | What it does |
|---|---|---|---|
| `lightChance` | `src/difficulty.js`, per house | 0.62 → 0.30 | Fraction of rooms that get any light at all. **The single biggest lever.** Raise it and the house is navigable; lower it and the torch is everything. |
| `ambient` | `src/level.js` CONFIG | 0.018 | Light in places no lamp reaches. Raise to 0.04 and shadows become readable dark grey; drop to 0.005 and unlit rooms are genuinely black. |
| `uFlashGain` | `src/material.js` | 1.9 | Torch brightness. Paired with `uFlashRange` (22 m). |

If the game is "too dark to play", raise `ambient` first — it lifts the floor
everywhere without making the lit rooms look flat.

If it is "not scary enough", lower `lightChance` rather than `ambient`. Fewer
lit rooms is frightening; uniformly dim rooms are just murky.

## Lamps

In `src/generate.js`, `makeLight()`:

```js
y: lerp(2.1, 2.6, rand())        // height. Lower = longer wall shadows
intensity: lerp(1.8, 3.1, ...)   // brightness at the source
range: lerp(6.5, 9.5, ...)       // metres to full falloff
```

Falloff is `(1 - d/range)²`, so `range` controls the *shape* of the pool of
light and `intensity` its peak. A short bright lamp reads as a desk lamp; a long
dim one reads as a ceiling fitting.

Lamps per room is `Math.round(area / 45)`, capped at 3, in the room lighting
loop. Raise the divisor for pools of light with dark between them; lower it for
evenly lit rooms.

## Shadows

`shadowLeak` in `src/level.js` (now `0.10`) is the fraction of a light that
survives an occluder. It is not physical — it stands in for bounced light.

- `0.0` — hard black shadows, very stylised, and corners become unreadable
- `0.10` — current
- `0.25` — soft and forgiving, close to an ambient-occlusion look

## Flicker

Failing lamps are baked into separate channels and modulated live, so they cost
one multiply per fragment.

- **How many flicker:** `src/generate.js`, `rand() < 0.45` for corridors and
  `rand() < 0.22` for rooms.
- **How they flicker:** `flickerSignal()` in `src/material.js`. `gate > 0.72`
  sets how often a stutter happens — lower it for a lamp that is always dying.
  The `0.92 + slow * 0.08` line is the steady state.

## Fog

Per house in `src/difficulty.js` (`fogDensity`, 0.072 → 0.098). It is
`1 - exp(-(density·distance)²)`, so small changes move the wall a long way.

Fog is what makes distance culling invisible. **If you raise `drawDistance` you
must lower `fogDensity` to match**, or you will see rooms pop in at the cut-off.
Roughly: opaque at about `2.8 / density` metres. At 0.09 that is 31 m, safely
inside the 34 m draw distance.

## The torch

`src/material.js`, in `createHouseMaterial`:

```js
uFlashInner: cos(14°)   // full-brightness core
uFlashOuter: cos(34°)   // edge of the cone
uFlashRange: 22.0       // metres
uFlashGain:  1.9        // brightness
```

Widen the outer angle for a lantern, narrow it for a hand torch. The `spill`
term in the fragment shader adds a soft ring outside the cone so the beam does
not end in a hard disc — raise `0.22` there if the edge looks cut out.

The torch also stutters when a ghost is within 12 m (`nearestGhostDistance()` in
`src/main.js`). That is deliberate: it is your only warning that something is
behind you. Set `uFlashFlicker` to a constant 1 to disable it.

## Surfaces

Texture brightness multiplies the baked light. The generated tiles are
normalised to **0.52** mean in `src/textures.js` (`normalise(d)`); the shader
doubles them, so 0.52 lands near unity. A supplied image outside 0.32–0.68 will
shift the whole house and the loader warns in the console.

Room colours themselves are in `src/generate.js` — `shade(0x3a332c, ...)` for
floors, `0x4a423a` walls, `0x241f1b` ceilings. These are albedo: they tint what
the light does, they do not add any.

## Quality

`bakeScale` in `src/settings.js` multiplies the tessellation step. Smaller means
more vertices, finer gradients, longer load — **not** a lower frame rate.
Currently 1.55 / 1.28 / 1.0 / 0.85 across the four presets, landing the largest
house at about 435k vertices and 150 ms.

## A worked example

To make it noticeably brighter without losing the mood:

```js
// src/level.js
ambient: 0.030,        // was 0.018
// src/difficulty.js — on the house you are testing
lightChance: 0.55,     // was 0.40 on Hunted
fogDensity: 0.080,     // was 0.090, so the extra light carries further
// src/material.js
uFlashGain: 2.2,       // was 1.9
```

And to go the other way, for a house that is genuinely frightening:

```js
ambient: 0.008,
lightChance: 0.22,
shadowLeak: 0.04,
uFlashRange: 16.0,
```
