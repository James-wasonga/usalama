import type { AuditInput, Finding, StaticRule } from "../types.js"

/**
 * Attribute names that usually hold a number a product will eventually want to range-filter —
 * "show me loads under this price", "positions below this health factor". Arkiv only indexes
 * i32/u64/u256/dec for <, <=, >, >= (see query/expression.ts's ORDERED_TAGS); a value with one of
 * these names declared as a plain string can never be range-queried, only matched exactly.
 */
const NUMERIC_SOUNDING_NAMES =
  /\b(price|amount|score|level|balance|count|weight|reward|deadline|timestamp|quantity|rate|rating|rank|value|total|size|duration|age|index|wins|losses|votes|stake|bid|fee|cost)\w*/gi

/**
 * A crude but useful parse of one markdown-ish "attribute line" inside schema.md, of the shape
 * `name (type)` or `name: type` — the two shapes every schema.md we found in the wild actually
 * uses. Deliberately permissive: schema.md has no fixed grammar, only a fixed list of what it
 * must cover, so this looks for the pattern rather than requiring one exact format.
 */
function parseAttributeLines(schemaMd: string): { name: string; type: string }[] {
  const lines = schemaMd.split("\n")
  const results: { name: string; type: string }[] = []
  const paren = /\b([A-Za-z][A-Za-z0-9_]*)\s*\(([A-Za-z0-9_, ]+)\)/g
  const colon = /\b([A-Za-z][A-Za-z0-9_]*)\s*:\s*(str|string|i32|u64|u256|dec|bool|addr|key|bytes32)\b/gi

  for (const line of lines) {
    for (const m of line.matchAll(paren)) {
      const name = m[1]
      const type = m[2]
      if (name !== undefined && type !== undefined) results.push({ name, type: type.trim() })
    }
    for (const m of line.matchAll(colon)) {
      const name = m[1]
      const type = m[2]
      if (name !== undefined && type !== undefined) results.push({ name, type: type.trim() })
    }
  }
  return results
}

function findNumericNamedStrings(schemaMd: string | undefined): Finding[] {
  if (schemaMd === undefined) return []
  const findings: Finding[] = []
  const attrs = parseAttributeLines(schemaMd)

  for (const { name, type } of attrs) {
    const looksNumeric = NUMERIC_SOUNDING_NAMES.test(name)
    NUMERIC_SOUNDING_NAMES.lastIndex = 0 // reset — the /g flag makes .test() stateful
    const isStringType = /^(str|string)$/i.test(type)
    if (looksNumeric && isStringType) {
      findings.push({
        ruleId: "dd-numeric-name-string-type",
        pillar: "dataDesign",
        severity: "warn",
        message:
          `arkiv/schema.md declares "${name}" as ${type}, but the name suggests a number a ` +
          "query would want to range-filter. Only i32/u64/u256/dec carry an ordered index on " +
          "Arkiv — a str with this name can only ever be matched exactly, never compared with " +
          "< or >. (If it's genuinely non-numeric, e.g. a formatted ID, this is a false positive.)",
        file: "arkiv/schema.md",
      })
    }
  }
  return findings
}

/**
 * Looks for an explicit expiry duration per entity-type section of schema.md, and flags it when
 * every entity type the file names uses the exact same one. The rubric rewards "lifetimes that
 * differ per entity type and follow product logic" by name — an identical duration everywhere
 * usually means expiry was set once and copy-pasted, not actually designed per entity.
 */
function findUndifferentiatedExpiry(schemaMd: string | undefined): Finding[] {
  if (schemaMd === undefined) return []
  const durationPattern = /\b(\d+)\s*(second|minute|hour|day|week|month|year)s?\b/gi
  const durations = new Set<string>()
  let totalMatches = 0

  for (const m of schemaMd.matchAll(durationPattern)) {
    const n = m[1]
    const unit = m[2]
    if (n === undefined || unit === undefined) continue
    totalMatches++
    durations.add(`${n} ${unit.toLowerCase()}`)
  }

  // Only worth an opinion once there's enough evidence: fewer than 2 duration mentions could be
  // one entity type with one expiry stated once, which is not evidence of anything.
  if (totalMatches < 2) return []

  if (durations.size === 1) {
    return [
      {
        ruleId: "dd-undifferentiated-expiry",
        pillar: "dataDesign",
        severity: "warn",
        message:
          "Every expiry duration mentioned in arkiv/schema.md is the same " +
          `(${[...durations][0]}). The rubric specifically rewards lifetimes that differ per ` +
          "entity type and follow product logic — worth checking this wasn't set once and " +
          "copied across every entity.",
        file: "arkiv/schema.md",
      },
    ]
  }
  return [
    {
      ruleId: "dd-differentiated-expiry",
      pillar: "dataDesign",
      severity: "info",
      message: `arkiv/schema.md mentions ${durations.size} distinct expiry durations — a sign lifetimes were considered per entity type, not copy-pasted.`,
      file: "arkiv/schema.md",
    },
  ]
}

/** Rewards source that actually uses a range operator (gt/gte/lt/lte) — proof range queries are exercised, not just possible. */
function findRangeQueryUsage(sourceFiles: Record<string, string>): Finding[] {
  const findings: Finding[] = []
  for (const [file, text] of Object.entries(sourceFiles)) {
    if (/\b(gt|gte|lt|lte)\(/.test(text)) {
      findings.push({
        ruleId: "dd-range-query-usage",
        pillar: "dataDesign",
        severity: "info",
        message: "Uses a range operator (gt/gte/lt/lte) — numeric attributes are actually being range-queried, not just declared.",
        file,
      })
    }
  }
  return findings
}

export const dataDesignRules: StaticRule[] = [
  {
    id: "dd-numeric-name-string-type",
    pillar: "dataDesign",
    description: "Flags numeric-sounding attribute names declared as str in schema.md.",
    check: (input: AuditInput) => findNumericNamedStrings(input.schemaMd),
  },
  {
    id: "dd-expiry-differentiation",
    pillar: "dataDesign",
    description: "Flags every entity type sharing one identical expiry duration.",
    check: (input: AuditInput) => findUndifferentiatedExpiry(input.schemaMd),
  },
  {
    id: "dd-range-query-usage",
    pillar: "dataDesign",
    description: "Rewards actual use of gt/gte/lt/lte in source.",
    check: (input: AuditInput) => findRangeQueryUsage(input.sourceFiles),
  },
]
