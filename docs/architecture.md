# Architecture and limits

## Startup and state

BootKit owns the initial canvas and capability checks. Game CSS, markup, and code are held as inert text in the single HTML file. The launch adapter activates them after the player selects a start mode. The first-frame graphics check completes before the main loop starts. Failures keep their stage, error code, and report controls visible.

The game uses one fixed-step simulation loop. Rendering follows browser animation callbacks. The parameter registry provides validation, defaults, developer controls, persistence, and hashes for reports. The six quick controls remain a simpler view of this state. Desktop and mobile input remain separate.

## Water layers

1. A conservative virtual-pipe grid transports water between cells and through gates. Boundary sources/sinks are explicit.
2. Gerstner and CPU FFT waves provide larger-scale displacement and wind detail. These layers do not transport lagoon volume.
3. A local reflected-wave stencil carries small disturbances beside wet/dry boundaries.
4. A shared GPU cache supplies displacement, normals, and motion to rendering passes. Its spatial and temporal sampling are finite.

Dry cells within two cells of water carry the lowest neighbouring free-surface height. Rendering, wetness, caustics and hull buoyancy therefore meet a level waterline at walls instead of interpolating toward the bed height. Dry grid-edge cells meet the open water drawn beyond the grid.

Both hull and renderer query this layered surface. A bounded inverse-displacement lookup is used to sample it in world coordinates. The graphics wetness path uses a smaller relaxed inverse solve than the full CPU contact path. It is an approximation, particularly near steep displaced crests.

## Surface refinement

### Foam

The existing ping-pong RGBA8 history remains the source of foam density. RG packs density, B stores a young-foam amount, and A now carries breakup structure. All channels use the same backtrace velocity. Sources are tied to crest compression, slope, active shallows, and short stern segments. Age changes the breakup threshold. The age byte uses stochastic rounding so small per-step decays are not lost. Density controls where detail is visible.

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

## Surface 10.2 additions

### Frame uniform block

Values every shared program reads (settings, light rig, wave modes, lamps, the sun shadow matrix and the surface switches) live in one std140 block, `Frame`, generated from `FRAME_FIELDS`. The renderer fills it once per frame and sends it with one `bufferSubData`. The preparation passes switch readiness flags and `uSunVP` within a frame, so those fields sit in a short tail that is re-sent only when one changes. Per-pass values (`uVP`, `uEye`, `uReflect`, `uUnder`, `uClipLevel`, `uAirCapture`) and samplers stay plain uniforms. A new shader value is a `FRAME_FIELDS` entry set in a `frameValues()` wrapper. Per-frame tables can live there too: the far-sea roughness table (`uFarSeaTable`) is filled on the CPU each frame.

### Light

`LightRig` cross-fades sun and moon over a band of solar altitude, weighting direction and tint by each source's light. `waterLight` (sky light plus sun tint and strength) scales the water body and underwater haze. `skyColor(r, disc)` leaves the sun and moon discs out of reflections; the GGX highlight is the reflected sun. The light style (`lightStyle`) is one uniform branch in `crestLight()`.

Scenery ambient comes from a 4×2 average of the cached sky panorama (four azimuth sectors, two hemispheres), evaluated per vertex. Ambient occlusion is baked once per world mesh from short rays against the bed and the props' collision shapes, into its own vertex attribute.

### Motion and interpolation

Each fixed step records the poses it starts from. A frame blends the previous and current poses by the accumulator fraction and draws the analytic waves at the matching time (`renderer.renderTime`). The poses are restored after the frame, so the simulation, benchmark hashes and `water.time` never see them. Interpolation is off in benchmarks, held results, contact fixtures, after resets and when paused.

### Final image

The highlight glow is a dual-filter chain: a thresholded half-resolution pass, further halving passes, and additive tent upsamples back to half resolution. Its depth is `bloomLevels` (the phone preset uses 2). The post pass tone-maps (ACES fit or an AgX-style curve), applies the vignette, then encodes exact sRGB.

### Particles

With `gpuParticles`, spray, foam, bubbles and mist live in two RGBA32F ping-pong maps, 256 slots a row: (x, y, z, life) and (vx, vy, vz, kind | size | maximum life packed as an integer below 2^24). The CPU hands out ring slots (`ParticlePool`) and writes spawn rows with their birth time; it never reads the maps back. One update pass a frame moves the live window with exact wind relaxation and gravity, lands spray on the full displaced surface (all modes, the FFT field and the reef breaker, undisplaced by two fixed-point steps) and turns it into foam there; bubbles surface as foam; mist drifts and settles above the water. A preparation pass lifts, lights and sizes each live particle once (position, colour, and velocity with the kind), together with the CPU contact drops (two texels each, written every frame) and the underwater motes. Sprites are quads of six vertices from `gl_VertexID` in one draw; a drop stretches into a capsule along its screen motion over the streak exposure, and a mist puff is a Gaussian billboard with its own depth fade. Contact drops stay on the CPU (`world.cast`) and hand their landing foam to the GPU. The water never reads GPU state: every third spray drop's landing ripple is predicted ballistically at spawn (`game.landings`, saved in snapshots). Mist draws from its own random stream and makes no ripples. A row reduction read back through a fenced pixel buffer (at most twice a second, never waited on) gives reports their live counts. Without float render targets the 10.1 CPU path and point sprites run.

Bow spray samples each bow corner on the hull flare once a step: the hull-relative water speed across the flare above a threshold throws drops along the flare at a rate growing with its square, and a corner entering the water faster than the slam speed releases a burst (within `contactSprayBurst`) and mist.

### Foam material

`foamLight()` in the shared shader code shades foam on the water and on the reef crest sheet: dense foam is bright and rough (GGX alpha 0.6), thin foam darker and more translucent (wrap lighting and light from behind), and thin edges cover less. On the water the foam normal follows the gradient of the foam history.

### Beams

With `stableBeams`, the lamp-beam march (and underwater light shafts, moved from the post pass) jitter their samples by a golden-ratio step each frame. A history pass reprojects the previous result through the point where each pixel's ray ends, rejects it where last frame's ray ended elsewhere, and clamps it to the current neighbourhood. History restarts on size, world or beam-setting changes, time jumps and large eye jumps.

## Restore and export

Benchmark snapshots include water arrays, scalar counters, body state, old foam/optics state, world wetness, boat moisture, previous stern positions and the predicted spray landings. GPU particles and the beam history restart empty after a restore. Returning from a result restores the voyage and history. Resetting a scene clears old marks so they cannot leak between environments.

Recorded and live reports include `surfaceDetail`. Frames contain wake-source counts and signed-source error. CSV includes those fields. The reports explicitly state the approximations. The live field is not a substitute for repeated benchmark samples.
