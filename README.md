# TIDELINE

A water and light lab in one offline HTML file. Sail, tow a disabled boat, change the light, and compare water-rendering features in repeatable tests.

**Current build:** `TL-SURFACE-20261006.2` · Surface 10.2

[Source on GitHub](https://github.com/michaelcrosato/tideline) · [Validation workflow](https://github.com/michaelcrosato/tideline/actions/workflows/ci.yml)

## Deploy to Vercel

In [Vercel's new project screen](https://vercel.com/new), import **`michaelcrosato/tideline`** and use the repository root (`.`). The checked-in `vercel.json` configures everything:

| Setting | Value |
| --- | --- |
| Framework preset | Other |
| Node.js | 24.x |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Environment variables | None |

Choose **Deploy**. Vercel serves the game as static HTML over HTTPS, and its Git integration deploys subsequent pushes. The build has no npm dependencies and needs no Python on Vercel. Only `dist/index.html` is published; source, tests, and documentation stay in the repository. See [deployment details](docs/vercel.md).

## Run

Open **`index.html`** in a browser with WebGL2 and graphics acceleration. No server, account, external models, textures, or runtime packages are required.

The startup screen checks graphics support before loading the game. Choose **Start in game mode** for fullscreen, or **Start in window**. Fullscreen, orientation locking, and keeping the screen awake depend on browser permission and support. A web page cannot block phone calls, notifications, or all system edge gestures.

The six quick controls are **Time of day, Swell height, Water clarity, Surface foam, Brightness, and Light style** (Glow or Natural). Use **Advanced settings** for the full parameter registry and up to ten pinned controls.

## This version

Surface 10.2 phase 2 adds richer spray, foam and light:

- **Spray on the GPU:** spray, foam and bubbles move on the GPU and land on the full wave surface, so drops no longer fall through the swell. Fast drops streak, breakers and slams release soft mist, and the bow throws spray as the boat drives into the water.
- **Foam material:** foam has relief, a soft sheen, light through thin edges, and one colour on the water and the reef crest.
- **Stable beams:** lamp beams and underwater light shafts no longer crawl with a fixed dither pattern.

Surface 10.2 phase 1 fixed the remaining lighting and reef issues and added cheap visual upgrades:

- **Light style:** Glow keeps the teal crest light; Natural filters the sun through the water, so crests turn gold at dawn and dusk. Shadowed reflections, the doubled sun, the dusk light jump and the water colour are fixed in both.
- **Water:** the far sea keeps highlight roughness instead of a mirror finish; the reef breaker has no edge step, aliasing or trough ridge; spray glows toward the sun and takes shadow.
- **Scenery and image:** sky-coloured ambient light, baked ambient occlusion, exact sRGB output, an optional AgX-style tone curve, and a wide, smooth highlight glow.
- **Motion:** boats bob and rock again, and frames are interpolated between physics steps.
- **Phones:** a first-run Phone preset, and one shared uniform buffer that halves the GL calls per frame.

Earlier surface features remain:

- **Patch foam:** fresh dense patches age into broken trails. Detail is carried with the stored foam. The previous cellular-edge appearance remains available for comparison.
- **Wave-height wetness:** scenery shading samples the displaced surface. Nearby surfaces keep two height marks: a fast-draining film and a slower damp mark. Each boat also keeps moisture on its model vertices.
- **Filtered highlights:** normal variation and unresolved small ripples broaden specular highlights. This is an original variance approximation, not a complete LEAN mapping implementation.
- **Path wakes:** short stern sources follow both boats. The history preserves the route after a turn. Balanced positive and negative impulses also feed the local ripple field. They do not add transported water volume.

Surface 10.1 was a correctness and cost pass: sluice gates work at the default grid, water no longer climbs walls as a translucent sheet, capsized boats right themselves, reef breakers stop at the breakwater, and several shading and per-frame costs are lower. See [changes](CHANGELOG.md).

The default transport grid, visible mesh, and particle ceiling are unchanged from the previous build. There is no automatic FPS-based quality reduction. GPU particles need float render targets (`EXT_color_buffer_float`); without them the CPU spray path runs, with round drops and no mist.

## Scenes and controls

**Sluice islands** tests gates and transported water. **Beacon channel** tests moving lights. **Flooded arcade** tests an underwater view through the moving surface. **Breakwater** adds a reef, harbour, second boat, and towing rescue.

Desktop: **WASD / arrows** steer; **right-drag** changes the orbit view; the **wheel** changes its distance. **E** attaches/releases the tow; **[ / ]** reel; **G** sends a rogue packet; **B** changes the camera; **V** changes the underwater view; **Y** hides the interface. **F2** opens controls, **F4** shows pins, **F7** runs a test, and **F8** pauses with diagnostics.

Mobile has a separate interface. The first finger on the open scene steers from its touch point. A second finger moves the camera. Buttons and sliders have independent contacts. There is no visible joystick. Portrait uses bottom panels; landscape uses side panels.

## Benchmark

The default **Surface verification** uses three scenes twice, reversing the order on the second pass. Its 60-second limit reserves 57 seconds for setup, warm-up, and recording, plus three seconds for results. Shorter limits and the previous optical, contact, and towing tests remain available.

**Surface comparison** runs Prior / New / New / Prior. It changes four declared switches: foam, wetness, highlight filtering, and path wakes. **Surface 10.2 comparison** does the same for the 10.2 switches (far-sea roughness, spray lighting, sky ambient, baked AO, bloom chain, GPU particles, spray streaks, mist, bow spray, foam material, stable beams), and **Light style comparison** alternates Glow and Natural. It uses this executable for both variants; it is not the old executable. The new wakes can alter body motion, so this is **not an identical-image renderer replay**.

The report pauses the simulation and renderer. Save the PNG, JSON, or complete ZIP. GPU timings use asynchronous queries when available. Main-thread elapsed time is not CPU utilization. Tracked allocations are not total process RAM or VRAM. Short samples and invalid runs remain marked.

**Reports can contain device details, timezone, browser information, and your notes. Review them before attaching them to a public issue.** Nothing is uploaded automatically. No personal benchmark reports or browser screenshots are included in this repository.

## Build from source

Requires Python 3.10 or later. No build dependencies are needed.

```sh
python tools/build.py
python tools/build.py --check
```

For the Vercel build and local HTTP preview, use Node.js 24:

```sh
npm ci
npm run check
npm run build
npm run preview
```

Open `http://127.0.0.1:3000`. `npm run dev` builds before starting the same preview server. After editing `src`, run `npm run build` and reload the browser. To use another port, run `npm run preview -- --port 3001`. The Node and Python builders produce the same offline HTML; Node also creates the isolated `dist` directory.

`index.html` is the generated, self-contained deliverable. Edit the files in `src`, then rebuild. Do not edit the generated file alone.

```text
src/shell.html   Minimal startup shell and include points
src/bootkit.js   Platform checks, renderer startup, failures, game mode
src/game.css     Desktop and mobile styles
src/game.html    Deferred game interface
src/engine.js    Simulation, renderer, GLSL, controls, tests, diagnostics
src/surface.js   Wetness, path wakes, new reporting, feature comparisons
src/launch.js    Game identity and deferred-load contract
tools/build.mjs Vercel/Node builder, matching tools/build.py
tools/serve.mjs Local preview of the deployable HTML
```

The engine retains the existing systems rather than replacing them during this visual pass. See [architecture](docs/architecture.md), [measurement limits](docs/benchmark.md), and [changes](CHANGELOG.md).

## Tests

Functional tests use Playwright. They are development tools only, not game dependencies.

```sh
uv venv --python 3.13 .venv
uv pip install -r tests/requirements.txt
uv run --no-project python -m playwright install chromium
uv run --no-project python tests/regression.py
uv run --no-project python tests/mobile.py
uv run --no-project python tests/static_checks.py
uv run --no-project python tests/publish_safety.py
```

Install [uv](https://docs.astral.sh/uv/) for these test commands. GitHub Actions runs the source checks, publication safety checks, and both browser suites on pushes to `main` and pull requests. The bundled [validation report](docs/validation.json) records the original source package's checks; use GitHub Actions for current results.

On Ubuntu 26.04, the pinned Playwright release needs `export PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64` before installing Chromium and running browser tests. CI uses Ubuntu 24.04 directly.

For a browser whose local navigation is restricted, `--in-memory` loads the same HTML into a blank test page. Test settings are explicitly reduced and recorded. `--cdp http://127.0.0.1:9222` can attach to a browser you started for testing. Do not expose a browser debugging port to the network.

The mobile tests use an in-memory page and reduced settings. Publication safety tests mock all remote actions and do not create a repository.

These tests do not establish speed on any player's GPU. Physical Android/iOS and hardware-driver checks are separate tasks.

## Publish the initial repository

The repository is **[michaelcrosato/tideline](https://github.com/michaelcrosato/tideline)**. After editing and validating a checkout, commit and push normally:

```sh
git add <changed-files>
git commit -m "Describe the change"
git push origin main
```

The package also retains `tools/publish.py` for initial publication of an absent or empty public target. It deliberately refuses a nonempty remote, so use normal Git commands for updates. The helper does not publish a website or enable GitHub Pages.

See [publishing](docs/publishing.md) for the safety checks and recovery steps.

## Limits

This is a height-field and surface-wave approximation, not an engineering fluid solver. Gerstner/FFT waves and curling crest sheets do not transport reservoir volume. Static wetness stores one vertical interval per world column; it cannot represent independent damp layers on stacked decks. Boat moisture is interpolated from a low-poly model. The wake source is not a fully energy-conserving ship-wave model. Normal filtering does not fix every reflection artifact or provide a full rough reflection convolution.

## References and licensing

Design references are listed in [docs/references.md](docs/references.md). The implementation does not include commercial game code or art. The game generates its geometry and effects in code.

**No open-source license has been selected yet.** Public repository visibility alone does not grant a general license to reuse this work. A project owner can add a license before accepting outside contributions.
