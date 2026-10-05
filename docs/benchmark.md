# Benchmark protocol

## Default Surface verification

At 60 seconds, record three scenes, then reverse the scene order. Each scene has fixed light and camera settings. Reserve 57 seconds for setup, warm-up, recording, and scene images. Reserve three seconds for result collection. The browser can delay a callback; report a deadline overrun rather than promise a hard real-time timer.

The scenes examine wet walls and foam, a turning boat wake, and night highlights. The 30-, 15-, and 10-second options are short coverage checks. They are not equally strong tail-latency estimates.

## Controlled feature comparison

The Surface comparison orders variants as Prior / New / New / Prior. Only four declared feature flags change. The scene, camera settings, resolution, and initial world seed match. Wakes can change later hull motion. Do not claim this is an identical-image rendering replay or an independent rerun of an older executable.

The previous contact, optical, gate-flow, and towing plans remain available. Keep saved reports from the same scene and resolution when checking a change. A different scene is not a pure renderer comparison.

## Read the measurements

- Frame interval comes from browser animation timing. It can be display-limited.
- CPU fields are elapsed sections on the main thread, not system CPU use.
- GPU fields are sampled asynchronous commands. Missing or invalid results are not zero.
- Tracked GPU allocations are known target/buffer sizes, not total VRAM.
- JavaScript heap is a browser estimate when exposed, not total process RAM.
- Water-volume checks apply to transport. They do not validate the energy or mass of visual FFT, Gerstner, foam, or crest-sheet layers.
- Wake signed-source error checks source balance before Float32 integration. It is not a full coupled energy residual.

The benchmark keeps slow frames, incomplete scenes, discarded simulation time, and weak sample warnings. The result screen stops rendering until resumed.

## Reproducible development checks

`tests/regression.py` checks startup, feature toggles, settings, histories, wake balance, boat settling, and transport bookkeeping. Reduced settings are named in the script and report. Build verification needs only Python. Browser tests need Playwright.

The development validation report is intentionally sanitized. It is not a performance score for an RTX GPU or a physical phone.

## Public feedback

Inspect a report before posting it. Report JSON can include graphics adapter, browser and platform, locale/timezone, display size, and typed notes. Prefer a game-only capture instead of a browser-window image with personal tabs and bookmarks. Never attach browser profiles, access tokens, or local storage exports unrelated to the game.
