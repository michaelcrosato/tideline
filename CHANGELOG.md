# Changes

## Surface 10.2 phase 2 — TL-SURFACE-20261006.2

Phase 2 of the Surface 10.2 upgrade plan (`docs/upgrade-plan.md`, M9–M13): richer spray, foam and light. Every effect has a switch in Advanced settings and joins the **Surface 10.2 comparison**. The phone preset keeps them light or off. There is still no automatic FPS-based quality change.

### Spray

- **GPU particles:** spray, foam, bubbles and mist live in float textures and move on the GPU. Drops land on the full wave surface (every swell mode, the FFT field and the reef breaker) and turn to foam where they land; bubbles surface as foam. Drops that hit scenery stay on the CPU. Spray CPU time per physics step fell from about 2.1 to 0.55 ms. Without float render targets the 10.1 CPU path runs.
- **Streaks:** drops and bubbles stretch along their screen motion; still drops stay round.
- **Mist:** breaking crests, hull slams and waves striking walls release large, faint, soft puffs that drift with the wind. Mist never changes the simulation. Off in the phone preset.
- **Bow spray:** each bow corner throws a sheet of drops along the hull flare from the water rushing past it; hard slams add a burst and mist. It shares the contact drop cap and the particle limit.

### Foam

- **Foam material:** foam has its own surface: a normal from the foam density, a rough sheen, wrap lighting for light scattered through the layer, light through thin foam from behind, and darker, thinner edges. The water and the reef crest sheet share one foam colour.

### Light

- **Stable beams:** lamp-beam samples move each frame and a history pass reprojects them, so beams no longer crawl with a screen-locked dither. Against a 32-sample reference, the error of an 8-sample beam falls from 14% to 2% once settled. Underwater light shafts share the pass (at beam resolution instead of full resolution). Phone preset: 8 beam samples.

### Tests

- New regression checks for each item: landing on the full surface, rendering never changing the simulation, the live count, streak length, mist determinism, bow spray budgets, a foam material probe, and beam history convergence and reprojection.

## Surface 10.2 phase 1 — TL-SURFACE-20261006.1

Phase 1 of the Surface 10.2 upgrade plan (`docs/upgrade-plan.md`, M0–M8): foundations, lighting fixes and cheap visual wins. New features have switches in Advanced settings and join the **Surface 10.2 comparison** (prior / new / new / prior). There is still no automatic FPS-based quality change.

### Phones and CPU

- **Phone preset:** the first touch-interface run with no saved settings applies an explicit Phone preset (0.9 MP, DPR 1.5, visual grid 257, half-scale SSR, reflections every 2nd frame, 256 foam map, 8,000 particles, 2 bloom levels). Reports record it; your own changes override it.
- **Shared uniform block:** per-frame shared shader values moved into one std140 `Frame` block, sent once per frame. GL calls per frame fell by about 55%.

### Light and water

- **Light style:** new Glow / Natural choice in Advanced settings and Quick Look. Glow keeps the teal crest light (default). Natural filters the sun through the water, so crests turn gold at dawn and dusk.
- **Lighting fixes (both styles):** sun shadow no longer dims reflections, specular or crest glow twice; the water reflects the sun only as its highlight, not also as a sky disc; sun and moon cross-fade near the horizon instead of switching; the water body and underwater haze follow the sun's tint and strength.
- **Crest sheets** use the water's Fresnel settings, air fog and shadow, no longer write depth, and fade with depth like the surface wave.
- **Far-sea roughness:** outside the basin the slope energy of the waves the LOD fades out widens the highlight, so the far sea no longer looks mirror-flat or sparkly. Scenery, water and crest sheets share one fog start.
- **Reef breaker:** no step at the basin edge (the reef reads the coast bed outside the grid), outer rings no longer alias it, its trough is flat, and its slope includes the depth and breakwater fades. CPU and GPU stay identical.
- **Spray** scatters light forward toward the sun, takes sun shadow and fades into the air haze.
- **Ambient and AO:** scenery ambient takes its colour and direction from the sky (brighter from above, a ground bounce below), and per-vertex ambient occlusion is baked once per scene.
- **Final image:** exact sRGB encoding, vignette after the tone curve, an optional AgX-style tone curve (ACES stays the default), and a smooth dual-filter bloom chain from half resolution in place of the blocky single pass.

### Motion

- **Livelier boats:** lighter hull damping lets boats bob and rock again; a 0.3 m heave offset rings about twice. Drop and tow checks still pass.
- **Render interpolation:** frames blend body poses and the analytic waves between the last two physics steps. It is render-only and off in benchmarks, held results and contact tests.

### Tests

- New regression checks for each item above, including CPU-vs-GPU reef samples across the basin edge and a check that rendering never changes the simulated state.

## Surface 10.1 — TL-SURFACE-20261005.1

A correctness and cost pass over water, rendering and boat physics. Defaults, quick controls, the mesh, transport grid and particle ceiling are unchanged.

### Fixed

- **Sluice gates:** at the default transport grid (and at grid 65), cell rows fell exactly on the gate line, so no face was gated and the lagoon ignored both gates. The fill/drain objective can now be completed.
- **Water at walls:** dry cells beside water now carry the lowest neighbouring free surface two cells into the bank. Interpolating toward the bed drew translucent water sheets up walls, pillars, piers and cliffs, wrote false wet marks high on scenery, lit dry stone with caustics, and gave hulls phantom buoyancy against walls.
- **Capsized boats** right themselves while wet. *Recover boat* now levels the hull, clears its spin, and releases the tow instead of yanking the workboat.
- **Hull buoyancy** no longer counts the hull's own pressure dimple, which sank the tug about 0.23 m and gave it a grid-dependent list.
- **Contact correction** no longer re-applies depth already removed by earlier contacts in the same pass, which made grounded hulls hop.
- **Reef breakers** stop at the breakwater instead of running through the walls into the harbour corners. The crest sheet curls forward with the wave and uses the surface's own crest transmission instead of a neon cyan rim.
- **Foam age:** stochastic rounding lets the young-foam byte decay to zero, so old foam breaks into trails at any frame rate.
- Foam, crest light and the crest sheet respect sun shadow; wet-film gloss stays above the waterline; shoreline derivatives are taken before `discard`; a vertical sky ray no longer yields NaN; the legacy wet map is sampled at node centres.
- Transport speed no longer depends on grid size, solver substeps rise automatically before the stability limit, and partial gate damping is per unit time.
- Splashes are zero-sum, so the wall-wave field keeps no permanent offset. Horizontal wave motion never exceeds the vertical amplitude, so low swell no longer slides sideways.
- Wave phases are wrapped in double precision on the CPU. A float32 `uTime` drifted the GPU surface away from the CPU surface in long sessions.
- Traced-reflection history now resets after real hitches; the previous test could never fire.

### Cost

- Scenery farther from the water than the current maximum wave reach skips the displaced-surface solve.
- Underwater frames skip above-water shading; fully shadowed water skips the wave-shadow march; lamp diffuse for foam runs only where there is foam; fog sky lookups run only where there is fog.
- The hidden performance HUD no longer summarizes the frame window four times a second (a long frame each time).
- The above-water cube keeps one framebuffer per face instead of re-attaching and validating faces on every capture.
- Unchanged water state is not re-packed or re-uploaded; unused planar reflections are skipped; an idle overlay canvas is not cleared every frame.
- Fewer per-frame allocations and string signatures (storm sync, matrices, contacts, tow endpoints, hull wetness memo, the motion solve).

## Surface 10.0 — TL-SURFACE-20261004.1

### Water and rendering

- Replaced the default connected cell-edge foam with transported breakup and age-aware patches.
- Replaced boat-relative foam masks with short stern sources and persistent path history for both boats.
- Added balanced local-wave velocity sources for wakes, with wet-boundary source accounting.
- Matched scenery wetness/submersion checks to the displaced wave surface.
- Added fast film and slow damp watermarks for static surfaces.
- Added model-attached moisture samples for the tug and disabled workboat.
- Added bounded normal-variance highlight filtering for directional and local lights.

### Reports and packaging

- Added separate wet-history GPU, hull-moisture CPU, and wake-source CPU scopes.
- Added Surface verification and four-switch comparison plans.
- Added source counters and limits to JSON/CSV reports; restored histories with benchmark voyages.
- Split editable sources from the generated, standalone HTML. Added deterministic Python build tooling and reproducible browser tests.
- Added public-feedback guidance and an initial GitHub publication helper.

### Retained

- Five quick sliders and ten advanced pins.
- Separate desktop and multi-touch mobile controls.
- Deferred BootKit startup, fullscreen requests, diagnostic errors.
- Four environments, existing optics, towing, recent stable contacts and hull damping.
- Default mesh, transport resolution, and maximum particle count.

### Limits

Wet marks are approximate height columns and vertex values. Local wake sources are not a fully coupled ship-wave solver. Highlight filtering is not full LEAN mapping or complete rough-reflection integration. No automatic FPS-based reduction is added.
