import { readFile, readdir } from "node:fs/promises"
import { join, relative } from "node:path"
import type { AuditInput } from "./types.js"

const SCANNABLE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".md"])
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"])
/** A hard cap so an accidentally-huge target (a vendored dependency, a monorepo) can't make one audit run forever. */
const MAX_FILES = 2000

/**
 * Walks a local directory, reading every scannable source file plus arkiv/schema.md
 * specifically, and returns the {@link AuditInput} the rule engine needs.
 *
 * @param rootDir - The repo checkout's root — wherever LICENSE, arkiv/, package.json live.
 * @param repoUrl - What to label the report with. Usually the repo's GitHub URL.
 * @param wallets - Optional wallet addresses the target disclosed, for a live on-chain probe.
 */
export async function scanDirectory(rootDir: string, repoUrl: string, wallets?: `0x${string}`[]): Promise<AuditInput> {
  const sourceFiles: Record<string, string> = {}
  let schemaMd: string | undefined

  async function walk(dir: string) {
    if (Object.keys(sourceFiles).length >= MAX_FILES) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return // unreadable directory — skip rather than fail the whole audit
    }
    for (const entry of entries) {
      if (Object.keys(sourceFiles).length >= MAX_FILES) return
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
          await walk(fullPath)
        }
        continue
      }
      const isLicense = /^LICENSE(\.(md|txt))?$/i.test(entry.name)
      const hasScannableExt = [...SCANNABLE_EXTENSIONS].some((ext) => entry.name.endsWith(ext))
      if (!isLicense && !hasScannableExt) continue

      let text: string
      try {
        text = await readFile(fullPath, "utf8")
      } catch {
        continue // binary or unreadable — skip rather than fail the whole audit
      }
      const relativePath = relative(rootDir, fullPath).split("\\").join("/") // normalise on Windows
      sourceFiles[relativePath] = text
      if (relativePath.toLowerCase() === "arkiv/schema.md") {
        schemaMd = text
      }
    }
  }

  await walk(rootDir)
  return { repoUrl, schemaMd, sourceFiles, wallets }
}
