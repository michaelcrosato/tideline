# Vercel deployment

Import [michaelcrosato/tideline](https://github.com/michaelcrosato/tideline) from [Vercel](https://vercel.com/new). Select the repository root, the **Other** framework preset, and Node.js **24.x**. Keep the build settings from `vercel.json`: `npm ci`, `npm run build`, and output directory `dist`. No environment variables, database, server functions, or runtime packages are required.

`tools/build.mjs` assembles the same source includes as the original Python builder. It writes the downloadable offline `index.html` and an identical `dist/index.html`. Every build recreates `dist`, so obsolete files cannot be published accidentally. The deployed file includes its own styles, scripts, shaders, and interface; it requests no external assets.

The HTML revalidates when revisited, allowing players to receive updates. Vercel handles delivery compression and HTTPS. There is no catch-all rewrite: the game uses `/`, and unknown paths should return 404. There are no client-side routes to configure.

After import, Vercel's Git integration deploys `main` to production and supplies previews for pull requests. GitHub Actions independently checks the deterministic build and game behavior; a successful Vercel build alone does not mean those game checks passed. See [Vercel's configuration reference](https://vercel.com/docs/project-configuration/vercel-json) and [GitHub integration](https://vercel.com/docs/git/vercel-for-github).

## Local verification

```sh
npm ci
npm run check
npm run build
npm run preview
```

Open `http://127.0.0.1:3000`, wait for the startup checks, then select **Start in window**. The preview serves only the generated game. Rebuild and reload after changing the source. The root `index.html` can also be opened directly or saved for offline use.

The browser needs WebGL2 and graphics acceleration. Fullscreen, orientation lock, and wake lock still depend on browser support. Browser regression tests use explicit reduced settings and software graphics; they do not measure performance on a player's GPU.

## Common import issues

- **404 at the home page:** confirm the root directory is `.` and the output directory is `dist`.
- **Wrong framework preset:** use **Other**; this is plain HTML, JavaScript, and WebGL.
- **Build mismatch in GitHub Actions:** rebuild after editing `src`, then commit the updated root `index.html` with the source changes.
- **Initial-publication helper refuses the repository:** that helper accepts only an absent or empty repository. Use normal `git push` for updates.
