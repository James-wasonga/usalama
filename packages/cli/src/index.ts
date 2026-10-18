#!/usr/bin/env node
import { Command } from "commander"
import {
  createReadClient,
  createWatchClient,
  createWriteClient,
  getLatestReports,
  liveProbeFindings,
  probeWallets,
  publishAuditReport,
  runAudit,
  scanDirectory,
  type AuditReport,
  type Finding,
  type Pillar,
} from "@usalama/core"

const PILLARS: Pillar[] = ["security", "privacy", "dataDesign", "openSource", "censorship"]

function severityTag(severity: Finding["severity"]): string {
  return { info: "  info", warn: "  warn", fail: "  FAIL" }[severity]
}

function printReport(report: AuditReport, liveFindings: Finding[] = []) {
  console.log(`\nUsalama audit — ${report.repoUrl}`)
  console.log(`Overall score: ${report.overallScore}/100\n`)

  for (const pillar of PILLARS) {
    const score = report.scoresByPillar[pillar]
    if (score === undefined) continue
    console.log(`  ${pillar}: ${score}/100`)
  }

  const all = [...report.findings, ...liveFindings]
  if (all.length === 0) {
    console.log("\nNo findings — either the target is clean, or nothing scannable was found.")
    return
  }

  console.log("\nFindings:")
  for (const finding of all) {
    const location = finding.file ? ` (${finding.file}${finding.line ? `:${finding.line}` : ""})` : ""
    console.log(`${severityTag(finding.severity)}  [${finding.ruleId}]${location}`)
    console.log(`        ${finding.message}`)
  }
}

const program = new Command()
program
  .name("usalama")
  .description("Audit an Arkiv project's security, privacy, and data-design posture")
  .version("0.1.0")

program
  .command("audit <path>")
  .description("Run every static rule against a local project directory")
  .option("--repo <url>", "Label the report with this URL instead of the local path")
  .option("--wallets <addresses>", "Comma-separated 0x addresses to probe live on Tiramisu")
  .option("--json", "Print machine-readable JSON instead of a human report")
  .option("--publish", "Write the report to Arkiv (requires USALAMA_PRIVATE_KEY)")
  .action(async (path: string, opts: { repo?: string; wallets?: string; json?: boolean; publish?: boolean }) => {
    const repoUrl = opts.repo ?? path
    const wallets = opts.wallets?.split(",").map((w) => w.trim()) as `0x${string}`[] | undefined

    const input = await scanDirectory(path, repoUrl, wallets)
    const report = runAudit(input)

    let liveFindings: Finding[] = []
    if (wallets && wallets.length > 0) {
      const readClient = createReadClient()
      const probeResults = await probeWallets(readClient, wallets)
      liveFindings = probeResults.flatMap(liveProbeFindings)
    }

    if (opts.json) {
      console.log(JSON.stringify({ ...report, liveFindings }, (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2))
    } else {
      printReport(report, liveFindings)
    }

    if (opts.publish) {
      const privateKey = process.env.USALAMA_PRIVATE_KEY as `0x${string}` | undefined
      if (!privateKey) {
        console.error("\n--publish requires USALAMA_PRIVATE_KEY to be set. See README.md \"Getting a funded wallet\".")
        process.exitCode = 1
        return
      }
      const writeClient = createWriteClient(privateKey)
      console.log("\nPublishing to Arkiv (Tiramisu)...")
      for (const pillar of PILLARS) {
        if (report.scoresByPillar[pillar] === undefined) continue
        const result = await publishAuditReport(writeClient, pillar, report)
        console.log(`  ${pillar}: entity ${result.entityKey} (tx ${result.txHash})`)
      }
    }
  })

program
  .command("list <repoUrl>")
  .description("Fetch the latest published reports for a repo from Tiramisu")
  .action(async (repoUrl: string) => {
    const client = createReadClient()
    const reports = await getLatestReports(client, repoUrl)
    if (reports.length === 0) {
      console.log(`No reports found for ${repoUrl}.`)
      return
    }
    for (const entity of reports) {
      console.log(JSON.stringify(entity, (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2))
    }
  })

  program
  .command("watch")
  .description("Stream newly created entities on Tiramisu as they land")
  .action(() => {
    // A real WebSocket client, not the HTTP one — see createWatchClient()'s docstring in
    // @usalama/core/client for why: watching over HTTP silently polls every ~1s and burns the
    // anonymous query budget, which is exactly what happened to our own dashboard before this fix.
    const client = createWatchClient()
    console.log("Watching Tiramisu for new entities. Ctrl+C to stop.\n")
    // Events carry entityKey/owner/expiresAt/creationFlags, but never attributes (see
    // arkiv/friction.md) — so showing *what* was created needs this follow-up getEntity() call.
    const unwatch = client.watchEntityEvents({
      onEntityCreated: (event) => {
        // getEntity always returns every field (it has no per-call selection) and throws if the
        // entity is already gone by the time we ask — easily possible for a short-lived one.
        client
          .getEntity(event.entityKey)
          .then((entity) => {
            const kind = entity.attributes["kind"]?.value ?? "(unknown kind)"
            console.log(`created  ${event.entityKey}  owner=${event.owner}  kind=${kind}`)
          })
          .catch(() => {
            console.log(`created  ${event.entityKey}  owner=${event.owner}  (could not fetch attributes — entity may have already expired)`)
          })
      },
      onError: (error) => console.error("watch error:", error.message),
    })
    process.on("SIGINT", () => {
      unwatch()
      process.exit(0)
    })
  })

program.parseAsync(process.argv)
