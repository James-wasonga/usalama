import type { Hex } from "viem"
import type { PublicArkivClient } from "./client.js"
import type { Finding, LiveProbeResult } from "./types.js"

const ORDERED_TYPE_TAGS = new Set(["i32", "u64", "u256", "dec"])
/** One day, in blocks, at Arkiv's nominal 2-second block time — used only to bucket observed lifetimes for comparison, not to resolve a real expiry. */
const BLOCKS_PER_DAY = (24 * 60 * 60) / 2

/**
 * Queries a target's disclosed wallet for its own, real entities on Tiramisu — the empirical
 * half of an audit. A project's schema.md can describe typed, differentiated-expiry entities
 * that its actual on-chain data doesn't match; this is what catches that gap.
 *
 * Deliberately uses only `.createdBy()` and `limit` — no attribute-name assumptions about the
 * target's schema, since Usalama doesn't know it in advance. What it *can* check without
 * guessing names: does anything carry an ordered (range-queryable) type at all, and do entities
 * cluster into more than one rough lifetime, or all share one.
 */
export async function probeWallet(client: PublicArkivClient, wallet: Hex, sampleSize = 50): Promise<LiveProbeResult> {
  const page = await client
    .select({ key: true, attributeSchema: true, expiresAt: true })
    .createdBy(wallet)
    .limit(sampleSize)
    .fetch()

  let withNumericAttrs = 0
  const lifetimeBuckets = new Set<bigint>()
  let anyPermanent = false
  // The max uint64 ExpirationTime.permanent() resolves to (see entity/params.ts's MAX_EXPIRES_AT) —
  // duplicated here rather than imported so this package doesn't need a dependency on the exact
  // internal constant just to recognise it; any expiry within a day of it is close enough to call permanent.
  const MAX_EXPIRES_AT = 2n ** 64n - 1n

  for (const entity of page.entities) {
    const schema = entity.attributeSchema ?? {}
    if (Object.values(schema).some((tag) => ORDERED_TYPE_TAGS.has(tag))) {
      withNumericAttrs++
    }
    if (entity.expiresAt !== undefined) {
      if (MAX_EXPIRES_AT - entity.expiresAt < BigInt(BLOCKS_PER_DAY)) {
        anyPermanent = true
      } else {
        lifetimeBuckets.add(entity.expiresAt / BigInt(BLOCKS_PER_DAY))
      }
    }
  }

  return {
    wallet,
    entitiesSampled: page.entities.length,
    entitiesWithNumericAttrs: withNumericAttrs,
    distinctLifetimeBuckets: lifetimeBuckets.size,
    anyPermanentEntities: anyPermanent,
  }
}

/** Probes every disclosed wallet and returns one result per wallet, in the order given. */
export async function probeWallets(client: PublicArkivClient, wallets: Hex[], sampleSize = 50): Promise<LiveProbeResult[]> {
  const results: LiveProbeResult[] = []
  for (const wallet of wallets) {
    results.push(await probeWallet(client, wallet, sampleSize))
  }
  return results
}

/**
 * Turns a probe's raw numbers into the same Finding shape the static rules produce, so live and
 * static evidence sit side by side in one report instead of two disconnected sections.
 */
export function liveProbeFindings(result: LiveProbeResult): Finding[] {
  const findings: Finding[] = []
  if (result.entitiesSampled === 0) {
    findings.push({
      ruleId: "live-no-entities-found",
      pillar: "security",
      severity: "warn",
      message: `No entities found created by ${result.wallet} on Tiramisu. Either this wallet hasn't written yet, or the disclosed address doesn't match what's actually on-chain.`,
    })
    return findings
  }
  if (result.entitiesWithNumericAttrs === 0) {
    findings.push({
      ruleId: "live-no-ordered-attrs",
      pillar: "dataDesign",
      severity: "warn",
      message: `None of ${result.entitiesSampled} sampled entities from ${result.wallet} carry an i32/u64/u256/dec attribute — nothing here is actually range-queryable on-chain, whatever schema.md claims.`,
    })
  }
  if (result.distinctLifetimeBuckets <= 1 && !result.anyPermanentEntities) {
    findings.push({
      ruleId: "live-undifferentiated-lifetimes",
      pillar: "dataDesign",
      severity: "info",
      message: `Sampled entities from ${result.wallet} cluster into a single rough lifetime bucket — worth checking this matches a genuinely single-purpose entity type, not every type sharing one expiry.`,
    })
  }
  if (result.anyPermanentEntities) {
    findings.push({
      ruleId: "live-permanent-entities-found",
      pillar: "dataDesign",
      severity: "info",
      message: `${result.wallet} has created at least one entity with an effectively permanent expiry. Confirm this is deliberate (see schema.md's own justification) rather than an unset expiry.`,
    })
  }
  return findings
}
