/**
 * Publishes Usalama's rule registry to Arkiv, once — so anyone can query exactly which rules
 * exist and what each one checks for, verifiably on-chain, without reading this repo's source.
 * This is the Open Source pillar made concrete: a third party could build their own dashboard or
 * re-implementation against this public registry alone.
 *
 * Re-running this script is safe but will publish duplicates — rule definitions are `readonly`,
 * so there's no "update in place"; if a rule's description changes, publish a new one and treat
 * the old entity as superseded (its id is still queryable for history).
 *
 * Run with: USALAMA_PRIVATE_KEY=0x... node --experimental-strip-types scripts/seed-rule-definitions.ts
 */
import { allRules, createWriteClient, publishRuleDefinitions } from "@usalama/core"

async function main() {
  const privateKey = process.env.USALAMA_PRIVATE_KEY as `0x${string}` | undefined
  if (!privateKey) {
    console.error("Set USALAMA_PRIVATE_KEY to a funded Tiramisu testnet private key. See README.md.")
    process.exitCode = 1
    return
  }

  const client = createWriteClient(privateKey)
  const definitions = allRules.map((r) => ({ id: r.id, pillar: r.pillar, description: r.description }))

  console.log(`Publishing ${definitions.length} rule definitions to Tiramisu...`)
  const results = await publishRuleDefinitions(client, definitions)

  for (const [i, result] of results.entries()) {
    console.log(`  ${definitions[i]?.id}: entity ${result.entityKey} (tx ${result.txHash})`)
  }
  console.log("\nDone.")
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
