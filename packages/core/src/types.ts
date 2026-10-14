/**
 * Shared types for Usalama's rule engine and Arkiv integration.
 */

export type Pillar = "security" | "privacy" | "openSource" | "censorship" | "dataDesign"

export type Severity = "info" | "warn" | "fail"

/** One thing a rule found while examining a target project. */
export type Finding = {
  ruleId: string
  pillar: Pillar
  severity: Severity
  message: string
  /** File path the finding relates to, if any — relative to the scanned root. */
  file?: string
  /** 1-based line number, if the finding points at a specific line. */
  line?: number
}

/** A static source for one rule to check: the schema.md text, plus every source file found. */
export type AuditInput = {
  /** The target's identity, used as the repoUrl attribute on the published report. */
  repoUrl: string
  /** Raw text of /arkiv/schema.md, if found. */
  schemaMd?: string
  /** Every source file scanned, keyed by relative path. */
  sourceFiles: Record<string, string>
  /** Optional: wallet addresses the target disclosed as its entity creators, for live verification. */
  wallets?: `0x${string}`[]
}

/** What a live, on-chain probe against a target's disclosed wallets found. */
export type LiveProbeResult = {
  wallet: `0x${string}`
  entitiesSampled: number
  /** How many sampled entities carry at least one numeric (i32/u64/u256/dec) attribute. */
  entitiesWithNumericAttrs: number
  /** Distinct expiry windows observed, rounded to the nearest day, as a rough lifetime count. */
  distinctLifetimeBuckets: number
  /** Whether any sampled entity's expiry resolves effectively to "never" (the max u64 block). */
  anyPermanentEntities: boolean
}

/** A rule is a pure function from input to zero or more findings. Static rules never touch the network. */
export type StaticRule = {
  id: string
  pillar: Pillar
  description: string
  check: (input: AuditInput) => Finding[]
}

/** The full result of auditing one target. */
export type AuditReport = {
  repoUrl: string
  auditedAt: number
  findings: Finding[]
  /** 0-100, one per pillar that had at least one applicable rule. */
  scoresByPillar: Partial<Record<Pillar, number>>
  /** The overall score: the average of scoresByPillar, rounded. */
  overallScore: number
  liveProbe?: LiveProbeResult[]
}
