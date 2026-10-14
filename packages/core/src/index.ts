/**
 * The full barrel — convenient for Node (CLI, scripts), but pulls in scan.ts's `node:fs`/
 * `node:path` imports. Browser code (apps/web) should import the specific subpaths it needs
 * instead — e.g. `@usalama/core/client`, `@usalama/core/entities`, `@usalama/core/types` — never
 * this barrel, or a bundler will try (and fail) to resolve Node builtins for the browser.
 */
export * from "./types.js"
export * from "./client.js"
export * from "./engine.js"
export * from "./scan.js"
export * from "./entities.js"
export * from "./liveProbe.js"
export { allRules, securityRules, privacyRules, dataDesignRules, freshnessRules, openSourceRules, censorshipRules } from "./rules/index.js"
