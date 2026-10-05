# Changes

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
