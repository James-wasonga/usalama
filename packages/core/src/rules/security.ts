import type { AuditInput, Finding, StaticRule } from "../types.js"

/**
 * Names that look like "this attribute decides who can act", written by a hand rather than by
 * the protocol. Arkiv's actual access-control primitives are the system fields `$creator`
 * (immutable, set once at creation) and `$owner` (mutable, but only changeable through
 * `changeOwnership`, which checks the *current* owner). A plain attribute with one of these
 * names is just data: any wallet that can write an entity can set `owner: "0xWhoeverTheyWant"`
 * on it, so filtering on it as if it were authoritative is the exact mistake the hackathon's own
 * rubric calls out under the Security pillar.
 */
const WRITABLE_AUTHORITY_NAMES = [
  "owner",
  "owneraddress",
  "creator",
  "creatoraddress",
  "admin",
  "adminaddress",
  "author",
  "authoraddress",
  "controller",
]

/** Matches `eq("owner", ...)`, `where(eq("ownerAddress", ...))`, etc. — a writable name used as a filter. */
function findWritableAuthorityFilters(sourceFiles: Record<string, string>): Finding[] {
  const findings: Finding[] = []
  const callPattern = /\b(?:eq|ne)\(\s*["'`]([A-Za-z][A-Za-z0-9._-]*)["'`]/g

  for (const [file, text] of Object.entries(sourceFiles)) {
    for (const match of text.matchAll(callPattern)) {
      const name = match[1]
      if (name === undefined) continue
      if (!WRITABLE_AUTHORITY_NAMES.includes(name.toLowerCase())) continue
      const line = text.slice(0, match.index).split("\n").length
      findings.push({
        ruleId: "sec-writable-authority-filter",
        pillar: "security",
        severity: "fail",
        message:
          `Query filters on a plain attribute named "${name}", which any wallet can set to any ` +
          'value when writing an entity. Use $creator (immutable) via createdBy(), or $owner ' +
          "via ownedBy(), so the filter can't be spoofed by the data it's filtering.",
        file,
        line,
      })
    }
  }
  return findings
}

/** Rewards code that actually uses the real primitives: createdBy()/ownedBy(), or $creator/$owner in a query string. */
function findRealAuthorityUsage(sourceFiles: Record<string, string>): Finding[] {
  const findings: Finding[] = []
  const goodPattern = /\.(createdBy|ownedBy)\(|["'`]\$(creator|owner)["'`]/

  for (const [file, text] of Object.entries(sourceFiles)) {
    if (goodPattern.test(text)) {
      findings.push({
        ruleId: "sec-real-authority-usage",
        pillar: "security",
        severity: "info",
        message: "Uses createdBy()/ownedBy() or $creator/$owner directly — the real, unspoofable authority fields.",
        file,
      })
    }
  }
  return findings
}

/**
 * Flags a private key, or anything that looks like one, appearing in source rather than an env
 * var. A 64-hex-char string prefixed 0x is exactly a private key's shape; the hackathon's own
 * disqualification list names "private keys or secrets stored in Arkiv" as an instant fail, and
 * a hard-coded key in the repo that writes to Arkiv is one accidental commit away from the same
 * mistake, even if it never actually lands in an entity's payload.
 */
function findHardcodedKeys(sourceFiles: Record<string, string>): Finding[] {
  const findings: Finding[] = []
  const keyPattern = /0x[0-9a-fA-F]{64}\b/g

  for (const [file, text] of Object.entries(sourceFiles)) {
    // Skip files that are clearly documentation about the *shape* of a key, not a real one.
    if (/\.md$/i.test(file)) continue
    for (const match of text.matchAll(keyPattern)) {
      const line = text.slice(0, match.index).split("\n").length
      findings.push({
        ruleId: "sec-hardcoded-key-shaped-literal",
        pillar: "security",
        severity: "warn",
        message:
          "A 64-hex-character 0x-prefixed literal — the exact shape of a private key — appears " +
          "in source. If this is a real key, rotate it immediately and load keys from an env " +
          "var instead. (If it's a sample/test address or hash, this is a false positive — " +
          "Usalama can't tell the difference from the string alone.)",
        file,
        line,
      })
    }
  }
  return findings
}

export const securityRules: StaticRule[] = [
  {
    id: "sec-writable-authority-filter",
    pillar: "security",
    description: "Flags queries that filter on a plain, writable attribute as if it granted authority.",
    check: (input: AuditInput) => findWritableAuthorityFilters(input.sourceFiles),
  },
  {
    id: "sec-real-authority-usage",
    pillar: "security",
    description: "Rewards use of the real $creator/$owner primitives via createdBy()/ownedBy().",
    check: (input: AuditInput) => findRealAuthorityUsage(input.sourceFiles),
  },
  {
    id: "sec-hardcoded-key-shaped-literal",
    pillar: "security",
    description: "Flags 0x-prefixed 64-hex-char literals in source, which are exactly private-key shaped.",
    check: (input: AuditInput) => findHardcodedKeys(input.sourceFiles),
  },
]
