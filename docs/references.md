# Design references

These references explain techniques, not copied commercial assets or source.

- [Filament material guide: specular anti-aliasing](https://google.github.io/filament/main/materials.html). The highlight change uses a bounded normal-variance approximation. It is not the complete Filament implementation.
- [LEAN mapping](https://www.csee.umbc.edu/~olano/papers/lean/). A reference for filtering a distribution of surface directions. This build does not implement full LEAN texture moments.
- [Wave Particles](https://www.cemyuksel.com/research/waveparticles/). A reference for interaction-driven surface disturbances. This build retains its grid-based local stencil and balanced wake sources; it does not implement the paper's particle method.
- [GPU Gems: Effective Water Simulation from Physical Models](https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-1-effective-water-simulation-physical-models). A reference for separating large waves from fine surface detail.
- [GitHub CLI: gh repo create](https://cli.github.com/manual/gh_repo_create). Used by the optional initial-publication helper.

The existing game predates this source package. Its methods are approximations documented in the architecture notes. Similarity of an effect to a commercial game is not a claim of engine equivalence.
