# Architecture and limits

## Startup and state

BootKit owns the initial canvas and capability checks. Game CSS, markup, and code are held as inert text in the single HTML file. The launch adapter activates them after the player selects a start mode. The first-frame graphics check completes before the main loop starts. Failures keep their stage, error code, and report controls visible.

The game uses one fixed-step simulation loop. Rendering follows browser animation callbacks. The parameter registry provides validation, defaults, developer controls, persistence, and hashes for reports. The five quick controls remain a simpler view of this state. Desktop and mobile input remain separate.

## Water layers

1. A conservative virtual-pipe grid transports water between cells and through gates. Boundary sources/sinks are explicit.
2. Gerstner and CPU FFT waves provide larger-scale displacement and wind detail. These layers do not transport lagoon volume.
3. A local reflected-wave stencil carries small disturbances beside wet/dry boundaries.
4. A shared GPU cache supplies displacement, normals, and motion to rendering passes. Its spatial and temporal sampling are finite.

Both hull and renderer query this layered surface. A bounded inverse-displacement lookup is used to sample it in world coordinates. The graphics wetness path uses a smaller relaxed inverse solve than the full CPU contact path. It is an approximation, particularly near steep displaced crests.

## Surface refinement

### Foam

The existing ping-pong RGBA8 history remains the source of foam density. RG packs density, B stores a young-foam amount, and A now carries breakup structure. All channels use the same backtrace velocity. Sources are tied to crest compression, slope, active shallows, and short stern segments. Age changes the breakup threshold. Density controls where detail is visible.

No new particles are added merely to fill a quota. Turning wakes are not rotated with the current boat heading. Old density remains in its previous location and moves with local flow. Semi-Lagrangian history is diffusive and is not a conservative bubble simulation.

### Wet surfaces

The surface-height lookup includes wave displacement. Scenery caustics and submersion checks use that height instead of only mean water level. The world history has two 16-bit packed height marks in each RGBA8 pixel. Marks span -16 to 32 metres. The fast mark recedes at the film-drain rate; the slow mark represents longer dampness. The default is two 256-square maps, approximately 0.5 MiB combined.

These are world columns, not a 3D moisture volume. A deck above another deck can share a column. Normals offset the sample slightly outward at solid walls. Thin obstacles and coarse cells can still give imperfect boundaries.

Each boat mesh keeps film and damp amounts at deduplicated model vertices. World-space tests refresh those samples at a fixed configured rate. Exponential decay gives the two drying times. The samples move with the boat and are interpolated across triangles. No UV atlas or texture asset is needed, but the low-poly mesh limits wet-mark detail. Changing the moisture sample rate is explicit; it is not adjusted by FPS.

### Highlight filtering

The water shader estimates normal variance from screen derivatives and unresolved procedural micro-ripples. This widens the sun and local-light highlight lobe within bounded roughness limits. It avoids simply removing all small-ripple influence when a ripple becomes subpixel.

This is not full LEAN mapping, a temporal antialiasing system, or a complete filtered-environment model. It does not trace multiple scattering or fix occluded information in screen-space reflections.

### Wakes

Each moving wet hull deposits a small positive/negative source into local wave velocity at its stern. The weights are mean-corrected over valid wet cells, including supports clipped by walls. The signed source sum is near zero. The source does not edit transported water depth.

That zero-sum check does not prove conservation of total coupled fluid/body energy. Strength depends on relative water speed, wet fraction, and load. The recently corrected implicit hull damping and collision response are retained.

The foam pass adds a short segment between successive stern positions for each of the two boats. A distance guard rejects teleports. Old boat-relative V masks are disabled in this mode. A source switch preserves the old mode for comparison.

## Rendering and cost

The additional world-wetness pass runs after wave-cache generation. Hull-moisture sampling has a separate CPU scope. History targets and per-vertex data are included in tracked allocations. GPU time is asynchronous; CPU time measures elapsed callback work, not processor utilization.

The default mesh, transport grid, and particle limit did not increase. There is no hidden dynamic quality setting. New features have independent switches in Advanced settings and in the Surface comparison plan.

## Restore and export

Benchmark snapshots include water arrays, scalar counters, body state, old foam/optics state, world wetness, boat moisture, and previous stern positions. Returning from a result restores the voyage and history. Resetting a scene clears old marks so they cannot leak between environments.

Recorded and live reports include `surfaceDetail`. Frames contain wake-source counts and signed-source error. CSV includes those fields. The reports explicitly state the approximations. The live field is not a substitute for repeated benchmark samples.
