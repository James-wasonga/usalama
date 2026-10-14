import type { AuditInput, AuditReport, Finding, Pillar, Severity, StaticRule } from "./types.js"
import { allRules } from "./rules/index.js"

const PENALTY: Record<Severity, number> = {
  info: 0, // informational findings are evidence, not a deduction
  warn: 15,
  fail: 35,
}

/**
 * Turns one pillar's findings into a 0-100 score, starting at 100 and deducting per finding.
 * `info` findings never lower the score — they exist so a report can show what was done right,
 * not just what was wrong.
 */
function scorePillar(findings: Finding[]): number {
  const total = findings.reduce((sum, f) => sum + PENALTY[f.severity], 0)
  return Math.max(0, 100 - total)
}

/**
 * Runs every rule in `rules` (defaults to {@link allRules}) against `input` and returns the full
 * audit report: every finding, a 0-100 score per pillar that had at least one finding, and an
 * overall score averaged across those pillars.
 *
 * A pillar with zero findings is left out of `scoresByPillar` rather than defaulted to 0 or 100
 * — no rule firing means nothing was checked for that pillar on this input, not that the project
 * passed or failed it.
 */
export function runAudit(input: AuditInput, rules: StaticRule[] = allRules): AuditReport {
  const findings: Finding[] = []
  for (const rule of rules) {
    findings.push(...rule.check(input))
  }

  const byPillar = new Map<Pillar, Finding[]>()
  for (const finding of findings) {
    const list = byPillar.get(finding.pillar) ?? []
    list.push(finding)
    byPillar.set(finding.pillar, list)
  }

  const scoresByPillar: Partial<Record<Pillar, number>> = {}
  for (const [pillar, pillarFindings] of byPillar) {
    scoresByPillar[pillar] = scorePillar(pillarFindings)
  }

  const scores = Object.values(scoresByPillar)
  const overallScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0

  return {
    repoUrl: input.repoUrl,
    auditedAt: Math.floor(Date.now() / 1000),
    findings,
    scoresByPillar,
    overallScore,
  }
}
