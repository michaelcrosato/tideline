# TIDELINE Surface 10.2 — visual and feel upgrades

This is the working plan for the Surface 10.2 upgrade series. Each milestone is done in its own session and pull request. Read **Working agreement** and **Status** before starting.

## Working agreement

- Do only the milestone you were asked for. Do not start the next one.
- Line numbers below are approximate and drift after each milestone. Confirm them with `grep` before editing.
- Edit `src/` only. Rebuild `index.html` with `python tools/build.py` (or `npm run build`); never edit it by hand.
- Run the **Verification** steps for the milestone, plus the fast checks and both browser suites.
- One PR per milestone. Merge into `main` only when CI is green.
- Before starting a milestone, restart the working branch from the latest `main`.
- When finished, update the milestone's row in **Status** (state, PR link, short notes on anything deferred) in the same PR.
- Release hygiene (build ID bump to Surface 10.2, CHANGELOG, README, `docs/architecture.md`, `MANIFEST.sha256`) happens in the last milestone of each phase, not in every PR.

## Status

| Milestone | Effort | State | PR | Notes |
|---|---|---|---|---|
| M0 Phone quality defaults | Medium | Done | [michaelcrosato/tideline#3](https://github.com/michaelcrosato/tideline/pull/3) | `PHONE_PRESET` applied once on first touch-UI run with no saved settings; recorded as `hardware.qualityPreset` in reports; `tests/mobile.py` checks first run, report, apply-once and user override. Not added to the `mGraphics` menu (no way to re-apply it after overriding); `renderer.high` left on. Build ID/CHANGELOG/README deferred to the end of Phase 1. |
| M1 Shared uniform buffer | Extra high | Done | [michaelcrosato/tideline#4](https://github.com/michaelcrosato/tideline/pull/4) | `Frame` std140 block (126 vec4, 2,016 B) generated from `FRAME_FIELDS`. One full `bufferSubData` per frame. The readiness flags and `uSunVP`, which the prep passes switch mid-frame, sit in a 96 B tail that is re-sent only when one changes (3 per frame in tests). GL calls/frame −54…58% (1,797→815 reduced; 1,518→635 defaults; 1,730→781 phone preset); render submission CPU slightly lower; SwiftShader full-frame time unchanged within noise. 17 reduced-setting and 2 default-setting captures are byte-identical to `main`. New shader values: add a `FRAME_FIELDS` entry and set it in a `frameValues()` wrapper. Left: samplers are still bound per pass (~90 `uniform1i`/frame could be set once per program); no physical-phone timing. Build ID/CHANGELOG/README/`docs/architecture.md` (describe `Frame`) deferred to the end of Phase 1. |
| M2 Lighting fixes + `lightStyle` | High | Done | [michaelcrosato/tideline#5](https://github.com/michaelcrosato/tideline/pull/5) | Shadow (`mix(.72,1.,lightVisibility)`) now dims only the water-body in-scatter; reflections, specular and crest glow are shadowed once. The sun/moon disc is a `skyColor(r,disc)` argument rather than a uniform (a per-pass value would need its own Frame re-send): 0 for water and crest reflections and the planar reflection's sky, 1 for direct sky, fog and the underwater window. `LightRig` cross-fades sun→moon over altitude −0.02…0.08, with direction and tint weighted by each source's light; the largest per-step light change across 17.6–18.6 h fell from 1.14 to 0.03. `uBody`/`uHaze` follow `lights.waterLight` (half daylight, half sun tint × strength relative to the default noon sun; noon unchanged). `lightStyle` (0 Glow, 1 Natural: `exp(-uAbsorb·path)` × sun, path 0.6–2.2 m) in `waterFS` and `crestFS`; in Advanced settings, as a sixth Quick Look control, in `surfaceReport`, and as a `lightStyle` benchmark comparison. Crest sheet uses `uFresnel`/`uFresnelPower`, air fog and the body-only shadow. New regression checks: shadowed reflection unchanged, no dusk jump, both styles render. Frame time unchanged (SwiftShader 0.8 MP: 2,618 → 2,629 ms median, interleaved); GL calls/frame unchanged. README still lists five quick controls; deferred to Phase 1 release hygiene (M8). |
| M3 Far-sea roughness | Medium | Done | [michaelcrosato/tideline#6](https://github.com/michaelcrosato/tideline/pull/6) | New flag `farSeaRoughness` (default on). Outside the basin, `filteredWaterRoughness` adds the slope variance of the detail the LOD fades out: ½(ka)²(1−lod²) per Gerstner mode, plus fftHeight²·⟨k²⟩ per spectral band (⟨k²⟩ is computed once per spectrum in `OceanSpectrum.configure`), capped at α²+0.08 (about the Cox–Munk mean-square slope at 14 m/s). It applies with or without `filteredHighlights`. The renderer tabulates the variance per frame at 16 log-spaced footprints (`uFarSeaTable`); the shader interpolates with constant indices, because a per-pixel 30-mode loop cost 3.6% and dynamic indexing 2.6% in SwiftShader. Measured: +1.7% median (A/A noise ±1.5%). Fog: scenery, water and crest sheets share `airFog()`, starting at 28 m. `UPGRADE_FEATURES` and the `upgradeAudit` comparison (all 10.2 switches off/on) start here, and later milestones add to them. Effect: moonlit and noon far-sea glints become a broad glitter; inside the basin nothing changes. |
| M4 Reef breaker fix | High | Done | [michaelcrosato/tideline#7](https://github.com/michaelcrosato/tideline/pull/7) | (a) Past \|p\|=26, `coastWave`/`coastalSample` take depth from the coast bed under the ocean level (`rescueTerrainGL` mirrors `rescueTerrain`; new `oceanSurface()` feeds both CPU and `uOcean`), instead of the GPU's 10 m (full reef beside the walls) and the CPU's clamped edge value. (b) Each harmonic fades with the mesh footprint, using the crest-line wavenumber k·\|(0.076x, 1)\| (the CPU is footprint 0). (c) Second harmonic 0.32 → 0.25 on both sides, so the trough is flat, with no local maximum. (d) The returned gradient includes ∇(fade·pass): breakwaterPass analytically, depth by ±0.25 m central differences where the fade is changing (0.08–0.65 m). (f) The crest sheet tests depth without writing it, and its depth fade is `smoothstep(.08,.65,coastDepthAt)`. Item (e) is not in the plan. New test probe `Renderer.probeCoast` (RGBA32F, test use only); the regression check compares CPU and GPU at x=±25.9/±26.1 and 4 interior points (worst relative difference 1.2e-4), checks for no step across the edge and one crest per period. The reef meets the basin edge over land, so the edge values are 0 on both sides now (the GPU used to raise the reef outside). Frame time +0.4% (noise); +1 GL call per frame (depth-mask restore). |
| M5 Spray shading | Medium | Done | [michaelcrosato/tideline#8](https://github.com/michaelcrosato/tideline/pull/8) | New flag `sprayLighting` (default on, in `UPGRADE_FEATURES`). `pointVS` gives the sun term a Henyey–Greenstein lobe (g=0.55, from the view ray toward the sun, normalized so its sphere average is the old isotropic 0.36). It also adds one sun-shadow tap per drop (`sprayShadow`, no 3×3 filter) and above-water `airFog` toward `skyColor`. `pointFS` is unchanged. Regression check: a drop cloud adds 1.67× more light looking toward the sun than away from it, and a full sun shadow halves it. The M4 build fails this check (0.95×, no shadow response). Frame time +0.7% (noise) with 4,000 spray/s; +6 GL calls per frame (shadow and sky maps bound for the point program). The effect is strongest with the sun ahead of the camera. |
| M6 Floating motion + render interpolation | High | Done | (this PR) | `bodyDamping` 14 → 4.5 (registry step 0.2 → 0.1, so 4.5 is on the grid), `bodyAngularDrag` 3 → 0.6, `waterEntryDrag` kept at 1.8. Measured from log decrement in calm water: heave ζ≈0.40 (2 overshoots after a 0.3 m offset), pitch ≈0.45, roll ≈0.33. ζ≈0.3/0.12 is not reachable here: the per-sample vertical damping and entry drag also damp rotation, and 3.5/0.4 already breaks the drop guard (maxUp 1.12 > 1.1). Drop fixture: maxUp 1.02, no air after entry, no faults. Tow trial at 4 matched start times: no breaks or faults; max roll 0.37–0.55 rad (was 0.26–0.42), max pitch 0.43–0.72 (was 0.31–0.46). Interpolation (`surface.js`, flag `renderInterpolation`, default on): each `game.step` records the start poses of the boat, workboat and rescue objects. `renderInterpolated` blends them by alpha=accumulator/DT (shortest-arc angles) and sets `renderer.renderTime=water.time−(1−alpha)·DT` for `uTime`, `phases()`, `uCoastPhase`, `uOcean`, the rogue centre and the crest-sheet index, then restores the poses. Off when paused, in benchmarks, with a held result, in contact fixtures, after a reset or skipped step, or for a body that moved >3 m. Not in `upgradeAudit`, because benchmarks always run it off. Uploads still key on `water.time`. New checks: heave rings 2–4 times; rendering never changes the simulated state hash, and drawn jerk falls 4× (0.0015 vs 0.0062) at 45 Hz over 60 Hz physics. No physical-phone check. |
| M7 Ambient, AO, tonemap | High | Not started | | |
| M8 Bloom chain | Medium | Not started | | |
| M9 GPU particles | Extra high | Not started | | |
| M10 Stretched spray and mist | High | Not started | | |
| M11 Bow and slam spray | High | Not started | | |
| M12 Foam material | Medium-high | Not started | | |
| M13 Stable lamp beams | High | Not started | | |

## Context

Surface 10.1 fixed correctness bugs. This round adds the upgrades from the follow-up review. It also fixes the remaining lighting and reef issues that exploration confirmed.

Constraints set by the project owner:
- **Phones are in scope.** CPU recovery and pass trims come first. Heavier effects ship behind switches.
- **Both phases are in scope.** Each milestone gets an effort level: medium, high or extra high.
- **Keep the turquoise glow** as a selectable style next to a new natural-light style. The lighting bugs are fixed in both styles.
- **Livelier boats.** Bobbing and rocking return.

**Working rules.** These apply to every milestone:
- Edit `src/engine.js` and `src/surface.js` only, then rebuild with `python tools/build.py`. Never edit `index.html` by hand.
- Each new feature gets a registry `flag`/`num` and joins a Prior/New comparison. Follow the `SURFACE_FEATURES` pattern in `src/surface.js`, which covers the list, the `frameValues()` wrapper (since M1, shader values are `FRAME_FIELDS` entries in the shared `Frame` block, not per-pass uniforms), the `Benchmark.prototype.variants` mode and `surfaceReport`.
- No automatic FPS-based quality changes, matching the existing design rule.
- Simulated state stays deterministic. Render-only smoothing must never feed simulation, benchmark hashes or `water.time`.
- Bump the build to `TL-SURFACE-2026MMDD.1` / Surface 10.2 when the work is finished. Update CHANGELOG, README, `docs/architecture.md`, `tests/static_checks.py` and `tests/regression.py` to match.

### Light style: Glow vs Natural

It is not much more complex, and it costs essentially nothing at runtime.

**How it works:**
- One setting, `lightStyle`, picks the look: 0 = Glow (the current teal crest), 1 = Natural.
- Glow keeps the constant `vec3(.025,.58,.42)` colour.
- Natural derives the crest colour from the water's own absorption, `exp(-uAbsorb*pathLength)`, multiplied by the sun's colour and strength. At dusk the crests then turn gold or amber instead of staying teal.
- The real bugs are fixed for **both** styles:
  - shadow dims reflections;
  - the sun is counted twice;
  - the light pops at dusk;
  - the water body colour ignores the sun's tint.
- The style choice is one uniform-driven branch in `waterFS` and `crestFS`, so it adds no measurable cost.

**Pros:**
- Keeps the game's identity.
- Gives a direct A/B comparison.
- Night and dusk become correct in Natural.
- Players and benchmarks can choose.

**Cons:**
- Two looks to tune and screenshot.
- About 15 extra lines of shader code.
- The comparison plan gains one more axis.

**Default:** Glow, so the established look is unchanged. Natural is one click away in Advanced settings and Quick Look.

## Milestones (in order)

### Phase 1: foundations and cheap wins

**M0. Phone quality defaults** (medium)
- Problem: phones currently get desktop defaults (8 MP, `visualGrid` 657, full reflections and SSR) unless the user picks "light".
- Change: on the first run with `MOBILE_BRANCH` and no saved settings, apply a "Phone" preset. It is built like the existing `mGraphics` "light" option and the `WORKLOAD_PROFILES` pattern (`applyProfile`):
  - `maxPixels` 0.9 MP, `maxDPR` 1.5, `visualGrid` 257;
  - SSR at half scale;
  - `reflectionEvery` 2;
  - `foamResolution` 256;
  - `particleLimit` 8000.
- The preset is explicit and recorded in reports. It is not adaptive.
- Test: `tests/mobile.py` checks that the preset applies once and that the user can override it.

**M1. Shared uniform buffer** (extra high)
- Move the per-frame shared values into one std140 block, `Frame`, updated once per frame with `bufferSubData`.
- What goes in: about 130 vec4 slots (≈2.1 KB):
  - `settings()` singles;
  - the `bindAbyss` and `bindBeacon` floats;
  - `uWave[30]`, `uMode[30]` (padded to vec4);
  - the lamp arrays and `uLampVP[2]`;
  - `uSunVP`;
  - the surface.js floats.
- What stays as plain uniforms: anything set per pass (`uVP`, `uEye`, `uReflect`, `uUnder`, `uClipLevel`, `uAirCapture`) and all samplers.
- Edit the declarations in `sharedGLSL` (roughly engine.js 842–891) and `surfaceGLSL`. Bind each program's block once in `program()` (≈1374).
- Remove the duplicate `uVP` upload in `common()`.
- Expected gain: removes about 1,000 GL calls per frame. This is the main CPU recovery for phones.

**M2. Lighting fixes plus `lightStyle`** (high)
- **Shadow.** In `waterFS`, apply `mix(.72,1.,lightVisibility)` only to the transmitted/body light. Remove it from the reflections, which also removes the double-shadowed specular and glow.
- **Sun counted twice.** Add a `uSunDiscScale` uniform to `skyColor`. Set it to 0 for water-reflection lookups and the planar/SSR sky pass, so the GGX specular is the only sun the water reflects. Keep the disc for direct sky.
- **Dusk pop.** In `LightRig.update` (≈811–830), cross-fade direction, tint and strength from sun to moon over an altitude band (−0.02 … 0.08), instead of switching hard at alt .035.
- **Water colour.** `uBody` and `uHaze` follow `sunTint × strength`, not just daylight.
- **Glow vs Natural.** Add the `lightStyle` branch to the crest glow in `waterFS` and `crestFS`.
- **Crest sheet.** `crestFS` gets the same fog and Fresnel inputs (`uFresnel`) as `waterFS`.
- Test: a regression check that a fully shadowed pixel's reflection is not dimmed.

**M3. Far-sea roughness** (medium)
- Problem: water outside the basin (|p|>26) gets no normal detail, so it looks mirror-flat or aliased.
- Change: in `filteredWaterRoughness`, raise roughness with the wave LOD footprint (`max(abs(x),abs(z))-26`). Add the energy of the faded Gerstner/spectral waves to the variance, using the same formula as the micro octaves.
- Line up the fog start of the water (30 m) and the scenery mesh (28 m).

**M4. Reef breaker fix** (high). Sources come from exploration item 4:
- **(a) Edge step.** Outside the basin, compute `depthFade` from `rescueTerrain` depth, or fade the reef with the distance past |x|=26. This removes the up to 1.55 m step at x=±26.
- **(b) Outer rings.** Give `coastWave` a footprint-based LOD fade so the outer rings don't alias.
- **(c) Second harmonic.** Change its coefficient from `.32` to `.25` in both the GPU and CPU (`coastalSample`) versions. This removes the trough ridge.
- **(d) Gradient.** Include the gradient of `depthFade·breakwaterPass` in the returned gradient.
- **(f) Crest sheet.** Turn off depth writes while drawing it, and match its depth fade to the surface wave's (`.08,.65`).
- Keep CPU and GPU identical. Extend the existing gate/reef checks with a CPU-vs-GPU sample at x=±25.9 and ±26.1.

**M5. Spray shading** (medium)
- Problem: `pointVS` has no sun direction, shadow or fog.
- Change:
  - Add forward scattering (an HG-style phase from the view direction to the sun), so spray glows against the light.
  - Add sun shadow (one `sunVisibility` tap per vertex), plus fog and depth haze above water.
  - Keep `pointFS` as is.

**M6. Floating motion and render interpolation** (high)
- **Damping.** Retune to damping ratio ζ≈0.3 for heave and pitch and ζ≈0.12 for roll:
  - `bodyDamping` 14 → ~4.5;
  - `bodyAngularDrag` 3 → ~0.6;
  - keep `waterEntryDrag` at 1.8 so slams stay damped.
- **Damping guard.** The drop test (`regression.py:79`: no air after entry, `maxUp<1.1`, no faults) must still pass, and so must the tow trial.
- **Interpolation.** Store each body's previous pose (`game.boat`, `rescue.target`, `rescue.objects`) at the start of `game.step`. At render time, use `alpha=accumulator/DT` to interpolate:
  - poses, with shortest-arc yaw;
  - the camera target;
  - a render-only `renderTime = water.time - (1-alpha)*DT` for the shader time uniforms (`uTime`, `phases()`, `uCoastPhase`, `uOcean`).
- **Interpolation guards:**
  - Upload checks still key on `ws.time`.
  - Off during benchmarks, `resultHeld` and contact fixtures.
  - New flag `renderInterpolation` (default on).

**M7. Ambient, AO and tonemap** (high)
- **Ambient.** Replace the flat `vec3(.33,.44,.55)*uAmbient` with hemispheric sky/ground ambient taken from the sky LUT.
- **AO.** Add per-vertex ambient occlusion, baked once in `Builder` (sample terrain and prop proxies above each vertex, ~8 rays). It is stored in the colour alpha, so there is no runtime cost.
- **Tonemap.** Use exact sRGB encoding instead of a plain 2.2 power. Apply the vignette after the tonemap. Add a mild AgX-style shoulder option behind the `tonemap` switch; ACES stays the default.

**M8. Bloom chain** (medium)
- Replace the single 3×3 pass with a 4-level dual-filter down/up chain, starting at half resolution.
- This also fixes `uTexel` using full-resolution texel sizes.
- Phone preset: 2 levels.

### Phase 2: richer effects (all behind switches; phone preset keeps them light or off)

**M9. GPU particles** (extra high)
- Particle state (position/life, velocity/kind) lives in RGBA16F/32F ping-pong textures. Use `EXT_color_buffer_float`, with a CPU fallback when it is missing.
- One full-screen update pass per frame:
  - collision with the full `sea()` surface, including the FFT field (today the CPU uses only 6 Gerstner modes);
  - foam conversion;
  - wind and gravity.
- The CPU keeps spawning by writing spawn rows into a small texture each frame. It also keeps scenery-contact drops on the CPU path (hybrid, because `world.cast` needs the CPU).
- Drawing: instanced quads reading state with `texelFetch`.
- Removes the 116 k-float `bufferSubData` and most of `sprayCPU`.

**M10. Stretched spray and mist** (high)
- Spray quads are aligned to velocity and stretched with screen-space speed.
- New "mist" kind: large, low-alpha, soft-depth sprites spawned from breakers and slams.
- Phone: mist off by default.

**M11. Bow and slam spray** (high)
- New emitter at the bow corners, using hull-relative water speed and the bow's slam velocity. Use the hull patch data in `hydro` (~1590).
- Emits a sheet of drops along the hull flare, plus mist on hard slams.
- Wire it into the existing `emit()` budget and `contactSprayBurst` limits.

**M12. Foam material** (medium-high)
- Foam gets its own material:
  - a normal derived from the foam density gradient;
  - roughness ~0.6;
  - thin-layer translucency (wrap lighting);
  - darker, thinner edges using `detail`.
- Unify the foam colour constants between `waterFS` and `crestFS`.

**M13. Stable lamp beams** (high)
- Animate the beam jitter: `hash(pixel)` plus a golden-ratio offset per frame.
- Add a history pass that reprojects with `uPreviousVP`, reusing the reflection-trace history template (≈2536–2561) and its depth-reject clamp. Do the same for the underwater rays.
- Fixes the screen-locked dither crawl. Phone: 8 beam steps with history.

## Effort summary

| Effort | Milestones |
|---|---|
| Extra high | M1, M9 |
| High | M2, M4, M6, M7, M10, M11, M13 |
| Medium / medium-high | M0, M3, M5, M8, M12 |

## Verification (each milestone)

**Fast checks:**
- `python tools/build.py --check`
- `node tools/build.mjs --check`
- `tests/static_checks.py`
- `tests/publish_safety.py`

**Browser suites:**
- `tests/regression.py`
- `tests/mobile.py` (use the venv with Playwright 1.56, which matches the preinstalled Chromium)

**Visual checks:**
- Before/after screenshots of all 4 scenes at noon, dusk and night, underwater, a reef close-up and a resting/bobbing boat. Capture with headless Chromium (`.venv` Playwright, `--enable-unsafe-swiftshader`): start the game, set `window.requestAnimationFrame=()=>0`, call `__tideline.chooseWorld(id)`, step `game.step(DT)` and `renderer.render(...)` for a few seconds, then read `renderer.gl.canvas.toDataURL()` in the same evaluate call. Keep captures out of the repo.
- Glow vs Natural side by side.

**Measurements:**
- SwiftShader full-frame timings, interleaved old/new.
- CPU-side GL call counts per frame: target ≥40% fewer after M1.
- Phone-preset frame cost at 390×844.

**Physics checks:**
- Drop/tow fixtures.
- New check: after a 0.3 m heave offset, a boat oscillates 2–4 times before settling.
- With M6: the simulated state hash is identical with interpolation on and off.

**Delivery:** one PR per phase. Phase 2 can be split per milestone if it gets large.
