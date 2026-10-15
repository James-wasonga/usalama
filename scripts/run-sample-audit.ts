/**
 * The walkthrough script: audits the bundled fixtures/bad-project, prints the report, and — if
 * USALAMA_PRIVATE_KEY is set — publishes it to Arkiv for real. This is the fastest path from a
 * fresh clone to your first genuine on-chain entity. See README.md "Your first audit".
 *
 * Run with: node --experimental-strip-types scripts/run-sample-audit.ts
 * Or, to actually publish: USALAMA_PRIVATE_KEY=0x... node --experimental-strip-types scripts/run-sample-audit.ts
 */
import { join } from "node:path"
import { createWriteClient, publishAuditReport, runAudit, scanDirectory, type Pillar } from "@usalama/core"

const PILLARS: Pillar[] = ["security", "privacy", "dataDesign", "openSource", "censorship"]

async function main() {
  const target = join(import.meta.dirname, "..", "fixtures", "bad-project")
  const input = await scanDirectory(target, "fixtures/bad-project (sample)")
  const report = runAudit(input)

  console.log(`Audited fixtures/bad-project — overall score ${report.overallScore}/100`)
  for (const pillar of PILLARS) {
    const score = report.scoresByPillar[pillar]
    if (score !== undefined) console.log(`  ${pillar}: ${score}/100`)
  }
  console.log(`${report.findings.length} findings total.\n`)

  const privateKey = process.env.USALAMA_PRIVATE_KEY as `0x${string}` | undefined
  if (!privateKey) {
    console.log("USALAMA_PRIVATE_KEY not set — stopping here. Set it to actually publish this report to Tiramisu.")
    return
  }

  const client = createWriteClient(privateKey)
  console.log("Publishing to Tiramisu...")
  for (const pillar of PILLARS) {
    if (report.scoresByPillar[pillar] === undefined) continue
    const result = await publishAuditReport(client, pillar, report)
    console.log(`  ${pillar}: entity ${result.entityKey} (tx ${result.txHash}, expires at block ${result.expiresAt})`)
  }
  console.log("\nDone. Check tiramisu.explorer.arkiv.network for your entities.")
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
