import { i32, str, u64 } from "@arkiv-network/sdk/attr"
import { eq, lt } from "@arkiv-network/sdk/query"
import { ExpirationTime, jsonToPayload } from "@arkiv-network/sdk/utils"
import type { Hex } from "viem"
import type { PublicArkivClient, WalletArkivClient } from "./client.js"
import type { AuditReport, Pillar } from "./types.js"

/**
 * Usalama writes three entity kinds, discriminated by the `kind` attribute (plain "type" was
 * avoided only because it reads ambiguously next to "contentType" in logs — it is not a reserved
 * word, see attr/names.ts, so either would have worked).
 */
export const ENTITY_KINDS = {
  auditReport: "auditReport",
  auditRequest: "auditRequest",
  ruleDefinition: "ruleDefinition",
} as const

/** How long one audit report stays trusted before it needs re-running — the product reason is in README.md. */
export const AUDIT_REPORT_LIFETIME = ExpirationTime.fromDays(90)
/** A queued audit request is a ticket, not a record — it should not outlive the queue by much. */
export const AUDIT_REQUEST_LIFETIME = ExpirationTime.fromHours(24)
/** Rule definitions are reference data: the registry of what Usalama checks for, meant to last. */
export const RULE_DEFINITION_LIFETIME = ExpirationTime.fromYears(2)

/**
 * Publishes one audit report as an Arkiv entity, one per (repoUrl, pillar) pair so each pillar's
 * score can be queried, extended and historied independently.
 *
 * Flags: `permissionlessExtension` so the *audited* project's own wallet can keep a passing
 * report fresh by re-requesting an audit, without being able to alter the score itself — see
 * CreationFlags in the installed SDK (entity/flags.ts) for exactly what that does and does not
 * allow. `readonly` is deliberately **not** set — see arkiv/schema.md, "why not readonly", for
 * why a report needs to stay patchable.
 */
export async function publishAuditReport(client: WalletArkivClient, pillar: Pillar, report: AuditReport) {
  const score = report.scoresByPillar[pillar]
  if (score === undefined) {
    throw new Error(`No findings for pillar "${pillar}" — nothing to publish. Run rules for that pillar first.`)
  }
  const pillarFindings = report.findings.filter((f) => f.pillar === pillar)

  return client.createEntity({
    expires: AUDIT_REPORT_LIFETIME,
    attributes: {
      kind: str(ENTITY_KINDS.auditReport),
      repoUrl: str(report.repoUrl),
      pillar: str(pillar),
      score: i32(score),
      findingsCount: i32(pillarFindings.length),
      auditedAt: u64(BigInt(report.auditedAt)),
    },
    payload: jsonToPayload({ findings: pillarFindings }),
    contentType: "application/json",
    flags: { permissionlessExtension: true },
  })
}

/** Re-runs freshness on an existing report instead of writing a duplicate — see extendEntity's "sets, does not add" semantics. */
export async function reaudit(client: WalletArkivClient, entityKey: Hex) {
  return client.extendEntity({ entityKey, expires: AUDIT_REPORT_LIFETIME })
}

/** Queues an audit request — a short-lived ticket, not part of the permanent record. */
export async function requestAudit(client: WalletArkivClient, repoUrl: string) {
  return client.createEntity({
    expires: AUDIT_REQUEST_LIFETIME,
    attributes: {
      kind: str(ENTITY_KINDS.auditRequest),
      repoUrl: str(repoUrl),
      status: str("queued"),
    },
    payload: jsonToPayload({ repoUrl }),
    contentType: "application/json",
  })
  // Note: who requested it is already on-chain without a dedicated attribute — it's the
  // transaction's $creator, set by whichever account signs this call. A redundant
  // "requestedBy" attribute would just duplicate what $creator already proves.
}

/**
 * Publishes the registry of rule definitions Usalama checks for — long-lived reference data,
 * published once (or whenever a rule changes) rather than per audit. Lets a third party build
 * their own dashboard or re-implementation against Usalama's own stated rules, verifiable
 * on-chain, without asking anyone's permission — the Open Source pillar's own framing.
 */
export async function publishRuleDefinitions(
  client: WalletArkivClient,
  rules: { id: string; pillar: Pillar; description: string }[],
) {
  const results = []
  for (const rule of rules) {
    const result = await client.createEntity({
      expires: RULE_DEFINITION_LIFETIME,
      attributes: {
        kind: str(ENTITY_KINDS.ruleDefinition),
        ruleId: str(rule.id),
        pillar: str(rule.pillar),
      },
      payload: jsonToPayload({ description: rule.description }),
      contentType: "application/json",
      flags: { readonly: true },
    })
    results.push(result)
  }
  return results
}

/** The latest report(s) for a repo, newest first — sorted client-side, since Arkiv's query language has no orderBy (see arkiv/friction.md). */
export async function getLatestReports(client: PublicArkivClient, repoUrl: string, limit = 10) {
  const page = await client
    .select({ key: true, attributes: true, payload: true })
    .where(eq("kind", ENTITY_KINDS.auditReport), eq("repoUrl", repoUrl))
    .limit(limit)
    .fetch()
  return [...page.entities].sort((a, b) => {
    const an = a.attributes?.["auditedAt"]?.value
    const bn = b.attributes?.["auditedAt"]?.value
    const au = typeof an === "bigint" ? an : 0n
    const bu = typeof bn === "bigint" ? bn : 0n
    return bu > au ? 1 : bu < au ? -1 : 0
  })
}

/**
 * Every report a given auditor wallet has ever published — proof of the auditor's own track
 * record. Uses `.createdBy()`, the SDK's own shorthand for `eq("$creator", addr(creator))` —
 * exactly the primitive this project's own Security-pillar rule checks that *other* projects use,
 * rather than trusting a plain "auditor" attribute someone could fake.
 */
export async function getReportsByAuditor(client: PublicArkivClient, auditorAddr: Hex, limit = 50) {
  const page = await client
    .select({ key: true, attributes: true, creator: true })
    .where(eq("kind", ENTITY_KINDS.auditReport))
    .createdBy(auditorAddr)
    .limit(limit)
    .fetch()
  return page.entities
}

/**
 * Every failing report currently live for a pillar — a worklist, not a hall of shame: entries
 * fall off on their own once fixed and re-audited, no deletion needed.
 *
 * `score` is an i32 attribute specifically so this can be a real range query (`lt`) rather than
 * fetching every report for the pillar and filtering in JS — see arkiv/schema.md's note on why
 * every numeric-sounding attribute here is typed, not stringified.
 */
export async function getFailingReports(client: PublicArkivClient, pillar: Pillar, scoreBelow: number, limit = 50) {
  const page = await client
    .select({ key: true, attributes: true })
    .where(eq("kind", ENTITY_KINDS.auditReport), eq("pillar", pillar), lt("score", i32(scoreBelow)))
    .limit(limit)
    .fetch()
  return page.entities
}
