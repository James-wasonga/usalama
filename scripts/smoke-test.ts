/**
 * A dependency-free correctness check for the static rule engine: run it against two fixture
 * projects — one written to pass, one written to fail every rule on purpose — and assert the
 * findings land where they should. No network, no wallet, no testnet needed; this only proves
 * the rules themselves are correct. See README.md "Verifying it works" for what this does and
 * does not cover.
 *
 * Run with: node --experimental-strip-types scripts/smoke-test.ts
 * (or: npm test, from the repo root)
 */
import assert from "node:assert/strict"
import { join } from "node:path"
import { scanDirectory, runAudit } from "@usalama/core"

const FIXTURES_DIR = join(import.meta.dirname, "..", "fixtures")

function ids(findings: { ruleId: string }[]): Set<string> {
  return new Set(findings.map((f) => f.ruleId))
}

async function main() {
  console.log("Usalama smoke test\n")

  // --- Good project: every rule should either stay silent or report info-only. ---
  const goodInput = await scanDirectory(join(FIXTURES_DIR, "good-project"), "fixtures/good-project")
  const goodReport = runAudit(goodInput)
  const goodFindingIds = ids(goodReport.findings)

  assert.ok(!goodFindingIds.has("sec-writable-authority-filter"), "good project should not trigger the writable-authority-filter rule")
  assert.ok(!goodFindingIds.has("priv-plaintext-pii-near-write"), "good project should not trigger the plaintext-PII rule")
  assert.ok(!goodFindingIds.has("dd-numeric-name-string-type"), "good project typed price/amount as i32 and should not trigger this")
  assert.ok(goodFindingIds.has("os-license-present"), "good project has a LICENSE and should be recognised")
  assert.ok(goodFindingIds.has("dd-differentiated-expiry"), "good project's three different expiry windows should be recognised as differentiated")
  for (const fail of goodReport.findings.filter((f) => f.severity === "fail")) {
    assert.fail(`good project should have zero "fail"-severity findings, but got: ${fail.ruleId} — ${fail.message}`)
  }
  console.log(`good-project: score ${goodReport.overallScore}/100, ${goodReport.findings.length} findings, 0 failures ✓`)

  // --- Bad project: every anti-pattern planted in the fixture should be caught. ---
  const badInput = await scanDirectory(join(FIXTURES_DIR, "bad-project"), "fixtures/bad-project")
  const badReport = runAudit(badInput)
  const badFindingIds = ids(badReport.findings)

  assert.ok(badFindingIds.has("sec-writable-authority-filter"), 'bad project filters on a plain "owner" attribute and should be caught')
  assert.ok(badFindingIds.has("sec-hardcoded-key-shaped-literal"), "bad project has a key-shaped literal and should be caught")
  assert.ok(badFindingIds.has("priv-plaintext-pii-near-write"), "bad project has an email literal next to a write and should be caught")
  assert.ok(badFindingIds.has("dd-numeric-name-string-type"), 'bad project types "price" and "amount" as str and should be caught')
  assert.ok(badFindingIds.has("dd-undifferentiated-expiry"), "bad project uses 30 days for every entity type and should be caught")
  assert.ok(badFindingIds.has("os-license-missing"), "bad project has no LICENSE and should be caught")
  assert.ok(badFindingIds.has("os-friction-missing"), "bad project has no arkiv/friction.md and should be caught")
  assert.ok(badReport.overallScore < goodReport.overallScore, "bad project's overall score should be lower than the good project's")
  console.log(`bad-project: score ${badReport.overallScore}/100, ${badReport.findings.length} findings, all ${7} planted issues caught ✓`)

  console.log(`\nAll assertions passed. good=${goodReport.overallScore} bad=${badReport.overallScore}`)
}

main().catch((err) => {
  console.error("\nSMOKE TEST FAILED")
  console.error(err)
  process.exitCode = 1
})
