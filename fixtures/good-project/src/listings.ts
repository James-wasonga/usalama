import { eq, gt } from "@arkiv-network/sdk/query"
import { i32 } from "@arkiv-network/sdk/attr"
import { createPublicClient } from "@arkiv-network/sdk"

// Good: filters by the real $creator/$owner primitives, not a writable attribute.
export async function myListings(client: ReturnType<typeof createPublicClient>, me: `0x${string}`) {
  return client
    .select({ key: true, attributes: true })
    .where(eq("status", "open"), gt("price", i32(0)))
    .ownedBy(me)
    .limit(50)
    .fetch()
}
