import type { AuditInput, Finding, StaticRule } from "../types.js"

/**
 * `ExpirationTime.permanent()` is a real, legitimate call — some data genuinely should never
 * expire (a registry of rule definitions, say). But it is also the easiest way to accidentally
 * turn Arkiv into "a database that never cleans up after itself", which is exactly the
 * plain-database behaviour the Why Arkiv story is supposed to improve on. This rule doesn't fail
 * the build; it just asks the question out loud.
 */
function findPermanentExpiry(sourceFiles: Record<string, string>): Finding[] {
  const findings: Finding[] = []
  for (const [file, text] of Object.entries(sourceFiles)) {
    const pattern = /ExpirationTime\s*\.\s*permanent\s*\(\s*\)/g
    for (const match of text.matchAll(pattern)) {
      const line = text.slice(0, match.index).split("\n").length
      findings.push({
        ruleId: "fresh-permanent-expiry",
        pillar: "dataDesign",
        severity: "info",
        message:
          "Uses ExpirationTime.permanent() — worth a one-line justification in schema.md for " +
          "why this entity type should never expire, since permanent-by-default is usually a " +
          "sign expiry wasn't designed for this entity, just skipped.",
        file,
        line,
      })
    }
  }
  return findings
}

/** Rewards extendEntity usage — a sign the project renews freshness by activity rather than recreating entities. */
function findExtendUsage(sourceFiles: Record<string, string>): Finding[] {
  const findings: Finding[] = []
  for (const [file, text] of Object.entries(sourceFiles)) {
    if (/\bextendEntity\s*\(/.test(text)) {
      findings.push({
        ruleId: "fresh-extend-usage",
        pillar: "dataDesign",
        severity: "info",
        message: "Uses extendEntity() — freshness is renewed by activity instead of entities being recreated from scratch.",
        file,
      })
    }
  }
  return findings
}

/** A LICENSE file is one of the hackathon's own submission gates — flag its absence directly. */
function findLicense(sourceFiles: Record<string, string>): Finding[] {
  const hasLicense = Object.keys(sourceFiles).some((f) => /^LICENSE(\.(md|txt))?$/i.test(f))
  if (hasLicense) {
    return [
      {
        ruleId: "os-license-present",
        pillar: "openSource",
        severity: "info",
        message: "A LICENSE file is present.",
      },
    ]
  }
  return [
    {
      ruleId: "os-license-missing",
      pillar: "openSource",
      severity: "fail",
      message: "No LICENSE file found. The hackathon's own submission gate requires a public MIT repo — missing LICENSE blocks that gate outright.",
    },
  ]
}

/** schema.md and friction.md are both named, required files in the submission checklist. */
function findRequiredDocs(input: AuditInput): Finding[] {
  const findings: Finding[] = []
  const files = Object.keys(input.sourceFiles)
  if (input.schemaMd === undefined && !files.some((f) => /arkiv\/schema\.md$/i.test(f))) {
    findings.push({
      ruleId: "os-schema-missing",
      pillar: "openSource",
      severity: "fail",
      message: "No arkiv/schema.md found — required by the submission checklist's own gate.",
    })
  }
  if (!files.some((f) => /arkiv\/friction\.md$/i.test(f))) {
    findings.push({
      ruleId: "os-friction-missing",
      pillar: "openSource",
      severity: "fail",
      message: "No arkiv/friction.md found — required by the submission checklist's own gate.",
    })
  }
  return findings
}

/**
 * A rough signal for the Censorship-Resistance pillar: does the app read Arkiv directly
 * (createPublicClient, viem, watchEntityEvents), or only ever talk to the project's own backend
 * API? Reading Arkiv only through your own server means your server is a single point someone
 * could lean on or shut down — the opposite of what the pillar is asking "who is harmed if this
 * is censored or shut down" to probe.
 */
function findDirectReadAccess(sourceFiles: Record<string, string>): Finding[] {
  const hasDirectClient = Object.values(sourceFiles).some((t) =>
    /createPublicClient|watchEntityEvents|@arkiv-network\/sdk/.test(t),
  )
  if (hasDirectClient) {
    return [
      {
        ruleId: "cens-direct-read-access",
        pillar: "censorship",
        severity: "info",
        message: "Reads Arkiv directly via the SDK somewhere in the scanned source — a client isn't forced through one operator's backend to see the data.",
      },
    ]
  }
  return [
    {
      ruleId: "cens-no-direct-read-access",
      pillar: "censorship",
      severity: "warn",
      message: "No direct Arkiv SDK read call found in the scanned source. If every read actually goes through your own backend, that backend is a single point of failure the Censorship-Resistance pillar is specifically asking about.",
    },
  ]
}

export const freshnessRules: StaticRule[] = [
  {
    id: "fresh-permanent-expiry",
    pillar: "dataDesign",
    description: "Flags ExpirationTime.permanent() usage for a one-line justification.",
    check: (input: AuditInput) => findPermanentExpiry(input.sourceFiles),
  },
  {
    id: "fresh-extend-usage",
    pillar: "dataDesign",
    description: "Rewards extendEntity() usage.",
    check: (input: AuditInput) => findExtendUsage(input.sourceFiles),
  },
]

export const openSourceRules: StaticRule[] = [
  {
    id: "os-license",
    pillar: "openSource",
    description: "Checks for a LICENSE file.",
    check: (input: AuditInput) => findLicense(input.sourceFiles),
  },
  {
    id: "os-required-docs",
    pillar: "openSource",
    description: "Checks for arkiv/schema.md and arkiv/friction.md.",
    check: (input: AuditInput) => findRequiredDocs(input),
  },
]

export const censorshipRules: StaticRule[] = [
  {
    id: "cens-direct-read-access",
    pillar: "censorship",
    description: "Checks whether Arkiv is read directly via the SDK, not only through one backend.",
    check: (input: AuditInput) => findDirectReadAccess(input.sourceFiles),
  },
]
