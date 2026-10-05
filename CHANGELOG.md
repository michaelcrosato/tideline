# Changes

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
