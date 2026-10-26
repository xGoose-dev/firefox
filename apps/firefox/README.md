# Firefox host

See the [repository README](../../README.md) and [Mozilla build instructions](../../MOZILLA_REVIEW.md).

Run `npm run build` from the repository root. The `dist/` directory is a complete
Manifest V3 Firefox extension. Packaged skills use `browser.scripting`; optional
user scripts and custom actions use Firefox 153's `browser.userScripts.execute`.
The esbuild-injected `firefoxAPI.ts` alias uses the Promise-based `browser` namespace
while retaining compatible TypeScript declarations.
