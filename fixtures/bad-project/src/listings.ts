import { eq } from "@arkiv-network/sdk/query"

// Bad: filters on a plain, writable "owner" attribute instead of $owner/$creator.
export async function myListings(client: any, me: string) {
  return client.select({ key: true, attributes: true }).where(eq("owner", me)).limit(50).fetch()
}

// Bad: a private-key-shaped literal sitting in source.
const DEV_KEY = "0xab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12"

export async function createListing(client: any) {
  // Bad: plaintext email right next to an Arkiv write call.
  const contact = "buyer@example.com"
  return client.createEntity({
    attributes: { contact },
    payload: new Uint8Array(),
    contentType: "application/json",
  })
}
